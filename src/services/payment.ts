// ============================================================
// OCÉAN DU NORD — Moteur de paiement
// Architecture indépendante des fournisseurs (PaymentProviderInterface).
//
// MTN MoMo : intégration RÉELLE via l'API officielle
// (https://momodeveloper.mtn.com) — collections (Request to Pay) et
// disbursements (Transfer/Refund) dans src/services/momo.ts.
// Airtel Money : intégration officielle non activée — refus explicite 501.
// Les vérifications serveur sont idempotentes (webhook, confirmation, QR).
// ============================================================

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { hmacSha256, timingSafeEqual, safeJsonParse } from "@/lib/security";
import { logAudit, logSecurity } from "@/lib/audit";
import { issueTicketForBooking } from "@/services/tickets";
import { awardPointsForBooking } from "@/services/loyalty";
import { emitDomainEvents, emitDomainEvent } from "@/services/domain-events";
import { toPaymentDTO } from "@/services/payment-mappers";
import {
  momoCollectionConfigured,
  momoDisbursementConfigured,
  momoConfigStatus,
  momoCurrency,
  momoRequestToPay,
  momoGetRequestToPayStatus,
  momoRefund,
  momoTransfer,
  momoGetRefundStatus,
  momoGetTransferStatus,
  momoGetBalance,
  toMomoMsisdn,
  momoFailureMessage,
} from "@/services/momo";
import type { PaymentDTO, PayBookingInput, RefundPaymentInput, MomoOverviewDTO, MomoBalanceDTO } from "@/types";

// ------------------------------------------------------------
// Interface fournisseur — chaque provider officiel doit
// implémenter initialize/verify/refund avec ses clés .env.
// ------------------------------------------------------------

export interface ProviderContext {
  paymentId: string;
  amount: number;
  phone?: string;
  senderName?: string;
  bookingReference?: string;
}

export interface ProviderResult {
  status: "PENDING" | "PROCESSING";
  providerTransactionId: string | null;
  instructions: string | null;
}

export interface PaymentProviderInterface {
  code: string;
  name: string;
  isConfigured(): boolean; // clés officielles présentes ?
  initializePayment(ctx: ProviderContext): Promise<ProviderResult>;
  verifyPayment(providerTransactionId: string): Promise<"SUCCESS" | "PROCESSING" | "FAILED">;
  refundPayment(providerTransactionId: string): Promise<boolean>;
}

// --- Espèces (guichet) : pleinement fonctionnel ---
const cashProvider: PaymentProviderInterface = {
  code: "CASH",
  name: "Espèces",
  isConfigured: () => true,
  async initializePayment(ctx) {
    return {
      status: "PENDING",
      providerTransactionId: `CASH-${ctx.paymentId.slice(-8)}`,
      instructions: "Paiement en espèces : à encaisser au guichet avant l'émission du billet.",
    };
  },
  async verifyPayment() {
    return "PROCESSING"; // confirmé par l'agent via confirm-cash
  },
  async refundPayment() {
    return true; // remboursement physique — journalisé
  },
};

