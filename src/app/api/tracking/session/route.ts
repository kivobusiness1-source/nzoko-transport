// GET  /api/tracking/session — session courante du chauffeur connecté (réconciliation
//        après rechargement de page en plein trajet) → TrackingSessionDTO | null
// POST /api/tracking/session — actions { START | PAUSE | RESUME | STOP } (DRIVER seul).
//        START : lie optionnellement un voyage du jour (tripId) → bus + agence déduits,
//        chauffeur passe ON_TRIP ; STOP : chauffeur repasse AVAILABLE.
//
// V5 multi-bus :
//   - START exige un deviceId (identification du TÉLÉPHONE, §6) et
//     REFUSE les conflits de niveau BUS (§5/§27) : un autre suivi
//     ACTIF sur le même car, ou un voyage déjà suivi/terminé → 409
//     SESSION_CONFLICT (journalisé) ;
//   - START avec voyage : transition métier SCHEDULED → BOARDING
//     (machine à états, updateMany conditionnel) ;
//   - STOP : endReason=DRIVER + événements GPS_SESSION_STOPPED et
//     TRIP_COMPLETED (audit §34) — la session se termine
//     PROPREMENT même sans arrivée détectée.

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { toTrackingSessionDTO, toTrackingSessionActionDTO, emitRealtime } from "@/services/tracking";
import { logTrackingEvent } from "@/services/tracking-events";
import { isJudgedStatus } from "@/lib/trip-state-machine";

const actionSchema = z.object({
  action: z.enum(["START", "PAUSE", "RESUME", "STOP"]),
  tripId: z.string().min(1).nullable().optional(),
  /** V5 — identifiant du téléphone (UUID localStorage du chauffeur). */
  deviceId: z.string().min(8).max(64).nullable().optional(),
});

/** Charge le profil chauffeur + session ACTIVE/PAUSED existante. */
async function loadDriverContext(userId: string) {
  const driver = await db.driver.findUnique({ where: { userId }, include: { agency: true } });
  if (!driver) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
  }
  const current = await db.trackingSession.findFirst({
    where: { driverId: driver.id, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { startedAt: "desc" },
    include: { driver: true, agency: true, trip: { include: { route: { include: { originCity: true, destinationCity: true } } } }, bus: true },
  });
  return { driver, current };
}

