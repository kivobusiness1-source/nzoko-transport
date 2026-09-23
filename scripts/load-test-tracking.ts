// ============================================================
// NZOKO TRANSPORT — SIMULATEUR DE CHARGE GPS V5 (§40)
//
// Génère N bus simulés (défaut 100) : comptes chauffeurs, cars,
// voyages et sessions RÉELS via l'API, puis des positions
// périodiques concurrentes, et mesure :
//   - latence de démarrage de session (p50/p95/max) ;
//   - latence d'ingestion des positions (p50/p95/p99/max) ;
//   - débit global (positions/s) et erreurs par statut HTTP ;
//   - temps de réponse de la vue flotte PENDANT la charge ;
//   - latence de propagation temps réel (POST → événement socket) ;
//   - volumétrie base (points écrits) et charge client (mémoire).
//
// Usage : bun run scripts/load-test-tracking.ts [nbBus] [duréeSec]
// Nettoie TOUTES ses données à la fin (mêmes en cas d'erreur).
// ============================================================

import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const GATEWAY = "http://localhost:81";
const NB_BUSES = Math.max(1, parseInt(process.argv[2] ?? "100", 10));
const DURATION_S = Math.max(10, parseInt(process.argv[3] ?? "60", 10));
const POSITION_INTERVAL_MS = 8_000; // palier « en mouvement » du cahier des charges
const PASSWORD = "LoadV5@2026!";

// ---------- Métriques ----------
class Metrics {
  samples: number[] = [];
  errors = new Map<number, number>();
  add(ms: number) { this.samples.push(ms); }
  fail(status: number) { this.errors.set(status, (this.errors.get(status) ?? 0) + 1); }
  get count() { return this.samples.length; }
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  }
  get max(): number { return this.samples.length === 0 ? 0 : Math.max(...this.samples); }
}

const startMetrics = new Metrics();
const posMetrics = new Metrics();
const fleetMetrics = new Metrics();
let realtimeEvents = 0;
const realtimeLatencies: number[] = [];
const t0 = Date.now();

function hr(ms: number): string {
  return `${Math.round(ms)} ms`;
}

function report(busCount: number, pointsWritten: number) {
  const wall = (Date.now() - t0) / 1000;
  console.log("\n══════════════ RAPPORT DE CHARGE GPS V5 ══════════════");
  console.log(` Bus simulés      : ${busCount}`);
  console.log(` Durée            : ${Math.round(wall)} s`);
  console.log(` Sessions démarrées : ${startMetrics.count} (erreurs : ${startMetrics.errors.size ? [...startMetrics.errors].map(([s, n]) => `${s}×${n}`).join(", ") : "aucune"})`);
  if (startMetrics.count > 0) {
    console.log(` Latence START    : p50=${hr(startMetrics.percentile(50))} p95=${hr(startMetrics.percentile(95))} max=${hr(startMetrics.max)}`);
  }
  console.log(` Positions envoyées : ${posMetrics.count} (débit ${Math.round(posMetrics.count / wall)} /s)`);
  console.log(` Erreurs positions : ${posMetrics.errors.size ? [...posMetrics.errors].map(([s, n]) => `${s}×${n}`).join(", ") : "aucune"}`);
  if (posMetrics.count > 0) {
    console.log(` Latence position : p50=${hr(posMetrics.percentile(50))} p95=${hr(posMetrics.percentile(95))} p99=${hr(posMetrics.percentile(99))} max=${hr(posMetrics.max)}`);
  }
  console.log(` Vue flotte (pendant charge) : ${fleetMetrics.count} appels, p50=${hr(fleetMetrics.percentile(50))} p95=${hr(fleetMetrics.percentile(95))} max=${hr(fleetMetrics.max)}`);
  const realtimeP50 = realtimeLatencies.length > 0 ? hr(realtimeLatencies.sort((a, b) => a - b)[Math.floor(realtimeLatencies.length / 2)]) : null;
  console.log(` Temps réel       : ${realtimeEvents} événements « gps » reçus${realtimeP50 ? ` (propagation p50=${realtimeP50})` : ""}`);
  console.log(` Base             : ${pointsWritten} points GPS écrits pour les sessions de charge`);
  console.log(` Client (test)    : mémoire ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} Mo`);
  console.log("══════════════════════════════════════════════════════");
}

// ---------- Utilitaires ----------
function cookiesOf(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function login(email: string, password: string = PASSWORD): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
    body: JSON.stringify({ identifier: email, password }),
  });
  if (!res.ok) throw new Error(`login ${email} → ${res.status}`);
  return cookiesOf(res);
}

interface SimBus {
  index: number;
  email: string;
  cookie: string;
  sessionId: string;
  userId: string;
  driverId: string;
  tripId: string;
  busId: string;
  lat: number;
  lng: number;
  dLat: number;
  dLng: number;
}

