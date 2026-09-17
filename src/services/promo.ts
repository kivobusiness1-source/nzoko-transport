// ============================================================
// NZOKO TRANSPORT — Codes promo (fidélité & campagnes)
// Validation partagée : route publique /api/bookings/promo/validate
// ET moteur de réservation (createBooking) — UNE SEULE implémentation.
// type PERCENT : value = % de remise ; FREE_TICKET : traitement manuel.
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { generatePromoCode } from "@/lib/security";
import type { PromoCodeValidationDTO } from "@/types";
import type { PromoCode, Prisma } from "@prisma/client";

/**
 * Validation complète d'un code promo pour un voyage donné.
 * Lève des ApiError FR explicites — réutilisable partout.
 * @param sessionUserId null si non connecté, sinon l'id du client
 */
export async function validatePromoForTrip(
  code: string,
  tripId: string,
  sessionUserId: string | null
): Promise<PromoCodeValidationDTO> {
  const trip = await db.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");

  const promo = await db.promoCode.findUnique({ where: { code } });
  if (!promo) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Code invalide.");

  if (!promo.isActive || promo.expiresAt <= new Date() || promo.usedCount >= promo.maxUses) {
    throw new ApiError(410, ERROR_CODES.BAD_REQUEST, "Ce code a expiré.");
  }

  // Code nominatif : réservé à son propriétaire uniquement
  if (promo.userId && promo.userId !== sessionUserId) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Ce code n'est pas utilisable avec ce compte.");
  }

  return {
    code: promo.code,
    type: promo.type as "PERCENT" | "FREE_TICKET",
    value: promo.value,
    label: promo.label,
    originalAmount: trip.price,
    discountedAmount:
      promo.type === "PERCENT"
        ? Math.max(0, Math.round(trip.price * (1 - promo.value / 100)))
        : trip.price,
  };
}

/** Création d'un code promo récompense (approbation d'une demande de fidélité). */
export async function createRewardPromoCode(
  data: {
    type: "PERCENT" | "FREE_TICKET";
    value: number;
    label: string;
    userId: string;
    days?: number;
  },
  tx?: Prisma.TransactionClient
): Promise<PromoCode> {
  const client = tx ?? db;
  const code = generatePromoCode();
  const expiresAt = new Date(Date.now() + (data.days ?? 90) * 24 * 3600 * 1000);
  return client.promoCode.create({
    data: {
      code,
      type: data.type,
      value: data.value,
      label: data.label,
      userId: data.userId,
      maxUses: 1,
      expiresAt,
      isActive: true,
    },
  });
}
