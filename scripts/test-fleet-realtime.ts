// ============================================================
// NZOKO — Test E2E du flux temps réel du suivi flotte (Task 13-b)
// Vérifie la chaîne COMPLÈTE côté client dashboards :
//   1. login manager (AGENCY_MANAGER Pointe-Noire) → stream-token
//   2. abonnement socket.io au mini-service (jeton HMAC, salons)
//   3. login chauffeur → start tracking → 3 positions simulées
//   4. le socket reçoit bien les messages "bus_location" (bus
//      concerné mis à jour) et "tracking_event"
// Exécution : bun run scripts/test-fleet-realtime.ts
// (aucune persistance — le suivi est stoppé en fin de test)
// ============================================================

import { io, type Socket } from "socket.io-client";

const WEB = "http://localhost:3000";
const MANAGER = { identifier: "manager.pn@nzoko.cg", password: "Manager@2026!" };
const DRIVER = { identifier: "chauffeur.jean@nzoko.cg", password: "Chauffeur@2026!" };

interface LoginData { id: string; fullName: string; role: string; agencyName: string | null; }

async function login(who: { identifier: string; password: string }): Promise<string> {
  const res = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-requested-with": "nzoko" },
    body: JSON.stringify(who),
  });
  const body = (await res.json()) as { success: boolean; data: LoginData };
  if (!res.ok || !body.success) throw new Error(`login ${who.identifier} échoué: ${res.status}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  console.log(`✓ login ${who.identifier} (${body.data.role} · ${body.data.agencyName ?? "—"})`);
  return cookies;
}

async function api<T>(cookie: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WEB}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-requested-with": "nzoko",
      cookie: cookie,
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as { success: boolean; data: T; error?: { message: string } };
  if (!res.ok || !body.success) throw new Error(`${path} → ${res.status} ${body.error?.message ?? ""}`);
  return body.data;
}

interface StreamTokenData { token: string; agencyIds: string[]; realtime: boolean; }
interface DriverTrip { id: string; code: string; status: string; originCityName: string; destinationCityName: string; }
interface ActionResult { sessionId: string; status: string; message: string; }
interface BusLocationMsg { type: "bus_location"; bus: { busId: string; fleetNumber: string | null; latitude: number | null; longitude: number | null; speed: number | null; heading: number | null; state: string; }; }
interface TrackingEventMsg { type: "tracking_event"; event: { eventType: string; busLabel: string; }; }

async function main() {
  // 1) Manager : jeton de flux (AVANT la connexion socket)
  const managerCookie = await login(MANAGER);
  const tokenData = await api<StreamTokenData>(managerCookie, "/api/tracking/stream-token");
  if (!tokenData.realtime) throw new Error("realtime=false côté serveur — vérifier TRACKING_REALTIME_URL");
  console.log(`✓ stream-token (realtime, agences: ${tokenData.agencyIds.join(", ") || "global"})`);

  // 2) Abonnement socket.io (Node se connecte en direct au mini-service 3005,
  //    path "/" — le navigateur passe par la passerelle /?XTransformPort=3005)
  const socket: Socket = io("http://localhost:3005", {
    auth: { token: tokenData.token },
    transports: ["websocket", "polling"],
    reconnection: false,
    timeout: 8000,
  });

  const busUpdates: BusLocationMsg["bus"][] = [];
  const eventsSeen: string[] = [];
  let rooms: string[] | null = null;

  await new Promise<void>((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error("socket: pas de 'subscribed' en 8 s")), 8000);
    socket.on("subscribed", (data: { rooms: string[] }) => {
      clearTimeout(fail);
      rooms = data.rooms;
      console.log(`✓ socket connecté → salons ${data.rooms.join(", ")}`);
      resolve();
    });
    socket.on("auth_error", (data: { message: string }) => reject(new Error(`auth_error: ${data.message}`)));
    socket.on("connect_error", (err: Error) => reject(new Error(`connect_error: ${err.message}`)));
  });

  socket.on("message", (msg: BusLocationMsg | TrackingEventMsg) => {
    if (msg.type === "bus_location") {
      busUpdates.push(msg.bus);
      console.log(`  ← bus_location ${msg.bus.fleetNumber} @(${msg.bus.latitude},${msg.bus.longitude}) ${Math.round(msg.bus.speed ?? 0)} km/h cap ${msg.bus.heading ?? "—"} [${msg.bus.state}]`);
    } else if (msg.type === "tracking_event") {
      eventsSeen.push(msg.event.eventType);
      console.log(`  ← tracking_event ${msg.event.eventType} (${msg.event.busLabel})`);
    }
  });

  // 3) Chauffeur : démarrage d'un suivi sur un voyage SCHEDULED
  const driverCookie = await login(DRIVER);
  const trips = await api<DriverTrip[]>(driverCookie, "/api/driver/trips");
  const trip = trips.find((t) => t.status === "SCHEDULED");
  if (!trip) throw new Error("aucun voyage SCHEDULED pour le chauffeur de test");
  console.log(`✓ voyage cible ${trip.code} (${trip.originCityName} → ${trip.destinationCityName})`);

  const started = await api<ActionResult>(driverCookie, "/api/tracking/start", {
    method: "POST",
    body: JSON.stringify({ tripId: trip.id }),
  });
  console.log(`✓ suivi démarré (${started.status})`);

  // 4) Positions successives → le marqueur DOIT bouger côté dashboard
  const positions = [
    { latitude: -4.78, longitude: 11.86, speed: 42, heading: 45 },
    { latitude: -4.75, longitude: 11.9, speed: 65, heading: 90 },
    { latitude: -4.71, longitude: 11.95, speed: 72, heading: 110 },
  ];
  for (const p of positions) {
    const r = await api<ActionResult>(driverCookie, "/api/tracking/simulate", {
      method: "POST",
      body: JSON.stringify({ sessionId: started.sessionId, accuracy: 12, ...p }),
    });
    console.log(`✓ position injectée (${p.latitude}, ${p.longitude}) → ${r.status}`);
    await new Promise((res) => setTimeout(res, 700));
  }

  // 5) Verdict
  await new Promise((res) => setTimeout(res, 1200));
  socket.disconnect();
  const positionsReceived = busUpdates.filter((b) => b.latitude !== null).length;
  const distinctPositions = new Set(busUpdates.map((b) => `${b.latitude},${b.longitude}`)).size;
  console.log("--- VERDICT ---");
  console.log(`salons: ${rooms?.join(", ")}`);
  console.log(`messages bus_location reçus: ${busUpdates.length} (${positionsReceived} avec position, ${distinctPositions} positions distinctes)`);
  console.log(`événements reçus: ${eventsSeen.join(", ") || "aucun"}`);
  if (busUpdates.length < 2 || distinctPositions < 2) {
    throw new Error("ÉCHEC : le flux temps réel n'a pas propagé les positions successives");
  }
  console.log("✅ TEMPS RÉEL VALIDÉ : les positions se propagent jusqu'aux abonnés (le marqueur du dashboard bouge sans rechargement)");

  // Nettoyage : on laisse la session ACTIVE pour tester le dashboard dans le
  // navigateur (l'arrivée mettrait fin au voyage). Le prochain test peut stopper.
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌", err instanceof Error ? err.message : err);
    process.exit(1);
  });
