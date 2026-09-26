// ============================================================
// OCÉAN DU NORD — Moteur de réservation
// Verrouillage serveur des sièges via SeatOccupancy (unique tripId+seatId)
// La disponibilité est TOUJOURS calculée par voyage, jamais globalement.
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { generateBookingReference } from "@/lib/security";
import { SEAT_HOLD_MINUTES, MAX_SEATS_PER_BOOKING } from "@/lib/constants";
import { dayRange } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { validatePromoForTrip } from "@/services/promo";
import { emitDomainEvents } from "@/services/domain-events";
import type { BookingDTO, BookingDetailDTO, CreateBookingInput, HoldCustomerInput, PassengerInput, SeatMapDTO, TripSearchDTO, TripSeatStatus } from "@/types";
import type { Prisma } from "@prisma/client";
import { toPaymentDTO } from "@/services/payment-mappers";

// ---------- Purge paresseuse des verrous expirés (batchée) ----------
// Appelée par les routes publiques à chaque requête : débouncée en mémoire
// (au plus une purge réelle toutes les 30 s) et regroupée en UNE transaction
// au lieu de N — cf. audit architecture, point 5. createBooking passe
// { force: true } : la libération d'un verrou expiré doit être garantie
// AVANT le test d'unicité tripId+seatId (sinon 409 injuste pour le client).
// Un échec de purge n'interrompt jamais la route appelante (avale, comme
// les .catch de l'ancienne implémentation).
let lastHoldPurgeMs = 0;
const HOLD_PURGE_INTERVAL_MS = 30_000;
let holdPurgeInFlight: Promise<void> | null = null;

export function releaseExpiredHolds(options?: { force?: boolean }): Promise<void> {
  if (!options?.force && Date.now() - lastHoldPurgeMs < HOLD_PURGE_INTERVAL_MS) {
    return Promise.resolve();
  }
  if (holdPurgeInFlight) return holdPurgeInFlight;
  lastHoldPurgeMs = Date.now();
  holdPurgeInFlight = (async () => {
    try {
      const expired = await db.seatOccupancy.findMany({
        where: { status: "HELD", expiresAt: { lt: new Date() } },
        take: 200,
      });
      if (expired.length === 0) return;
      const bookingIds = [...new Set(expired.map((o) => o.bookingId))];
      await db.$transaction(async (tx) => {
        await tx.seatOccupancy
          .deleteMany({ where: { id: { in: expired.map((o) => o.id) } } })
          .catch(() => {});
        await tx.booking
          .updateMany({ where: { id: { in: bookingIds }, status: "PENDING" }, data: { status: "EXPIRED" } })
          .catch(() => {});
      });
      // Événements (contrat §14) : les places repassent AVAILABLE, les
      // réservations PENDING correspondantes passent EXPIRED. Best-effort.
      await emitDomainEvents([
        ...expired.map((o) => ({
          type: "SEAT_RELEASED" as const,
          aggregateType: "Seat" as const,
          aggregateId: o.seatId,
          tripId: o.tripId,
          bookingId: o.bookingId,
          payload: { reason: "HOLD_EXPIRED", seatId: o.seatId },
        })),
        ...bookingIds.map((id) => ({
          type: "BOOKING_EXPIRED" as const,
          aggregateType: "Booking" as const,
          aggregateId: id,
          bookingId: id,
          payload: { reason: "HOLD_EXPIRED" },
        })),
      ]);
    } catch {
      // purge best-effort : jamais bloquante pour la route appelante
    } finally {
      holdPurgeInFlight = null;
    }
  })();
  return holdPurgeInFlight;
}

