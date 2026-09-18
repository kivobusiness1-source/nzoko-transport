// ============================================================
// NZOKO TRANSPORT — Billetterie électronique
// QR = token aléatoire (AUCUNE donnée passager dedans).
// Anti-duplication : le statut VALID→USED est une transition atomique.
// ============================================================

import QRCode from "qrcode";
import { db } from "@/lib/db";
import { generateBoardingNumber, generateTicketToken } from "@/lib/security";
import type { Prisma, Ticket } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Numéro d'embarquement unique — collision gérée par la contrainte base (P2002). */
export async function issueTicketForBooking(tx: Tx, bookingId: string, _bookingReference: string): Promise<Ticket> {
  const existing = await tx.ticket.findUnique({ where: { bookingId } });
  if (existing) return existing; // idempotence — un seul billet par réservation

  // Le numéro est généré AVANT toute requête : la contrainte unique en base
  // rejette une collision (31^6 ≈ 887 M combinaisons — improbable) et on
  // retente avec un nouveau numéro. Typiquement UN seul INSERT.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tx.ticket.create({
        data: {
          bookingId,
          token: generateTicketToken(),
          boardingNumber: generateBoardingNumber(),
          status: "VALID",
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002" && attempt < 4) continue; // collision → nouveau numéro
      throw err;
    }
  }
  throw new Error("Impossible d'émettre le numéro d'embarquement (collisions répétées).");
}

/** QR PNG data URL pour l'affichage/impression du billet. */
export async function getTicketQrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, { margin: 1, width: 256, errorCorrectionLevel: "M" });
}

// ------------------------------------------------------------
// Contrôle d'embarquement (CHECKER)
// Validation atomique : deux scans simultanés → un seul embarquement.
// ------------------------------------------------------------
import type { ScanResultDTO } from "@/types";

interface BoardingContext {
  checkerUserId: string;
  checkerName: string;
  checkerAgencyId: string | null;
  isGlobal: boolean;
  ip: string | null;
}

