// POST /api/bookings — création de réservation (verrou serveur des sièges)
// Channel AGENT si l'utilisateur connecté a la permission booking:create, sinon WEB (public).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { createBooking } from "@/services/booking";

const passengerSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom du passager requis.").max(60),
  lastName: z.string().trim().min(1, "Nom du passager requis.").max(60),
  phone: z
    .string()
    .trim()
    .min(8, "Numéro de téléphone invalide.")
    .max(20, "Numéro de téléphone invalide.")
    .regex(/^(\+|00|\d)[\d\s.-]+$/, "Numéro de téléphone invalide (format attendu : +242 06 123 45 67)."),
  email: z.email("Adresse e-mail invalide.").optional(),
  documentNumber: z.string().trim().min(1).max(40).optional(),
});

const bookingSchema = z.object({
  tripId: z.string().trim().min(1, "Voyage requis."),
  seatId: z.string().trim().min(1, "Siège requis."),
  passenger: passengerSchema,
  channel: z.enum(["WEB", "AGENT"]).optional(),
  promoCode: z.string().trim().min(3, "Code promo invalide.").max(40).optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    enforceRateLimit(`booking:${ip}`, RATE_LIMITS.booking.limit, RATE_LIMITS.booking.windowMs);

    const input = bookingSchema.parse(await req.json().catch(() => null));

    // Le channel n'est JAMAIS pris sur parole du client :
    // il est recalculé côté serveur à partir des permissions réelles.
    // Un client PASSENGER connecté reste sur le canal WEB (self-service).
    const auth = await getAuth(req);
    const isAgent = Boolean(auth && auth.role !== "PASSENGER" && auth.permissions.includes("booking:create"));
    const isPassenger = Boolean(auth && auth.role === "PASSENGER");
    const ctx = isAgent && auth
      ? {
          channel: "AGENT" as const,
          actorUserId: auth.userId,
          actorAgencyId: auth.agencyId,
          actorRole: auth.role,
          actorPhone: auth.sessionUser.phone ?? null,
        }
      : {
          channel: "WEB" as const,
          actorUserId: isPassenger && auth ? auth.userId : null,
          actorAgencyId: null,
          actorRole: isPassenger && auth ? auth.role : null,
          actorPhone: isPassenger && auth ? auth.sessionUser.phone ?? null : null,
        };

    const booking = await createBooking(
      { ...input, channel: ctx.channel },
      ctx
    );

    await logAudit({
      userId: ctx.actorUserId,
      action: "BOOKING_CREATED",
      entity: "Booking",
      entityId: booking.id,
      metadata: {
        reference: booking.bookingReference,
        trip: booking.trip.code,
        seat: booking.seat.seatNumber,
        amount: booking.amount,
        channel: ctx.channel,
        promoCode: booking.promoCode ?? null,
      },
      ipAddress: ip,
    });

    return ok(booking, 201);
  } catch (err) {
    return routeError(err, "POST /api/bookings");
  }
}
