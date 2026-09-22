// ============================================================
// NZOKO TRANSPORT — Autorisation du module tracking GPS
// Sécurité multi-tenant : le serveur détermine TOUJOURS l'agence à
// partir de la session authentifiée. Aucun agencyId fourni par le
// frontend ne fait foi (cf. règle absolue #30 du brief V2).
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import type { AuthContext } from "@/lib/auth";
import { assertPermission, resolveAgencyScope } from "@/lib/auth";
import type { Driver, Trip, TrackingSession } from "@prisma/client";

export interface DriverContext {
  driver: Driver;
  agencyId: string;
}

/**
 * Résout le profil chauffeur du compte connecté (rôle DRIVER obligatoire).
 * Un chauffeur ne peut agir que sur SES trajets — jamais ceux d'un autre.
 */
export async function requireDriverContext(auth: AuthContext): Promise<DriverContext> {
  if (auth.role !== "DRIVER") {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux chauffeurs.");
  }
  const driver = await db.driver.findUnique({ where: { userId: auth.userId } });
  if (!driver) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
  }
  return { driver, agencyId: driver.agencyId };
}

/**
 * Vérifie que le chauffeur connecté est bien affecté à ce voyage et que
 * bus/voyage/chauffeur appartiennent à la même agence (invariants du brief).
 * Retourne le voyage enrichi (relations nécessaires au tracking).
 */
export async function requireDriverOwnsTrip(
  ctx: DriverContext,
  tripId: string
): Promise<Trip & { bus: { id: string; registrationNumber: string; fleetNumber: string | null; agencyId: string }; route: { id: string; estimatedDurationMinutes: number } }> {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      bus: { select: { id: true, registrationNumber: true, fleetNumber: true, agencyId: true } },
      route: { select: { id: true, estimatedDurationMinutes: true } },
    },
  });
  if (!trip) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
  }
  if (trip.agencyId !== ctx.agencyId) {
    // Ne pas révéler l'existence du voyage d'une autre agence
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
  }
  if (trip.driverId !== ctx.driver.id) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Ce voyage n'est pas affecté à votre compte chauffeur.");
  }
  if (trip.bus.agencyId !== ctx.agencyId) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le bus de ce voyage n'appartient pas à votre agence.");
  }
  return trip;
}

/**
 * Session de tracking : doit appartenir au voyage ET au chauffeur demandeur.
 * Un chauffeur ne peut JAMAIS envoyer de positions pour le bus d'un autre.
 */
export async function requireDriverSession(ctx: DriverContext, sessionId?: string | null, tripId?: string | null): Promise<TrackingSession> {
  const session = sessionId
    ? await db.trackingSession.findUnique({ where: { id: sessionId } })
    : tripId
      ? await db.trackingSession.findFirst({ where: { tripId, driverId: ctx.driver.id }, orderBy: { startedAt: "desc" } })
      : await db.trackingSession.findFirst({ where: { driverId: ctx.driver.id, status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { startedAt: "desc" } });

  if (!session) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
  }
  if (session.driverId !== ctx.driver.id) {
    // IDOR : session d'un autre chauffeur → 404 (pas de divulgation)
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
  }
  if (session.busId && tripId && session.tripId !== tripId) {
    throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette session ne correspond pas au voyage demandé.");
  }
  return session;
}

/**
 * Scope de lecture flotte (dashboard). Permissions requises :
 * tracking:read + scope agence forcé pour AGENCY_MANAGER (via
 * resolveAgencyScope — les rôles globaux peuvent filtrer sur une agence).
 * Retourne l'agencyId de filtrage (null = toutes les agences).
 */
export function requireFleetReadScope(auth: AuthContext, requestedAgencyId?: string | null): string | null {
  assertPermission(auth, "tracking:read");
  return resolveAgencyScope(auth, requestedAgencyId ?? undefined);
}

/**
 * Accès à un voyage pour LECTURE (dashboard/historique/événements) :
 * filtré par agence autorisée — jamais parce qu'un simple ID est connu.
 */
export async function assertTripReadAllowed(auth: AuthContext, tripId: string): Promise<void> {
  requireFleetReadScope(auth);
  const trip = await db.trip.findUnique({ where: { id: tripId }, select: { agencyId: true } });
  if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
  const scope = resolveAgencyScope(auth);
  if (scope && trip.agencyId !== scope) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
  }
}

/** Idem pour un bus (l'ID d'un bus d'une autre agence ne donne AUCUN accès). */
export async function assertBusReadAllowed(auth: AuthContext, busId: string): Promise<{ agencyId: string }> {
  requireFleetReadScope(auth);
  const bus = await db.bus.findUnique({ where: { id: busId }, select: { agencyId: true } });
  if (!bus) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Bus introuvable.");
  const scope = resolveAgencyScope(auth);
  if (scope && bus.agencyId !== scope) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Bus introuvable.");
  }
  return bus;
}
