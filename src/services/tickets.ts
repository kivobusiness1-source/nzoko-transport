// ============================================================
// OCÉAN DU NORD — Billetterie électronique
// QR = token aléatoire (AUCUNE donnée passager dedans).
// Anti-duplication : le statut VALID→USED est une transition atomique.
// ============================================================

import QRCode from "qrcode";
import { db } from "@/lib/db";
import { emitDomainEvent } from "@/services/domain-events";
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
// Validation atomique : deux checkers scannent en même temps → un seul embarquement.
// Embarquement PAR PLACE (extension §24 — passagers nommés) : une réservation
// multi-places émet UN billet (QR) mais embarque chaque voyageur individuellement.
//   - preview:true            → toutes les vérifications, AUCUNE mutation
//   - seatNumbers undefined   → tout le groupe embarque (comportement historique)
//   - seatNumbers:[...]       → seules ces places sont marquées embarquées
// Un billet déjà USED peut compléter ses places restantes (passagers retardataires).
// ------------------------------------------------------------
import type { ScanResultDTO } from "@/types";

interface BoardingContext {
  checkerUserId: string;
  checkerName: string;
  checkerAgencyId: string | null;
  isGlobal: boolean;
  ip: string | null;
}

interface BoardingOptions {
  /** Places à embarquer (numéros). Absent = tout le groupe. */
  seatNumbers?: string[];
  /** Mode aperçu : vérifie sans embarquer (sélection des passagers du groupe). */
  preview?: boolean;
}

const bookingIncludeForScan = {
  trip: { include: { route: { include: { originCity: true, destinationCity: true } }, bus: true, agency: true } },
  seat: true, // place principale (compat) — liste complète dans occupancies
  passenger: true,
  payment: true,
  agency: true,
  occupancies: {
    include: { seat: true, passenger: { select: { firstName: true, lastName: true } } },
    orderBy: { seatId: "asc" as const },
  },
} satisfies Prisma.BookingInclude;

/** Ticket + réservation chargés pour le scan (token direct ou référence/numéro). */
async function findScannableTicket(code: string) {
  const ticket = await db.ticket.findUnique({
    where: { token: code },
    include: { booking: { include: bookingIncludeForScan }, checkedBy: true },
  });
  if (ticket) return ticket;

  const upper = code.toUpperCase();
  const isBoardingNumber = /^NZK-[A-Z2-9]{6}$/.test(upper) && !upper.startsWith("NZK-202");
  const booking = await db.booking.findFirst({
    where: isBoardingNumber ? { ticket: { boardingNumber: upper } } : { bookingReference: upper },
    include: { ticket: { include: { booking: { include: bookingIncludeForScan }, checkedBy: true } } },
  });
  return booking?.ticket ?? null;
}