// --- MTN MoMo : intégration officielle (Request to Pay) ---
const mtnMomoProvider: PaymentProviderInterface = {
  code: "MTN_MOMO",
  name: "MTN Mobile Money",
  isConfigured() {
    return momoCollectionConfigured();
  },
  async initializePayment(ctx) {
    if (!this.isConfigured()) {
      throw new ApiError(
        503,
        "MOMO_NOT_CONFIGURED",
        "Paiement MTN MoMo non configuré. Renseignez les clés MOMO_COLLECTION_* (voir README)."
      );
    }
    // ---- Request to Pay réel ----
    if (!ctx.phone) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Numéro Mobile Money requis.");
    }
    const msisdn = toMomoMsisdn(ctx.phone); // 400 si invalide
    const referenceId = randomUUID(); // X-Reference-Id — idempotence MoMo

    await momoRequestToPay({
      referenceId,
      amount: ctx.amount,
      currency: momoCurrency(),
      externalId: ctx.bookingReference ?? ctx.paymentId,
      msisdn,
      payerMessage: ctx.bookingReference
        ? `Billet ${ctx.bookingReference} — OCÉAN DU NORD`
        : "OCÉAN DU NORD",
      payeeNote: `Paiement billet ${ctx.bookingReference ?? ""}`.trim(),
    });

    return {
      status: "PROCESSING",
      providerTransactionId: referenceId,
      instructions:
        "Demande de paiement envoyée sur votre téléphone. Validez-la depuis votre application MTN MoMo ou le menu MoMo de votre SIM, puis patientez quelques secondes.",
    };
  },
  async verifyPayment(providerTransactionId) {
    if (!this.isConfigured()) return "PROCESSING";
    const st = await momoGetRequestToPayStatus(providerTransactionId);
    return st.status === "SUCCESSFUL" ? "SUCCESS" : st.status === "FAILED" ? "FAILED" : "PROCESSING";
  },
  async refundPayment(providerTransactionId) {
    if (!momoDisbursementConfigured()) return false;
    await momoRefund({
      referenceId: randomUUID(),
      amount: 0, // remplacé par le contexte réel dans initiatePaymentRefund
      currency: momoCurrency(),
      externalId: providerTransactionId,
      referenceIdToRefund: providerTransactionId,
    });
    return true; // initiation acceptée — suivi par pollPaymentRefundStatus
  },
};

// --- Airtel Money : intégration officielle non activée ---
const airtelProvider: PaymentProviderInterface = {
  code: "AIRTEL_MONEY",
  name: "Airtel Money",
  isConfigured() {
    return Boolean(process.env.AIRTEL_MONEY_API_KEY && process.env.AIRTEL_MONEY_API_SECRET);
  },
  async initializePayment() {
    throw new ApiError(
      501,
      "INTEGRATION_PENDING",
      "Intégration Airtel Money non activée. Utilisez MTN Mobile Money ou les espèces."
    );
  },
  async verifyPayment() {
    return "PROCESSING";
  },
  async refundPayment() {
    return false; // à implémenter avec l'API officielle
  },
};

// --- Carte / virement : confirmation manuelle (comptable/admin) ---
const manualProvider = (code: "CARD" | "BANK_TRANSFER", name: string): PaymentProviderInterface => ({
  code,
  name,
  isConfigured: () => true,
  async initializePayment() {
    return {
      status: "PENDING",
      providerTransactionId: null,
      instructions:
        code === "CARD"
          ? "Paiement par carte : à confirmer manuellement par un administrateur après réception."
          : "Virement bancaire : à confirmer manuellement par un comptable après réception du justificatif.",
    };
  },
  async verifyPayment() {
    return "PROCESSING";
  },
  async refundPayment() {
    return true;
  },
});

const PROVIDERS: Record<string, PaymentProviderInterface> = {
  CASH: cashProvider,
  MTN_MOMO: mtnMomoProvider,
  AIRTEL_MONEY: airtelProvider,
  CARD: manualProvider("CARD", "Carte bancaire"),
  BANK_TRANSFER: manualProvider("BANK_TRANSFER", "Virement bancaire"),
};

export function getProvider(code: string): PaymentProviderInterface {
  const provider = PROVIDERS[code];
  if (!provider) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Mode de paiement inconnu.");
  return provider;
}

// ------------------------------------------------------------
// Métadonnées JSON du paiement (helpers typés)
// ------------------------------------------------------------

interface PaymentMetadata {
  instructions?: string | null;
  momoPhone?: string | null;
  senderName?: string | null;
  ip?: string | null;
  reason?: string | null;
  momo?: {
    product: "collection";
    referenceId: string;
    msisdn: string;
    currency: string;
    environment: string;
    financialTransactionId?: string | null;
    reasonCode?: string | null;
    reason?: string | null;
  };
  refund?: {
    mode: RefundPaymentInput["mode"];
    status: "PROCESSING" | "SUCCESSFUL" | "FAILED";
    amount: number;
    referenceId?: string | null;
    msisdn?: string | null;
    reason?: string | null;
    reasonCode?: string | null;
    initiatedByName?: string | null;
    initiatedAt: string;
    confirmedAt?: string | null;
    financialTransactionId?: string | null;
  };
}

