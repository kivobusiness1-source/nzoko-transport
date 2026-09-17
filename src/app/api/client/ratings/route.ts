// POST /api/client/ratings — évaluation post-voyage (5 critères 1-5)
// Éligibilité : réservation à moi, voyage terminé (réservation COMPLETED
// OU voyage ARRIVÉ/COMPLÉTÉ + départ passé), pas encore évaluée.
// Une évaluation par réservation (bookingId unique → 409 si déjà).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient, myPassengerIds } from "@/services/client-space";
import { db } from "@/lib/db";

const schema = z.object({
  bookingId: z.string().trim().min(1, "Réservation requise."),
  cleanliness: z.number().int().min(1, "Note entre 1 et 5.").max(5, "Note entre 1 et 5."),
  comfort: z.number().int().min(1, "Note entre 1 et 5.").max(5, "Note entre 1 et 5."),
  punctuality: z.number().int().min(1, "Note entre 1 et 5.").max(5, "Note entre 1 et 5."),
  staff: z.number().int().min(1, "Note entre 1 et 5.").max(5, "Note entre 1 et 5."),
  security: z.number().int().min(1, "Note entre 1 et 5.").max(5, "Note entre 1 et 5."),
  comment: z.string().trim().max(1000, "Commentaire trop long (1000 caractères max).").optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`rating:${auth.userId}`, RATE_LIMITS.ratingCreate.limit, RATE_LIMITS.ratingCreate.windowMs);

    const body = schema.parse(await req.json().catch(() => null));

    const user = await db.user.findUnique({ where: { id: auth.userId }, select: { id: true, phone: true } });
    if (!user) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Compte introuvable.");
    const passengerIds = await myPassengerIds(user);

    const booking = await db.booking.findFirst({
      where: { id: body.bookingId, passengerId: { in: passengerIds } },
      include: { trip: true },
    });
    if (!booking) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réservation introuvable.");

    // Éligibilité : voyage terminé + pas encore évalué
    const already = await db.tripRating.findUnique({ where: { bookingId: booking.id }, select: { id: true } });
    const arrived =
      (booking.status === "COMPLETED" || ["ARRIVED", "COMPLETED"].includes(booking.trip.status)) &&
      booking.trip.departureTime.getTime() < Date.now();

    if (already) {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Vous avez déjà évalué ce voyage.");
    }
    if (!arrived) {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce voyage ne peut pas encore être évalué.");
    }

    const notes = [body.cleanliness, body.comfort, body.punctuality, body.staff, body.security];
    const average = Math.round(notes.reduce((s, n) => s + n, 0) / 5);

    await db.tripRating.create({
      data: {
        bookingId: booking.id,
        tripId: booking.tripId,
        userId: auth.userId,
        cleanliness: body.cleanliness,
        comfort: body.comfort,
        punctuality: body.punctuality,
        staff: body.staff,
        security: body.security,
        average,
        comment: body.comment ?? null,
      },
    });

    await db.notification.create({
      data: {
        userId: auth.userId,
        title: "Merci pour votre évaluation ⭐",
        message: "Votre avis aide toute l'équipe NZOKO à améliorer chaque voyage. Merci !",
        type: "SUCCESS",
      },
    });

    return ok(true);
  } catch (err) {
    return routeError(err, "POST /api/client/ratings");
  }
}
