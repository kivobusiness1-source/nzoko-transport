// ============================================================
// NZOKO TRANSPORT — Tests E2E du GPS V5 multi-bus (§39 : 20 scénarios)
//
// Prérequis : serveur dev sur :3000, base sandbox seedée, mini-service
// tracking-realtime lancé. Nettoie TOUTES ses données de test à la fin.
//
// Scénarios (numérotation du cahier des charges) :
//  T1  1 bus actif — session + positions isolées
//  T2  10 bus actifs simultanés — flotte OK, isolation stricte
//  T3  50 bus actifs — flotte OK (2 requêtes, pas de N+1)
//  T4  100 bus simulés → scripts/load-test-tracking.ts (charge)
//  T5  Deux positions simultanées pour deux bus différents
//  T6  Deux téléphones/chauffeurs pour le MÊME bus → 409 conflit
//  T7  Position envoyée deux fois → idempotence (positionId)
//  T8  Position ancienne reçue après une récente → historique seule
//  T9  Perte Internet (file locale simulée) → lot /batch
//  T10 Synchronisation après reconnexion → re-batch idempotent
//  T11 GPS imprécis → ACCEPT_FLAGGED + événement anomalie
//  T12 Position impossible → vitesses/téléportation rejetées
//  T13 Arrivée à un arrêt (géofence + dwell) → STOP_ARRIVAL + AT_STOP
//  T14 Fausse entrée/sortie de géofence (dwell non respecté) → rien
//  T15 Arrivée destination durable → Trip ARRIVED + événements
//  T16 Fin du trajet (STOP chauffeur) → COMPLETED + endReason
//  T17 Session orpheline → watchdog PAUSED + GPS_OFFLINE
//  T18 Utilisateur non autorisé (session d'un autre) → 404
//  T19 Realtime déconnecté puis reconnecté → événements retrouvés
//  T20 Dashboard avec nombreux bus simultanés → flotte fluide
//  T21 (bonus §11) Heartbeat : GPS_STALE vs GPS_ACTIVE
// ============================================================

import { io } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID, createHmac } from "crypto";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const GATEWAY = "http://localhost:81";
const ADMIN_LOGIN = { identifier: "superadmin", password: "Nzoko@2026!" };
const DRIVER_A_LOGIN = { identifier: "chauffeur", password: "Chauffeur@2026!" }; // Jean-Félix Mabiala (PO)
const LOAD_SECRET = "nzoko-tracking-dev-secret-change-me";

// ---------- Utilitaires ----------
interface Ctx {
  adminCookie: string;
  cookieA: string; // chauffeur réel
  cookieB: string; // chauffeur synthétique
  driverAId: string;
  driverBId: string;
  userBId: string;
  busId: string;
  routeId: string;
  poAgencyId: string;
  coords: { pointeNoire: [number, number]; dolisie: [number, number]; nkayi: [number, number]; brazzaville: [number, number] };
  created: { userIds: string[]; driverIds: string[]; tripIds: string[]; sessionIds: string[]; busIds: string[] };
}