// ---------- Recherche de voyages ----------
export async function searchTrips(params: {
  from: string;
  to: string;
  date: string;
  agencyId?: string | null;
}): Promise<TripSearchDTO[]> {
  await releaseExpiredHolds();
  const { start, end } = dayRange(params.date);
  const now = new Date();

  const routes = await db.route.findMany({
    where: { isActive: true },
    include: {
      originCity: true,
      destinationCity: true,
      stops: { include: { city: true }, orderBy: { position: "asc" } },
    },
  });

  // Routes directes OU desservant la paire (départ avant arrivée) via arrêts
  const validRoutes = routes.filter((r) => {
    if (r.originCityId === params.from && r.destinationCityId === params.to) return true;
    const stops = r.stops.slice().sort((a, b) => a.position - b.position);
    const fromStop = stops.find((s) => s.cityId === params.from);
    const toStop = stops.find((s) => s.cityId === params.to);
    if (r.originCityId === params.from && toStop) return true;
    if (fromStop && r.destinationCityId === params.to) return fromStop.position > 0;
    if (fromStop && toStop) return fromStop.position < toStop.position;
    return false;
  });

  if (validRoutes.length === 0) return [];

  const trips = await db.trip.findMany({
    where: {
      routeId: { in: validRoutes.map((r) => r.id) },
      departureTime: { gte: start, lt: end },
      status: { in: ["SCHEDULED", "BOARDING"] },
      // V3 — filtre multi-agences : « Trouver mon agence » restreint la
      // recherche aux départs de l'agence choisie (décision serveur, le filtre
      // n'est qu'une préférence d'affichage JAMAIS une contrainte de sécurité).
      ...(params.agencyId ? { agencyId: params.agencyId } : {}),
    },
    include: {
      route: { include: { originCity: true, destinationCity: true, stops: { include: { city: true }, orderBy: { position: "asc" } } } },
      bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
      agency: true,
      occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] } },
    },
    orderBy: { departureTime: "asc" },
  });

  const nowTs = now.getTime();
  return trips
    .filter((t) => t.departureTime.getTime() > nowTs)
    .map((t) => toTripSearchDTO(t, t.bus.seatLayout.seats.length, t.occupancies.length));
}

type TripWithRelations = Omit<
  Prisma.TripGetPayload<{
    include: {
      route: { include: { originCity: true; destinationCity: true; stops: { include: { city: true } } } };
      bus: { include: { agency: true; seatLayout: { include: { seats: true } } } };
      agency: true;
      occupancies: {
        where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: Date } }] };
        include: { booking: { select: { ticket: { select: { status: true } } } } };
      };
    };
  }>,
  "occupancies"
> & {
  /** Type structurel souple : le DTO de recherche ne consomme que le COUNT
   *  des occupations actives — les appelants admin passent leur propre include. */
  occupancies: { seatId: string }[];
};

export function toTripSearchDTO(trip: TripWithRelations, totalSeats: number, takenSeats: number): TripSearchDTO {
  const r = trip.route;
  return {
    id: trip.id,
    code: trip.code,
    routeId: r.id,
    originCityId: r.originCityId,
    originCityName: r.originCity.name,
    destinationCityId: r.destinationCityId,
    destinationCityName: r.destinationCity.name,
    stops: r.stops
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ cityName: s.city.name, minutesFromStart: s.minutesFromStart })),
    departureTime: trip.departureTime.toISOString(),
    estimatedArrivalTime: trip.estimatedArrivalTime.toISOString(),
    price: trip.price,
    status: trip.status as TripSearchDTO["status"],
    busRegistration: trip.bus.registrationNumber,
    busBrand: trip.bus.brand,
    busModel: trip.bus.model,
    seatLayoutId: trip.bus.seatLayoutId,
    totalSeats,
    availableSeats: Math.max(0, totalSeats - takenSeats),
    agencyName: trip.agency.name,
    durationMinutes: r.estimatedDurationMinutes,
  };
}

