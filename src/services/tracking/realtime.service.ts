// ============================================================
// NZOKO TRANSPORT — Couche REALTIME du module tracking GPS
//
// Abstraction fournisseur : l'application ne dépend PAS d'un
// fournisseur temps réel particulier. Deux implémentations :
//  - SocketIoProvider → mini-service dédié (socket.io, port 3005)
//    compatible Vercel (le serveur Next.js reste sans processus
//    long-lived : il publie par HTTP interne vers le service).
//  - NoopProvider → temps réel désactivé (dashboard en polling).
//
// Un futur fournisseur (Ably, Pusher…) n'implémente que
// RealtimeProvider SANS réécrire l'application (brief §20).
//
// Les publications sont best-effort : une panne realtime ne doit
// JAMAIS bloquer ni faire échouer l'ingestion GPS (source de vérité
// = la base, le temps réel n'est qu'un canal d'affichage).
// ============================================================

import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { logger } from "@/services/tracking/tracking-logger";
import type { FleetBusDTO, TrackingEventDTO } from "@/types";

// ---------- Contrat des payloads publiés ----------

export interface BusLocationEvent {
  type: "bus_location";
  agencyId: string;
  bus: FleetBusDTO;
}

export interface TrackingEventPayload {
  type: "tracking_event";
  agencyId: string;
  event: TrackingEventDTO;
}

export interface TripStatusPayload {
  type: "trip_status";
  agencyId: string;
  tripId: string;
  tripCode: string;
  status: string;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  busLabel: string;
  routeLabel: string;
}

export type RealtimeMessage = BusLocationEvent | TrackingEventPayload | TripStatusPayload;

export interface RealtimeProvider {
  readonly name: string;
  publish(agencyId: string, message: RealtimeMessage): Promise<void>;
}

// ---------- Implémentation socket.io (mini-service dédié) ----------

const REALTIME_URL = process.env.TRACKING_REALTIME_URL ?? "";
const REALTIME_SECRET = process.env.TRACKING_REALTIME_SECRET ?? "";

class SocketIoProvider implements RealtimeProvider {
  readonly name = "socketio";

  async publish(agencyId: string, message: RealtimeMessage): Promise<void> {
    // Best-effort : timeout court, jamais d'exception remontée
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const res = await fetch(`${REALTIME_URL.replace(/\/$/, "")}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Realtime-Secret": REALTIME_SECRET,
        },
        body: JSON.stringify({ room: `agency:${agencyId}`, broadcast: message.type === "bus_location" || message.type === "tracking_event" || message.type === "trip_status", message }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("realtime", `publication ${message.type} → HTTP ${res.status}`);
      }
    } catch (err) {
      logger.warn("realtime", `publication ${message.type} indisponible (${err instanceof Error ? err.message : "erreur"})`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ---------- Implémentation inactive (polling) ----------

class NoopProvider implements RealtimeProvider {
  readonly name = "noop";
  async publish(): Promise<void> {
    /* temps réel désactivé — le dashboard utilise le polling /api/tracking/current */
  }
}

let provider: RealtimeProvider | null = null;

export function getRealtimeProvider(): RealtimeProvider {
  if (!provider) {
    provider = REALTIME_URL && REALTIME_SECRET ? new SocketIoProvider() : new NoopProvider();
  }
  return provider;
}

/** API de haut niveau (stable même si le fournisseur change). */
export const realtime = {
  publishBusLocation(bus: FleetBusDTO): Promise<void> {
    return getRealtimeProvider().publish(bus.agencyId, { type: "bus_location", agencyId: bus.agencyId, bus });
  },
  publishTrackingEvent(agencyId: string, event: TrackingEventDTO): Promise<void> {
    return getRealtimeProvider().publish(agencyId, { type: "tracking_event", agencyId, event });
  },
  publishTripStatus(payload: Omit<TripStatusPayload, "type">): Promise<void> {
    return getRealtimeProvider().publish(payload.agencyId, { type: "trip_status", ...payload });
  },
};

export function isRealtimeEnabled(): boolean {
  return Boolean(REALTIME_URL && REALTIME_SECRET);
}

// ---------- Jetons d'abonnement signés (HMAC) ----------
// Le navigateur ne peut s'abonner aux salons temps réel qu'avec un jeton
// court signé par le serveur Next.js (60 s) et vérifié par le mini-service
// avec le secret partagé. Le scope agences est FOUNGUÉ côté serveur.

const STREAM_TOKEN_TTL_MS = 60_000;

function streamSecret(): string {
  if (!REALTIME_SECRET) {
    throw new Error("TRACKING_REALTIME_SECRET manquant — temps réel désactivé");
  }
  return REALTIME_SECRET;
}

export interface StreamTokenPayload {
  userId: string;
  role: string;
  agencyIds: string[]; // agences autorisées — vide = accès global (SUPER_ADMIN/ADMIN)
  exp: number; // epoch ms
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", streamSecret()).update(data).digest("base64url");
}

export function createStreamToken(payload: Omit<StreamTokenPayload, "exp">): { token: string; expiresAt: number } {
  const exp = Date.now() + STREAM_TOKEN_TTL_MS;
  const body = b64url(JSON.stringify({ ...payload, exp }));
  return { token: `${body}.${sign(body)}`, expiresAt: exp };
}

export function verifyStreamToken(token: string): StreamTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = Buffer.from(sign(body));
  const got = Buffer.from(signature);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StreamTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (!Array.isArray(payload.agencyIds) || typeof payload.userId !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Construit le scope d'abonnement d'un utilisateur authentifié :
 * rôles globaux → toutes les agences actives ; sinon son unique agence.
 * (Le mini-service rejoindra les salons agency:{id} correspondants.)
 */
export async function buildStreamScope(agencyId: string | null): Promise<string[]> {
  if (!agencyId) {
    const agencies = await db.agency.findMany({ where: { isActive: true }, select: { id: true } });
    return agencies.map((a) => a.id);
  }
  return [agencyId];
}

export function generateRealtimeSecret(): string {
  return randomBytes(32).toString("hex");
}