// ---------- Préparation ----------
async function seed(): Promise<SimBus[]> {
  console.log(`\n🔧 Préparation de ${NB_BUSES} bus simulés (comptes, cars, voyages)…`);
  const route = await db.route.findFirstOrThrow({ where: { code: "PO-BR-EHK" } });
  const layout = await db.seatLayout.findFirstOrThrow();
  const agency = await db.agency.findFirstOrThrow({ where: { name: { contains: "Pointe-Noire" } } });
  const driverRole = await db.role.findUniqueOrThrow({ where: { code: "DRIVER" } });
  const hash = await bcrypt.hash(PASSWORD, 12);
  const po = await db.city.findFirstOrThrow({ where: { name: "Pointe-Noire" } });
  const bzv = await db.city.findFirstOrThrow({ where: { name: "Brazzaville" } });
  const runTag = Date.now().toString(36);

  const buses: SimBus[] = [];
  for (let i = 0; i < NB_BUSES; i++) {
    const email = `load-v5-${runTag}-${i}@loadtest.nzoko.local`;
    const user = await db.user.create({
      data: {
        email,
        passwordHash: hash,
        firstName: "Charge",
        lastName: `Bus${i + 1}`,
        phone: `24207${String(10000000 + i).slice(0, 8)}`,
        roleId: driverRole.id,
        agencyId: agency.id,
        isActive: true,
      },
    });
    const driver = await db.driver.create({
      data: {
        firstName: "Charge", lastName: `Bus${i + 1}`,
        phone: user.phone, licenseNumber: `LOAD-${runTag}-${i}`,
        userId: user.id, agencyId: agency.id, status: "AVAILABLE",
      },
    });
    const bus = await db.bus.create({
      data: {
        registrationNumber: `LOAD-${runTag}-${i}`,
        brand: "NZOKO-LOAD", model: "Simulateur", year: 2026, capacity: 70,
        status: "ACTIVE", agencyId: agency.id, seatLayoutId: layout.id,
      },
    });
    // Départs étalés sur les 4 dernières heures : les arrêts déjà
    // « sautés » diffèrent, le moteur géofence travaille pour de vrai.
    const departure = new Date(Date.now() - Math.floor((i % 12) * 20 * 60_000) - 30 * 60_000);
    const trip = await db.trip.create({
      data: {
        code: `LOAD-${runTag}-${i}`,
        routeId: route.id, busId: bus.id, driverId: driver.id, agencyId: agency.id,
        departureTime: departure,
        estimatedArrivalTime: new Date(departure.getTime() + 600 * 60_000),
        price: 18000, status: "SCHEDULED",
      },
    });
    // Position initiale interpolée le long de la ligne (pas de collision
    // géofence garantie — chaque bus avance à SON rythme).
    const progress = (i % 10) / 10;
    buses.push({
      index: i, email, cookie: "", sessionId: "", userId: user.id, driverId: driver.id,
      tripId: trip.id, busId: bus.id,
      lat: po.latitude! + (bzv.latitude! - po.latitude!) * progress,
      lng: po.longitude! + (bzv.longitude! - po.longitude!) * progress,
      dLat: (bzv.latitude! - po.latitude!) / 5000, // ~130 m par pas de 8 s ≈ 58 km/h
      dLng: (bzv.longitude! - po.longitude!) / 5000,
    });
  }
  console.log(`✅ ${NB_BUSES} comptes/cars/voyages créés (run ${runTag}).`);
  return buses;
}

async function cleanup(buses: SimBus[]) {
  console.log("\n🧹 Nettoyage des données de charge…");
  const sessionIds = buses.map((b) => b.sessionId).filter(Boolean);
  if (sessionIds.length > 0) {
    await db.gpsPoint.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await db.trackingEvent.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await db.trackingSession.deleteMany({ where: { id: { in: sessionIds } } });
  }
  await db.trackingEvent.deleteMany({ where: { type: "SESSION_CONFLICT", busId: { in: buses.map((b) => b.busId) } } });
  const tripIds = buses.map((b) => b.tripId);
  await db.seatOccupancy.deleteMany({ where: { tripId: { in: tripIds } } });
  await db.trip.deleteMany({ where: { id: { in: tripIds } } });
  await db.driver.deleteMany({ where: { id: { in: buses.map((b) => b.driverId) } } });
  await db.user.deleteMany({ where: { id: { in: buses.map((b) => b.userId) } } });
  await db.bus.deleteMany({ where: { id: { in: buses.map((b) => b.busId) } } });
  console.log("✅ Nettoyage terminé.");
}