// ---------- Plan de sièges ----------
export async function getSeatMap(tripId: string): Promise<SeatMapDTO> {
  await releaseExpiredHolds();
  const now = new Date();
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      route: { include: { originCity: true, destinationCity: true } },
      bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
      agency: true,
      occupancies: {
        where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] },
        include: {
          booking: { select: { ticket: { select: { status: true, checkedAt: true } } } },
        },
      },
    },
  });

  if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
  if (!["SCHEDULED", "BOARDING"].includes(trip.status) || trip.departureTime < now) {
    throw new ApiError(409, ERROR_CODES.TRIP_UNAVAILABLE, "Ce voyage n'est plus réservable.");
  }

  // Statut contractuel par place (API centrale §4/§6) :
  //  - verrou HELD actif        → HELD (🟡)
  //  - occupation BOOKED        → PAID (🔴) sauf embarquée → BOARDED (⚫)
  //    Embarquement PAR PLACE (§24) : occupancy.boardedAt fait foi. Fallback
  //    héritage (ticket USED) UNIQUEMENT si AUCUNE place de la réservation
  //    n'est datée (groupe embarqué avant l'extension) — sinon une place
  //    non embarquée d'un groupe partiel serait faussement BOARDED.
  //  - aucune occupation active → AVAILABLE (🟢)
  const bookingsWithBoarded = new Set(
    trip.occupancies.filter((o) => o.boardedAt !== null).map((o) => o.bookingId)
  );
  const occupancyBySeat = new Map(trip.occupancies.map((o) => [o.seatId, o]));
  const seats = trip.bus.seatLayout.seats
    .map((s) => {
      const occ = occupancyBySeat.get(s.id);
      let status: TripSeatStatus = "AVAILABLE";
      if (occ) {
        if (occ.status === "HELD") status = "HELD";
        else if (
          occ.boardedAt !== null ||
          (occ.booking.ticket?.status === "USED" && !bookingsWithBoarded.has(occ.bookingId))
        ) {
          status = "BOARDED";
        } else status = "PAID";
      }
      return {
        id: s.id,
        seatNumber: s.seatNumber,
        number: s.seatNumber, // alias contractuel (API centrale §6)
        row: s.row,
        column: s.column,
        type: s.type as "STANDARD" | "VIP",
        status,
      };
    })
    .sort((a, b) => a.row - b.row || a.column.localeCompare(b.column));

  return {
    tripId: trip.id,
    trip: {
      id: trip.id,
      code: trip.code,
      originCityName: trip.route.originCity.name,
      destinationCityName: trip.route.destinationCity.name,
      departureTime: trip.departureTime.toISOString(),
      estimatedArrivalTime: trip.estimatedArrivalTime.toISOString(),
      price: trip.price,
      status: trip.status as SeatMapDTO["trip"]["status"],
      busRegistration: trip.bus.registrationNumber,
      agencyName: trip.agency.name,
    },
    layout: {
      rows: trip.bus.seatLayout.rows,
      columns: trip.bus.seatLayout.columns,
      aisleAfter: trip.bus.seatLayout.aisleAfter,
      name: trip.bus.seatLayout.name,
    },
    seats,
    availableSeats: seats.filter((s) => s.status === "AVAILABLE").length,
    total: seats.length,
    holdMinutes: SEAT_HOLD_MINUTES,
  };
}

// ---------- Création de réservation (VERROU SERVEUR) ----------
export interface CreateBookingContext {
  actorUserId?: string | null;
  actorAgencyId?: string | null;
  channel: "WEB" | "AGENT";
  /** Rôle de l'utilisateur connecté (liaison compte client si PASSENGER). */
  actorRole?: string | null;
  /** Téléphone de l'utilisateur connecté (liaison passager ↔ compte). */
  actorPhone?: string | null;
}

const bookingInclude = {
  trip: { include: { route: { include: { originCity: true, destinationCity: true } }, bus: true, agency: true } },
  seat: true,
  occupancies: {
    include: { seat: true, passenger: { select: { firstName: true, lastName: true } } },
    orderBy: { seat: { seatNumber: "asc" as const } },
  },
  passenger: true,
  agency: true,
  createdBy: true,
  dropOffNeighborhood: { select: { id: true, name: true, city: { select: { name: true } } } },
} satisfies Prisma.BookingInclude;

/** Convertit le `customer` contractuel (§7) en passager complet.
 *  « Jean Mbala » → firstName=Jean, lastName=Mbala (un seul mot → les deux). */
