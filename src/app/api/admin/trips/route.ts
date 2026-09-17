// GET  /api/admin/trips?date&routeId&agencyId&status — voyages du jour demandé (trip:read, scope)
// POST /api/admin/trips — création (trip:manage ; repeatDays départs quotidiens ; code auto)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { TRIP_STATUSES } from "@/lib/constants";
import { generateTripCode } from "@/lib/security";
import { dayRange, isValidDateStr, todayStr } from "@/lib/dates";
import { db } from "@/lib/db";
import { toTripSearchDTO } from "@/services/booking";

const querySchema = z.object({
  date: z
    .string()
    .trim()
    .refine((s) => s === "" || isValidDateStr(s), "Date invalide (YYYY-MM-DD).")
    .optional(),
  routeId: z.string().trim().min(1).optional(),
  agencyId: z.string().trim().min(1).optional(),
  status: z.enum(TRIP_STATUSES).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "trip:read");
    const q = querySchema.parse({
      date: req.nextUrl.searchParams.get("date") ?? undefined,
      routeId: req.nextUrl.searchParams.get("routeId") ?? undefined,
      agencyId: req.nextUrl.searchParams.get("agencyId") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
    });

    const agencyId = resolveAgencyScope(auth, q.agencyId ?? null);
    const date = q.date && q.date !== "" ? q.date : todayStr();
    const { start, end } = dayRange(date);
    const now = new Date();

    const trips = await db.trip.findMany({
      where: {
        departureTime: { gte: start, lt: end },
        ...(agencyId ? { agencyId } : {}),
        ...(q.routeId ? { routeId: q.routeId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      include: {
        route: { include: { originCity: true, destinationCity: true, stops: { include: { city: true }, orderBy: { position: "asc" } } } },
        bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
        agency: true,
        occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] } },
      },
      orderBy: { departureTime: "asc" },
    });

    const data = trips.map((t) =>
      toTripSearchDTO(t, t.bus.seatLayout.seats.length, t.occupancies.length)
    );

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/trips");
  }
}

const createSchema = z.object({
  routeId: z.string().trim().min(1, "Route requise."),
  busId: z.string().trim().min(1, "Bus requis."),
  driverId: z.string().trim().min(1).nullable().optional(),
  agencyId: z.string().trim().min(1, "Agence requise."),
  departureTime: z
    .string()
    .min(1, "Date et heure de départ requises.")
    .refine((s) => !Number.isNaN(Date.parse(s)), "Date/heure invalide (ISO attendu)."),
  price: z.number().int("Montant entier XAF requis.").positive("Le prix doit être positif."),
  repeatDays: z.number().int().min(1, "Minimum 1 jour.").max(7, "Maximum 7 jours.").optional().default(1),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "trip:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    // Scope agence : un non-global programme DANS son agence
    const agencyId = resolveAgencyScope(auth, body.agencyId);

    const [route, bus, driver] = await Promise.all([
      db.route.findUnique({ where: { id: body.routeId } }),
      db.bus.findUnique({ where: { id: body.busId } }),
      body.driverId ? db.driver.findUnique({ where: { id: body.driverId } }) : Promise.resolve(null),
    ]);

    if (!route || !route.isActive) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Route inconnue ou désactivée.");
    }
    if (!bus) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Bus inconnu.");
    if (bus.status !== "ACTIVE") {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce bus n'est pas en service (statut actif requis).");
    }
    if (bus.agencyId !== agencyId) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Le bus n'appartient pas à l'agence sélectionnée.");
    }
    if (body.driverId) {
      if (!driver) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Chauffeur inconnu.");
      if (driver.agencyId !== agencyId) {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Le chauffeur n'appartient pas à l'agence sélectionnée.");
      }
    }

    const baseDeparture = new Date(body.departureTime);
    if (baseDeparture.getTime() <= Date.now()) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Le départ doit être dans le futur.");
    }

    const tripIds: string[] = [];
    for (let i = 0; i < body.repeatDays; i++) {
      const departureTime = new Date(baseDeparture.getTime() + i * 24 * 3600 * 1000);
      const estimatedArrivalTime = new Date(
        departureTime.getTime() + route.estimatedDurationMinutes * 60 * 1000
      );
      const created = await db.trip.create({
        data: {
          code: generateTripCode(),
          routeId: route.id,
          busId: bus.id,
          driverId: body.driverId ?? null,
          agencyId,
          departureTime,
          estimatedArrivalTime,
          price: body.price,
        },
        select: { id: true },
      });
      tripIds.push(created.id);
    }

    const now = new Date();
    const created = await db.trip.findMany({
      where: { id: { in: tripIds } },
      include: {
        route: { include: { originCity: true, destinationCity: true, stops: { include: { city: true }, orderBy: { position: "asc" } } } },
        bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
        agency: true,
        occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] } },
      },
      orderBy: { departureTime: "asc" },
    });

    await logAudit({
      userId: auth.userId,
      action: "TRIP_CREATED",
      entity: "Trip",
      entityId: tripIds[0],
      metadata: {
        route: route.code,
        bus: bus.registrationNumber,
        agencyId,
        price: body.price,
        repeatDays: body.repeatDays,
        createdTrips: tripIds.length,
      },
      ipAddress: ip,
    });

    return ok(
      {
        created: created.map((t) =>
          toTripSearchDTO(t, t.bus.seatLayout.seats.length, t.occupancies.length)
        ),
      },
      201
    );
  } catch (err) {
    return routeError(err, "POST /api/admin/trips");
  }
}
