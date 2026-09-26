// ============================================================
// OCÉAN DU NORD — Mappers paiement (DTO)
// ============================================================

import type { PaymentDTO, PaymentRefundDTO, RefundMode } from "@/types";
import type { Prisma } from "@prisma/client";

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: { createdBy: true; booking: true } }>;

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
    mode: RefundMode;
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

export function toPaymentDTO(p: PaymentWithRelations): PaymentDTO {
  const meta = safeMeta(p.metadata);
  return {
    id: p.id,
    bookingId: p.bookingId,
    bookingReference: p.booking?.bookingReference,
    provider: p.provider as PaymentDTO["provider"],
    providerTransactionId: p.providerTransactionId,
    amount: p.amount,
    currency: p.currency,
    status: p.status as PaymentDTO["status"],
    instructions: meta?.instructions ?? null,
    failureReason: meta?.reason ?? null,
    createdAt: p.createdAt.toISOString(),
    collectedByName: p.createdBy ? `${p.createdBy.firstName} ${p.createdBy.lastName}` : null,
    refund: meta?.refund ? toRefundDTO(meta.refund) : null,
  };
}

function toRefundDTO(r: NonNullable<PaymentMetadata["refund"]>): PaymentRefundDTO {
  return {
    mode: r.mode,
    status: r.status,
    amount: r.amount,
    referenceId: r.referenceId ?? null,
    msisdn: r.msisdn ?? null,
    reason: r.reason ?? null,
    initiatedByName: r.initiatedByName ?? null,
    initiatedAt: r.initiatedAt,
    confirmedAt: r.confirmedAt ?? null,
    financialTransactionId: r.financialTransactionId ?? null,
  };
}

function safeMeta(raw: string | null): PaymentMetadata | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