function customerToPassenger(c: HoldCustomerInput): PassengerInput {
  const parts = c.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "Passager";
  const lastName = parts.slice(1).join(" ") || firstName;
  return { firstName, lastName, phone: c.phone, email: c.email, documentNumber: undefined };
}

export async function createBooking(input: CreateBookingInput, ctx: CreateBookingContext): Promise<BookingDTO> {
  // ⚠️ IDEMPOTENCE (contrat §16) : la même Idempotency-Key rejouée renvoie
  // la réservation D'ORIGINE — jamais une seconde.
  if (input.idempotencyKey) {
    const existing = await db.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const created = await db.booking.findUnique({ where: { id: existing.id }, include: bookingInclude });
      if (created) return toBookingDTO(created);
    }
  }

  // Multi-sièges (contrat §7) : seatIds prioritaire, sinon seatId historique.
  const seatIds = [...new Set((input.seatIds?.length ? input.seatIds : input.seatId ? [input.seatId] : []).filter(Boolean))];
  if (seatIds.length === 0) {
    throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Aucune place sélectionnée.");
  }
  if (seatIds.length > MAX_SEATS_PER_BOOKING) {
    throw new ApiError(400, ERROR_CODES.BAD_REQUEST, `Maximum ${MAX_SEATS_PER_BOOKING} places par réservation.`);
  }

  // Passager : objet complet OU client contractuel minimal (normalisé).
  const rawPassenger = input.passenger ?? customerToPassenger(input.customer ?? { name: "", phone: "" });
  const p: PassengerInput = {
    firstName: rawPassenger.firstName,
    lastName: rawPassenger.lastName,
    phone: rawPassenger.phone,
    email: rawPassenger.email,
    documentNumber: rawPassenger.documentNumber,
  };
  if (!p.firstName || !p.lastName || !p.phone) {
    throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Informations client incomplètes (nom + téléphone requis).");
  }

  // force : un verrou expiré sur le siège visé doit être libéré AVANT le
  // test d’unicité tripId+seatId, sinon le client recevrait un 409 injuste.
  await releaseExpiredHolds({ force: true });
  const now = new Date();

  const trip = await db.trip.findUnique({
    where: { id: input.tripId },
    include: {
      route: { include: { originCity: true, destinationCity: true } },
      bus: { include: { agency: true, seatLayout: { include: { seats: true } } } },
    },
  });
  if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
  if (!["SCHEDULED", "BOARDING"].includes(trip.status) || trip.departureTime < now) {
    throw new ApiError(409, ERROR_CODES.TRIP_UNAVAILABLE, "Ce voyage n'est plus réservable.");
  }
  const seatByid = new Map(trip.bus.seatLayout.seats.map((s) => [s.id, s]));
  const seats = seatIds.flatMap((id) => {
    const seat = seatByid.get(id);
    return seat ? [seat] : [];
  });
  if (seats.length !== seatIds.length) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Place introuvable pour ce bus.");
  }

  // Agence choisie par le client (contrat §5) : canal/agence de vente de la
  // réservation. Elle NE possède PAS la place — la disponibilité reste
  // globale au voyage. Validée serveur : existante + ACTIVE (§7.4).
  let sellerAgencyId: string | null = null;
  if (input.agencyId) {
    const agency = await db.agency.findUnique({ where: { id: input.agencyId }, select: { id: true, isActive: true } });
    if (!agency || !agency.isActive) {
      throw new ApiError(400, ERROR_CODES.AGENCY_UNAVAILABLE, "Agence invalide ou inactive. Choisissez une agence active.");
    }
    sellerAgencyId = agency.id;
  }

  // Quartier d'arrêt (optionnel) : il doit exister, être ACTIF et
  // appartenir à la ville de DESTINATION du voyage — jamais sur parole
  // du client (un quartier d'une autre ville est rejeté).
  let dropOffNeighborhoodId: string | null = null;
  if (input.dropOffNeighborhoodId) {
    const hood = await db.neighborhood.findUnique({
      where: { id: input.dropOffNeighborhoodId },
    });
    if (!hood || !hood.isActive || hood.cityId !== trip.route.destinationCityId) {
      throw new ApiError(
        400,
        ERROR_CODES.BAD_REQUEST,
        "Quartier d'arrêt invalide pour cette destination. Choisissez un quartier de la liste ou laissez vide."
      );
    }
    dropOffNeighborhoodId = hood.id;
  }

  // Code promo : MÊME validation que /api/bookings/promo/validate
  // (une seule implémentation — src/services/promo.ts). La remise est
  // figée dans le montant de la réservation — appliquée PAR PLACE puis
  // multipliée par le nombre de places.
  let unitAmount = trip.price;
  let promoCode: string | null = null;
  if (input.promoCode?.trim()) {
    const validated = await validatePromoForTrip(
      input.promoCode.trim().toUpperCase(),
      trip.id,
      ctx.actorRole === "PASSENGER" ? ctx.actorUserId ?? null : null
    );
    unitAmount = validated.discountedAmount;
    promoCode = validated.code;
  }
  const amount = unitAmount * seats.length;

  // Téléphone passager : normalisé E.164 digits (compatibilité MoMo OK)
  const passengerPhone = normalizePhone(p.phone) ?? p.phone.trim();

  // Passagers NOMMÉS par place (extension §24) : alignés par index sur les
  // places ; l'acheteur est le fallback (place sans passager nommé). Le
  // téléphone de l'acheteur sert de contact de repli (Passenger.phone requis).
  const seatPassengers = seats.map((_, index) => {
    const named = input.passengers?.[index];
    if (!named?.firstName?.trim() || !named?.lastName?.trim()) return null;
    const phone = normalizePhone(named.phone ?? p.phone) ?? passengerPhone;
    return {
      firstName: named.firstName.trim(),
      lastName: named.lastName.trim(),
      phone,
      email: named.email?.trim() || null,
      documentNumber: named.documentNumber?.trim() || null,
    };
  });

  const expiresAt = new Date(now.getTime() + SEAT_HOLD_MINUTES * 60 * 1000);

  try {
    const bookingId = await db.$transaction(async (tx) => {
      // Passager : réutilisé si téléphone + nom identiques, sinon créé
      const existing = await tx.passenger.findFirst({
        where: { phone: passengerPhone, lastName: p.lastName.trim() },
      });
      const passenger = existing
        ? await tx.passenger.update({
            where: { id: existing.id },
            data: {
              firstName: p.firstName.trim(),
              email: p.email?.trim() || existing.email,
              documentNumber: p.documentNumber?.trim() || existing.documentNumber,
            },
          })
        : await tx.passenger.create({
            data: {
              firstName: p.firstName.trim(),
              lastName: p.lastName.trim(),
              phone: passengerPhone,
              email: p.email?.trim() || null,
              documentNumber: p.documentNumber?.trim() || null,
            },
          });

      // Liaison compte client : un client PASSENGER connecté qui réserve
      // avec SON numéro rattache le profil passager à son compte (ses
      // billets remontent dans l'espace client). Jamais pour un tiers.
      if (
        ctx.actorRole === "PASSENGER" &&
        ctx.actorUserId &&
        passengerPhone === ctx.actorPhone &&
        passenger.userId !== ctx.actorUserId
      ) {
        await tx.passenger.update({
          where: { id: passenger.id },
          data: { userId: ctx.actorUserId },
        });
      }

      const booking = await tx.booking.create({
        data: {
          bookingReference: generateBookingReference(),
          tripId: trip.id,
          passengerId: passenger.id,
          seatId: seats[0].id, // place principale (compat) — liste complète dans SeatOccupancy
          amount,
          status: "PENDING",
          channel: ctx.channel,
          // Agence vendeuse : choisie par le client (contrat §5/§21-T7), sinon
          // l'agence du voyage (WEB historique) ou l'agence de l'agent (guichet).
          agencyId: ctx.channel === "AGENT" ? ctx.actorAgencyId : sellerAgencyId ?? trip.agencyId,
          createdById: ctx.actorUserId ?? null,
          promoCode,
          dropOffNeighborhoodId,
          expiresAt,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });

      // ⚠️ VERROU CRITIQUE (contrat §8) : la contrainte unique (tripId+seatId)
      // rejette TOUTE double réservation simultanée, quel que soit le nombre
      // de clients parallèles — UNE seule transaction gagne, les autres
      // reçoivent 409 SEAT_ALREADY_TAKEN (rollback complet du groupe).
      // Passagers nommés : chaque place est liée à SON passager (créé ou
      // réutilisé par téléphone+nom) — null = passager acheteur.
      const seatPassengerIds: (string | null)[] = [];
      for (let i = 0; i < seats.length; i++) {
        const sp = seatPassengers[i];
        if (!sp) {
          seatPassengerIds.push(null);
          continue;
        }
        const existingSp = await tx.passenger.findFirst({
          where: { phone: sp.phone, lastName: sp.lastName },
        });
        const id = existingSp
          ? existingSp.id
          : (
              await tx.passenger.create({
                data: {
                  firstName: sp.firstName,
                  lastName: sp.lastName,
                  phone: sp.phone,
                  email: sp.email,
                  documentNumber: sp.documentNumber,
                },
              })
            ).id;
        seatPassengerIds.push(id);
      }

      await tx.seatOccupancy.createMany({
        data: seats.map((s, i) => ({
          tripId: trip.id,
          seatId: s.id,
          bookingId: booking.id,
          passengerId: seatPassengerIds[i],
          status: "HELD",
          expiresAt,
        })),
      });

      return booking.id;
    });

    // Événements (contrat §14) : BOOKING_CREATED + SEAT_HELD par place.
    // Best-effort, post-transaction — jamais bloquant.
    await emitDomainEvents([
      {
        type: "BOOKING_CREATED",
        aggregateType: "Booking",
        aggregateId: bookingId,
        tripId: trip.id,
        bookingId,
        payload: { seats: seats.map((s) => s.seatNumber), amount, channel: ctx.channel },
      },
      ...seats.map((s) => ({
        type: "SEAT_HELD" as const,
        aggregateType: "Seat" as const,
        aggregateId: s.id,
        tripId: trip.id,
        bookingId,
        payload: { seatNumber: s.seatNumber, holdMinutes: SEAT_HOLD_MINUTES },
      })),
    ]);

    const created = await db.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
    if (!created) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de finaliser votre réservation. Veuillez réessayer.");
    return toBookingDTO(created);
  } catch (err) {
    const prismaErr = err as { code?: string; meta?: { target?: string[] } };
    if (prismaErr?.code === "P2002") {
      const target = prismaErr.meta?.target ?? [];
      // Collision sur la clé d'idempotence : la requête a déjà été traitée
      // avec UNE AUTRE charge utile — conflit documenté (contrat §16).
      if (target.includes("idempotencyKey")) {
        throw new ApiError(
          409,
          ERROR_CODES.CONFLICT,
          "Cette clé d'idempotence a déjà été utilisée avec une requête différente."
        );
      }
      throw new ApiError(
        409,
        ERROR_CODES.SEAT_ALREADY_TAKEN,
        "Cette place vient d'être réservée. Veuillez choisir une autre place."
      );
    }
    throw err;
  }
}