function parseMetadata(raw: string | null): PaymentMetadata {
  return safeJsonParse<PaymentMetadata>(raw ?? "{}", {});
}

async function writeMetadata(paymentId: string, mutate: (meta: PaymentMetadata) => PaymentMetadata): Promise<void> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, select: { metadata: true } });
  if (!payment) return;
  const next = mutate(parseMetadata(payment.metadata));
  await db.payment.update({ where: { id: paymentId }, data: { metadata: JSON.stringify(next) } });
}

// Relit un paiement avec ses relations après mutation — lève 404 plutôt
// qu'une assertion non-null (le paiement vient d'être écrit : absence =
// suppression concurrente, signalée proprement à l'appelant).
async function refetchPayment(paymentId: string) {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { createdBy: true, booking: true } });
  if (!payment) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Paiement introuvable.");
  }
  return payment;
}

// ------------------------------------------------------------
// Création d'un paiement
// ------------------------------------------------------------

export async function createPayment(
  input: PayBookingInput,
  ctx: { actorUserId?: string | null; ip?: string | null }
): Promise<PaymentDTO> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { trip: true, payment: true },
  });
  if (!booking) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réservation introuvable.");
  if (booking.status !== "PENDING") {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Cette réservation n'est plus en attente de paiement.");
  }
  if (booking.expiresAt && booking.expiresAt < new Date()) {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Le délai de réservation a expiré. Veuillez réserver à nouveau.");
  }
  if (booking.payment.some((p) => ["PENDING", "PROCESSING", "SUCCESS"].includes(p.status))) {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Un paiement est déjà en cours pour cette réservation.");
  }

  const provider = getProvider(input.provider);

  // MTN MoMo réel : validation E.164 AVANT toute écriture (400 propre, aucune ligne créée)
  let momoPhone = input.momoPhone;
  if (input.provider === "MTN_MOMO" && provider.isConfigured()) {
    if (!momoPhone) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Numéro Mobile Money requis.");
    momoPhone = toMomoMsisdn(momoPhone);
  }

  const payment = await db.payment.create({
    data: {
      bookingId: booking.id,
      provider: input.provider,
      amount: booking.amount,
      status: "PENDING",
      createdById: ctx.actorUserId ?? null,
    },
  });

  let result: ProviderResult;
  try {
    result = await provider.initializePayment({
      paymentId: payment.id,
      amount: booking.amount,
      phone: momoPhone,
      senderName: input.senderName,
      bookingReference: booking.bookingReference,
    });
  } catch (err) {
    // Échec d'initialisation fournisseur (ex : numéro MoMo introuvable) →
    // le paiement est marqué FAILED (réessayable) et l'erreur remonte au client.
    const reason = err instanceof ApiError ? err.message : "Initialisation du paiement impossible.";
    await db.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", metadata: JSON.stringify({ reason }) },
    });
    throw err;
  }

  const momoMeta: PaymentMetadata["momo"] | undefined =
    input.provider === "MTN_MOMO" && result.providerTransactionId
      ? {
          product: "collection",
          referenceId: result.providerTransactionId,
          msisdn: momoPhone ?? "",
          currency: momoCurrency(),
          environment: momoConfigStatus().environment,
        }
      : undefined;

  const updated = await db.payment.update({
    where: { id: payment.id },
    data: {
      status: result.status,
      providerTransactionId: result.providerTransactionId,
      metadata: JSON.stringify({
        instructions: result.instructions,
        momoPhone: momoPhone ?? null,
        senderName: input.senderName ?? null,
        ip: ctx.ip ?? null,
        ...(momoMeta ? { momo: momoMeta } : {}),
      }),
    },
    include: { createdBy: true, booking: true },
  });

  await logAudit({
    userId: ctx.actorUserId ?? null,
    action: "PAYMENT_INITIALIZED",
    entity: "Payment",
    entityId: payment.id,
    metadata: {
      provider: input.provider,
      amount: booking.amount,
      ...(result.providerTransactionId ? { momoReferenceId: result.providerTransactionId } : {}),
    },
    ipAddress: ctx.ip ?? null,
  });

  return toPaymentDTO(updated);
}

