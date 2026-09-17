// ============================================================
// NZOKO TRANSPORT — Espace client : helpers & mappers partagés
// Résolution des passagers liés à un compte client (userId OU
// téléphone — billets achetés avant la création du compte),
// mappers DTO réclamations / récompenses, prochains départs.
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { LOYALTY_REWARDS } from "@/lib/constants";
import { tierLabel } from "@/services/loyalty";
import type { AuthContext } from "@/lib/auth";
import type {
  AdminComplaintDTO,
  ComplaintDTO,
  ComplaintDetailDTO,
  FavoriteRouteDTO,
  RedemptionRequestDTO,
} from "@/types";
import type { Complaint, ComplaintMessage, RedemptionRequest, Prisma } from "@prisma/client";

/**
 * Accès espace client : authentifié + rôle PASSENGER.
 * Les données sont personnelles — aucune permission générique ne
 * remplace ce contrôle.
 */
export function assertClient(auth: AuthContext | null): AuthContext {
  if (!auth) {
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Vous devez être connecté pour effectuer cette action.");
  }
  if (auth.role !== "PASSENGER") {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux clients.");
  }
  return auth;
}

/**
 * Passagers liés au compte client :
 *  - profils explicitement rattachés (Passenger.userId = moi)
 *  - profils historiques portant mon téléphone (achats sans compte)
 */
export async function myPassengerIds(user: { id: string; phone: string | null }): Promise<string[]> {
  const passengers = await db.passenger.findMany({
    where: {
      OR: [{ userId: user.id }, ...(user.phone ? [{ phone: user.phone }] : [])],
    },
    select: { id: true },
  });
  return passengers.map((p) => p.id);
}

// ---------- Réclamations ----------

export function toComplaintDTO(
  c: Complaint & {
    messages: Pick<ComplaintMessage, "id" | "createdAt">[];
  }
): ComplaintDTO {
  const last = c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
  return {
    id: c.id,
    reference: c.reference,
    category: c.category as ComplaintDTO["category"],
    categoryLabel: complaintCategoryLabel(c.category),
    subject: c.subject,
    status: c.status as ComplaintDTO["status"],
    statusLabel: complaintStatusLabel(c.status),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c.messages.length,
    lastMessageAt: last ? last.createdAt.toISOString() : null,
    preview: c.message.length > 80 ? `${c.message.slice(0, 80)}…` : c.message,
  };
}

const complaintInclude = {
  messages: { orderBy: { createdAt: "asc" as const } },
  assignedTo: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ComplaintInclude;

type ComplaintWithRelations = Prisma.ComplaintGetPayload<{ include: typeof complaintInclude }>;

export function toComplaintDetailDTO(c: ComplaintWithRelations): ComplaintDetailDTO {
  return {
    ...toComplaintDTO(c),
    message: c.message,
    bookingReference: c.bookingReference,
    assignedToName: c.assignedTo ? `${c.assignedTo.firstName} ${c.assignedTo.lastName}` : null,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    messages: c.messages.map((m) => ({
      id: m.id,
      authorName: m.authorName,
      isStaff: m.isStaff,
      message: m.message,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/** Détail d'une réclamation avec contrôle d'appartenance client. */
export async function getComplaintDetailForUser(
  id: string,
  userId: string
): Promise<ComplaintDetailDTO> {
  const complaint = await db.complaint.findFirst({
    where: { id, userId },
    include: complaintInclude,
  });
  if (!complaint) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réclamation introuvable.");
  }
  return toComplaintDetailDTO(complaint);
}

// ---------- Réclamations (vue admin/support) ----------

export const adminComplaintInclude = {
  ...complaintInclude,
  user: { select: { firstName: true, lastName: true, phone: true } },
} satisfies Prisma.ComplaintInclude;

type AdminComplaintWithRelations = Prisma.ComplaintGetPayload<{ include: typeof adminComplaintInclude }>;

/** Détail complet + identité du client (vue ADMIN/SUPPORT). */
export function toAdminComplaintDTO(c: AdminComplaintWithRelations): AdminComplaintDTO {
  return {
    ...toComplaintDetailDTO(c),
    clientName: `${c.user.firstName} ${c.user.lastName}`,
    clientPhone: c.user.phone,
  };
}

function complaintCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    TICKET: "Problème avec mon billet",
    BUS: "Problème avec le bus",
    STAFF: "Comportement du personnel",
    PAYMENT: "Problème de paiement",
    DELAY: "Retard",
    SUGGESTION: "Suggestion d'amélioration",
    COMPLAINT: "Réclamation",
  };
  return labels[category] ?? category;
}

function complaintStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    OPEN: "En attente",
    IN_PROGRESS: "En cours de traitement",
    RESOLVED: "Résolu",
    CLOSED: "Fermé",
  };
  return labels[status] ?? status;
}

// ---------- Récompenses (fidélité) ----------

export function toRedemptionRequestDTO(r: RedemptionRequest): RedemptionRequestDTO {
  return {
    id: r.id,
    rewardKey: r.rewardKey as RedemptionRequestDTO["rewardKey"],
    rewardLabel: rewardLabel(r.rewardKey),
    pointsSpent: r.pointsSpent,
    status: r.status as RedemptionRequestDTO["status"],
    promoCode: r.promoCode,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

/** Libellé de récompense depuis le catalogue (fallback clé brute). */
export function rewardLabel(key: string): string {
  return LOYALTY_REWARDS.find((r) => r.key === key)?.label ?? key;
}

// ---------- Favoris ----------

/** Prochain départ SCHEDULED futur sur une paire de villes. */
export async function nextDepartureForRoute(
  originCityId: string,
  destinationCityId: string
): Promise<{ tripId: string; departureTime: string; price: number } | null> {
  const trip = await db.trip.findFirst({
    where: {
      status: "SCHEDULED",
      departureTime: { gte: new Date() },
      route: { originCityId, destinationCityId, isActive: true },
    },
    orderBy: { departureTime: "asc" },
    select: { id: true, departureTime: true, price: true },
  });
  if (!trip) return null;
  return {
    tripId: trip.id,
    departureTime: trip.departureTime.toISOString(),
    price: trip.price,
  };
}

/** Noms des villes d'une paire (null si la paire n'existe pas). */
export async function cityPairNames(
  originCityId: string,
  destinationCityId: string
): Promise<{ originCityName: string; destinationCityName: string } | null> {
  const cities = await db.city.findMany({
    where: { id: { in: [originCityId, destinationCityId] } },
    select: { id: true, name: true },
  });
  const origin = cities.find((c) => c.id === originCityId);
  const destination = cities.find((c) => c.id === destinationCityId);
  if (!origin || !destination) return null;
  return { originCityName: origin.name, destinationCityName: destination.name };
}

/** Construit un FavoriteRouteDTO (favori manuel ou auto-détecté). */
export async function buildFavoriteRouteDTO(
  data: {
    id: string;
    originCityId: string;
    destinationCityId: string;
    isManual: boolean;
    tripsCount: number;
  }
): Promise<FavoriteRouteDTO> {
  const names = await cityPairNames(data.originCityId, data.destinationCityId);
  return {
    id: data.id,
    originCityId: data.originCityId,
    originCityName: names?.originCityName ?? "—",
    destinationCityId: data.destinationCityId,
    destinationCityName: names?.destinationCityName ?? "—",
    isManual: data.isManual,
    tripsCount: data.tripsCount,
    nextDeparture: await nextDepartureForRoute(data.originCityId, data.destinationCityId),
  };
}

// Ré-export pratique (affichage palier dans les vues)
export { tierLabel };