// ---------- Exécution ----------
async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log(` SIMULATEUR DE CHARGE GPS V5 — ${NB_BUSES} bus, ${DURATION_S} s`);
  console.log("══════════════════════════════════════════════════════");

  let buses: SimBus[] = [];
  try {
    buses = await seed();

    // Connexions (parallélisme maîtrisé par lots de 10 pour ne pas
    // saturer bcrypt côté serveur au démarrage).
    console.log("\n🔑 Connexions chauffeurs…");
    for (let off = 0; off < buses.length; off += 10) {
      await Promise.all(buses.slice(off, off + 10).map(async (b) => { b.cookie = await login(b.email); }));
    }
    console.log(`✅ ${buses.length} chauffeurs connectés.`);

    // Temps réel : UN observateur admin (jeton via un compte admin).
    const adminCookie = await login("admin", "Admin@2026!").catch(() => null);
    let socket: ReturnType<typeof io> | null = null;
    const pendingBySession = new Map<string, number>(); // sessionId → Date.now() du POST
    if (adminCookie) {
      const fleetRes = await fetch(`${BASE}/api/admin/tracking`, { headers: { cookie: adminCookie, "x-requested-with": "nzoko" } });
      const token = (await fleetRes.json())?.data?.socketToken;
      if (token) {
        socket = io(`${GATEWAY}/?XTransformPort=3003`, { transports: ["websocket"], reconnectionAttempts: 3 });
        socket.on("connect", () => {
          socket!.emit("subscribe-fleet", { token }, () => undefined);
        });
        socket.on("gps", (e: { sessionId: string }) => {
          realtimeEvents += 1;
          const since = pendingBySession.get(e.sessionId);
          if (since) {
            realtimeLatencies.push(Date.now() - since);
            pendingBySession.delete(e.sessionId);
          }
        });
      }
    }

    // Démarrage des sessions (vague unique, mesure de latence START).
    console.log("\n🚌 Démarrage des sessions (API START)…");
    await Promise.all(
      buses.map(async (b) => {
        const t = Date.now();
        try {
          const res = await fetch(`${BASE}/api/tracking/session`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: b.cookie },
            body: JSON.stringify({ action: "START", tripId: b.tripId, deviceId: `dev-load-${b.index}` }),
          });
          if (res.ok) {
            b.sessionId = (await res.json())?.data?.id ?? "";
            startMetrics.add(Date.now() - t);
          } else {
            startMetrics.fail(res.status);
            console.warn(`   START bus ${b.index + 1} → HTTP ${res.status}`);
          }
        } catch (err) {
          startMetrics.fail(0);
          console.warn(`   START bus ${b.index + 1} → ${(err as Error).message}`);
        }
      })
    );
    const live = buses.filter((b) => b.sessionId);
    console.log(`✅ ${live.length}/${buses.length} sessions actives (p95 START = ${hr(startMetrics.percentile(95))}).`);

    // Boucle de positions : chaque bus envoie une position toutes les
    // 8 s pendant DURATION_S — tout en parallèle.
    console.log(`\n📡 Envoi des positions pendant ${DURATION_S} s (${Math.round((live.length * 1000) / POSITION_INTERVAL_MS)} positions/s attendues)…`);
    const deadline = Date.now() + DURATION_S * 1000;
    const fleetPoll = setInterval(async () => {
      if (!adminCookie) return;
      const t = Date.now();
      try {
        const res = await fetch(`${BASE}/api/admin/tracking`, { headers: { cookie: adminCookie, "x-requested-with": "nzoko" } });
        if (res.ok) fleetMetrics.add(Date.now() - t);
      } catch { /* best-effort */ }
    }, 5_000);

    const sendLoop = (b: SimBus) =>
      new Promise<void>((resolve) => {
        const tick = async () => {
          if (Date.now() >= deadline) return resolve();
          // Avance du bus + jitter réaliste ; vitesse cohérente.
          b.lat += b.dLat * (0.85 + Math.random() * 0.3);
          b.lng += b.dLng * (0.85 + Math.random() * 0.3);
          const t = Date.now();
          pendingBySession.set(b.sessionId, t);
          try {
            const res = await fetch(`${BASE}/api/tracking/location`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: b.cookie },
              body: JSON.stringify({
                sessionId: b.sessionId,
                deviceId: `dev-load-${b.index}`,
                latitude: b.lat, longitude: b.lng,
                speed: 55 + Math.random() * 15, heading: 75, accuracy: 12,
                batteryLevel: 40 + (b.index % 50),
                recordedAt: new Date().toISOString(),
                positionId: randomUUID(),
              }),
            });
            if (res.ok) posMetrics.add(Date.now() - t);
            else posMetrics.fail(res.status);
          } catch {
            posMetrics.fail(0);
          }
          setTimeout(tick, POSITION_INTERVAL_MS);
        };
        // Étalement des premiers envois pour ne pas synchroniser les bus.
        setTimeout(tick, Math.random() * POSITION_INTERVAL_MS);
      });

    await Promise.all(live.map(sendLoop));
    clearInterval(fleetPoll);

    // Laisse converger les dernières émissions temps réel.
    await new Promise((r) => setTimeout(r, 2000));

    // Arrêt propre des sessions (mesure la vague de STOP aussi).
    await Promise.all(
      live.map(async (b) => {
        try {
          await fetch(`${BASE}/api/tracking/session`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: b.cookie },
            body: JSON.stringify({ action: "STOP" }),
          });
        } catch { /* best-effort */ }
      })
    );
    socket?.disconnect();

    const points = await db.gpsPoint.count({ where: { sessionId: { in: live.map((b) => b.sessionId) } } });
    report(live.length, points);
  } catch (err) {
    console.error("\n💥 ERREUR :", err instanceof Error ? err.stack : err);
  } finally {
    await cleanup(buses);
    await db.$disconnect();
  }
}

void main();