// ------------------------------------------------------------
// Confirmation idempotente + émission billet
// Cœur du système : appelée par cash, webhook, confirmation manuelle.
// ------------------------------------------------------------

export async function confirmPaymentAndIssueTicket(
  paymentId: string,
  actorUserId: string | null,
  ip: string | null
): Promise<{ payment: PaymentDTO; alreadyConfirmed: boolean }> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { booking: true, createdBy: true } });
  if (!payment) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Paiement introuvable.");

  if (payment.status === "SUCCESS") {
    return { payment: toPaymentDTO(payment), alreadyConfirmed: true }; // idempotence stricte
  }
  if (payment.status !== "PENDING" && payment.status !== "PROCESSING") {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Ce paiement ne peut plus être confirmé.");
  }

  // ⚠️ NOYAU ATOMIQUE COURT : pooler Neon (PgBouncer transaction-mode), la
  // transaction interactive doit rester < quelques secondes de latence cumulée
  // (P2028 « Transaction not found » au-delà). Anti-double-confirmation ET
  // billet émis exactement une fois (contrainte unique bookingId) :
  // 6 requêtes au lieu de ~13. La fidélité/promo (idempotentes par conception)
  // sont rejouées APRÈS la transaction, en best-effort.
  await db.$transaction(async (tx) => {
    // Re-vérification atomique du statut dans la transaction
    const fresh = await tx.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    if (!fresh || fresh.status !== payment.status) {
      throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Le paiement a changé d'état concurrentiellement.");
    }

    await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCESS" } });
    await tx.booking.update({ where: { id: payment.bookingId }, data: { status: "CONFIRMED" } });
    await tx.seatOccupancy.updateMany({
      where: { bookingId: payment.bookingId },
      data: { status: "BOOKED", expiresAt: null },
    });

    // Billet émis exactement une fois (contrainte unique bookingId)
    await issueTicketForBooking(tx, payment.bookingId, payment.booking.bookingReference);

    // Écriture comptable idempotente (référence unique)
    await tx.transaction.create({
      data: {
        type: "INCOME",
        amount: payment.amount,
        reference: payment.booking.bookingReference,
        description: `Vente billet ${payment.booking.bookingReference} (${payment.provider})`,
        agencyId: payment.booking.agencyId,
        paymentId: payment.id,
        createdById: actorUserId,
      },
    });
  });

  // ---------- Post-traitement idempotent (hors transaction) ----------
  // Événements de domaine (contrat §14) : le paiement est LA transition
  // critique multi-sites — le SITE AGENCES voit la place passer PAID,
  // le SITE CLIENT reçoit la confirmation de son billet. Best-effort.
  const confirmedBooking = await db.booking.findUnique({
    where: { id: payment.bookingId },
    select: {
      tripId: true,
      bookingReference: true,
      occupancies: { select: { seatId: true } },
      ticket: { select: { id: true } },
    },
  }).catch(() => null);
  if (confirmedBooking) {
    await emitDomainEvents([
      {
        type: "PAYMENT_SUCCESS",
        aggregateType: "Payment",
        aggregateId: payment.id,
        tripId: confirmedBooking.tripId,
        bookingId: payment.bookingId,
        payload: { provider: payment.provider, amount: payment.amount },
      },
      {
        type: "BOOKING_CONFIRMED",
        aggregateType: "Booking",
        aggregateId: payment.bookingId,
        tripId: confirmedBooking.tripId,
        bookingId: payment.bookingId,
        payload: { reference: confirmedBooking.bookingReference },
      },
      ...confirmedBooking.occupancies.map((o) => ({
        type: "SEAT_PAID" as const,
        aggregateType: "Seat" as const,
        aggregateId: o.seatId,
        tripId: confirmedBooking.tripId,
        bookingId: payment.bookingId,
        payload: {},
      })),
      ...(confirmedBooking.ticket
        ? [{
            type: "TICKET_CREATED" as const,
            aggregateType: "Ticket" as const,
            aggregateId: confirmedBooking.ticket.id,
            tripId: confirmedBooking.tripId,
            bookingId: payment.bookingId,
            payload: { reference: confirmedBooking.bookingReference },
          }]
        : []),
    ]);
  }

  // Points fidélité : bookingId unique sur LoyaltyTransaction — un paiement
  // rejoué ne double JAMAIS les points. Passager anonyme → silencieux.
  await awardPointsForBooking(db, payment.bookingId).catch(() => {});

  // Code promo appliqué : consommation du crédit d'usage (best-effort).
  if (payment.booking.promoCode) {
    await db.promoCode
      .updateMany({
        where: { code: payment.booking.promoCode },
        data: { usedCount: { increment: 1 } },
      })
      .catch(() => {});
  }

  await logAudit({
    userId: actorUserId,
    action: "PAYMENT_CONFIRMED",
    entity: "Payment",
    entityId: payment.id,
    metadata: { provider: payment.provider, amount: payment.amount, booking: payment.booking.bookingReference },
    ipAddress: ip,
  });

  const final = await refetchPayment(paymentId);
  return { payment: toPaymentDTO(final), alreadyConfirmed: false };
}

