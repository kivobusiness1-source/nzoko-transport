// Test E2E du module GPS — simule le flux complet :
// 1. Login admin → GET /api/admin/tracking → socketToken
// 2. Socket connecté via la passerelle (:81) + abonnement signé « fleet »
// 3. Login chauffeur → POST /api/tracking/session START (→ événement socket session-started)
// 4. POST /api/tracking/location (→ événement socket gps)
// 5. POST /api/tracking/session STOP (→ événement socket session-stopped)
// 6. Vérifications DB + nettoyage (session de test)

import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const GATEWAY = "http://localhost:81";

function cookiesOf(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function login(identifier: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw new Error(`login ${identifier} → ${res.status}`);
  return cookiesOf(res);
}

const results: string[] = [];
const events: string[] = [];

async function main() {
  // --- 1. Admin : jeton flotte ---
  const adminCookie = await login("admin@nzoko.cg", "Admin@2026!");
  const fleetRes = await fetch(`${BASE}/api/admin/tracking`, {
    headers: { cookie: adminCookie, "x-requested-with": "nzoko" },
  });
  const fleet = (await fleetRes.json()).data;
  if (!fleetRes.ok || !fleet.socketToken) throw new Error("Pas de socketToken admin");
  results.push("✅ GET /api/admin/tracking → socketToken HMAC émis");

  // --- 2. Socket via la passerelle ---
  const socket = io(`${GATEWAY}/?XTransformPort=3003`, {
    transports: ["websocket", "polling"],
    timeout: 5000,
    reconnectionAttempts: 2,
  });
  const subscribed = new Promise<boolean>((resolve) => {
    socket.on("connect", () => {
      socket.emit("subscribe-fleet", { token: fleet.socketToken }, (ack: { ok: boolean }) => resolve(ack.ok));
    });
  });
  const subscribedOk = await Promise.race([subscribed, new Promise<boolean>((r) => setTimeout(() => r(false), 6000))]);
  if (!subscribedOk) throw new Error("Abonnement flotte refusé (HMAC/ack)");
  results.push("✅ Socket gateway :81 → connecté + abonnement « fleet » signé accepté");

  socket.on("session-started", (s: { id: string }) => events.push(`session-started:${s.id}`));
  socket.on("session-updated", (s: { id: string }) => events.push(`session-updated:${s.id}`));
  socket.on("session-stopped", (s: { id: string }) => events.push(`session-stopped:${s.id}`));
  socket.on("gps", (e: { sessionId: string }) => events.push(`gps:${e.sessionId}`));

  // --- 3. Chauffeur : START ---
  const driverCookie = await login("chauffeur.jean@nzoko.cg", "Chauffeur@2026!");
  const apiDriver = (path: string, body: unknown) =>
    fetch(`${BASE}/api/tracking${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: driverCookie },
      body: JSON.stringify(body),
    });

  const startRes = await apiDriver("/session", { action: "START", tripId: null });
  const started = (await startRes.json()).data;
  if (startRes.status !== 201) throw new Error(`START → ${startRes.status}`);
  results.push(`✅ POST /api/tracking/session START → ${started.id} (chauffeur ON_TRIP)`);

  // --- 4. Point GPS ---
  await new Promise((r) => setTimeout(r, 300));
  const pointRes = await apiDriver("/location", {
    sessionId: started.id,
    latitude: -4.2667,
    longitude: 15.2833,
    speed: 62.5,
    heading: 45,
    accuracy: 8,
    recordedAt: new Date().toISOString(),
  });
  if (pointRes.status !== 201) throw new Error(`location → ${pointRes.status}`);
  results.push("✅ POST /api/tracking/location → 201 (point -4.27, 15.28, 62 km/h)");

  // --- 5. Batch (file offline simulée) ---
  const batchPoints = Array.from({ length: 5 }, (_, i) => ({
    latitude: -4.2667 + i * 0.001,
    longitude: 15.2833 + i * 0.001,
    speed: 50 + i,
    recordedAt: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
  }));
  const batchRes = await apiDriver("/batch", { sessionId: started.id, points: batchPoints });
  const batch = (await batchRes.json()).data;
  if (batchRes.status !== 200 || batch.accepted !== 5) throw new Error(`batch → ${batchRes.status} ${JSON.stringify(batch)}`);
  results.push(`✅ POST /api/tracking/batch → accepted=${batch.accepted}`);

  // --- 6. STOP ---
  const stopRes = await apiDriver("/session", { action: "STOP" });
  if (stopRes.status !== 200) throw new Error(`STOP → ${stopRes.status}`);
  results.push("✅ POST /api/tracking/session STOP → COMPLETED (chauffeur AVAILABLE)");

  // --- Attente de la diffusion temps réel ---
  await new Promise((r) => setTimeout(r, 1500));
  const expect = [`session-started:${started.id}`, `gps:${started.id}`, `session-stopped:${started.id}`];
  const received = expect.filter((e) => events.includes(e));
  results.push(`${received.length === 3 ? "✅" : "⚠️"} Socket temps réel : ${received.length}/3 événements reçus → ${events.join(", ") || "aucun"}`);

  // --- 7. Vérif DB ---
  const count = await db.gpsPoint.count({ where: { sessionId: started.id } });
  results.push(`${count === 6 ? "✅" : "⚠️"} Base : ${count}/6 points persistés (1 isolé + 5 batch)`);
  const session = await db.trackingSession.findUnique({ where: { id: started.id } });
  results.push(`${session?.status === "COMPLETED" ? "✅" : "⚠️"} Session finale : ${session?.status}`);

  // --- 8. Nettoyage (base de test propre) ---
  await db.gpsPoint.deleteMany({ where: { sessionId: started.id } });
  await db.trackingSession.delete({ where: { id: started.id } });
  results.push("🧹 Nettoyage : session de test + points supprimés");

  socket.disconnect();
  console.log(results.join("\n"));
  const ok = received.length === 3 && count === 6;
  process.exit(ok ? 0 : 1);
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