export async function scanAndBoard(
  rawCode: string,
  ctx: BoardingContext,
  options: BoardingOptions = {}
): Promise<ScanResultDTO> {
  const code = rawCode.trim();
  if (!code) {
    return { result: "INVALID", message: "Code vide.", boarded: false, ticket: null };
  }

  const target = await findScannableTicket(code);

  if (!target) {
    await logScan(ctx, code, "INVALID");
    return { result: "INVALID", message: "Billet introuvable. Code invalide.", boarded: false, ticket: null };
  }

  const b = target.booking;

  // ---- Liste des places du groupe (extension passagers nommés) ----
  // Fallback héritage : un ticket USED SANS aucune place datée (réservation
  // antérieure à l'extension) marque TOUTES ses places embarquées. Dès qu'UNE
  // place porte boardedAt, les données par place font foi (embarquement partiel).
  const hasAnyBoarded = b.occupancies.some((o) => o.boardedAt !== null);
  const legacyBoardedAt = target.status === "USED" && !hasAnyBoarded ? target.checkedAt : null;
  const seats = b.occupancies.map((o) => {
    const passenger = o.passenger ?? b.passenger;
    const boardedAt = o.boardedAt ?? legacyBoardedAt;
    return {
      seatNumber: o.seat.seatNumber,
      seatType: o.seat.type as "STANDARD" | "VIP",
      passengerName: `${passenger.firstName} ${passenger.lastName}`,
      isBuyer: o.passengerId === null || o.passengerId === b.passengerId,
      boardedAt: boardedAt ? boardedAt.toISOString() : null,
      occupancyId: o.id,
      seatId: o.seatId,
    };
  });

  // Champs historiques (compat) : passager acheteur + place principale.
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
    seats: seats.map(({ seatNumber, seatType, passengerName, isBuyer, boardedAt }) => ({
      seatNumber,
      seatType,
      passengerName,
      isBuyer,
      boardedAt,
    })),
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

  // ---- Résolution des places ciblées ----
  const requested = options.seatNumbers?.map((s) => s.trim()).filter(Boolean);
  let selected = seats;
  if (requested && requested.length > 0) {
    const wanted = new Set(requested);
    selected = seats.filter((s) => wanted.has(s.seatNumber));
    if (selected.length === 0) {
      return {
        result: "INVALID",
        message: "Aucune place connue dans la sélection.",
        boarded: false,
        ticket: info,
      };
    }
  }
  const pending = selected.filter((s) => s.boardedAt === null);
  const allGroupBoarded = seats.every((s) => s.boardedAt !== null);

  // Aperçu : vérifications faites, AUCUNE mutation — le contrôleur choisit
  // les voyageurs présents quand le billet couvre plusieurs places.
  if (options.preview) {
    if (allGroupBoarded) {
      await logScan(ctx, code, "ALREADY_USED");
      return {
        result: "ALREADY_USED",
        message: `Groupe déjà embarqué${target.checkedAt ? ` le ${new Date(target.checkedAt).toLocaleString("fr-FR")}` : ""}.`,
        boarded: false,
        ticket: info,
      };
    }
    await logScan(ctx, code, "PREVIEW");
    return { result: "VALID", message: "Aperçu du billet (aucun embarquement effectué).", boarded: false, preview: true, ticket: info };
  }

  // Groupe entièrement embarqué sans sélection explicite → refus classique.
  if (allGroupBoarded) {
    await logScan(ctx, code, "ALREADY_USED");
    return {
      result: "ALREADY_USED",
      message: `Billet DÉJÀ UTILISÉ${target.checkedAt ? ` le ${new Date(target.checkedAt).toLocaleString("fr-FR")}` : ""}.`,
      boarded: false,
      ticket: info,
    };
  }

  // Places restantes = cibles par défaut (tout le groupe).
  const toBoard = pending.length > 0 ? pending : selected;
  if (toBoard.length === 0) {
    await logScan(ctx, code, "ALREADY_USED");
    return {
      result: "ALREADY_USED",
      message: "Toutes les places sélectionnées sont déjà embarquées.",
      boarded: false,
      ticket: info,
    };
  }

  const now = new Date();
  const boardingNames = toBoard.map((s) => `${s.passengerName} (${s.seatNumber})`).join(", ");

  // ⚠️ Transitions atomiques :
  //  - billet VALID → USED : updateMany conditionnel — deux scans simultanés
  //    ne modifient qu'une ligne, l'autre reçoit ALREADY_USED ;
  //  - places : updateMany { boardedAt: null } → { boardedAt: now } sur les
  //    SEULES places ciblées (idempotent — rejouer ne double-datera pas).
  if (target.status === "VALID") {
    const ticketUpdate = await db.ticket.updateMany({
      where: { id: target.id, status: "VALID" },
      data: { status: "USED", checkedAt: now, checkedById: ctx.checkerUserId },
    });
    if (ticketUpdate.count === 0) {
      const refreshed = await db.ticket.findUnique({ where: { id: target.id } });
      await logScan(ctx, code, "ALREADY_USED");
      return {
        result: "ALREADY_USED",
        message: "Billet DÉJÀ UTILISÉ (embarquement concurrent).",
        boarded: false,
        ticket: { ...info, checkedAt: refreshed?.checkedAt?.toISOString() ?? null },
      };
    }
  }

  const occupancyUpdate = await db.seatOccupancy.updateMany({
    where: { id: { in: toBoard.map((s) => s.occupancyId) }, boardedAt: null },
    data: { boardedAt: now },
  });

  if (occupancyUpdate.count === 0) {
    await logScan(ctx, code, "ALREADY_USED");
    return {
      result: "ALREADY_USED",
      message: "Toutes les places sélectionnées sont déjà embarquées (embarquement concurrent).",
      boarded: false,
      ticket: info,
    };
  }

  // Événements (contrat §14) : chaque place passe BOARDED — visible sur le
  // plan de sièges temps réel des deux sites. Best-effort, après la transaction.
  await Promise.all(
    toBoard.map((s) =>
      emitDomainEvent({
        type: "TICKET_BOARDED",
        aggregateType: "Ticket",
        aggregateId: target.id,
        tripId: b.tripId,
        bookingId: b.id,
        payload: { reference: b.bookingReference, seatNumber: s.seatNumber },
      }).catch(() => {})
    )
  );

  await logScan(ctx, code, "VALID");
  const suffix = seats.length > 1 ? ` — ${toBoard.length}/${seats.length} place(s) à bord` : "";
  return {
    result: "VALID",
    message: `✓ EMBARQUEMENT VALIDÉ — ${boardingNames}${suffix}.`,
    boarded: true,
    ticket: {
      ...info,
      seats: info.seats.map((s) => ({
        ...s,
        boardedAt: toBoard.some((t2) => t2.seatNumber === s.seatNumber) ? now.toISOString() : s.boardedAt,
      })),
      checkedAt: target.status === "VALID" ? now.toISOString() : info.checkedAt,
    },
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