// Confirmation espèces par un agent (permission payment:cash-collect)
export async function confirmCashPayment(paymentId: string, actorUserId: string, ip: string | null): Promise<PaymentDTO> {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Paiement introuvable.");
  if (payment.provider !== "CASH") {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Cette confirmation ne concerne qu'un paiement en espèces.");
  }
  const { payment: dto } = await confirmPaymentAndIssueTicket(paymentId, actorUserId, ip);
  return dto;
}

// ------------------------------------------------------------
// MTN MoMo — suivi Request to Pay (polling public, idempotent)
// Référence : GET /collection/v1_0/requesttopay/{referenceId}
// ------------------------------------------------------------

export async function pollMomoPaymentStatus(
  paymentId: string,
  ctx: { actorUserId?: string | null; ip?: string | null }
): Promise<PaymentDTO> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { createdBy: true, booking: true } });
  if (!payment) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Paiement introuvable.");
  if (payment.provider !== "MTN_MOMO") {
    throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Ce paiement n'est pas un paiement MTN Mobile Money.");
  }
  // Statut déjà final → réponse idempotente (pas d'appel MTN inutile)
  if (payment.status !== "PENDING" && payment.status !== "PROCESSING") {
    return toPaymentDTO(payment);
  }
  if (!payment.providerTransactionId) {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Référence de transaction MoMo introuvable pour ce paiement.");
  }

  const status = await momoGetRequestToPayStatus(payment.providerTransactionId);

  if (status.status === "SUCCESSFUL") {
    // Confirmation idempotente (billet + écriture comptable) — le cœur existant
    await confirmPaymentAndIssueTicket(paymentId, ctx.actorUserId ?? null, ctx.ip ?? null);
    await writeMetadata(paymentId, (m) => ({
      ...m,
      momo: m.momo
        ? { ...m.momo, financialTransactionId: status.financialTransactionId }
        : m.momo,
    }));
    return toPaymentDTO(await refetchPayment(paymentId));
  }

  if (status.status === "FAILED") {
    await db.payment.update({ where: { id: paymentId }, data: { status: "FAILED" } });
    await writeMetadata(paymentId, (m) => ({
      ...m,
      reason: momoFailureMessage(status),
      momo: m.momo ? { ...m.momo, reasonCode: status.reasonCode, reason: status.reasonMessage } : m.momo,
    }));
    await logAudit({
      userId: ctx.actorUserId ?? null,
      action: "MOMO_PAYMENT_FAILED",
      entity: "Payment",
      entityId: paymentId,
      metadata: { reasonCode: status.reasonCode, booking: payment.booking.bookingReference },
      ipAddress: ctx.ip ?? null,
    });
    return toPaymentDTO(await refetchPayment(paymentId));
  }

  // Toujours PENDING côté MTN
  return toPaymentDTO(payment);
}

// ------------------------------------------------------------
// MTN MoMo — REMBOURSEMENTS (envoi de fonds aux clients)
// Modes : MOMO_REFUND (Refund API, référence R2P d'origine),
//         MOMO_TRANSFER (Transfer vers un MSISDN),
//         CASH (espèces rendues au guichet — finalisation immédiate).
// ------------------------------------------------------------