async function serializeWithLastPoint(sessionId: string, withSocketUrl: boolean) {
  const session = await db.trackingSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { driver: true, agency: true, trip: { include: { route: { include: { originCity: true, destinationCity: true } } } }, bus: true },
  });
  const [lastPoint, pointsCount] = await Promise.all([
    db.gpsPoint.findFirst({ where: { sessionId }, orderBy: { recordedAt: "desc" } }),
    db.gpsPoint.count({ where: { sessionId } }),
  ]);
  return withSocketUrl
    ? toTrackingSessionActionDTO(session, lastPoint, pointsCount)
    : toTrackingSessionDTO(session, lastPoint, pointsCount);
}

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }
    const { current } = await loadDriverContext(auth.userId);
    if (!current) return ok(null);
    const dto = await serializeWithLastPoint(current.id, false);
    return ok(dto);
  } catch (err) {
    return routeError(err, "Erreur lecture session GPS");
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingSession:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.trackingSession.limit, RATE_LIMITS.trackingSession.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }

    const body = actionSchema.parse(await req.json());
    const { driver, current } = await loadDriverContext(auth.userId);

    switch (body.action) {
      case "START": {
        if (current) {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Une session de suivi est déjà en cours. Arrêtez-la avant d'en démarrer une nouvelle.");
        }
        // Voyage rattaché : doit appartenir au chauffeur, agence cohérente.
        let trip = null as Awaited<ReturnType<typeof db.trip.findFirst>>;
        if (body.tripId) {
          trip = await db.trip.findFirst({
            where: { id: body.tripId, driverId: driver.id },
            include: { route: { include: { originCity: true, destinationCity: true } } },
          });
          if (!trip) {
            throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable ou non assigné à votre compte.");
          }
          // §27 — un voyage déjà jugé (arrivé/terminé/annulé) ne se
          // suit plus : évite les trajets fantômes.
          if (isJudgedStatus(trip.status)) {
            await logTrackingEvent({
              type: "SESSION_CONFLICT",
              severity: "WARN",
              tripId: trip.id,
              busId: trip.busId,
              driverId: driver.id,
              agencyId: trip.agencyId,
              message: `Démarrage refusé : voyage ${trip.code} déjà ${trip.status}`,
              payload: { attempted: "START", tripStatus: trip.status },
            });
            throw new ApiError(409, ERROR_CODES.CONFLICT, `Ce voyage est déjà ${trip.status === "ARRIVED" ? "arrivé" : trip.status === "COMPLETED" ? "terminé" : "annulé"} : impossible de le suivre.`);
          }
          // §5 — un autre suivi ACTIF existe-t-il déjà pour CE car ?
          if (trip.busId) {
            const busBusy = await db.trackingSession.findFirst({
              where: { busId: trip.busId, status: { in: ["ACTIVE", "PAUSED"] } },
              select: { id: true, driverId: true },
            });
            if (busBusy && busBusy.driverId !== driver.id) {
              await logTrackingEvent({
                type: "SESSION_CONFLICT",
                severity: "CRITICAL",
                tripId: trip.id,
                busId: trip.busId,
                driverId: driver.id,
                agencyId: trip.agencyId,
                message: "Démarrage refusé : un autre téléphone suit déjà ce car",
                payload: { attempted: "START", existingSessionId: busBusy.id },
              });
              throw new ApiError(409, ERROR_CODES.CONFLICT, "Un autre téléphone suit déjà ce car. Attendez la fin de ce suivi ou contactez l'agence.");
            }
          }
        }

        const session = await db.trackingSession.create({
          data: {
            driverId: driver.id,
            tripId: trip?.id ?? null,
            busId: trip?.busId ?? null,
            agencyId: trip?.agencyId ?? driver.agencyId,
            status: "ACTIVE",
            deviceId: body.deviceId ?? null,
          },
        });
        await db.driver.update({ where: { id: driver.id }, data: { status: "ON_TRIP" } });

        // Transition métier (§22) : SCHEDULED → BOARDING (conditionnel,
        // légal, jamais rétrograde — BOARDING/DEPARTED déjà posés restent).
        if (trip && trip.status === "SCHEDULED") {
          await db.trip.updateMany({
            where: { id: trip.id, status: "SCHEDULED" },
            data: { status: "BOARDING" },
          });
        }

        await logTrackingEvent({
          type: "GPS_SESSION_STARTED",
          severity: "INFO",
          sessionId: session.id,
          tripId: session.tripId,
          busId: session.busId,
          driverId: driver.id,
          agencyId: session.agencyId,
          message: trip ? `Suivi démarré pour le voyage ${trip.code}` : "Suivi démarré (hors voyage)",
          payload: { deviceId: body.deviceId ?? null },
        });

        const dto = await serializeWithLastPoint(session.id, true);
        await emitRealtime({ room: "fleet", event: "session-started", payload: dto });
        return ok(dto, 201);
      }

      case "PAUSE": {
        if (!current || current.status !== "ACTIVE") {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Aucune session active à mettre en pause.");
        }
        await db.trackingSession.update({ where: { id: current.id }, data: { status: "PAUSED" } });
        const dto = await serializeWithLastPoint(current.id, true);
        await emitRealtime({ room: "fleet", event: "session-updated", payload: dto });
        return ok(dto);
      }

      case "RESUME": {
        if (!current || current.status !== "PAUSED") {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Aucune session en pause à reprendre.");
        }
        await db.trackingSession.update({ where: { id: current.id }, data: { status: "ACTIVE" } });
        const dto = await serializeWithLastPoint(current.id, true);
        await emitRealtime({ room: "fleet", event: "session-updated", payload: dto });
        return ok(dto);
      }

      case "STOP": {
        if (!current) {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Aucune session de suivi en cours.");
        }
        await db.trackingSession.update({
          where: { id: current.id },
          data: { status: "COMPLETED", endedAt: new Date(), endReason: "DRIVER" },
        });
        await db.driver.update({ where: { id: driver.id }, data: { status: "AVAILABLE" } });

        await logTrackingEvent({
          type: "GPS_SESSION_STOPPED",
          severity: "INFO",
          sessionId: current.id,
          tripId: current.tripId,
          busId: current.busId,
          driverId: driver.id,
          agencyId: current.agencyId,
          message: "Suivi arrêté par le chauffeur",
          payload: { endReason: "DRIVER" },
        });
        // TRIP_COMPLETED : le voyage lié passe ARRIVED → COMPLETED
        // (transition métier conditionnelle — jamais rétrograde).
        if (current.tripId && current.trip?.status === "ARRIVED") {
          const completed = await db.trip.updateMany({
            where: { id: current.tripId, status: "ARRIVED" },
            data: { status: "COMPLETED" },
          });
          if (completed.count > 0) {
            await logTrackingEvent({
              type: "TRIP_COMPLETED",
              severity: "INFO",
              sessionId: current.id,
              tripId: current.tripId,
              busId: current.busId,
              driverId: driver.id,
              agencyId: current.agencyId,
              message: `Voyage ${current.trip.code} terminé`,
              payload: { by: "driver-stop" },
            });
          }
        }

        const dto = await serializeWithLastPoint(current.id, true);
        await emitRealtime({ room: "fleet", event: "session-stopped", payload: dto });
        return ok(dto);
      }
    }
  } catch (err) {
    return routeError(err, "Erreur action session GPS");
  }
}