export async function scanAndBoard(rawCode: string, ctx: BoardingContext): Promise<ScanResultDTO> {
  const code = rawCode.trim();
  if (!code) {
    return { result: "INVALID", message: "Code vide.", boarded: false, ticket: null };
  }

  // Le QR contient un token de billet. On accepte aussi une référence de
  // réservation (NZK-2026-…) ou un numéro d'embarquement (NZK-XXXXXX).
  const ticket = await db.ticket.findUnique({
    where: { token: code },
    include: {
      booking: {
        include: {
          trip: { include: { route: { include: { originCity: true, destinationCity: true } }, bus: true, agency: true } },
          seat: true,
          passenger: true,
          payment: true,
          agency: true,
        },
      },
      checkedBy: true,
    },
  });

  let target = ticket;
  if (!target) {
    const upper = code.toUpperCase();
    const isBoardingNumber = /^NZK-[A-Z2-9]{6}$/.test(upper) && !upper.startsWith("NZK-202");
    const booking = await db.booking.findFirst({
      where: isBoardingNumber
        ? { ticket: { boardingNumber: upper } }
        : { bookingReference: upper },
      include: { ticket: { include: { booking: { include: { trip: { include: { route: { include: { originCity: true, destinationCity: true } }, bus: true, agency: true } }, seat: true, passenger: true, payment: true, agency: true } }, checkedBy: true } } },
    });
    if (booking?.ticket) {
      target = booking.ticket as typeof ticket;
    }
  }

  if (!target) {
    await logScan(ctx, code, "INVALID");
    return { result: "INVALID", message: "Billet introuvable. Code invalide.", boarded: false, ticket: null };
  }

  const b = target.booking;
  const info = {
    reference: b.bookingReference,
    token: target.token,
    boardingNumber: target.boardingNumber,
    status: target.status as "VALID" | "USED" | "CANCELLED",
    passengerName: `${b.passenger.firstName} ${b.passenger.lastName}`,
    passengerPhone: b.passenger.phone,
    seatNumber: b.seat.seatNumber,
    seatType: b.seat.type as "STANDARD" | "VIP",
    tripCode: b.trip.code,
    originCityName: b.trip.route.originCity.name,
    destinationCityName: b.trip.route.destinationCity.name,
    departureTime: b.trip.departureTime.toISOString(),
    busRegistration: b.trip.bus.registrationNumber,
    agencyName: b.trip.agency.name,
    agencyAddress: b.trip.agency.address,
    checkedAt: target.checkedAt?.toISOString() ?? null,
    checkedByName: target.checkedBy
      ? `${target.checkedBy.firstName} ${target.checkedBy.lastName}`
      : null,
  };

  // Sécurité multi-agences : un checker ne contrôle que les voyages de son agence
  if (!ctx.isGlobal && b.trip.agencyId !== ctx.checkerAgencyId) {
    await logScan(ctx, code, "WRONG_AGENCY");
    return {
      result: "WRONG_AGENCY",
      message: "Ce billet appartient à une autre agence.",
      boarded: false,
      ticket: info,
    };
  }

  if (target.status === "CANCELLED") {
    await logScan(ctx, code, "INVALID");
    return { result: "INVALID", message: "Billet annulé.", boarded: false, ticket: info };
  }

  // Le paiement doit être confirmé côté serveur (jamais sur parole du scan)
  const paid = b.payment.some((p) => p.status === "SUCCESS");
  if (!paid) {
    await logScan(ctx, code, "PAYMENT_NOT_CONFIRMED");
    return {
      result: "PAYMENT_NOT_CONFIRMED",
      message: "Paiement non confirmé pour ce billet.",
      boarded: false,
      ticket: info,
    };
  }

  if (b.trip.status === "CANCELLED") {
    await logScan(ctx, code, "TRIP_CANCELLED");
    return { result: "TRIP_CANCELLED", message: "Ce voyage a été annulé.", boarded: false, ticket: info };
  }

  if (target.status === "USED") {
    await logScan(ctx, code, "ALREADY_USED");
    return {
      result: "ALREADY_USED",
      message: `Billet DÉJÀ UTILISÉ le ${target.checkedAt ? new Date(target.checkedAt).toLocaleString("fr-FR") : "?"}.`,
      boarded: false,
      ticket: { ...info, checkedAt: target.checkedAt?.toISOString() ?? null },
    };
  }

  // ⚠️ Transition atomique VALID → USED : si deux checkers scannent en même
  // temps, updateMany ne modifie qu'une seule ligne — l'autre reçoit ALREADY_USED.
  const result = await db.ticket.updateMany({
    where: { id: target.id, status: "VALID" },
    data: { status: "USED", checkedAt: new Date(), checkedById: ctx.checkerUserId },
  });

  if (result.count === 0) {
    const refreshed = await db.ticket.findUnique({ where: { id: target.id } });
    await logScan(ctx, code, "ALREADY_USED");
    return {
      result: "ALREADY_USED",
      message: "Billet DÉJÀ UTILISÉ (embarquement concurrent).",
      boarded: false,
      ticket: { ...info, checkedAt: refreshed?.checkedAt?.toISOString() ?? null },
    };
  }

  await logScan(ctx, code, "VALID");
  return {
    result: "VALID",
    message: `✓ EMBARQUEMENT VALIDÉ — ${info.passengerName}, siège ${info.seatNumber}.`,
    boarded: true,
    ticket: { ...info, checkedAt: new Date().toISOString() },
  };
}

async function logScan(ctx: BoardingContext, code: string, result: string): Promise<void> {
  await db.auditLog
    .create({
      data: {
        userId: ctx.checkerUserId,
        action: "TICKET_SCANNED",
        entity: "Ticket",
        entityId: code.slice(0, 40),
        metadata: JSON.stringify({ result }),
        ipAddress: ctx.ip,
      },
    })
    .catch(() => {});
}