async function finalizeRefund(
  paymentId: string,
  mode: RefundPaymentInput["mode"],
  refundMeta: NonNullable<PaymentMetadata["refund"]>,
  actorUserId: string | null,
  ip: string | null,
  financialTransactionId: string | null
): Promise<void> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { booking: true } });
  if (!payment) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Paiement introuvable.");

  const confirmedMeta: NonNullable<PaymentMetadata["refund"]> = {
    ...refundMeta,
    status: "SUCCESSFUL",
    confirmedAt: new Date().toISOString(),
    financialTransactionId,
  };

  await db.$transaction(async (tx) => {
    // Statut + métadonnées de remboursement de façon ATOMIQUE (même transaction)
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "REFUNDED",
        metadata: JSON.stringify({ ...parseMetadata(payment.metadata), refund: confirmedMeta }),
      },
    });
    // Écriture comptable REFUND (aucun doublon possible : le statut REFUNDED
    // fait échouer toute nouvelle tentative de remboursement ensuite)
    await tx.transaction.create({
      data: {
        type: "REFUND",
        amount: refundMeta.amount,
        reference: payment.booking.bookingReference,
        description: `Remboursement billet ${payment.booking.bookingReference} (${
          mode === "CASH" ? "espèces" : mode === "MOMO_REFUND" ? "MTN MoMo — remboursement" : "MTN MoMo — transfert"
        }${refundMeta.msisdn ? ` vers ${refundMeta.msisdn}` : ""})`,
        agencyId: payment.booking.agencyId,
        paymentId: paymentId,
        createdById: actorUserId,
      },
    });
  });

  await logAudit({
    userId: actorUserId,
    action: "REFUND_CONFIRMED",
    entity: "Payment",
    entityId: paymentId,
    metadata: { mode, amount: refundMeta.amount, booking: payment.booking.bookingReference, financialTransactionId },
    ipAddress: ip,
  });
}

export async function initiatePaymentRefund(
  paymentId: string,
  input: RefundPaymentInput,
  ctx: { userId: string; userName: string; ip?: string | null }
): Promise<PaymentDTO> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { booking: true, createdBy: true } });
  if (!payment) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Paiement introuvable.");
  if (payment.status !== "SUCCESS") {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Seul un paiement réussi peut être remboursé.");
  }
  const meta = parseMetadata(payment.metadata);
  if (meta.refund?.status === "PROCESSING" || meta.refund?.status === "SUCCESSFUL") {
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Un remboursement est déjà en cours ou terminé pour ce paiement.");
  }
  if (input.amount !== undefined && (input.amount <= 0 || input.amount > payment.amount)) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Montant de remboursement invalide.");
  }
  const refundAmount = input.amount ?? payment.amount;
  const bookingRef = payment.booking.bookingReference;

  // ---- Espèces : finalisation immédiate ----
  if (input.mode === "CASH") {
    const refundMeta: NonNullable<PaymentMetadata["refund"]> = {
      mode: "CASH",
      status: "PROCESSING",
      amount: refundAmount,
      initiatedByName: ctx.userName,
      initiatedAt: new Date().toISOString(),
    };
    await finalizeRefund(paymentId, "CASH", refundMeta, ctx.userId, ctx.ip ?? null, null);
    return toPaymentDTO(await refetchPayment(paymentId));
  }

  // ---- Modes MoMo : disbursement obligatoire ----
  if (!momoDisbursementConfigured()) {
    throw new ApiError(
      503,
      "MOMO_NOT_CONFIGURED",
      "Remboursement MTN MoMo non configuré. Renseignez les clés MOMO_DISBURSEMENT_* (voir README)."
    );
  }
  const referenceId = randomUUID();
  let msisdn: string | null = null;

  if (input.mode === "MOMO_REFUND") {
    if (payment.provider !== "MTN_MOMO" || !payment.providerTransactionId) {
      throw new ApiError(
        409,
        ERROR_CODES.PAYMENT_ERROR,
        "Le remboursement automatique MTN nécessite un paiement MTN MoMo (transaction d'origine requise)."
      );
    }
    await momoRefund({
      referenceId,
      amount: refundAmount,
      currency: momoCurrency(),
      externalId: bookingRef,
      referenceIdToRefund: payment.providerTransactionId,
      payerMessage: `Remboursement billet ${bookingRef}`,
      payeeNote: "Remboursement OCÉAN DU NORD",
    });
  } else {
    // MOMO_TRANSFER — envoi de fonds vers le MSISDN du passager (ou saisi)
    const rawPhone: string | null = input.msisdn ?? meta.momoPhone ?? null;
    if (!rawPhone) throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Numéro Mobile Money du bénéficiaire requis.");
    msisdn = toMomoMsisdn(rawPhone);
    await momoTransfer({
      referenceId,
      amount: refundAmount,
      currency: momoCurrency(),
      externalId: bookingRef,
      msisdn,
      payerMessage: `Remboursement billet ${bookingRef}`,
      payeeNote: "Remboursement OCÉAN DU NORD",
    });
  }

  const refundMeta: NonNullable<PaymentMetadata["refund"]> = {
    mode: input.mode,
    status: "PROCESSING",
    amount: refundAmount,
    referenceId,
    msisdn,
    initiatedByName: ctx.userName,
    initiatedAt: new Date().toISOString(),
  };
  await writeMetadata(paymentId, (m) => ({ ...m, refund: refundMeta }));

  await logAudit({
    userId: ctx.userId,
    action: "REFUND_INITIATED",
    entity: "Payment",
    entityId: paymentId,
    metadata: { mode: input.mode, amount: refundAmount, booking: bookingRef, momoReferenceId: referenceId },
    ipAddress: ctx.ip ?? null,
  });

  const fresh = await refetchPayment(paymentId);
  return toPaymentDTO(fresh);
}

