#!/usr/bin/env bun
// ============================================================
// NZOKO TRANSPORT — Utilisateurs fictifs & test de charge
// ------------------------------------------------------------
// Usage :
//   bun tests/load-test.ts seed [nb=300]    Déployer nb utilisateurs fictifs
//                                            (+ sessions pré-authentifiées)
//   bun tests/load-test.ts run [niveauMax=800]  Montée en charge progressive
//                                            (10→25→50→100→200→400→800 users)
//   bun tests/load-test.ts clean            Retirer les utilisateurs fictifs
//
// Les utilisateurs fictifs (email charge+XXX@loadtest.nzoko.cg, rôle SUPPORT)
// sont des comptes de test clairement étiquetés, avec sessions créées
// directement en base (bcrypt non sollicité pendant la charge — le login
// est testé séparément par quelques sondes réelles par vague).
// ============================================================

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import { hash } from "bcryptjs";

const DB = new PrismaClient();
const BASE = process.env.LOAD_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "Charge@2026!";
const EMAIL_SUFFIX = "@loadtest.nzoko.cg";
const TOKENS_FILE = `${import.meta.dir}/.load-users.json`;
const CSRF = { "x-requested-with": "nzoko" };

const TOKEN_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomToken(len = 48): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  return out;
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

// Noms de passagers fictifs (Congo)
const FIRST_NAMES = [
  "Mamie", "Grâce", "Junior", "Christ", "Bercy", "Fanie", "Kevin", "Merveille",
  "Prince", "Ruth", "Sagesse", "Chancelle", "Dieuveil", "Loïs", "Ilan", "Naomi",
  "Bénissy", "Audrey", "Rolly", "Terence",
];
const LAST_NAMES = [
  "Mabiala", "Ngoma", "Loubaki", "Moukoko", "Bissielo", "Tchicaya", "Makosso",
  "Loemba", "Kimbembe", "Youla", "Malonga", "Kinzamba", "Bakala", "Missoumbe",
];
const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StoredUser {
  email: string;
  token: string;
}

// ------------------------------------------------------------
// SEED — déploiement des utilisateurs fictifs
// ------------------------------------------------------------
async function seed(count: number): Promise<void> {
  const role = await DB.role.findUnique({ where: { code: "SUPPORT" } });
  if (!role) throw new Error("Rôle SUPPORT introuvable — exécutez d'abord prisma/seed.ts");

  console.log(`⟩ Déploiement de ${count} utilisateurs fictifs (rôle SUPPORT, sans agence)…`);
  const passwordHash = await hash(PASSWORD, 12); // un seul hash partagé (comptes de test)

  const wanted: { email: string; i: number }[] = [];
  for (let i = 1; i <= count; i++) {
    wanted.push({ email: `charge+${String(i).padStart(4, "0")}${EMAIL_SUFFIX}`, i });
  }

  const existing = new Set(
    (await DB.user.findMany({
      where: { email: { endsWith: EMAIL_SUFFIX } },
      select: { email: true },
    })).map((u) => u.email)
  );
  const toCreate = wanted.filter((w) => !existing.has(w.email));
  console.log(`  ${toCreate.length} nouveaux / ${count - toCreate.length} déjà présents.`);

  if (toCreate.length > 0) {
    await DB.user.createMany({
      data: toCreate.map((w) => ({
        email: w.email,
        firstName: "Charge",
        lastName: `Fictif ${String(w.i).padStart(4, "0")}`,
        passwordHash,
        roleId: role.id,
        agencyId: null,
        isActive: true,
        phone: `+242 06 ${String(4000000 + w.i).slice(0, 3)} ${String(w.i).padStart(2, "0")} ${String(10 + (w.i % 80)).padStart(2, "0")}`,
      })),
    });
  }

  // Sessions pré-authentifiées (12 h) — évite bcrypt en pleine charge
  const users = await DB.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX }, isActive: true },
    select: { id: true, email: true },
  });
  const stored: StoredUser[] = (await Bun.file(TOKENS_FILE).json().catch(() => [])) as StoredUser[];
  const known = new Set(stored.map((s) => s.email));

  let created = 0;
  for (const u of users) {
    if (known.has(u.email)) continue;
    const token = randomToken();
    await DB.session.create({
      data: {
        id: sha256(token),
        userId: u.id,
        expiresAt: new Date(Date.now() + 11 * 3600 * 1000),
        ip: "127.0.0.1",
        userAgent: "nzoko-loadtest",
      },
    });
    stored.push({ email: u.email, token });
    created++;
  }
  await Bun.write(TOKENS_FILE, JSON.stringify(stored));
  console.log(`✓ ${users.length} utilisateurs fictifs prêts, ${created} nouvelles sessions.`);
  console.log(`  Connexion de test : charge+0001${EMAIL_SUFFIX} / ${PASSWORD}`);
  await DB.$disconnect();
}

