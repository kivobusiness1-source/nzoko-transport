// GET /api/map/public — données de la CARTE OUVERTE (PUBLIQUE, sans auth).
// Villes, agences et lignes avec leurs tracés (LineString GeoJSON [lng, lat]).
// Les positions de bus (sessions GPS ACTIVES) ne sont exposées QUE si
// PUBLIC_BUS_POSITIONS=true — données VOLONTAIREMENT minimales : aucun nom
// de chauffeur, aucune immatriculation, aucun agencyId. Rate limit modéré.

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { db } from "@/lib/db";
import { deriveBusStatus } from "@/lib/geo";
import { offlineThresholdMs, publicBusPositionsEnabled, stoppedSpeedKmh } from "@/lib/gps-config";
import { safeJsonParse } from "@/lib/security";
import { routeLabelOf } from "@/services/tracking";
import type { MapLineStringDTO, MapPublicDTO } from "@/types";

/** Décode et VALIDE un tracé stocké (Route.geometryJson) — null si corrompu. */
function parseLineString(raw: string | null): MapLineStringDTO | null {
  const parsed = safeJsonParse<unknown>(raw ?? "", null);
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "LineString" || !Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) {
    return null;
  }
  const coordinates: [number, number][] = [];
  for (const c of candidate.coordinates) {
    if (!Array.isArray(c) || c.length < 2) return null;
    const [lng, lat] = c as [unknown, unknown];
    if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    coordinates.push([lng, lat]);
  }
  return { type: "LineString", coordinates };
}

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`mapPublic:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);

    // Villes actives avec coordonnées (les autres ne sont pas cartographiables).
    const cities = (
      await db.city.findMany({
        where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
        select: { id: true, name: true, slug: true, latitude: true, longitude: true },
        orderBy: { name: "asc" },
      })
    ).flatMap((c) =>
      c.latitude === null || c.longitude === null
        ? []
        : [{ id: c.id, name: c.name, slug: c.slug, latitude: c.latitude, longitude: c.longitude }]
    );

    // Agences actives avec coordonnées — coordonnées publiques uniquement
    // (adresse + téléphone de l'agence, AUCUNE donnée de chauffeur).
    const agencies = (
      await db.agency.findMany({
        where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
        select: { id: true, name: true, address: true, phone: true, cityId: true, latitude: true, longitude: true },
        orderBy: { name: "asc" },
      })
    ).flatMap((a) =>
      a.latitude === null || a.longitude === null
        ? []
        : [{
            id: a.id,
            name: a.name,
            address: a.address,
            phone: a.phone,
            cityId: a.cityId,
            latitude: a.latitude,
            longitude: a.longitude,
          }]
    );

    // Lignes actives + arrêts ordonnés (villes sans coordonnées ignorées).
    const routes = await db.route.findMany({
      where: { isActive: true },
      include: {
        originCity: true,
        destinationCity: true,
        stops: { include: { city: true }, orderBy: { position: "asc" } },
      },
      orderBy: { code: "asc" },
    });
    const routeDtos = routes.map((r) => ({
      id: r.id,
      code: r.code,
      originCityName: r.originCity.name,
      destinationCityName: r.destinationCity.name,
      distanceKm: r.distanceKm,
      stops: r.stops.flatMap((s) =>
        s.city.latitude === null || s.city.longitude === null
          ? []
          : [{
              name: s.city.name,
              latitude: s.city.latitude,
              longitude: s.city.longitude,
              position: s.position,
              minutesFromStart: s.minutesFromStart,
            }]
      ),
      geometry: parseLineString(r.geometryJson),
    }));

    // Positions des bus — uniquement si l'exposition publique est activée.
    // Une session sans AUCUN point n'a pas de position cartographiable.
    const buses: MapPublicDTO["buses"] = [];
    if (publicBusPositionsEnabled()) {
      const activeSessions = await db.trackingSession.findMany({
        where: { status: "ACTIVE" },
        include: { trip: { include: { route: { include: { originCity: true, destinationCity: true } } } } },
        orderBy: { startedAt: "asc" },
      });
      for (const session of activeSessions) {
        const lastPoint = await db.gpsPoint.findFirst({
          where: { sessionId: session.id },
          orderBy: { recordedAt: "desc" },
        });
        if (!lastPoint) continue;
        const trip = session.trip;
        buses.push({
          sessionId: session.id,
          routeLabel: trip ? routeLabelOf(trip.route, trip.code) : "Repositionnement",
          latitude: lastPoint.latitude,
          longitude: lastPoint.longitude,
          speedKmh: lastPoint.speed ?? null,
          heading: lastPoint.heading ?? null,
          busStatus: deriveBusStatus({
            speedKmh: lastPoint.speed ?? null,
            lastPointAt: lastPoint.recordedAt,
            offlineThresholdMs: offlineThresholdMs(),
            stoppedSpeedKmh: stoppedSpeedKmh(),
            tripArrived: trip?.status === "ARRIVED",
          }),
          recordedAt: lastPoint.recordedAt.toISOString(),
        });
      }
    }

    const payload: MapPublicDTO = { cities, agencies, routes: routeDtos, buses };
    return ok(payload);
  } catch (err) {
    return routeError(err, "Erreur carte publique");
  }
}