// ---------- Détail / annulation ----------
export async function getBookingDetail(idOrRef: string): Promise<BookingDetailDTO> {
  await releaseExpiredHolds();
  const booking = await db.booking.findFirst({
    where: { OR: [{ id: idOrRef }, { bookingReference: idOrRef.toUpperCase() }] },
    include: {
      ...bookingInclude,
      payment: { include: { createdBy: true, booking: true }, orderBy: { createdAt: "desc" } },
      ticket: { include: { checkedBy: true } },
    },
  });
  if (!booking) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réservation introuvable. Vérifiez la référence.");
  return toBookingDetailDTO(booking);
}

export async function cancelBooking(
  idOrRef: string,
  actorUserId: string,
  actorAgencyId: string | null,
  isGlobal: boolean
): Promise<BookingDetailDTO> {
  const booking = await db.booking.findFirst({
    where: { OR: [{ id: idOrRef }, { bookingReference: idOrRef.toUpperCase() }] },
    include: { payment: true, ticket: true, agency: true },
  });
  if (!booking) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réservation introuvable.");

  // Sécurité multi-agences : une agence ne peut annuler que SES réservations
  if (!isGlobal && booking.agencyId && booking.agencyId !== actorAgencyId) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Accès refusé : réservation appartenant à une autre agence.");
  }
  if (["CANCELLED", "EXPIRED", "COMPLETED"].includes(booking.status)) {
    throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette réservation ne peut plus être annulée.");
  }

  // Places à libérer capturées AVANT la transaction (elle supprime les verrous).
  const freedSeats = await db.seatOccupancy.findMany({
    where: { bookingId: booking.id },
    select: { seatId: true },
  }).catch(() => []);

  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
    await tx.seatOccupancy.deleteMany({ where: { bookingId: booking.id } });
    if (booking.ticket) {
      await tx.ticket.update({ where: { id: booking.ticket.id }, data: { status: "CANCELLED" } });
    }
    for (const pay of booking.payment) {
      if (pay.status === "SUCCESS") {
        await tx.payment.update({ where: { id: pay.id }, data: { status: "REFUNDED" } });
        await tx.transaction.create({
          data: {
            type: "REFUND",
            amount: pay.amount,
            reference: booking.bookingReference,
            description: `Remboursement réservation ${booking.bookingReference}`,
            agencyId: booking.agencyId,
            createdById: actorUserId || null, // ""/marqueur service → null (contrainte FK User)
          },
        });
      } else if (["PENDING", "PROCESSING"].includes(pay.status)) {
        await tx.payment.update({ where: { id: pay.id }, data: { status: "CANCELLED" } });
      }
    }
  });

  // Événements (contrat §14) : annulation + libération des places
  // (règle métier documentée : une place CANCELLED REDEVIENT AVAILABLE).
  await emitDomainEvents([
    {
      type: "BOOKING_CANCELLED",
      aggregateType: "Booking",
      aggregateId: booking.id,
      tripId: booking.tripId,
      bookingId: booking.id,
      payload: { reference: booking.bookingReference },
    },
    ...freedSeats.map((o) => ({
      type: "SEAT_RELEASED" as const,
      aggregateType: "Seat" as const,
      aggregateId: o.seatId,
      tripId: booking.tripId,
      bookingId: booking.id,
      payload: { reason: "BOOKING_CANCELLED" },
    })),
    ...(booking.ticket
      ? [{
          type: "TICKET_CANCELLED" as const,
          aggregateType: "Ticket" as const,
          aggregateId: booking.ticket.id,
          tripId: booking.tripId,
          bookingId: booking.id,
          payload: { reference: booking.bookingReference },
        }]
      : []),
  ]);

  return getBookingDetail(booking.id);
}

