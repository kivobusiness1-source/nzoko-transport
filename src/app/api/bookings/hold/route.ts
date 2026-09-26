// POST /api/bookings/hold — contrat API centrale §7 : réservation temporaire
// multi-sièges avec verrou concurrent (§8), durée 10 min (§9), idempotence (§16).
//
// Body : { tripId, seatIds[], agencyId?, customer:{name,phone,email?} |
//          passenger:{...complet}, promoCode?, dropOffNeighborhoodId? }
// Header : Idempotency-Key: <uuid> (recommandé)
// 201 → BookingDetailDTO (status PENDING ≡ contractStatus HELD, holdExpiresAt)
// 409 SEAT_ALREADY_TAKEN → « Cette place vient d'être réservée » (§8)
// 400 AGENCY_UNAVAILABLE / TRIP_UNAVAILABLE / VALIDATION_ERROR

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { createBooking } from "@/services/booking";
import { getBookingDetail } from "@/services/booking";

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

const customerSchema = z.object({
  name: z.string().trim().min(2, "Nom du client requis (« Jean Mbala »).").max(120),
  phone: z
    .string()
    .trim()
    .min(8, "Numéro de téléphone invalide.")
    .max(20, "Numéro de téléphone invalide.")
    .regex(/^(\+|00|\d)[\d\s.-]+$/, "Numéro de téléphone invalide."),
  email: z.email("Adresse e-mail invalide.").optional(),
});

const holdSchema = z.object({
  tripId: z.string().trim().min(1, "Voyage requis."),
  seatIds: z.array(z.string().trim().min(1)).min(1, "Au moins une place requise.").max(6, "Maximum 6 places.").optional(),
  agencyId: z.string().trim().min(1).max(60).optional(),
  customer: customerSchema.optional(),
  passenger: passengerSchema.optional(),
  promoCode: z.string().trim().min(3).max(40).optional(),
  dropOffNeighborhoodId: z.string().trim().min(1).max(60).optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req); // cookie-web OU Bearer CENTRAL_API_SECRET (service)
    const ip = getClientIp(req);
    enforceRateLimit(`hold:${ip}`, RATE_LIMITS.booking.limit, RATE_LIMITS.booking.windowMs);

    const input = holdSchema.parse(await req.json().catch(() => null));
    if (!input.customer && !input.passenger) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Client requis : « customer » (nom + téléphone) ou « passenger » complet.");
    }

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

    // Le channel n'est JAMAIS pris sur parole du client (recalculé serveur).
    const created = await createBooking(
      {
        tripId: input.tripId,
        seatIds: input.seatIds,
        agencyId: input.agencyId,
        passenger: input.passenger,
        customer: input.customer,
        promoCode: input.promoCode,
        dropOffNeighborhoodId: input.dropOffNeighborhoodId,
        channel: ctx.channel,
        idempotencyKey: req.headers.get("idempotency-key") ?? undefined,
      },
      ctx
    );

    // Réponse : détail complet (payments/ticket/seats) + statut contractuel.
    const detail = await getBookingDetail(created.id);
    return ok(detail, 201);
  } catch (err) {
    return routeError(err, "POST /api/bookings/hold");
  }
}
