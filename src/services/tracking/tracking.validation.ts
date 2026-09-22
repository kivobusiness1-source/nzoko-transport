// ============================================================
// NZOKO TRANSPORT — Validation GPS (Zod) du module tracking
// NE JAMAIS faire confiance aux données envoyées par le téléphone :
// chaque position est re-validée ici (coordonnées, vitesse, timestamps).
// ============================================================

import { z } from "zod";
import { TRACKING } from "@/lib/constants";

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Horodatage invalide (ISO 8601 attendu)");

/** Un point GPS envoyé par le smartphone chauffeur. */
export const gpsPointSchema = z.object({
  latitude: z.number({ error: "Latitude requise" }).min(-90, "Latitude doit être entre -90 et 90").max(90, "Latitude doit être entre -90 et 90"),
  longitude: z.number({ error: "Longitude requise" }).min(-180, "Longitude doit être entre -180 et 180").max(180, "Longitude doit être entre -180 et 180"),
  speed: z.number().min(0).max(TRACKING.maxSpeedKmh * 1.2, "Vitesse physiquement impossible").nullish(),
  heading: z.number().min(0).max(360, "Direction (heading) entre 0 et 360°").nullish(),
  accuracy: z.number().min(0).max(10_000).nullish(),
  altitude: z.number().min(-500).max(10_000).nullish(),
  recordedAt: isoDate,
});
export type GpsPoint = z.infer<typeof gpsPointSchema>;

export const startTrackingSchema = z.object({
  tripId: z.string().min(1, "Voyage requis"),
});

export const locationTrackingSchema = gpsPointSchema.extend({
  sessionId: z.string().nullish(),
});

export const batchTrackingSchema = z.object({
  points: z.array(gpsPointSchema).min(1, "Aucune position à synchroniser").max(50, "Maximum 50 positions par lot"),
});

export const historyQuerySchema = z.object({
  cursor: isoDate.optional(),
  limit: z.coerce.number().int().min(50).max(TRACKING.historyPageSize).optional(),
});

export const busHistoryQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const eventsQuerySchema = z.object({
  agencyId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const currentQuerySchema = z.object({
  agencyId: z.string().optional(),
});

// ---- Mode simulation (DÉVELOPPEMENT UNIQUEMENT) ----
export const simulateSchema = z.object({
  sessionId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(200).optional(),
  heading: z.number().min(0).max(360).optional(),
  accuracy: z.number().min(0).max(500).optional(),
});

/**
 * Contrôles anti-replay / anti-timestamps absurdes.
 * Tolère les positions hors-ligne légitimes (recordedAt ancien ≤ 6 h)
 * mais rejette le futur lointain (horloge téléphone déréglée).
 */
export function checkTimestampWindow(recordedAt: Date, now: Date = new Date()): string | null {
  const delta = now.getTime() - recordedAt.getTime();
  if (delta > TRACKING.pastToleranceMs) {
    return "Position trop ancienne (plus de 6 h) — rejetée";
  }
  if (delta < -TRACKING.futureToleranceMs) {
    return "Horodatage dans le futur — rejeté";
  }
  return null;
}

/** Position physiquement incohérente ? (précision dégradée au-delà du seuil dur) */
export function isAccuracyRejection(accuracy: number | null | undefined): boolean {
  return accuracy !== null && accuracy !== undefined && accuracy > TRACKING.hardMaxAccuracyM;
}