// ---------- Mappers ----------
type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** Le quartier d'arrêt ET les occupancies sont OPTIONNELS pour les appelants
 *  qui construisent leur propre include (stats, listes partielles) : les
 *  mappers tolèrent leur absence (repli sur la place principale). */
export type BookingWithOptionalDropOff = Omit<BookingWithRelations, "dropOffNeighborhood" | "occupancies"> & {
  dropOffNeighborhood?: BookingWithRelations["dropOffNeighborhood"] | null;
  occupancies?: BookingWithRelations["occupancies"];
};

export function toBookingDTO(b: BookingWithRelations | BookingWithOptionalDropOff): BookingDTO {
  // Places de la réservation (multi-sièges) : occupancies triées par numéro.
  // Tolère l'absence de l'include (listes partielles) → repli sur la place principale.
  const occupancyRows = "occupancies" in b && Array.isArray(b.occupancies) ? b.occupancies : [];
  const buyer = { firstName: b.passenger.firstName, lastName: b.passenger.lastName };
  const allSeats =
    occupancyRows.length > 0
      ? occupancyRows.map((o) => ({
          id: o.seat.id,
          seatNumber: o.seat.seatNumber,
          type: o.seat.type as "STANDARD" | "VIP",
          // Passager nommé de la place, sinon l'acheteur (fallback).
          passenger: o.passenger ?? buyer,
          // Embarquement PAR PLACE (§6.1) : brut, sans fallback — le client
          // applique le même repli héritage que l'API (ticket USED).
          boardedAt: "boardedAt" in o && o.boardedAt ? o.boardedAt.toISOString() : null,
        }))
      : [{ id: b.seat.id, seatNumber: b.seat.seatNumber, type: b.seat.type as "STANDARD" | "VIP", passenger: buyer, boardedAt: null }];
  const contractMap: Record<string, "HELD" | "CONFIRMED" | "CANCELLED" | "EXPIRED"> = {
    PENDING: "HELD",
    CONFIRMED: "CONFIRMED",
    COMPLETED: "CONFIRMED",
    CANCELLED: "CANCELLED",
    EXPIRED: "EXPIRED",
  };
  return {
    id: b.id,
    bookingReference: b.bookingReference,
    status: b.status as BookingDTO["status"],
    contractStatus: contractMap[b.status] ?? "HELD",
    amount: b.amount,
    channel: b.channel as "WEB" | "AGENT",
    promoCode: b.promoCode,
    expiresAt: b.expiresAt?.toISOString() ?? null,
    holdExpiresAt: b.expiresAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    trip: {
      id: b.trip.id,
      code: b.trip.code,
      originCityName: b.trip.route.originCity.name,
      destinationCityName: b.trip.route.destinationCity.name,
      departureTime: b.trip.departureTime.toISOString(),
      estimatedArrivalTime: b.trip.estimatedArrivalTime.toISOString(),
      busRegistration: b.trip.bus.registrationNumber,
      status: b.trip.status as BookingDTO["trip"]["status"],
      agencyName: b.trip.agency.name,
    },
    seat: { id: b.seat.id, seatNumber: b.seat.seatNumber, type: b.seat.type as "STANDARD" | "VIP" },
    seats: allSeats,
    passenger: {
      id: b.passenger.id,
      firstName: b.passenger.firstName,
      lastName: b.passenger.lastName,
      phone: b.passenger.phone,
      documentNumber: b.passenger.documentNumber,
    },
    dropOffNeighborhood: b.dropOffNeighborhood
      ? { id: b.dropOffNeighborhood.id, name: b.dropOffNeighborhood.name, cityName: b.dropOffNeighborhood.city.name }
      : null,
    agencyName: b.agency?.name ?? null,
    createdByName: b.createdBy ? `${b.createdBy.firstName} ${b.createdBy.lastName}` : null,
  };
}

