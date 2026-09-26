// ============================================================
// OCÉAN DU NORD — Notifications système planifiées (V3)
// Rappels avant départ : chaque passager d'un voyage CONFIRMÉ
// partant dans moins de 2 h reçoit une notification « Rappel ».
// Exécuté par le scheduler de maintenance (mini-service 5 min /
// Vercel Cron) — idempotent par construction : l'anti-doublon
// repose sur la référence de réservation (unique) présente dans
// le message de la notification déjà envoyée.
// ============================================================

import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export interface RemindersResult {
  tripsScanned: number;
  remindersSent: number;
}

/** Fenêtre de rappel : départ entre maintenant et +2 h. */
const REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function runDepartureReminders(): Promise<RemindersResult> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);

  const trips = await db.trip.findMany({
    where: {
      status: { in: ["SCHEDULED", "BOARDING"] },
      departureTime: { gte: now, lte: windowEnd },
    },
    select: {
      id: true,
      code: true,
      departureTime: true,
      bookings: {
        where: { status: "CONFIRMED" },
        select: {
          id: true,
          bookingReference: true,
          passenger: { select: { userId: true, firstName: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const trip of trips) {
    for (const booking of trip.bookings) {
      const userId = booking.passenger.userId;
      if (!userId) continue; // notification → compte client uniquement

      // Idempotence : cette référence a-t-elle déjà reçu son rappel ?
      const already = await db.notification.findFirst({
        where: { userId, message: { contains: booking.bookingReference }, type: "REMINDER" },
        select: { id: true },
      });
      if (already) continue;

      await db.notification
        .create({
          data: {
            userId,
            title: "Rappel départ imminent 🚌",
            message: `Votre voyage ${trip.code} part à ${formatDateTime(trip.departureTime)} (heure du Congo). Présentez-vous à l'agence de départ au moins 30 minutes avant. Réf. ${booking.bookingReference}.`,
            type: "REMINDER",
          },
        })
        .then(() => {
          sent += 1;
        })
        .catch(() => {});
    }
  }

  return { tripsScanned: trips.length, remindersSent: sent };
}