// ------------------------------------------------------------
// CLEAN — retrait des utilisateurs fictifs
// ------------------------------------------------------------
async function clean(): Promise<void> {
  const res = await DB.user.deleteMany({ where: { email: { endsWith: EMAIL_SUFFIX } } });
  await Bun.write(TOKENS_FILE, "[]");
  console.log(`✓ ${res.count} utilisateurs fictifs retirés (sessions en cascade).`);
  await DB.$disconnect();
}

// ------------------------------------------------------------
// Client HTTP du test de charge
// ------------------------------------------------------------
type Class = "ok" | "limited" | "business" | "client4xx" | "server5xx" | "net";
interface Sample {
  status: number;
  ms: number;
}

function classify(status: number): Class {
  if (status < 0) return "net";
  if (status < 300) return "ok";
  if (status === 429) return "limited";
  if (status === 409 || status === 404) return "business";
  if (status < 500) return "client4xx";
  return "server5xx";
}

async function hit(
  path: string,
  init: RequestInit = {}
): Promise<Sample> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal });
    await res.arrayBuffer().catch(() => undefined); // libère le socket
    return { status: res.status, ms: performance.now() - t0 };
  } catch {
    return { status: -1, ms: performance.now() - t0 };
  } finally {
    clearTimeout(to);
  }
}

