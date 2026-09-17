// ============================================================
// NZOKO TRANSPORT — Moteur de fidélité (espace client)
// 1 voyage payé = 100 points (LOYALTY.pointsPerTrip).
// Paliers sur les points cumulés (lifetime) :
// BRONZE 0+ | SILVER 1 000+ | GOLD 5 000+ | VIP 15 000+.
// Toutes les écritures sont idempotentes (bookingId unique sur
// LoyaltyTransaction) : un webhook/paiement rejoué ne double JAMAIS
// les points.
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { LOYALTY } from "@/lib/constants";
import type { LoyaltyTier } from "@/lib/constants";
import type { LoyaltyAccount, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Palier correspondant aux points cumulés (lifetime). */
export function tierForPoints(lifetimePoints: number): LoyaltyTier {
  if (lifetimePoints >= 15000) return "VIP";
  if (lifetimePoints >= 5000) return "GOLD";
  if (lifetimePoints >= 1000) return "SILVER";
  return "BRONZE";
}

/**
 * Palier suivant + points restants (null au sommet VIP).
 * Utilisé par l'aperçu client et la page fidélité.
 */
export function nextTierForPoints(lifetimePoints: number): {
  key: LoyaltyTier;
  label: string;
  pointsRemaining: number;
} | null {
  const tiers = LOYALTY.tiers;
  for (const t of tiers) {
    if (t.key !== "VIP" && lifetimePoints < t.min) {
      return { key: t.key, label: t.label, pointsRemaining: t.min - lifetimePoints };
    }
  }
  return null; // VIP atteint
}

/** Libellé du palier (affichage). */
export function tierLabel(tier: LoyaltyTier): string {
  return LOYALTY.tiers.find((t) => t.key === tier)?.label ?? tier;
}

/**
 * Garantit l'existence du compte fidélité (upsert — compte créé avec
 * balance 0, lifetime 0, palier BRONZE). Utilise db OU une transaction
 * selon le contexte d'appel.
 */
export async function ensureLoyaltyAccount(
  userId: string,
  tx?: Tx
): Promise<LoyaltyAccount> {
  const client = tx ?? db;
  return client.loyaltyAccount.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

/**
 * Attribution des points pour un voyage payé — appelée DANS la
 * transaction de confirmation de paiement (confirmPaymentAndIssueTicket).
 * Idempotente : LoyaltyTransaction.bookingId est unique → un paiement
 * rejoué (webhook, poll, confirmation concurrente) n'ajoute rien.
 *
 * Résolution du client :
 *  1. passenger.userId (compte lié à la réservation), SINON
 *  2. utilisateur PASSENGER portant le même téléphone (achat avant compte),
 *  3. aucun client identifié → retour silencieux (pas de points anonymes).
 */
export async function awardPointsForBooking(tx: Tx, bookingId: string): Promise<void> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      passenger: { select: { id: true, userId: true, phone: true } },
      trip: { include: { route: { include: { originCity: true, destinationCity: true } } } },
    },
  });
  if (!booking) return;

  // Idempotence stricte : une transaction de fidélité existe déjà pour ce billet
  const existing = await tx.loyaltyTransaction.findUnique({ where: { bookingId: booking.id } });
  if (existing) return;

  // Résolution du client propriétaire des points
  let userId = booking.passenger.userId;
  if (!userId) {
    const phoneOwner = await tx.user.findFirst({
      where: { phone: booking.passenger.phone, role: { code: "PASSENGER" } },
      select: { id: true },
    });
    userId = phoneOwner?.id ?? null;
  }
  if (!userId) return; // passager anonyme → pas de points

  const account = await ensureLoyaltyAccount(userId, tx);
  const points = LOYALTY.pointsPerTrip;

  await tx.loyaltyTransaction.create({
    data: {
      accountId: account.id,
      type: "EARN",
      points,
      reason: "VOYAGE",
      bookingId: booking.id,
      description: `Voyage ${booking.trip.route.originCity.name} → ${booking.trip.route.destinationCity.name}`,
    },
  });

  const newLifetime = account.lifetimePoints + points;
  await tx.loyaltyAccount.update({
    where: { id: account.id },
    data: {
      pointsBalance: { increment: points },
      lifetimePoints: { increment: points },
      tier: tierForPoints(newLifetime),
    },
  });

  await tx.notification.create({
    data: {
      userId,
      title: "🎉 Points fidélité gagnés",
      message: `Vous avez gagné ${points} points NZOKO. Solde : ${account.pointsBalance + points} points.`,
      type: "SUCCESS",
    },
  });
}

/**
 * Dépense de points (demande de récompense). Vérifie le solde,
 * décrémente la balance (le cumul lifetime reste inchangé — il
 * porte le palier), journalise la transaction SPEND.
 * Les points sont dépensés À LA CRÉATION de la demande ; un refus
 * admin les restitue via refundPoints (ADJUST).
 */
export async function spendPoints(
  tx: Tx,
  userId: string,
  points: number,
  reason: string,
  description: string
): Promise<void> {
  const account = await ensureLoyaltyAccount(userId, tx);
  if (account.pointsBalance < points) {
    throw new ApiError(
      409,
      ERROR_CODES.CONFLICT,
      `Solde insuffisant : il vous manque ${points - account.pointsBalance} points.`
    );
  }
  await tx.loyaltyTransaction.create({
    data: {
      accountId: account.id,
      type: "SPEND",
      points,
      reason,
      description,
    },
  });
  await tx.loyaltyAccount.update({
    where: { id: account.id },
    data: { pointsBalance: { decrement: points } },
  });
}

/**
 * Restitution de points (demande de récompense refusée par
 * l'administration). Transaction ADJUST — le cumul lifetime ne
 * bouge pas (le palier déjà acquis est conservé).
 */
export async function refundPoints(
  tx: Tx,
  userId: string,
  points: number,
  description: string
): Promise<void> {
  const account = await ensureLoyaltyAccount(userId, tx);
  await tx.loyaltyTransaction.create({
    data: {
      accountId: account.id,
      type: "ADJUST",
      points,
      reason: "ADMIN",
      description,
    },
  });
  await tx.loyaltyAccount.update({
    where: { id: account.id },
    data: { pointsBalance: { increment: points } },
  });
}
