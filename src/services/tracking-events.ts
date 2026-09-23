// ============================================================
// NZOKO TRANSPORT — Journal d'événements GPS V5 (§34, §47)
//
// TOUT événement important du suivi est persisté dans TrackingEvent
// (audit + panneau d'alertes Super Admin §35) et diffusé au salon
// temps réel « fleet ». CONTRAT ABSOLU :
//   - l'écriture d'un événement ne fait JAMAIS échouer le flux
//     principal (best-effort, silencieux en cas d'erreur DB) ;
//   - aucun secret/jeton n'est journalisé (payloadJson = métadonnées) ;
//   - les identifiants sont des chaînes simples (pas de FK) : le
//     journal survit aux suppressions d'entités.
// ============================================================

import { db } from "@/lib/db";
import { GPS_V5 } from "@/lib/gps-config";
import { emitRealtime } from "@/services/tracking";

// ---------- Types d'événements (contrat stable, cf. §34) ----------
export type TrackingEventType =
  | "GPS_SESSION_STARTED"
  | "GPS_SESSION_STOPPED"
  | "GPS_DEVICE_CHANGED"
  | "SESSION_CONFLICT"
  | "GPS_POSITION_REJECTED"
  | "GPS_ANOMALY_DETECTED"
  | "GPS_STALE"
  | "GPS_OFFLINE"
  | "STOP_ARRIVAL_DETECTED"
  | "STOP_DEPARTURE_DETECTED"
  | "DESTINATION_APPROACHING"
  | "DESTINATION_ARRIVED"
  | "TRIP_COMPLETED";

export type TrackingSeverity = "INFO" | "WARN" | "CRITICAL";

/** Libellés français (panneau d'alertes + historique). */
export const TRACKING_EVENT_LABELS: Record<TrackingEventType, string> = {
  GPS_SESSION_STARTED: "Suivi démarré",
  GPS_SESSION_STOPPED: "Suivi arrêté",
  GPS_DEVICE_CHANGED: "Téléphone changé",
  SESSION_CONFLICT: "Conflit de session",
  GPS_POSITION_REJECTED: "Position rejetée",
  GPS_ANOMALY_DETECTED: "Anomalie GPS",
  GPS_STALE: "GPS silencieux",
  GPS_OFFLINE: "Téléphone hors ligne",
  STOP_ARRIVAL_DETECTED: "Arrivée à un arrêt",
  STOP_DEPARTURE_DETECTED: "Départ d'un arrêt",
  DESTINATION_APPROACHING: "Approche de la destination",
  DESTINATION_ARRIVED: "Arrivée à destination",
  TRIP_COMPLETED: "Voyage terminé",
};

export interface TrackingEventInput {
  type: TrackingEventType;
  severity?: TrackingSeverity;
  sessionId?: string | null;
  tripId?: string | null;
  busId?: string | null;
  driverId?: string | null;
  agencyId?: string | null;
  message?: string | null;
  /** Métadonnées sérialisables (JAMAIS de secret). */
  payload?: Record<string, unknown> | null;
  /** Diffuser aussi au salon temps réel « fleet » (défaut : true
   *  pour WARN/CRITICAL, false pour INFO — évite le bruit). */
  broadcast?: boolean;
}

/** Écrit un événement (best-effort ABSOLU — jamais levée d'erreur). */
export async function logTrackingEvent(input: TrackingEventInput): Promise<void> {
  const severity = input.severity ?? "INFO";
  try {
    await db.trackingEvent.create({
      data: {
        type: input.type,
        severity,
        sessionId: input.sessionId ?? null,
        tripId: input.tripId ?? null,
        busId: input.busId ?? null,
        driverId: input.driverId ?? null,
        agencyId: input.agencyId ?? null,
        message: input.message ?? null,
        payloadJson: input.payload ? JSON.stringify(input.payload).slice(0, 4_000) : null,
      },
    });
  } catch (err) {
    // Audit best-effort : la position/le flux principal PRIME toujours.
    console.warn("[tracking-event] écriture impossible (best-effort) :", err instanceof Error ? err.message : err);
    return;
  }

  // Diffusion temps réel (best-effort, silencieuse).
  const broadcast = input.broadcast ?? severity !== "INFO";
  if (broadcast) {
    await emitRealtime({
      room: "fleet",
      event: "tracking-event",
      payload: {
        type: input.type,
        severity,
        sessionId: input.sessionId ?? null,
        tripId: input.tripId ?? null,
        busId: input.busId ?? null,
        agencyId: input.agencyId ?? null,
        message: input.message ?? null,
        at: new Date().toISOString(),
      },
    });
  }
}

// ============================================================
// Requêtes admin (panneau d'alertes §35 + onglet Événements §44)
// ============================================================

export interface TrackingEventDTO {
  id: string;
  type: string;
  severity: string;
  message: string | null;
  sessionId: string | null;
  tripId: string | null;
  busId: string | null;
  driverId: string | null;
  agencyId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

function toDTO(row: {
  id: string;
  type: string;
  severity: string;
  message: string | null;
  sessionId: string | null;
  tripId: string | null;
  busId: string | null;
  driverId: string | null;
  agencyId: string | null;
  payloadJson: string | null;
  createdAt: Date;
}): TrackingEventDTO {
  let payload: Record<string, unknown> | null = null;
  if (row.payloadJson) {
    try {
      payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    message: row.message,
    sessionId: row.sessionId,
    tripId: row.tripId,
    busId: row.busId,
    driverId: row.driverId,
    agencyId: row.agencyId,
    payload,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Événements récents — filtres optionnels agence/sévérités/session. */
export async function recentTrackingEvents(options: {
  agencyId?: string;
  sessionId?: string;
  severities?: TrackingSeverity[];
  since?: Date;
  limit?: number;
}): Promise<TrackingEventDTO[]> {
  const limit = Math.min(Math.max(options.limit ?? GPS_V5.alertsMaxEvents, 1), 200);
  const where: Record<string, unknown> = {
    createdAt: options.since ? { gte: options.since } : undefined,
  };
  if (options.agencyId) where.agencyId = options.agencyId;
  if (options.sessionId) where.sessionId = options.sessionId;
  if (options.severities && options.severities.length > 0) where.severity = { in: options.severities };
  const rows = await db.trackingEvent.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toDTO);
}
