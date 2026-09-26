// ============================================================
// OCÉAN DU NORD — AgencyRoutingService (V3)
// Le MÊME moteur d'attribution d'agence pour tous les canaux :
// site public, guichet agent, assistant IA.
//
// Pipeline (décision 100 % serveur — jamais le client) :
//   1. position GPS plausible → détection ville + quartier (rayon)
//   2. agences actives géolocalisées → distance Haversine
//   3. horaires d'ouverture (heure Congo UTC+1)
//   4. capacité réelle par voyage (verrous HELD non expirés + BOOKED)
//   5. classement par distance + alternatives motivées (CAS 1/2/3)
// ============================================================

import { db } from "@/lib/db";
import { dayRange } from "@/lib/dates";
import { GEO } from "@/lib/constants";
import {
  haversineMeters,
  humanDistance,
  isPlausiblePosition,
  isOpenAt,
  type GeoPoint,
} from "@/lib/geo";
import type { AgencyNearbyResultDTO, AgencyRecommendationDTO, NearbyAgencyDTO } from "@/types";

// ------------------------------------------------------------
// Types internes
// ------------------------------------------------------------

export interface AgencyRoutingQuery {
  latitude: number;
  longitude: number;
  /** Filtre optionnel : limiter aux agences d'une ville */
  cityId?: string | null;
  /** Intention de voyage : ligne (orig→dest) + date → capacité réelle par agence */
  fromCityId?: string | null;
  toCityId?: string | null;
  date?: string | null; // YYYY-MM-DD
  seats?: number; // par défaut 1
  /** Précision GPS en mètres fournie par le navigateur (rayon à 68 %).
   *  Au-delà de GEO.neighborhoodClaimAccuracyM, la position est jugée
   *  approximative : le quartier détecté n'est plus affirmé. */
  accuracy?: number | null;
  /** true = la position n'est PAS celle de l'utilisateur mais un point de
   *  référence (repli manuel ville) → AUCUN quartier affirmé, message
   *  honnête « voici les agences de la ville ». */
  approximate?: boolean;
}

type AgencyRow = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  openingTime: string | null;
  closingTime: string | null;
  cityId: string;
  city: { id: string; name: string; latitude: number | null; longitude: number | null };
  neighborhoodId: string | null;
  neighborhood: { id: string; name: string } | null;
};

type TripAvailability = {
  departures: number;
  nextDepartureTime: Date | null;
  nextDepartureSeats: number | null;
  nextDeparturePrice: number | null;
};

// ------------------------------------------------------------
// Détection quartier / ville depuis une position
// ------------------------------------------------------------

async function detectNeighborhood(point: GeoPoint): Promise<{
  id: string;
  name: string;
  cityName: string;
} | null> {
  const hoods = await db.neighborhood.findMany({
    where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
    include: { city: { select: { id: true, name: true } } },
  });
  let best: { hood: (typeof hoods)[number]; distance: number } | null = null;
  for (const hood of hoods) {
    const center =
      hood.latitude !== null && hood.longitude !== null
        ? { latitude: hood.latitude, longitude: hood.longitude }
        : null;
    if (!center) continue;
    const distance = haversineMeters(point, center);
    if (distance <= hood.radiusMeters && (!best || distance < best.distance)) {
      best = { hood, distance };
    }
  }
  if (!best) return null;
  return { id: best.hood.id, name: best.hood.name, cityName: best.hood.city.name };
}

async function detectCity(point: GeoPoint): Promise<{ id: string; name: string } | null> {
  const cities = await db.city.findMany({
    where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
  });
  let best: { city: (typeof cities)[number]; distance: number } | null = null;
  for (const city of cities) {
    const center =
      city.latitude !== null && city.longitude !== null
        ? { latitude: city.latitude, longitude: city.longitude }
        : null;
    if (!center) continue;
    const distance = haversineMeters(point, center);
    if (!best || distance < best.distance) best = { city, distance };
  }
  // Au-delà de 120 km d'un centre connu : position probablement hors réseau
  if (!best || best.distance > 120_000) return null;
  return { id: best.city.id, name: best.city.name };
}

// ------------------------------------------------------------
// Disponibilité par agence pour une intention de voyage
// ------------------------------------------------------------