const results: { id: string; label: string; pass: boolean; detail?: string }[] = [];
function check(id: string, label: string, pass: boolean, detail?: string) {
  results.push({ id, label, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${id} — ${label}${pass ? "" : `  →  ${detail ?? ""}`}`);
}

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

type JsonRecord = Record<string, unknown>;
async function apiPost(cookie: string, path: string, body: unknown): Promise<{ status: number; json: JsonRecord | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function apiGet(cookie: string, path: string): Promise<{ status: number; json: JsonRecord | null }> {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-requested-with": "nzoko", cookie } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function pos(lat: number, lng: number, opts: Partial<{ speed: number; accuracy: number; recordedAt: Date; positionId: string; heading: number }> = {}) {
  return {
    latitude: lat,
    longitude: lng,
    speed: opts.speed ?? 60,
    heading: opts.heading ?? 90,
    accuracy: opts.accuracy ?? 15,
    recordedAt: (opts.recordedAt ?? new Date()).toISOString(),
    positionId: opts.positionId ?? randomUUID(),
  };
}

async function startSession(cookie: string, body: { tripId?: string | null; deviceId?: string }): Promise<{ status: number; json: JsonRecord | null }> {
  return apiPost(cookie, "/api/tracking/session", { action: "START", tripId: body.tripId ?? null, deviceId: body.deviceId ?? `dev-test-${randomUUID().slice(0, 8)}` });
}

/** Décale une position de dLat/dLng degrés (~111 km par degré). */
function offset([lat, lng]: [number, number], dLat: number, dLng: number): [number, number] {
  return [lat + dLat, lng + dLng];
}

// ============================================================
// PRÉPARATION
// ============================================================
async function setup(): Promise<Ctx> {
  const adminCookie = await login(ADMIN_LOGIN.identifier, ADMIN_LOGIN.password);
  const cookieA = await login(DRIVER_A_LOGIN.identifier, DRIVER_A_LOGIN.password);

  const driverA = await db.driver.findFirst({
    where: { user: { email: "kivobusiness1+chauffeur@gmail.com" } },
    include: { agency: true },
  });
  if (!driverA) throw new Error("Chauffeur Jean-Félix introuvable (seed requis)");
  const poAgencyId = driverA.agencyId;

  const cities = await db.city.findMany({ where: { name: { in: ["Pointe-Noire", "Dolisie", "Nkayi", "Brazzaville"] } } });
  const city = (name: string): [number, number] => {
    const c = cities.find((x) => x.name === name);
    if (!c || c.latitude === null || c.longitude === null) throw new Error(`Ville ${name} sans coordonnées (seed requis)`);
    return [c.latitude, c.longitude];
  };
  const coords = { pointeNoire: city("Pointe-Noire"), dolisie: city("Dolisie"), nkayi: city("Nkayi"), brazzaville: city("Brazzaville") };

  const route = await db.route.findFirst({ where: { code: "PO-BR-EHK" } });
  if (!route) throw new Error("Route PO-BR-EHK introuvable");

  // Bus dédié aux tests (pour ne pas perturber les 14 bus du parc).
  const layout = await db.seatLayout.findFirst();
  const testBus = await db.bus.create({
    data: {
      registrationNumber: `TEST-GPS-${Date.now().toString(36).toUpperCase()}`,
      brand: "NZOKO-TEST",
      model: "Bus de test V5",
      year: 2026,
      capacity: 70,
      status: "ACTIVE",
      agencyId: poAgencyId,
      seatLayoutId: layout!.id,
    },
  });

  // Chauffeur synthétique B (compte local, bcrypt cost 12 comme l'app).
  const driverRole = await db.role.findUniqueOrThrow({ where: { code: "DRIVER" } });
  const userB = await db.user.create({
    data: {
      email: `v5test-chauffeur-${Date.now()}@test.nzoko.local`,
      passwordHash: await bcrypt.hash("TestV5@2026!", 12),
      firstName: "Test",
      lastName: "ChauffeurV5",
      phone: `24206${Math.floor(10000000 + Math.random() * 89999999)}`,
      roleId: driverRole.id,
      agencyId: poAgencyId,
      isActive: true,
    },
  });
  const driverB = await db.driver.create({
    data: {
      firstName: "Test",
      lastName: "ChauffeurV5",
      phone: userB.phone,
      licenseNumber: `TEST-V5-${Date.now()}`,
      userId: userB.id,
      agencyId: poAgencyId,
      status: "AVAILABLE",
    },
  });
  const cookieB = await login(userB.email, "TestV5@2026!");

  return {
    adminCookie, cookieA, cookieB,
    driverAId: driverA.id, driverBId: driverB.id, userBId: userB.id,
    busId: testBus.id, routeId: route.id, poAgencyId, coords,
    created: { userIds: [userB.id], driverIds: [driverB.id], tripIds: [], sessionIds: [], busIds: [testBus.id] },
  };
}

/** Crée un voyage test pour un chauffeur sur la ligne PO→Brazzaville. */
async function makeTrip(ctx: Ctx, driverId: string, departureMinutesAgo: number): Promise<string> {
  const code = `V5T-${Date.now().toString(36).toUpperCase()}-${ctx.created.tripIds.length}`;
  const trip = await db.trip.create({
    data: {
      code,
      routeId: ctx.routeId,
      busId: ctx.busId,
      driverId,
      agencyId: ctx.poAgencyId,
      departureTime: new Date(Date.now() - departureMinutesAgo * 60_000),
      estimatedArrivalTime: new Date(Date.now() - departureMinutesAgo * 60_000 + 600 * 60_000),
      price: 18000,
      status: "SCHEDULED",
    },
  });
  ctx.created.tripIds.push(trip.id);
  return trip.id;
}

/** Fabrique une session ACTIVE directement en base (chauffeur/bus donnés). */
async function makeSession(ctx: Ctx, driverId: string, at: [number, number], tripId: string | null = null): Promise<string> {
  const session = await db.trackingSession.create({
    data: {
      driverId,
      tripId,
      busId: tripId ? (await db.trip.findUniqueOrThrow({ where: { id: tripId } })).busId : null,
      agencyId: ctx.poAgencyId,
      status: "ACTIVE",
      deviceId: `dev-synth-${randomUUID().slice(0, 8)}`,
      lastLatitude: at[0],
      lastLongitude: at[1],
      lastPositionAt: new Date(),
      lastHeartbeatAt: new Date(),
    },
  });
  ctx.created.sessionIds.push(session.id);
  return session.id;
}

/** Session ACTIVE orpheline + position récente (pour le watchdog T17). */
async function makeOrphanSession(ctx: Ctx): Promise<string> {
  const driver = await db.driver.create({
    data: { firstName: "Orphelin", lastName: "V5", licenseNumber: `ORPH-V5-${Date.now()}`, agencyId: ctx.poAgencyId, status: "ON_TRIP" },
  });
  ctx.created.driverIds.push(driver.id);
  const old = new Date(Date.now() - 50 * 60_000); // > watchdogStaleMs (45 min)
  const session = await db.trackingSession.create({
    data: {
      driverId: driver.id, tripId: null, busId: null, agencyId: ctx.poAgencyId,
      status: "ACTIVE", startedAt: old,
    },
  });
  await db.gpsPoint.create({ data: { sessionId: session.id, latitude: ctx.coords.dolisie[0], longitude: ctx.coords.dolisie[1], recordedAt: old } });
  ctx.created.sessionIds.push(session.id);
  return session.id;
}

// ============================================================
// SCÉNARIOS
// ============================================================
async function scenarioT1(ctx: Ctx) {
  const start = await startSession(ctx.cookieA, {});
  const sessionId = start.json?.data?.id;
  if (sessionId) ctx.created.sessionIds.push(sessionId);
  check("T1.1", "Démarrage session sans voyage (1 bus actif)", start.status === 201 && Boolean(sessionId), `status=${start.status}`);
  const p1 = await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId, ...pos(...offset(ctx.coords.dolisie, 0.01, 0.01)) });
  const p2 = await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId, ...pos(...offset(ctx.coords.dolisie, 0.02, 0.02)) });
  check("T1.2", "Positions acceptées + état courant avancé", p1.json?.data?.accepted === 1 && p2.json?.data?.accepted === 1, JSON.stringify(p1.json?.data?.verdict));
  const fleet = await apiGet(ctx.adminCookie, "/api/admin/tracking");
  const mine = fleet.json?.data?.sessions?.find((s: unknown) => s.id === sessionId);
  check("T1.3", "Flotte admin : session visible avec dernière position", fleet.status === 200 && mine?.lastPoint?.latitude != null, JSON.stringify(mine?.busStatus));
  check("T1.4", "Transition métier SCHEDULED/BOARDING absente (pas de voyage)", mine?.trip === null);
  // Ménage partiel : on garde la session active pour T5 ? Non — on stoppe.
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT2T3(ctx: Ctx, total: number, tag: string) {
  // S'assurer qu'aucune session réelle ne traîne (T1 stoppée).
  const existing = await db.trackingSession.count({ where: { status: "ACTIVE" } });
  const needed = Math.max(0, total - existing);
  const drivers: string[] = [];
  for (let i = 0; i < needed; i++) {
    const d = await db.driver.create({
      data: { firstName: `Flotte${tag}`, lastName: `Bus${i + 1}`, licenseNumber: `FL-${tag}-${Date.now()}-${i}`, agencyId: ctx.poAgencyId, status: "ON_TRIP" },
    });
    ctx.created.driverIds.push(d.id);
    drivers.push(d.id);
  }
  const at = (i: number): [number, number] => offset(ctx.coords.dolisie, ((i % 10) - 5) * 0.05, (Math.floor(i / 10) - 2) * 0.05);
  for (let i = 0; i < needed; i++) await makeSession(ctx, drivers[i], at(i));
  const t0 = Date.now();
  const fleet = await apiGet(ctx.adminCookie, "/api/admin/tracking");
  const elapsed = Date.now() - t0;
  const sessions = fleet.json?.data?.sessions ?? [];
  const withPosition = sessions.filter((s: unknown) => s.lastPoint !== null);
  check(`${tag}.1`, `${total} bus actifs : flotte complète (${sessions.length} sessions)`, fleet.status === 200 && sessions.length >= total, `sessions=${sessions.length}, existantes=${existing}`);
  check(`${tag}.2`, `Isolation stricte : positions distinctes par bus (${withPosition.length}/${sessions.length})`, withPosition.length >= Math.min(needed, sessions.length));
  check(`${tag}.3`, `Requête flotte rapide (≤ 3 s, anti-N+1)`, elapsed <= 3000, `${elapsed} ms`);
  // KPI cohérents avec les données réelles.
  const kpi = fleet.json?.data?.kpi;
  check(`${tag}.4`, `KPI cohérents (total=${kpi?.total} ≥ ${total})`, kpi?.total >= total, JSON.stringify(kpi));
  // Nettoyage de CES sessions synthétiques (COMPLETED — pas supprimées :
  // le nettoyage global supprimera sessions + chauffeurs par identifiants).
  await db.trackingSession.updateMany({ where: { id: { in: ctx.created.sessionIds }, status: "ACTIVE" }, data: { status: "COMPLETED", endedAt: new Date(), endReason: "ADMIN" } });
  await db.driver.updateMany({ where: { id: { in: drivers } }, data: { status: "AVAILABLE" } });
}

async function scenarioT5(ctx: Ctx) {
  // Deux sessions API simultanées (chauffeur A réel + chauffeur B synthétique).
  const startA = await startSession(ctx.cookieA, {});
  const startB = await startSession(ctx.cookieB, {});
  const sA = startA.json?.data?.id;
  const sB = startB.json?.data?.id;
  if (sA) ctx.created.sessionIds.push(sA); if (sB) ctx.created.sessionIds.push(sB);
  const posA = pos(...offset(ctx.coords.dolisie, 0.05, 0), { positionId: randomUUID() });
  const posB = pos(...offset(ctx.coords.nkayi, 0.05, 0), { positionId: randomUUID() });
  const [rA, rB] = await Promise.all([
    apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: sA, ...posA }),
    apiPost(ctx.cookieB, "/api/tracking/location", { sessionId: sB, ...posB }),
  ]);
  check("T5.1", "Deux positions simultanées (2 bus) acceptées", rA.json?.data?.accepted === 1 && rB.json?.data?.accepted === 1);
  const [eA, eB] = await Promise.all([db.trackingSession.findUnique({ where: { id: sA } }), db.trackingSession.findUnique({ where: { id: sB } })]);
  check(
    "T5.2",
    "Aucun mélange : chaque session garde SA position",
    Math.abs(eA!.lastLatitude! - posA.latitude) < 1e-9 && Math.abs(eB!.lastLatitude! - posB.latitude) < 1e-9,
    `A=${eA!.lastLatitude} B=${eB!.lastLatitude}`
  );
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
  await apiPost(ctx.cookieB, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT6(ctx: Ctx) {
  // Chauffeur B démarre un suivi sur un voyage du bus de test…
  const tripB = await makeTrip(ctx, ctx.driverBId, 100);
  const startB = await startSession(ctx.cookieB, { tripId: tripB });
  const sB = startB.json?.data?.id;
  ctx.created.sessionIds.push(sB);
  check("T6.1", "Chauffeur B démarre le suivi du bus de test", startB.status === 201, `status=${startB.status} ${JSON.stringify(startB.json?.error?.message)}`);
  // …chauffeur A tente le MÊME bus (voyage distinct, même bus) → 409.
  const tripA = await makeTrip(ctx, ctx.driverAId, 100);
  const attempt = await startSession(ctx.cookieA, { tripId: tripA });
  check("T6.2", "Deuxième téléphone/chauffeur sur le même bus → 409 refusé", attempt.status === 409, `status=${attempt.status}`);
  const conflictEvent = await db.trackingEvent.findFirst({ where: { type: "SESSION_CONFLICT", busId: ctx.busId } });
  check("T6.3", "Conflit journalisé (SESSION_CONFLICT)", conflictEvent !== null);
  await apiPost(ctx.cookieB, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT7(ctx: Ctx) {
  const start = await startSession(ctx.cookieA, {});
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);
  const point = pos(...offset(ctx.coords.dolisie, 0.03, 0.03), { positionId: "fixed-dup-test-0001" });
  const first = await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...point });
  const count1 = await db.gpsPoint.count({ where: { sessionId: s } });
  const second = await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...point });
  const count2 = await db.gpsPoint.count({ where: { sessionId: s } });
  check("T7.1", "Premier envoi accepté", first.json?.data?.verdict === "ACCEPT" || first.json?.data?.verdict === "ACCEPT_FLAGGED", first.json?.data?.verdict);
  check("T7.2", "Ré-envoi identique → DUPLICATE (idempotent 200)", second.status === 200 && second.json?.data?.duplicate === true, JSON.stringify(second.json?.data));
  check("T7.3", "Aucune seconde ligne en base", count1 === count2, `avant=${count1} après=${count2}`);
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT8(ctx: Ctx) {
  const start = await startSession(ctx.cookieA, {});
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);
  const now = Date.now();
  const newer = pos(...offset(ctx.coords.dolisie, 0.04, 0.04), { recordedAt: new Date(now), speed: 70 });
  const older = pos(...offset(ctx.coords.dolisie, 0.01, 0.01), { recordedAt: new Date(now - 60_000), speed: 40 });
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...newer });
  const late = await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...older });
  const session = await db.trackingSession.findUnique({ where: { id: s } });
  check("T8.1", "Position ancienne acceptée en HISTOIRE seulement", late.json?.data?.historyOnly === true, JSON.stringify(late.json?.data?.verdict));
  check(
    "T8.2",
    "L'état courant ne recule JAMAIS (toujours la plus récente)",
    session!.lastPositionAt!.getTime() >= new Date(newer.recordedAt).getTime(),
    `lastPositionAt=${session!.lastPositionAt?.toISOString()} attendu≈${newer.recordedAt}`
  );
  const points = await db.gpsPoint.count({ where: { sessionId: s } });
  check("T8.3", "Les DEUX positions sont en historique", points === 2, `points=${points}`);
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT9T10(ctx: Ctx) {
  const start = await startSession(ctx.cookieA, {});
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);
  // File offline simulée : 6 points espacés de 20 s, positionIds stables.
  const now = Date.now();
  const queue = Array.from({ length: 6 }, (_, i) =>
    pos(...offset(ctx.coords.dolisie, 0.001 * i, 0.001 * i), { recordedAt: new Date(now - (6 - i) * 20_000), speed: 55, positionId: `offline-${i}-fixed-uuid` })
  );
  const flush = await apiPost(ctx.cookieA, "/api/tracking/batch", { sessionId: s, deviceId: "dev-offline-test", points: queue });
  check("T9.1", "Lot offline (6 points) synchronisé", flush.json?.data?.accepted === 6, JSON.stringify(flush.json?.data));
  const count = await db.gpsPoint.count({ where: { sessionId: s } });
  check("T9.2", "6 lignes écrites (une par position)", count === 6, `count=${count}`);
  // Re-synchronisation (reconnexion) : MÊME lot renvoyé → 100 % doublons.
  const reflux = await apiPost(ctx.cookieA, "/api/tracking/batch", { sessionId: s, deviceId: "dev-offline-test", points: queue });
  check("T10.1", "Re-batch idempotent : 6 doublons, 0 écriture", reflux.json?.data?.duplicates === 6 && reflux.json?.data?.accepted === 0, JSON.stringify(reflux.json?.data));
  const countAfter = await db.gpsPoint.count({ where: { sessionId: s } });
  check("T10.2", "Toujours 6 lignes en base", countAfter === 6, `count=${countAfter}`);
  // Une seule position invalide ne casse pas le lot (§38) — positions
  // réalistes : 60 s d'écart, ~700 m de progression (≈ 42 km/h).
  const mixed = await apiPost(ctx.cookieA, "/api/tracking/batch", {
    sessionId: s,
    points: [
      pos(...offset(ctx.coords.dolisie, 0.05, 0.05), { positionId: "mixed-ok-1", speed: 42, recordedAt: new Date(now - 180_000) }),
      pos(...offset(ctx.coords.dolisie, 0.056, 0.056), { positionId: "mixed-bad-1", speed: 350, recordedAt: new Date(now - 120_000) }),
      pos(...offset(ctx.coords.dolisie, 0.062, 0.062), { positionId: "mixed-ok-2", speed: 42, recordedAt: new Date(now - 60_000) }),
    ],
  });
  check("T10.3", "Lot mixte : 2 acceptées + 1 rejetée (pas d'échec global)", mixed.json?.data?.accepted === 2 && mixed.json?.data?.rejected === 1, JSON.stringify(mixed.json?.data));
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT11T12(ctx: Ctx) {
  const start = await startSession(ctx.cookieA, {});
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);
  // Point de référence valide.
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.02, 0.02), { speed: 50 }) });
  // T11 — précision dégradée (8 km) : acceptée mais SIGNALÉE.
  const imprecise = await apiPost(ctx.cookieA, "/api/tracking/location", {
    sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.02, 0.021), { accuracy: 8000, speed: 50 }),
  });
  check("T11.1", "GPS imprécis (±8 km) accepté avec signalement", imprecise.json?.data?.flagged === true, JSON.stringify(imprecise.json?.data));
  const anomaly = await db.trackingEvent.findFirst({ where: { type: "GPS_ANOMALY_DETECTED", sessionId: s } });
  check("T11.2", "Anomalie journalisée (GPS_ANOMALY_DETECTED)", anomaly !== null);
  // T12 — vitesses et déplacements impossibles.
  const fast = await apiPost(ctx.cookieA, "/api/tracking/location", {
    sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.021, 0.022), { speed: 350 }),
  });
  check("T12.1", "Vitesse déclarée impossible (350 km/h) → 422 rejet", fast.status === 422 && String(fast.json?.data?.verdict).startsWith("REJECT"), JSON.stringify(fast.json?.data?.verdict));
  const teleport = await apiPost(ctx.cookieA, "/api/tracking/location", {
    sessionId: s, ...pos(...offset(ctx.coords.brazzaville, 0.01, 0.01), { recordedAt: new Date(Date.now() + 5000), speed: 50 }),
  });
  check("T12.2", "Téléportation (Dolisie→Brazzaville en 5 s) → 422 rejet", teleport.status === 422 && String(teleport.json?.data?.verdict).startsWith("REJECT"), JSON.stringify(teleport.json?.data?.verdict));
  const rejectedEvent = await db.trackingEvent.findFirst({ where: { type: "GPS_POSITION_REJECTED", sessionId: s } });
  check("T12.3", "Rejets journalisés (GPS_POSITION_REJECTED)", rejectedEvent !== null);
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT13T14(ctx: Ctx) {
  // Départ il y a 100 min → Dolisie (prévu +180 min) est le CANDIDAT.
  const trip = await makeTrip(ctx, ctx.driverAId, 100);
  const start = await startSession(ctx.cookieA, { tripId: trip });
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);
  check("T13.0", "Voyage lié : transition SCHEDULED → BOARDING", (await db.trip.findUniqueOrThrow({ where: { id: trip } })).status === "BOARDING");

  const now = Date.now();
  // Approche (2 km de Dolisie) puis ENTRÉE dans la géofence (1,2 km).
  // Écarts réalistes : ≥ 60 s entre points, distances cohérentes avec la
  // vitesse déclarée (sinon le serveur rejette en téléportation — §8 !).
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.018, 0.018), { recordedAt: new Date(now - 240_000), speed: 80 }) });
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.002, 0.002), { recordedAt: new Date(now - 180_000), speed: 25 }) });
  // ... mais on REPART avant le dwell minimal (25 s) → T14 faux positif filtré.
  // (2,7 km en ~22 s = ~440 km/h implicites : signalé mais accepté — sous
  // le seuil de téléportation. Un point plus rapide serait rejeté en §8.)
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.017, 0.017), { recordedAt: new Date(now - 158_000), speed: 70 }) });
  await new Promise((r) => setTimeout(r, 300));
  const noEvent = await db.trackingEvent.findFirst({ where: { type: "STOP_ARRIVAL_DETECTED", sessionId: s } });
  check("T14.1", "Traversée rapide de la géofence (dwell < 25 s) → AUCUN événement", noEvent === null);
  const afterFalse = await db.trackingSession.findUniqueOrThrow({ where: { id: s } });
  check("T14.2", "Candidature nettoyée après sortie", afterFalse.geofenceStopId === null && afterFalse.geofenceEnteredAt === null);

  // T13 — vraie halte : entrée + confirmation après 60 s à faible vitesse.
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.001, 0.001), { recordedAt: new Date(now - 120_000), speed: 8 }) });
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.0012, 0.0012), { recordedAt: new Date(now - 60_000), speed: 3 }) });
  await new Promise((r) => setTimeout(r, 300));
  const arrival = await db.trackingEvent.findFirst({ where: { type: "STOP_ARRIVAL_DETECTED", sessionId: s } });
  const session = await db.trackingSession.findUniqueOrThrow({ where: { id: s } });
  check("T13.1", "Arrivée DURABLE à Dolisie détectée (dwell + vitesse basse)", arrival !== null, arrival?.message ?? "aucun événement");
  check("T13.2", "Phase technique AT_STOP + arrêt courant enregistrés", session.tripPhase === "AT_STOP" && session.geofenceStopId !== null, `phase=${session.tripPhase}`);
  const fleet = await apiGet(ctx.adminCookie, "/api/admin/tracking");
  const mine = fleet.json?.data?.sessions?.find((x: unknown) => x.id === s);
  check("T13.3", "Flotte : prochain arrêt (Nkayi) + phase exposés", mine?.tripPhase === "AT_STOP" && mine?.geofenceStopName === "Dolisie" && mine?.nextStop?.name === "Nkayi", JSON.stringify(mine?.nextStop));
  check("T13.4", "Premier point du voyage → transition DEPARTED", (await db.trip.findUniqueOrThrow({ where: { id: trip } })).status === "DEPARTED");

  // Départ de l'arrêt (hystérésis ×1,5 = 1,8 km) → STOP_DEPARTURE + IN_TRANSIT.
  // 60 s après la confirmation, ~2,5 km plus loin (≈ 150 km/h implicites
  // → signalé mais accepté, cohérent avec un car sur route).
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.022, 0.022), { recordedAt: new Date(now), speed: 75 }) });
  await new Promise((r) => setTimeout(r, 300));
  const departure = await db.trackingEvent.findFirst({ where: { type: "STOP_DEPARTURE_DETECTED", sessionId: s } });
  const after = await db.trackingSession.findUniqueOrThrow({ where: { id: s } });
  check("T13.5", "Départ de l'arrêt détecté (hystérésis dépassé) → IN_TRANSIT", departure !== null && after.tripPhase === "IN_TRANSIT", `phase=${after.tripPhase}`);
  check("T13.6", "Progression conservée (dernier arrêt atteint = Dolisie)", after.geofenceStopId !== null);
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT15T16(ctx: Ctx) {
  // Départ il y a 400 min : Dolisie ET Nkayi sont « sautés » (horaire+grâce
  // dépassés) → la DESTINATION (Brazzaville) est le candidat direct.
  const trip = await makeTrip(ctx, ctx.driverAId, 400);
  const start = await startSession(ctx.cookieA, { tripId: trip });
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);
  const now = Date.now();
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.brazzaville, 0.03, 0.03), { recordedAt: new Date(now - 240_000), speed: 60 }) });
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.brazzaville, 0.004, 0.004), { recordedAt: new Date(now - 180_000), speed: 20 }) });
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.brazzaville, 0.0045, 0.0045), { recordedAt: new Date(now - 120_000), speed: 2 }) });
  await new Promise((r) => setTimeout(r, 400));
  const destEvent = await db.trackingEvent.findFirst({ where: { type: "DESTINATION_ARRIVED", sessionId: s } });
  const tripRow = await db.trip.findUniqueOrThrow({ where: { id: trip } });
  check("T15.1", "Arrivée DURABLE à Brazzaville détectée (géofence destination)", destEvent !== null, destEvent?.message ?? "aucun événement");
  check("T15.2", "Voyage passé ARRIVED (transition métier)", tripRow.status === "ARRIVED", `status=${tripRow.status}`);
  const session = await db.trackingSession.findUniqueOrThrow({ where: { id: s } });
  check("T15.3", "Arrivée horodatée avec position + session", session.lastLatitude !== null && session.lastPositionAt !== null);

  // T16 — fin de trajet propre par le chauffeur.
  const stop = await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
  check("T16.1", "STOP chauffeur → session COMPLETED", stop.json?.data?.status === "COMPLETED");
  const after = await db.trackingSession.findUniqueOrThrow({ where: { id: s } });
  const driverA = await db.driver.findUniqueOrThrow({ where: { id: ctx.driverAId } });
  check("T16.2", "endReason=DRIVER + chauffeur libéré (AVAILABLE)", after.endReason === "DRIVER" && driverA.status === "AVAILABLE", `endReason=${after.endReason} driver=${driverA.status}`);
  const completed = await db.trackingEvent.findFirst({ where: { type: "TRIP_COMPLETED", sessionId: s } });
  const tripAfter = await db.trip.findUniqueOrThrow({ where: { id: trip } });
  check("T16.3", "Voyage ARRIVED → COMPLETED + événement TRIP_COMPLETED", tripAfter.status === "COMPLETED" && completed !== null, `status=${tripAfter.status}`);
}

async function scenarioT17(ctx: Ctx) {
  const orphanId = await makeOrphanSession(ctx);
  // Déclenche le watchdog via l'API maintenance signée (comme le scheduler).
  const body = JSON.stringify({ action: "all" });
  const sig = createHmac("sha256", LOAD_SECRET).update(body).digest("hex");
  const res = await fetch(`${BASE}/api/tracking/maintenance`, { method: "POST", headers: { "content-type": "application/json", "x-signature": sig }, body });
  const orphan = await db.trackingSession.findUniqueOrThrow({ where: { id: orphanId } });
  check("T17.1", "Watchdog : session orpheline → PAUSED", res.ok && orphan.status === "PAUSED", `status=${orphan.status}`);
  const offlineEvent = await db.trackingEvent.findFirst({ where: { type: "GPS_OFFLINE", sessionId: orphanId } });
  check("T17.2", "Événement GPS_OFFLINE journalisé", offlineEvent !== null);
}

async function scenarioT18(ctx: Ctx) {
  // Session du chauffeur B (créée via son compte) ; A tente d'y écrire.
  const startB = await startSession(ctx.cookieB, {});
  const sB = startB.json?.data?.id;
  ctx.created.sessionIds.push(sB);
  const rogue = await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: sB, ...pos(...offset(ctx.coords.nkayi, 0.02, 0.02)) });
  check("T18.1", "Position sur la session d'un AUTRE chauffeur → 404", rogue.status === 404, `status=${rogue.status}`);
  const rogue2 = await apiPost(ctx.cookieA, "/api/tracking/heartbeat", { sessionId: sB });
  check("T18.2", "Heartbeat sur la session d'un autre → 404", rogue2.status === 404, `status=${rogue2.status}`);
  const count = await db.gpsPoint.count({ where: { sessionId: sB } });
  check("T18.3", "Aucune position injectée", count === 0, `count=${count}`);
  await apiPost(ctx.cookieB, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT19(ctx: Ctx) {
  const fleet = await apiGet(ctx.adminCookie, "/api/admin/tracking");
  const token = fleet.json?.data?.socketToken;
  const start = await startSession(ctx.cookieA, {});
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);

  const connect = () =>
    new Promise<{ socket: ReturnType<typeof io> | null; ok: boolean }>((resolve) => {
      const socket = io(`${GATEWAY}/?XTransformPort=3003`, {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 2,
        timeout: 4000,
      });
      const done = (ok: boolean) => resolve({ socket: ok ? socket : null, ok });
      setTimeout(() => done(false), 6000);
      socket.on("connect", () => {
        socket.emit("subscribe-fleet", { token }, (ack: { ok: boolean }) => done(ack.ok));
      });
    });
  const first = await connect();
  check("T19.1", "Connexion temps réel (socket + jeton signé)", first.ok);
  if (first.ok) {
    const received: string[] = [];
    first.socket!.on("gps", (e: { sessionId: string }) => { if (e.sessionId === s) received.push(e.sessionId); });
    await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.06, 0.06), { recordedAt: new Date(Date.now() - 120_000) }) });
    await new Promise((r) => setTimeout(r, 1500));
    check("T19.2", "Événement gps reçu en live", received.length >= 1);
    first.socket!.disconnect();
    // Position pendant la déconnexion (acceptée en base, personne n'écoute).
    await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.07, 0.07), { recordedAt: new Date(Date.now() - 90_000) }) });
    await new Promise((r) => setTimeout(r, 800));
    const second = await connect();
    check("T19.3", "Reconnexion après déconnexion", second.ok);
    if (second.ok) {
      let gotAfterReconnect = false;
      second.socket!.on("gps", (e: { sessionId: string }) => { if (e.sessionId === s) gotAfterReconnect = true; });
      // Laisse expirer tout émission en cours (anti-empilement 2,5 s,
      // comportement V4 : le polling admin rattrape les évènements droppés).
      await new Promise((r) => setTimeout(r, 3000));
      // Position PLUS RÉCENTE que la dernière (sinon : archivée en historique
      // sans émission — comportement §12) et vitesse implicite plausible.
      await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.08, 0.08), { recordedAt: new Date(Date.now() - 30_000) }) });
      await new Promise((r) => setTimeout(r, 1500));
      check("T19.4", "Événements reçus après reconnexion", gotAfterReconnect);
      second.socket!.disconnect();
    }
  }
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

async function scenarioT20(ctx: Ctx) {
  // Recrée une flotte nombreuse puis mesure la fraîcheur du dashboard.
  await scenarioT2T3(ctx, 50, "T20");
  const t0 = Date.now();
  const fleet = await apiGet(ctx.adminCookie, "/api/admin/tracking");
  const elapsed = Date.now() - t0;
  check("T20.1", "Dashboard 50+ bus : réponse rapide", fleet.status === 200 && elapsed <= 3000, `${elapsed} ms`);
  check("T20.2", "Événements d'alerte exposés au dashboard", Array.isArray(fleet.json?.data?.events));
}

async function scenarioT21(ctx: Ctx) {
  const start = await startSession(ctx.cookieA, {});
  const s = start.json?.data?.id;
  if (s) ctx.created.sessionIds.push(s);
  // Position ancienne (GPS « perdu » il y a 10 min) + heartbeat FRAIS.
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.09, 0.09), { recordedAt: new Date(Date.now() - 10 * 60_000), speed: 50 }) });
  const beat = await apiPost(ctx.cookieA, "/api/tracking/heartbeat", { sessionId: s, batteryLevel: 55 });
  check("T21.1", "Heartbeat accepté (téléphone en ligne)", beat.json?.data?.ok === true && beat.json?.data?.positionFresh === false, JSON.stringify(beat.json?.data));
  const fleet = await apiGet(ctx.adminCookie, "/api/admin/tracking");
  const mine = fleet.json?.data?.sessions?.find((x: unknown) => x.id === s);
  check("T21.2", "Distinction 🟡 GPS silencieux (heartbeat frais, positions anciennes)", mine?.gpsStatus === "GPS_STALE", `gpsStatus=${mine?.gpsStatus}`);
  // Nouvelle position → GPS redevient actif.
  await apiPost(ctx.cookieA, "/api/tracking/location", { sessionId: s, ...pos(...offset(ctx.coords.dolisie, 0.1, 0.1)) });
  const fleet2 = await apiGet(ctx.adminCookie, "/api/admin/tracking");
  const mine2 = fleet2.json?.data?.sessions?.find((x: unknown) => x.id === s);
  check("T21.3", "Position fraîche → 🟢 GPS actif", mine2?.gpsStatus === "GPS_ACTIVE", `gpsStatus=${mine2?.gpsStatus}`);
  await apiPost(ctx.cookieA, "/api/tracking/session", { action: "STOP" });
}

// ============================================================
// NETTOYAGE
// ============================================================
async function cleanup(ctx: Ctx) {
  // Arrêter toute session restée vivante sur les chauffeurs de test.
  await db.trackingSession.updateMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    data: { status: "COMPLETED", endedAt: new Date(), endReason: "ADMIN" },
  });
  await db.driver.updateMany({ where: { status: "ON_TRIP" }, data: { status: "AVAILABLE" } });
  // Points + événements des sessions de test.
  if (ctx.created.sessionIds.length > 0) {
    await db.gpsPoint.deleteMany({ where: { sessionId: { in: ctx.created.sessionIds } } });
    await db.trackingSession.deleteMany({ where: { id: { in: ctx.created.sessionIds } } });
  }
  await db.trackingEvent.deleteMany({ where: { OR: [{ sessionId: { in: ctx.created.sessionIds } }, { busId: ctx.busId }] } });
  if (ctx.created.tripIds.length > 0) {
    await db.seatOccupancy.deleteMany({ where: { tripId: { in: ctx.created.tripIds } } });
    await db.trip.deleteMany({ where: { id: { in: ctx.created.tripIds } } });
  }
  await db.driver.deleteMany({ where: { id: { in: ctx.created.driverIds } } });
  await db.user.deleteMany({ where: { id: { in: ctx.created.userIds } } });
  await db.bus.deleteMany({ where: { id: { in: ctx.created.busIds } } });
  console.log("\n🧹 Nettoyage effectué (sessions, points, événements, voyages, chauffeurs et bus de test).");
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log(" NZOKO GPS V5 — Tests E2E multi-bus (20 scénarios §39)");
  console.log("══════════════════════════════════════════════════════\n");
  let ctx: Ctx | null = null;
  try {
    ctx = await setup();
    await scenarioT1(ctx);
    await scenarioT2T3(ctx, 10, "T2");
    await scenarioT2T3(ctx, 50, "T3");
    await scenarioT5(ctx);
    await scenarioT6(ctx);
    await scenarioT7(ctx);
    await scenarioT8(ctx);
    await scenarioT9T10(ctx);
    await scenarioT11T12(ctx);
    await scenarioT13T14(ctx);
    await scenarioT15T16(ctx);
    await scenarioT17(ctx);
    await scenarioT18(ctx);
    await scenarioT19(ctx);
    await scenarioT20(ctx);
    await scenarioT21(ctx);
  } catch (err) {
    console.error("\n💥 ERREUR D'EXÉCUTION :", err instanceof Error ? err.stack : err);
  } finally {
    if (ctx) await cleanup(ctx);
    await db.$disconnect();
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass);
    console.log("\n══════════════════════════════════════════════════════");
    console.log(` RÉSULTAT : ${passed}/${results.length} vérifications réussies`);
    if (failed.length > 0) {
      console.log(" ÉCHECS :");
      for (const f of failed) console.log(`  ❌ ${f.id} — ${f.label} ${f.detail ?? ""}`);
    }
    console.log("══════════════════════════════════════════════════════");
    process.exit(failed.length > 0 ? 1 : 0);
  }
}

void main();