type BookingDetailWithRelations = Prisma.BookingGetPayload<{
  include: {
    trip: { include: { route: { include: { originCity: true; destinationCity: true } }, bus: true, agency: true } };
    seat: true;
    occupancies: { include: { seat: true, passenger: { select: { firstName: true; lastName: true } } }, orderBy: { seat: { seatNumber: "asc" } } };
    passenger: true;
    agency: true;
    createdBy: true;
    payment: { include: { createdBy: true, booking: true } };
    ticket: { include: { checkedBy: true } };
  };
}>;

export function toBookingDetailDTO(b: BookingDetailWithRelations): BookingDetailDTO {
  return {
    ...toBookingDTO(b as unknown as BookingWithRelations),
    payments: b.payment.map(toPaymentDTO),
    ticket: b.ticket
      ? {
          id: b.ticket.id,
          token: b.ticket.token,
          boardingNumber: b.ticket.boardingNumber,
          status: b.ticket.status as "VALID" | "USED" | "CANCELLED",
          issuedAt: b.ticket.issuedAt.toISOString(),
          checkedAt: b.ticket.checkedAt?.toISOString() ?? null,
          checkedByName: b.ticket.checkedBy
            ? `${b.ticket.checkedBy.firstName} ${b.ticket.checkedBy.lastName}`
            : null,
          qrDataUrl: null, // chargé à la demande via /api/tickets/[token]/qr
        }
      : null,
  };
}