async function availabilityByAgency(params: {
  fromCityId: string;
  toCityId: string;
  date: string;
}): Promise<Map<string, TripAvailability>> {
  const { start, end } = dayRange(params.date);
  const now = new Date();
  const routes = await db.route.findMany({
    where: { isActive: true, originCityId: params.fromCityId, destinationCityId: params.toCityId },
    select: { id: true },
  });
  const result = new Map<string, TripAvailability>();
  if (routes.length === 0) return result;

  const trips = await db.trip.findMany({
    where: {
      routeId: { in: routes.map((r) => r.id) },
      departureTime: { gte: start, lt: end },
      status: { in: ["SCHEDULED", "BOARDING"] },
    },
    include: {
      bus: { select: { seatLayoutId: true, seatLayout: { select: { _count: { select: { seats: true } } } } } },
      occupancies: {
        where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] },
        select: { id: true },
      },
    },
    orderBy: { departureTime: "asc" },
  });

  for (const trip of trips) {
    const total = trip.bus.seatLayout._count.seats;
    const seats = Math.max(0, total - trip.occupancies.length);
    const agg = result.get(trip.agencyId) ?? {
      departures: 0,
      nextDepartureTime: null,
      nextDepartureSeats: null,
      nextDeparturePrice: null,
    };
    agg.departures += 1;
    // prochain départ « utile » : premier départ avec au moins 1 place
    if (agg.nextDepartureTime === null && seats > 0) {
      agg.nextDepartureTime = trip.departureTime;
      agg.nextDepartureSeats = seats;
      agg.nextDeparturePrice = trip.price;
    }
    result.set(trip.agencyId, agg);
  }
  return result;
}

// ------------------------------------------------------------
// Normalisation d'une agence → DTO avec statut complet
// ------------------------------------------------------------

function toNearbyDTO(
  agency: AgencyRow,
  distanceMeters: number | null,
  availability: TripAvailability | null,
  withTripIntent: boolean
): NearbyAgencyDTO {
  const openNow = isOpenAt(agency.openingTime, agency.closingTime);
  let status: NearbyAgencyDTO["status"] = openNow ? "OPEN" : "CLOSED";
  if (withTripIntent && availability) {
    if (availability.nextDepartureTime === null) status = "FULL";
  }
  return {
    id: agency.id,
    code: agency.code,
    name: agency.name,
    address: agency.address,
    phone: agency.phone,
    cityId: agency.cityId,
    cityName: agency.city.name,
    neighborhoodId: agency.neighborhoodId,
    neighborhoodName: agency.neighborhood?.name ?? null,
    latitude: agency.latitude ?? null,
    longitude: agency.longitude ?? null,
    distanceMeters,
    distanceLabel: distanceMeters === null ? null : humanDistance(distanceMeters),
    openNow,
    openingTime: agency.openingTime,
    closingTime: agency.closingTime,
    departuresToday: withTripIntent ? availability?.departures ?? 0 : null,
    nextDepartureTime: withTripIntent ? availability?.nextDepartureTime?.toISOString() ?? null : null,
    nextDepartureSeats: withTripIntent ? availability?.nextDepartureSeats ?? null : null,
    nextDeparturePrice: withTripIntent ? availability?.nextDeparturePrice ?? null : null,
    status,
  };
}

// ------------------------------------------------------------
// API principale : agences proches (avec ou sans intention de voyage)
// ------------------------------------------------------------