export async function pollPaymentRefundStatus(
  paymentId: string,
  ctx: { userId: string; ip?: string | null }
): Promise<PaymentDTO> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { createdBy: true, booking: true } });
  if (!payment) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Paiement introuvable.");
  const meta = parseMetadata(payment.metadata);
  const refund = meta.refund;
  if (!refund) throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Aucun remboursement initié pour ce paiement.");
  if (refund.status !== "PROCESSING" || !refund.referenceId) {
    return toPaymentDTO(payment); // déjà final (SUCCESSFUL/FAILED) → idempotent
  }

  const status =
    refund.mode === "MOMO_REFUND"
      ? await momoGetRefundStatus(refund.referenceId)
      : await momoGetTransferStatus(refund.referenceId);

  if (status.status === "SUCCESSFUL") {
    await finalizeRefund(paymentId, refund.mode, refund, ctx.userId, ctx.ip ?? null, status.financialTransactionId);
  } else if (status.status === "FAILED") {
    await writeMetadata(paymentId, (m) => ({
      ...m,
      refund: m.refund ? { ...m.refund, status: "FAILED", reason: momoFailureMessage(status), reasonCode: status.reasonCode } : m.refund,
    }));
    await logAudit({
      userId: ctx.userId,
      action: "REFUND_FAILED",
      entity: "Payment",
      entityId: paymentId,
      metadata: { mode: refund.mode, reasonCode: status.reasonCode, booking: payment.booking.bookingReference },
      ipAddress: ctx.ip ?? null,
    });
  }

  const fresh = await refetchPayment(paymentId);
  return toPaymentDTO(fresh);
}

// ------------------------------------------------------------
// Vue d'ensemble MoMo (admin) — état + soldes, SANS secrets
// ------------------------------------------------------------

export async function getMomoOverview(): Promise<MomoOverviewDTO> {
  const config = momoConfigStatus();

  async function safeBalance(product: "collection" | "disbursement", configured: boolean) {
    if (!configured) return { configured: false, balance: null as MomoBalanceDTO | null, error: null as string | null };
    try {
      const balance = await momoGetBalance(product);
      return { configured: true, balance, error: null as string | null };
    } catch (e) {
      return {
        configured: true,
        balance: null as MomoBalanceDTO | null,
        error: e instanceof Error ? e.message : "Solde indisponible",
      };
    }
  }

  const [collection, disbursement] = await Promise.all([
    safeBalance("collection", config.collectionConfigured),
    safeBalance("disbursement", config.disbursementConfigured),
  ]);

  return {
    environment: config.environment,
    targetEnvironment: config.targetEnvironment,
    currency: config.currency,
    callbackConfigured: config.callbackConfigured,
    collection,
    disbursement,
  };
}

