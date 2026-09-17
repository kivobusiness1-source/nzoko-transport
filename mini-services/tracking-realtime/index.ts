// ============================================================
// NZOKO TRANSPORT — Service temps réel du suivi GPS
//
// Serveur 1 (port 3003) : socket.io, path "/" — salon « fleet »,
//   consommé par le frontend via la passerelle (?XTransformPort=3003).
//   NB : socket.io prend le contrôle du path "/" (les requêtes HTTP
//   non-socket.io reçoivent « Transport unknown ») d'où le second serveur.
// Serveur 2 (port 3004) : API interne signée HMAC — POST /internal/emit
//   (pont d'émission depuis les routes Next) + GET /health.
//
// Sécurité :
//   - Abonnement client : jeton HMAC émis par /api/admin/tracking
//     (payload « fleet:<userId>:<exp> » signé avec TRACKING_SECRET).
//   - Pont interne : x-signature = HMAC-SHA256 du corps brut.
//
// Durabilité (scheduler intégré) :
//   Toutes les 5 min, POST /api/tracking/maintenance du serveur Next
//   (signature HMAC du corps) — watchdog des sessions orphelines
//   (chauffeur navigateur fermé sans STOP) + rétention des données
//   GPS (points > 30 j, sessions > 90 j). Best-effort : un échec
//   (serveur Next en recompilation) est retenté au tick suivant.
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createHmac, timingSafeEqual } from "crypto";
import { Server, type Socket } from "socket.io";

const SOCKET_PORT = 3003;
const INTERNAL_PORT = 3004;
const TRACKING_SECRET = process.env.TRACKING_SECRET ?? "nzoko-tracking-dev-secret-change-me";
/** URL interne du serveur Next (scheduler → /api/tracking/maintenance). */
const NEXT_INTERNAL_URL = process.env.NEXT_INTERNAL_URL ?? "http://127.0.0.1:3000";
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const MAINTENANCE_GRACE_MS = 30 * 1000; // premier tick après 30 s

function hmac(payload: string): string {
  return createHmac("sha256", TRACKING_SECRET).update(payload).digest("hex");
}

// ============================================================
// Serveur 1 — socket.io (path "/", salon flotte)
// ============================================================
const socketServer = createServer();

// NE PAS changer le path "/" — la passerelle Caddy route ?XTransformPort=3003.
const io = new Server(socketServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
  maxHttpBufferSize: 256 * 1024,
});

function verifySubscribeToken(token: unknown): { ok: boolean; userId?: string; reason?: string } {
  if (typeof token !== "string") return { ok: false, reason: "format" };
  const parts = token.split(":");
  if (parts.length !== 4) return { ok: false, reason: "format" };
  const [topic, userId, expRaw, signature] = parts;
  if (topic !== "fleet") return { ok: false, reason: "topic" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return { ok: false, reason: "expired" };
  const expected = hmac(`${topic}:${userId}:${expRaw}`);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  return { ok: true, userId };
}

io.on("connection", (socket: Socket) => {
  socket.on("subscribe-fleet", (payload: unknown, ack?: (result: { ok: boolean; error?: string }) => void) => {
    const token = payload && typeof payload === "object" && "token" in payload ? (payload as { token: unknown }).token : payload;
    const verdict = verifySubscribeToken(token);
    if (!verdict.ok) {
      ack?.({ ok: false, error: verdict.reason ?? "invalide" });
      socket.disconnect(true);
      return;
    }
    socket.data.userId = verdict.userId;
    socket.join("fleet");
    ack?.({ ok: true });
  });
});

socketServer.listen(SOCKET_PORT, () => {
  console.log(`[nzoko-tracking-realtime] socket.io prêt sur le port ${SOCKET_PORT} (path /, salon fleet)`);
});

// ============================================================
// Serveur 2 — API interne signée (localhost uniquement)
// ============================================================
const internalServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Sonde de santé (passerelle / monitoring).
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "nzoko-tracking-realtime", uptime: Math.round(process.uptime()) }));
    return;
  }

  // Pont Next → socket.io : POST /internal/emit (HMAC du corps brut).
  if (req.method === "POST" && req.url === "/internal/emit") {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 256 * 1024) req.destroy(); // garde-fou taille
    });
    req.on("end", () => {
      try {
        const header = req.headers["x-signature"];
        const received = Array.isArray(header) ? header[0] : header;
        if (typeof received !== "string") throw new Error("missing signature");
        const a = Buffer.from(received, "utf8");
        const b = Buffer.from(hmac(body), "utf8");
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature");
        const event = JSON.parse(body) as { room: string; event: string; payload: unknown };
        if (typeof event.room !== "string" || typeof event.event !== "string" || !/^[\w:-]{1,64}$/.test(event.event)) {
          throw new Error("bad event");
        }
        io.to(event.room).emit(event.event, event.payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false }));
});

internalServer.listen(INTERNAL_PORT, "127.0.0.1", () => {
  console.log(`[nzoko-tracking-realtime] API interne signée sur 127.0.0.1:${INTERNAL_PORT}`);
});

// ============================================================
// Scheduler de durabilité — watchdog GPS + rétention des données
// ============================================================

let maintenanceBusy = false; // pas de chevauchement de ticks

async function runMaintenance(): Promise<void> {
  if (maintenanceBusy) return;
  maintenanceBusy = true;
  try {
    const body = JSON.stringify({ action: "all" });
    const signature = hmac(body);
    const res = await fetch(`${NEXT_INTERNAL_URL}/api/tracking/maintenance`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { data?: { watchdog?: unknown; retention?: unknown } } | null;
      console.log(`[nzoko-tracking-realtime] maintenance OK → ${JSON.stringify(json?.data ?? {})}`);
    } else {
      console.error(`[nzoko-tracking-realtime] maintenance → HTTP ${res.status}`);
    }
  } catch (error) {
    // Serveur Next absent/recompilant — silencieux, retry au prochain tick.
    console.error(`[nzoko-tracking-realtime] maintenance indisponible : ${(error as Error).message}`);
  } finally {
    maintenanceBusy = false;
  }
}

// Délai de grâce au démarrage (laisser le serveur Next compiler), puis
// ticks périodiques — bun --hot relance ce module proprement à chaud.
setTimeout(() => void runMaintenance(), MAINTENANCE_GRACE_MS);
setInterval(() => void runMaintenance(), MAINTENANCE_INTERVAL_MS);
console.log(
  `[nzoko-tracking-realtime] scheduler maintenance actif (toutes les ${Math.round(MAINTENANCE_INTERVAL_MS / 60_000)} min → ${NEXT_INTERNAL_URL})`
);
