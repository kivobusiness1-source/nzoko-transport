// ============================================================
// NZOKO TRANSPORT — Moteur de réservation
// Verrouillage serveur des sièges via SeatOccupancy (unique tripId+seatId)
// La disponibilité est TOUJOURS calculée par voyage, jamais globalement.
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { generateBookingReference } from "@/lib/security";
import { SEAT_HOLD_MINUTES } from "@/lib/constants";
import { dayRange } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { validatePromoForTrip } from "@/services/promo";
import type { BookingDTO, BookingDetailDTO, CreateBookingInput, SeatMapDTO, TripSearchDTO } from "@/types";
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

type TripWithRelations = Prisma.TripGetPayload<{
  include: {
    route: { include: { originCity: true; destinationCity: true; stops: { include: { city: true } } } };
    bus: { include: { agency: true; seatLayout: { include: { seats: true } } } };
    agency: true;
    occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: Date } }] } };
  };
}>;

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
      },
    },
  });

  if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
  if (!["SCHEDULED", "BOARDING"].includes(trip.status) || trip.departureTime < now) {
    throw new ApiError(409, ERROR_CODES.TRIP_UNAVAILABLE, "Ce voyage n'est plus réservable.");
  }

  const takenSeatIds = new Set(trip.occupancies.map((o) => o.seatId));
  const seats = trip.bus.seatLayout.seats
    .map((s) => ({
      id: s.id,
      seatNumber: s.seatNumber,
      row: s.row,
      column: s.column,
      type: s.type as "STANDARD" | "VIP",
      status: (takenSeatIds.has(s.id) ? "BOOKED" : "AVAILABLE") as "BOOKED" | "AVAILABLE",
    }))
    .sort((a, b) => a.row - b.row || a.column.localeCompare(b.column));

  return {
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
  passenger: true,
  agency: true,
  createdBy: true,
  dropOffNeighborhood: { select: { id: true, name: true, city: { select: { name: true } } } },
} satisfies Prisma.BookingInclude;

export async function createBooking(input: CreateBookingInput, ctx: CreateBookingContext): Promise<BookingDTO> {
  // force : un verrou expiré sur le siige visé doit être libéré AVANT le
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
  const seat = trip.bus.seatLayout.seats.find((s) => s.id === input.seatId);
  if (!seat) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Siège introuvable pour ce bus.");

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

  const p = input.passenger;

  // Code promo : MÊME validation que /api/bookings/promo/validate
  // (une seule implémentation — src/services/promo.ts). La remise est
  // figée dans le montant de la réservation.
  let amount = trip.price;
  let promoCode: string | null = null;
  if (input.promoCode?.trim()) {
    const validated = await validatePromoForTrip(
      input.promoCode.trim().toUpperCase(),
      trip.id,
      ctx.actorRole === "PASSENGER" ? ctx.actorUserId ?? null : null
    );
    amount = validated.discountedAmount;
    promoCode = validated.code;
  }

  // Téléphone passager : normalisé E.164 digits (compatibilité MoMo OK)
  const passengerPhone = normalizePhone(p.phone) ?? p.phone.trim();

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
          seatId: seat.id,
          amount,
          status: "PENDING",
          channel: ctx.channel,
          agencyId: ctx.channel === "AGENT" ? ctx.actorAgencyId : trip.agencyId,
          createdById: ctx.actorUserId ?? null,
          promoCode,
          dropOffNeighborhoodId,
          expiresAt,
        },
      });

      // ⚠️ Verrou : la contrainte unique (tripId+seatId) rejette TOUTE double
      // réservation simultanée, quel que soit le nombre de clients parallèles.
      await tx.seatOccupancy.create({
        data: {
          tripId: trip.id,
          seatId: seat.id,
          bookingId: booking.id,
          status: "HELD",
          expiresAt,
        },
      });

      return booking.id;
    });

    const created = await db.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
    if (!created) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de finaliser votre réservation. Veuillez réessayer.");
    return toBookingDTO(created);
  } catch (err) {
    const prismaErr = err as { code?: string };
    if (prismaErr?.code === "P2002") {
      throw new ApiError(
        409,
        ERROR_CODES.SEAT_UNAVAILABLE,
        "Ce siège vient d'être pris par un autre passager. Veuillez en choisir un autre."
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
            createdById: actorUserId,
          },
        });
      } else if (["PENDING", "PROCESSING"].includes(pay.status)) {
        await tx.payment.update({ where: { id: pay.id }, data: { status: "CANCELLED" } });
      }
    }
  });

  return getBookingDetail(booking.id);
}

// ---------- Mappers ----------
type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/** Le quartier d'arrêt est OPTIONNEL pour les appelants qui construisent
 *  leur propre include (stats, listes partielles) : le mapper tolère
 *  son absence (mappée à null dans le DTO). */
export type BookingWithOptionalDropOff = Omit<BookingWithRelations, "dropOffNeighborhood"> & {
  dropOffNeighborhood?: BookingWithRelations["dropOffNeighborhood"] | null;
};

export function toBookingDTO(b: BookingWithRelations | BookingWithOptionalDropOff): BookingDTO {
  return {
    id: b.id,
    bookingReference: b.bookingReference,
    status: b.status as BookingDTO["status"],
    amount: b.amount,
    channel: b.channel as "WEB" | "AGENT",
    promoCode: b.promoCode,
    expiresAt: b.expiresAt?.toISOString() ?? null,
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