const post = (path: string, body: unknown, cookie?: string) =>
  hit(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...CSRF, ...(cookie ? { cookie: `nzoko_session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });

const get = (path: string, cookie?: string) =>
  hit(path, { headers: cookie ? { cookie: `nzoko_session=${cookie}` } : {} });

// ------------------------------------------------------------
// Parcours des utilisateurs virtuels
// ------------------------------------------------------------
interface TripLite {
  id: string;
}
interface CityLite {
  id: string;
  name: string;
}

interface Context {
  cities: CityLite[];
  trips: TripLite[];
  authTokens: string[];
  futureDate: string;
}

const think = () => sleep(5 + Math.random() * 60);

/** Visiteur anonyme : villes → recherche → plan de sièges (3 requêtes API). */
async function journeyAnon(ctx: Context, samples: Sample[]): Promise<void> {
  await sleep(Math.random() * 100);
  samples.push(await get("/api/cities"));
  await think();
  const a = rand(ctx.cities);
  let b = rand(ctx.cities);
  while (b.id === a.id) b = rand(ctx.cities);
  const search = await get(`/api/trips/search?from=${a.id}&to=${b.id}&date=${ctx.futureDate}`);
  samples.push(search);
  await think();
  if (ctx.trips.length > 0) {
    samples.push(await get(`/api/trips/${rand(ctx.trips).id}/seats`));
  }
}

/** Visiteur avec chargement complet de la page (SPA) puis API. */
async function journeyPage(ctx: Context, samples: Sample[]): Promise<void> {
  await sleep(Math.random() * 100);
  samples.push(await get("/"));
  await think();
  samples.push(await get("/api/cities"));
  await think();
  const a = rand(ctx.cities);
  let b = rand(ctx.cities);
  while (b.id === a.id) b = rand(ctx.cities);
  samples.push(await get(`/api/trips/search?from=${a.id}&to=${b.id}&date=${ctx.futureDate}`));
}

/** Client connecté (session fictive) : profil + notifications + recherche. */
async function journeyAuth(ctx: Context, samples: Sample[]): Promise<void> {
  await sleep(Math.random() * 100);
  const token = rand(ctx.authTokens);
  samples.push(await get("/api/auth/me", token));
  await think();
  samples.push(await get("/api/notifications", token));
  await think();
  const a = rand(ctx.cities);
  let b = rand(ctx.cities);
  while (b.id === a.id) b = rand(ctx.cities);
  samples.push(await get(`/api/trips/search?from=${a.id}&to=${b.id}&date=${ctx.futureDate}`));
  await think();
  if (ctx.trips.length > 0) {
    samples.push(await get(`/api/trips/${rand(ctx.trips).id}/seats`, token));
  }
}

/** Sonde de connexion réelle (bcrypt + session + journal sécurité). */
async function journeyLogin(ctx: Context, samples: Sample[]): Promise<void> {
  const email = `charge+${String(1 + Math.floor(Math.random() * 50)).padStart(4, "0")}${EMAIL_SUFFIX}`;
  samples.push(await post("/api/auth/login", { email, password: PASSWORD }));
  await think();
  samples.push(await get("/api/cities"));
}

/** Écrivain : réservation + paiement Mobile Money (démo) — chemin d'écriture complet. */
async function journeyWriter(ctx: Context, samples: Sample[]): Promise<void> {
  const trip = rand(ctx.trips);
  const seatsRes = await fetch(`${BASE}/api/trips/${trip.id}/seats`);
  const seatMap = (await seatsRes.json().catch(() => null)) as
    | { success: boolean; data?: { seats?: { id: string; status: string }[] } }
    | null;
  samples.push({ status: seatsRes.status, ms: 0 });
  if (!seatMap?.success) return;

  const free = (seatMap.data?.seats ?? []).filter((s) => s.status === "AVAILABLE");
  if (free.length === 0) return; // voyage plein : on passe (cas métier)
  const seat = rand(free);

  const bookingRes = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", ...CSRF },
    body: JSON.stringify({
      tripId: trip.id,
      seatId: seat.id,
      passenger: {
        firstName: rand(FIRST_NAMES),
        lastName: rand(LAST_NAMES),
        phone: `+242 06 ${String(100 + Math.floor(Math.random() * 899))} ${String(10 + Math.floor(Math.random() * 89))} ${String(10 + Math.floor(Math.random() * 89))}`,
      },
    }),
  });
  const booking = (await bookingRes.json().catch(() => null)) as
    | { success: boolean; data?: { id: string } }
    | null;
  samples.push({ status: bookingRes.status, ms: 0 });
  if (!booking?.success || !booking.data) return;

  const payRes = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...CSRF },
    body: JSON.stringify({
      bookingId: booking.data.id,
      provider: "MTN_MOMO",
      momoPhone: "+242 06 666 12 34",
      senderName: "Test Charge",
    }),
  });
  const payment = (await payRes.json().catch(() => null)) as
    | { success: boolean; data?: { id: string } }
    | null;
  samples.push({ status: payRes.status, ms: 0 });
  if (!payment?.success || !payment.data) return;

  const sim = await hit(`/api/payments/${payment.data.id}/simulate`, { method: "POST", headers: CSRF });
  samples.push(sim);
}

// ------------------------------------------------------------
// RUN — montée en charge progressive
// ------------------------------------------------------------
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

async function run(maxLevel: number): Promise<void> {
  // 0. Contexte : villes + voyages futurs + sessions fictives
  const stored = (await Bun.file(TOKENS_FILE).json().catch(() => [])) as StoredUser[];
  if (stored.length === 0) {
    console.log("⚠ Aucun utilisateur fictif trouvé — lancez d'abord : bun tests/load-test.ts seed");
    process.exit(1);
  }
  const ctx: Context = {
    cities: [],
    trips: [],
    authTokens: stored.map((s) => s.token),
    futureDate: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
  };

  console.log("⟩ Préparation (warm-up des routes)…");
  const citiesRes = await fetch(`${BASE}/api/cities`);
  const citiesJson = (await citiesRes.json().catch(() => null)) as
    | { success: boolean; data?: CityLite[] }
    | null;
  if (!citiesJson?.success || !citiesJson.data || citiesJson.data.length < 2) {
    console.log("✗ Impossible de charger les villes — le serveur tourne-t-il sur le port 3000 ?");
    process.exit(1);
  }
  ctx.cities = citiesJson.data;

  // Pool de voyages : 6 combinaisons de villes sur la date future
  const seenTrips = new Set<string>();
  for (let i = 0; i < 6 && ctx.cities.length >= 2; i++) {
    const a = ctx.cities[i % ctx.cities.length]!;
    const b = ctx.cities[(i + 1) % ctx.cities.length]!;
    const res = await fetch(
      `${BASE}/api/trips/search?from=${a.id}&to=${b.id}&date=${ctx.futureDate}`
    );
    const json = (await res.json().catch(() => null)) as
      | { success: boolean; data?: TripLite[] }
      | null;
    for (const t of json?.data ?? []) {
      if (!seenTrips.has(t.id)) {
        seenTrips.add(t.id);
        ctx.trips.push(t);
      }
    }
  }
  if (ctx.trips.length === 0) {
    console.log("✗ Aucun voyage trouvé à J+3 — programmez des voyages avant le test.");
    process.exit(1);
  }
  await get(`/api/trips/${ctx.trips[0]!.id}/seats`); // compile la route seats
  await get("/"); // compile la page
  await get("/api/auth/me", ctx.authTokens[0]!); // compile me + session lookup
  console.log(`  ${ctx.cities.length} villes · ${ctx.trips.length} voyages · ${stored.length} sessions fictives.\n`);

  const LEVELS = [10, 25, 50, 100, 200, 400, 800].filter((l) => l <= maxLevel);
  if (LEVELS.length === 0 || maxLevel > (LEVELS[LEVELS.length - 1] ?? 0)) LEVELS.push(maxLevel);

  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(" MONTÉE EN CHARGE — NZOKO TRANSPORT (chaque niveau = utilisateurs simultanés)");
  console.log("════════════════════════════════════════════════════════════════════════════");
  console.log(
    "niveau │ requêtes │ durée  │ req/s │  p50  │  p95  │  p99  │ 2xx  │429 │409/404│4xx │ 5xx │ réseau"
  );

  let lastOk = 0;
  let lastRps = 0;
  let crashed: { level: number; reason: string } | null = null;

  for (const level of LEVELS) {
    const samples: Sample[] = [];
    const jobs: Promise<void>[] = [];

    // Répartition : ~65% anonymes, ~15% page+API, ~12% connectés, sondes login, écrivains
    const logins = level >= 25 ? Math.min(5, Math.floor(level / 25)) : 0;
    const writers = level >= 25 ? (level >= 100 ? 3 : 2) : 1;
    const auths = Math.max(0, Math.floor(level * 0.12));
    const pages = Math.max(0, Math.floor(level * 0.15));
    const anons = Math.max(0, level - logins - writers - auths - pages);

    // Diagnostic : LOAD_DISABLE=writers,logins,auths,pages pour isoler un type
    const off = new Set((process.env.LOAD_DISABLE ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    if (!off.has("anons")) for (let i = 0; i < anons; i++) jobs.push(journeyAnon(ctx, samples));
    if (!off.has("pages")) for (let i = 0; i < pages; i++) jobs.push(journeyPage(ctx, samples));
    if (!off.has("auths")) for (let i = 0; i < auths; i++) jobs.push(journeyAuth(ctx, samples));
    if (!off.has("logins")) for (let i = 0; i < logins; i++) jobs.push(journeyLogin(ctx, samples));
    if (!off.has("writers")) for (let i = 0; i < writers; i++) jobs.push(journeyWriter(ctx, samples));

    const t0 = performance.now();
    await Promise.all(jobs);
    const wall = (performance.now() - t0) / 1000;

    const lat = samples.filter((s) => s.ms > 0).map((s) => s.ms).sort((a, b) => a - b);
    const counts: Record<Class, number> = {
      ok: 0, limited: 0, business: 0, client4xx: 0, server5xx: 0, net: 0,
    };
    for (const s of samples) counts[classify(s.status)]++;

    const rps = samples.length / wall;
    const fail =
      counts.server5xx > 0 || counts.net > 0 || pct(lat, 95) > 5000 || counts.client4xx > 0;
    const reason =
      counts.server5xx > 0
        ? `${counts.server5xx} erreurs 5xx`
        : counts.net > 0
          ? `${counts.net} échecs réseau/timeout`
          : counts.client4xx > 0
            ? `${counts.client4xx} erreurs 4xx inattendues`
            : pct(lat, 95) > 5000
              ? `p95=${Math.round(pct(lat, 95))}ms > 5s`
              : "";

    console.log(
      ` ${String(level).padStart(5)} │ ${String(samples.length).padStart(8)} │ ${wall.toFixed(1)}s │ ${rps.toFixed(0).padStart(5)} │ ${String(Math.round(pct(lat, 50))).padStart(4)}ms │ ${String(Math.round(pct(lat, 95))).padStart(4)}ms │ ${String(Math.round(pct(lat, 99))).padStart(4)}ms │ ${String(counts.ok).padStart(5)} │ ${String(counts.limited).padStart(3)} │ ${String(counts.business).padStart(6)} │ ${String(counts.client4xx).padStart(3)} │ ${String(counts.server5xx).padStart(4)} │ ${String(counts.net).padStart(6)} ${fail ? "⚠ ÉCHEC" : "OK"}`
    );

    if (fail) {
      crashed = { level, reason };
      break;
    }
    lastOk = level;
    lastRps = Math.max(lastRps, rps);
    await sleep(1500); // respiration entre vagues
  }

  console.log("══════════════════════════════════════════════════════════════════════════════");
  if (crashed) {
    console.log(`✗ CRAQUAGE au niveau ${crashed.level} : ${crashed.reason}`);
    console.log(`  Capacité maximale tenue : ${lastOk} utilisateurs simultanés (~${lastRps.toFixed(0)} req/s).`);
  } else {
    console.log(`✓ ${LEVELS[LEVELS.length - 1]} utilisateurs simultanés absorbés SANS erreur.`);
    console.log(`  Débit de pointe mesuré : ~${lastRps.toFixed(0)} req/s.`);
  }
  console.log("  Note : serveur Next.js en mode dev (surcoût HMR) — la prod tient davantage.");
  await DB.$disconnect();
}

// ------------------------------------------------------------
// Point d'entrée
// ------------------------------------------------------------
const [cmd, ...args] = process.argv.slice(2);
const arg0 = args[0] ? Number(args[0]) : undefined;

switch (cmd) {
  case "seed":
    await seed(arg0 && arg0 > 0 ? Math.min(arg0, 2000) : 300);
    break;
  case "clean":
    await clean();
    break;
  case "run":
    await run(arg0 && arg0 > 0 ? arg0 : 800);
    break;
  default:
    console.log("NZOKO TRANSPORT — test de charge");
    console.log("  bun tests/load-test.ts seed [nb]      déployer des utilisateurs fictifs (déf. 300)");
    console.log("  bun tests/load-test.ts run [niveau]   montée en charge jusqu'au niveau (déf. 800)");
    console.log("  bun tests/load-test.ts clean          retirer les utilisateurs fictifs");
    process.exit(cmd ? 1 : 0);
}