// ------------------------------------------------------------
// Webhook MTN MoMo — callback officiel (POST/PUT)
// ⚠️ Le callback MoMo n'est PAS signé : on ne l'utilise JAMAIS comme
// preuve. Il sert uniquement de SIGNAL → re-vérification systématique
// du statut par GET auprès de MTN (source de vérité unique).
// ------------------------------------------------------------
export async function handleMomoWebhook(rawBody: string, ip: string | null): Promise<{ received: true; status: string }> {
  const payload = safeJsonParse<{ referenceId?: string; status?: string } | null>(rawBody, null);
  if (!payload?.referenceId) {
    await logSecurity({ event: "WEBHOOK_REJECTED", ipAddress: ip, details: { reason: "momo callback sans referenceId" } });
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Payload callback MoMo invalide.");
  }

  const payment = await db.payment.findUnique({ where: { providerTransactionId: payload.referenceId } });
  if (!payment) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Transaction MoMo inconnue.");
  }

  // Re-vérification systématique auprès de MTN (jamais sur parole du callback)
  const dto = await pollMomoPaymentStatus(payment.id, { ip });
  return { received: true, status: dto.status };
}

// ------------------------------------------------------------
// Webhook fournisseur interne — HMAC, idempotent, jamais sur parole du client
// POST /api/webhooks/payments
// Signature attendue : X-Nzoko-Signature: hex HMAC-SHA256(body, WEBHOOK_SECRET)
// ------------------------------------------------------------
export interface WebhookPayload {
  provider: string;
  providerTransactionId: string;
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  amount?: number;
}

export async function handlePaymentWebhook(rawBody: string, signature: string | null, ip: string | null): Promise<{ received: true; duplicate: boolean }> {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) throw new ApiError(503, "WEBHOOK_NOT_CONFIGURED", "Webhook non configuré.");

  if (!signature || !timingSafeEqual(signature, hmacSha256(secret, rawBody))) {
    await logSecurity({ event: "WEBHOOK_REJECTED", ipAddress: ip, details: { reason: "signature invalide" } });
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Signature webhook invalide.");
  }

  const payload = safeJsonParse<WebhookPayload | null>(rawBody, null);
  if (!payload?.providerTransactionId || !payload.status) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Payload webhook invalide.");
  }

  const payment = await db.payment.findUnique({ where: { providerTransactionId: payload.providerTransactionId } });
  if (!payment) {
    await logSecurity({ event: "WEBHOOK_REJECTED", ipAddress: ip, details: { reason: "transaction inconnue", tx: payload.providerTransactionId } });
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Transaction inconnue.");
  }

  if (payload.amount !== undefined && payload.amount !== payment.amount) {
    await logSecurity({ event: "SUSPICIOUS", ipAddress: ip, details: { reason: "montant webhook divergent", paymentId: payment.id } });
    throw new ApiError(409, ERROR_CODES.PAYMENT_ERROR, "Montant divergent — paiement bloqué.");
  }

  if (payload.status !== "SUCCESS") {
    await db.payment.update({ where: { id: payment.id }, data: { status: payload.status } });
    // Événement (contrat §14) : le paiement a échoué côté fournisseur.
    await emitDomainEvent({
      type: "PAYMENT_FAILED",
      aggregateType: "Payment",
      aggregateId: payment.id,
      bookingId: payment.bookingId,
      payload: { provider: payment.provider, status: payload.status },
    });
    return { received: true, duplicate: false };
  }

  // Idempotence : re-confirmer un paiement déjà SUCCESS est un no-op réussi
  const { alreadyConfirmed } = await confirmPaymentAndIssueTicket(payment.id, null, ip);
  return { received: true, duplicate: alreadyConfirmed };
}