export async function findNearbyAgencies(query: AgencyRoutingQuery): Promise<AgencyNearbyResultDTO> {
  const point: GeoPoint = { latitude: query.latitude, longitude: query.longitude };
  if (!isPlausiblePosition(point)) {
    return {
      neighborhood: null,
      detectedCity: null,
      agencies: [],
      recommended: null,
      message: "Position GPS inexploitable. Veuillez choisir votre agence manuellement.",
    };
  }

  const tripIntent =
    query.fromCityId && query.toCityId && query.date
      ? { fromCityId: query.fromCityId, toCityId: query.toCityId, date: query.date }
      : null;
  const withTripIntent = tripIntent !== null;

  const [neighborhood, detectedCity, agencies, availability] = await Promise.all([
    detectNeighborhood(point),
    detectCity(point),
    db.agency.findMany({
      where: {
        isActive: true,
        latitude: { not: null },
        longitude: { not: null },
        ...(query.cityId ? { cityId: query.cityId } : {}),
      },
      include: {
        city: { select: { id: true, name: true, latitude: true, longitude: true } },
        neighborhood: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
    tripIntent
      ? availabilityByAgency({
          fromCityId: tripIntent.fromCityId,
          toCityId: tripIntent.toCityId,
          date: tripIntent.date,
        })
      : Promise.resolve(new Map<string, TripAvailability>()),
  ]);

  const seats = Math.max(1, query.seats ?? 1);

  // Honnêteté géographique : la position peut être (a) réelle et précise,
  // (b) réelle mais imprécise (GPS/IP wifi → souvent le centre-ville), ou
  // (c) un point de référence (repli manuel ville — PAS la position de
  // l'utilisateur). Le quartier n'est affirmé qu'en cas (a) ; suggéré avec
  // réserve en cas (b) ; jamais mentionné en cas (c).
  const approximate = query.approximate === true;
  const accuracyM = query.accuracy ?? null;
  const lowAccuracy = accuracyM !== null && accuracyM > GEO.neighborhoodClaimAccuracyM;
  const tooLowAccuracy = accuracyM !== null && accuracyM > GEO.neighborhoodSuggestAccuracyM;
  const claimableNeighborhood = approximate || tooLowAccuracy ? null : neighborhood;

  const rows = agencies
    .map((a) => {
      const center =
        a.latitude !== null && a.longitude !== null
          ? { latitude: a.latitude, longitude: a.longitude }
          : null;
      const distance = center ? haversineMeters(point, center) : null;
      const av = availability.get(a.id) ?? null;
      const dto = toNearbyDTO(a as unknown as AgencyRow, distance, av, withTripIntent);
      // Réévalue FULL selon le nombre de places demandées
      if (withTripIntent && dto.status === "OPEN") {
        const av2 = availability.get(a.id);
        if (av2 && av2.nextDepartureSeats !== null && av2.nextDepartureSeats < seats) {
          dto.status = "FULL";
        }
      }
      return dto;
    })
    .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));

  // CAS 3 (sans intention) : on recommande simplement l'agence ouverte la plus proche
  const recommended =
    rows.find((r) => r.status === "OPEN") ?? rows.find((r) => r.status !== "CLOSED") ?? rows[0] ?? null;

  // Message honnête selon la qualité de la position.
  const accuracyKm = accuracyM !== null ? Math.max(1, Math.round(accuracyM / 1000)) : null;
  let neighborhoodLabel = "";
  if (approximate) {
    neighborhoodLabel = detectedCity ? `Voici les agences Océan du Nord de ${detectedCity.name}.` : "Agences Océan du Nord de la ville choisie.";
  } else if (neighborhood && tooLowAccuracy) {
    neighborhoodLabel = `Position GPS trop imprécise (± ${accuracyKm} km) pour identifier votre quartier.`;
  } else if (neighborhood && lowAccuracy) {
    neighborhoodLabel = `Position GPS approximative (± ${accuracyKm} km) — quartier le plus probable : ${neighborhood.name} (${neighborhood.cityName}).`;
  } else if (neighborhood) {
    neighborhoodLabel = `Vous êtes probablement à ${neighborhood.name} (${neighborhood.cityName}).`;
  }
  const message =
    rows.length === 0
      ? "Aucune agence Océan du Nord active et géolocalisée pour le moment. Vous pouvez choisir votre ville manuellement."
      : recommended && recommended.status === "OPEN"
        ? `${neighborhoodLabel} Nous vous proposons l'agence ${recommended.name}${recommended.distanceLabel ? ` à environ ${recommended.distanceLabel}` : ""}.`
        : `${neighborhoodLabel} Aucune agence ouverte à proximité immédiate ; voici les agences les plus proches.`;

  return {
    neighborhood: claimableNeighborhood
      ? { id: claimableNeighborhood.id, name: claimableNeighborhood.name, cityName: claimableNeighborhood.cityName }
      : null,
    detectedCity,
    agencies: rows,
    recommended,
    message,
  };
}

// ------------------------------------------------------------
// Recommandation complète avec alternatives motivées (CAS 1/2/3)
// ------------------------------------------------------------

export async function recommendAgency(query: AgencyRoutingQuery): Promise<AgencyRecommendationDTO> {
  const base = await findNearbyAgencies(query);
  const withTripIntent = Boolean(query.fromCityId && query.toCityId && query.date);
  const seats = Math.max(1, query.seats ?? 1);

  const eligible = base.agencies.filter((a) => a.status === "OPEN");
  const recommended = eligible[0] ?? null;
  const alternatives = base.agencies.filter((a) => a.id !== recommended?.id);

  let reason: string;
  if (recommended) {
    if (base.agencies[0]?.id === recommended.id) {
      // CAS 1 — l'agence la plus proche est disponible
      reason = `Agence la plus proche de vous, ouverte${
        recommended.nextDepartureSeats !== null ? ` avec ${recommended.nextDepartureSeats} place(s) disponible(s)` : ""
      }.`;
    } else {
      // CAS 2 — la plus proche était fermée/complète → alternative proposée
      const nearest = base.agencies[0];
      reason = `L'agence la plus proche (${nearest?.name}) est ${
        nearest?.status === "FULL" ? "complète pour ce voyage" : "actuellement fermée"
      }. Nous vous proposons ${recommended.name}${
        recommended.distanceLabel ? ` à environ ${recommended.distanceLabel}` : ""
      }.`;
    }
  } else if (withTripIntent) {
    // CAS 3 — aucune agence ne propose le voyage aujourd'hui
    reason =
      "Aucune agence proche ne propose de départ disponible pour ce voyage à cette date. Choisissez une autre date, une autre destination, ou sélectionnez manuellement une agence.";
  } else {
    reason = "Aucune agence ouverte n'a été trouvée à proximité. Vous pouvez choisir manuellement votre agence de départ.";
  }

  return {
    ...base,
    recommended,
    alternatives,
    reason,
    seats,
  };
}
