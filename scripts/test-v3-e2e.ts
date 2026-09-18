// ============================================================
// NZOKO TRANSPORT — TEST E2E V3 ULTRA (multi-agences + GPS client)
// Couvre le spec section 55, adapté au niveau API (le headless
// sandbox ne peut pas accorder géolocalisation/caméra navigateur) :
//
//   A. GPS client     : nearby (quartier/distances/statuts), position
//                       invalide, recommend avec capacité par voyage
//   B. Multi-agences  : recherche filtrée par agence, réservation
//                       complète (verrou siège → paiement CASH guichet
//                       → billet + n° d'embarquement), double
//                       réservation 409
//   C. Billet         : PDF A4 (content-type + magie %PDF), n°
//                       d'embarquement au format NZK-XXXXXX
//   D. Checker        : scan par n° d'embarquement → VALID →
//                       re-scan → ALREADY_USED (anti double validation)
//   E. IA             : FAQ directe (résolue, zéro LLM), question
//                       dynamique (LLM RAG), journal AIQuestionLog
//   F. Admin          : quartiers, base de connaissances, rapports
//                       ville/agent, stats questions IA
//   G. Nettoyage      : annulation de la réservation de test
//
// Exécution : bun scripts/test-v3-e2e.ts
// ============================================================

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";

// Chaîne de repli anti-sandbox : l'env système peut contenir une URL SQLite
// périmée injectée au boot — le .env du projet (Neon) fait foi.
function loadProjectEnv(): void {
  const envPath = path.join(process.cwd(), ".env");
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?\s*$/.exec(line.trim());
      if (m && (!process.env[m[1]] || process.env[m[1]]?.startsWith("file:"))) {
        process.env[m[1]] = m[2];
      }
    }
  } catch {
    // .env absent → on garde l'environnement tel quel
  }
}
loadProjectEnv();

const db = new PrismaClient();
const BASE = "http://localhost:3000";

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
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    results.push(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function main() {
  const PN = "Pointe-Noire";
  const BZV = "Brazzaville";
  const cities = await db.city.findMany();
  const pnCity = cities.find((c) => c.name === PN);
  const bzvCity = cities.find((c) => c.name === BZV);

  // ==========================================================
  console.log("── A. GPS CLIENT (nearby / recommend)");
  // ==========================================================
  {
    const res = await fetch(`${BASE}/api/agencies/nearby?lat=-4.7517&lng=11.867`);
    const body = await json<{ success: boolean; data: { neighborhood: { name: string } | null; agencies: { name: string; distanceMeters: number | null; status: string }[]; message: string } }>(res);
    check("A1 nearby HTTP 200", res.status === 200);
    const d = body.data;
    check("A2 quartier détecté (Tié-Tié)", d.neighborhood?.name === "Tié-Tié");
    check("A3 ≥ 5 agences géolocalisées", d.agencies.length >= 5, `${d.agencies.length} agences`);
    const distances = d.agencies.map((a) => a.distanceMeters ?? Infinity);
    const sorted = [...distances].sort((a, b) => a - b);
    check("A4 tri par distance croissante", JSON.stringify(distances) === JSON.stringify(sorted));
    check("A5 message de contexte fourni", d.message.length > 10);

    // Position aberrante → message explicite, pas d'agence
    const resBad = await fetch(`${BASE}/api/agencies/nearby?lat=0&lng=0`);
    const bad = await json<{ success: boolean; data: { agencies: unknown[]; message: string } }>(resBad);
    check("A6 position (0,0) rejetée proprement", bad.data.agencies.length === 0 && /manuel/i.test(bad.data.message));

    // Recommandation avec intention de voyage (demain, PN → BZV)
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const resRec = await fetch(`${BASE}/api/agencies/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
      body: JSON.stringify({ lat: -4.7517, lng: 11.867, fromCityId: pnCity?.id, toCityId: bzvCity?.id, date: tomorrow }),
    });
    const rec = await json<{ success: boolean; data: { agencies: { name: string; departuresToday: number | null; nextDepartureSeats: number | null }[]; reason: string; alternatives: unknown[] } }>(resRec);
    check("A7 recommend HTTP 200", resRec.status === 200);
    const tieTie = rec.data.agencies.find((a) => a.name.includes("Tié-Tié"));
    check("A8 Tié-Tié a des départs demain", (tieTie?.departuresToday ?? 0) >= 1, `${tieTie?.departuresToday} départs`);
    check("A9 sièges disponibles calculés", (tieTie?.nextDepartureSeats ?? 0) > 0, `${tieTie?.nextDepartureSeats} sièges`);
    check("A10 alternatives listées", rec.data.alternatives.length >= 1);
    check("A11 raison motivée fournie", rec.data.reason.length > 10);

    // Ligne PN → Dolisie : Ngoyo dessert, Tié-Tié NON (filtrage par ligne)
    const resRec2 = await fetch(`${BASE}/api/agencies/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
      body: JSON.stringify({ lat: -4.7517, lng: 11.867, fromCityId: pnCity?.id, toCityId: cities.find((c) => c.name === "Dolisie")?.id, date: tomorrow }),
    });
    const rec2 = await json<{ success: boolean; data: { agencies: { name: string; departuresToday: number | null }[] } }>(resRec2);
    const tieTieDol = rec2.data.agencies.find((a) => a.name.includes("Tié-Tié"));
    const ngoyoDol = rec2.data.agencies.find((a) => a.name.includes("Ngoyo"));
    check("A12 filtrage par ligne (Tié-Tié: 0 départ Dolisie)", (tieTieDol?.departuresToday ?? -1) === 0);
    check("A13 Ngoyo dessert Dolisie", (ngoyoDol?.departuresToday ?? 0) >= 1);
  }

  // ==========================================================
  console.log("── B. MULTI-AGENCES : réservation complète + verrou");
  // ==========================================================
  let bookingRef = "";
  let ticketToken = "";
  let boardingNumber = "";
  let bookingId = "";
  {
    // Trip FUTUR de PNR-CENTRE (le checker de test y est rattaché)
    const futureTrip = await db.trip.findFirst({
      where: { status: "SCHEDULED", departureTime: { gt: new Date() }, agency: { code: "PNR-CENTRE" } },
      include: { route: true, bus: { include: { seatLayout: { include: { seats: true } } } } },
      orderBy: { departureTime: "asc" },
    });
    if (!futureTrip) throw new Error("Aucun voyage futur PNR-CENTRE — relancer scripts/seed-v3.ts");
    const date = futureTrip.departureTime.toISOString().slice(0, 10);

    // Recherche filtrée par agence (4e paramètre)
    const resSearch = await fetch(`${BASE}/api/trips/search?from=${pnCity?.id}&to=${futureTrip.route.destinationCityId}&date=${date}&agencyId=${futureTrip.agencyId}`);
    const search = await json<{ success: boolean; data: { id: string; agencyName: string }[] }>(resSearch);
    check("B1 recherche filtrée par agence", resSearch.status === 200 && search.data.every((t) => t.agencyName.includes("Centre-ville") || t.agencyName.includes("Centre")), `${search.data.length} voyages`);

    // Plan de sièges → premier siège libre
    const resSeats = await fetch(`${BASE}/api/trips/${futureTrip.id}/seats`);
    const seatMap = await json<{ success: boolean; data: { seats: { id: string; status: string }[] } }>(resSeats);
    const freeSeat = seatMap.data.seats.find((s) => s.status === "AVAILABLE");
    if (!freeSeat) throw new Error("Aucun siège libre sur le voyage de test");
    check("B2 plan de sièges accessible", resSeats.status === 200 && seatMap.data.seats.length > 0);

    // Réservation WEB
    const resBook = await fetch(`${BASE}/api/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
      body: JSON.stringify({
        tripId: futureTrip.id,
        seatId: freeSeat.id,
        channel: "WEB",
        passenger: { firstName: "Test", lastName: "E2E V3", phone: "242055000099" },
      }),
    });
    const book = await json<{ success: boolean; data: { id: string; bookingReference: string } }>(resBook);
    check("B3 réservation créée", resBook.status === 201 && book.data.bookingReference.startsWith("NZK-"), book.data.bookingReference);
    bookingRef = book.data.bookingReference;
    bookingId = book.data.id;

    // DOUBLE réservation du même siège → 409 (anti double réservation)
    const resDouble = await fetch(`${BASE}/api/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
      body: JSON.stringify({
        tripId: futureTrip.id,
        seatId: freeSeat.id,
        channel: "WEB",
        passenger: { firstName: "Autre", lastName: "Client", phone: "242055000098" },
      }),
    });
    check("B4 double réservation rejetée (409)", resDouble.status === 409);

    // Paiement CASH au guichet (login admin → permission cash-collect)
    const admin = await login("admin@nzoko.cg", "Admin@2026!");
    const resPay = await fetch(`${BASE}/api/payments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: admin },
      body: JSON.stringify({ bookingId, provider: "CASH" }),
    });
    const pay = await json<{ success: boolean; data: { id: string; status: string } }>(resPay);
    check("B5 paiement espèces initié", resPay.status === 201 && pay.data.status === "PENDING");

    const resConfirm = await fetch(`${BASE}/api/payments/${pay.data.id}/confirm-cash`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: admin },
    });
    const confirmed = await json<{ success: boolean; data: { status: string } }>(resConfirm);
    check("B6 paiement espèces confirmé", resConfirm.status === 200 && confirmed.data.status === "SUCCESS");

    // Billet émis avec numéro d'embarquement
    const resDetail = await fetch(`${BASE}/api/bookings/${bookingRef}`);
    const detail = await json<{ success: boolean; data: { ticket: { token: string; boardingNumber: string | null } | null; status: string } }>(resDetail);
    ticketToken = detail.data.ticket?.token ?? "";
    boardingNumber = detail.data.ticket?.boardingNumber ?? "";
    check("B7 billet émis (CONFIRMED)", detail.data.status === "CONFIRMED" && ticketToken.length > 0);
    check("B8 n° d'embarquement NZK-XXXXXX", /^NZK-[A-Z2-9]{6}$/.test(boardingNumber), boardingNumber);

    // ==========================================================
    console.log("── C. BILLET PDF A4");
    // ==========================================================
    const resPdf = await fetch(`${BASE}/api/tickets/${ticketToken}/pdf`);
    const pdfBytes = new Uint8Array(await resPdf.arrayBuffer());
    check("C1 PDF HTTP 200", resPdf.status === 200);
    check("C2 content-type application/pdf", (resPdf.headers.get("content-type") ?? "").includes("application/pdf"));
    check("C3 magie %PDF + taille > 5 Ko", pdfBytes.length > 5000 && pdfBytes[0] === 0x25 && pdfBytes[1] === 0x50 && pdfBytes[2] === 0x44 && pdfBytes[3] === 0x46, `${(pdfBytes.length / 1024).toFixed(1)} Kio`);

    // ==========================================================
    console.log("── D. CHECKER : embarquement + anti double validation");
    // ==========================================================
    const checker = await login("checker.pn@nzoko.cg", "Checker@2026!");
    const scan = async (code: string) => {
      const r = await fetch(`${BASE}/api/checker/scan`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: checker },
        body: JSON.stringify({ code }),
      });
      return { status: r.status, body: await json<{ success: boolean; data: { result: string; boarded: boolean; ticket: { boardingNumber: string | null; checkedByName: string | null; checkedAt: string | null } | null } }>(r) };
    };

    // Scan par NUMÉRO D'EMBARQUEMENT (contrôle manuel du spec)
    const scan1 = await scan(boardingNumber);
    check(
      "D1 scan par n° d'embarquement → VALID",
      scan1.body.data?.result === "VALID" && scan1.body.data?.boarded === true,
      scan1.body.data ? `board=${scan1.body.data.boarded}` : `HTTP ${scan1.status} → ${JSON.stringify(scan1.body).slice(0, 160)}`
    );

    // DOUBLE UTILISATION → ALREADY_USED avec trace
    const scan2 = await scan(boardingNumber);
    check("D2 re-scan → ALREADY_USED (bloqué)", scan2.body.data?.result === "ALREADY_USED" && !scan2.body.data?.boarded, JSON.stringify(scan2.body).slice(0, 120));
    check("D3 trace première validation", Boolean(scan2.body.data?.ticket?.checkedAt) && Boolean(scan2.body.data?.ticket?.checkedByName));

    // Scan par référence réservation → détecte aussi l'usage
    const scan3 = await scan(bookingRef);
    check("D4 scan par référence → ALREADY_USED", scan3.body.data?.result === "ALREADY_USED", JSON.stringify(scan3.body).slice(0, 120));

    // ==========================================================
    console.log("── E. ASSISTANT IA (FAQ directe + RAG + journal)");
    // ==========================================================
    const t0 = Date.now();
    const resFaq = await fetch(`${BASE}/api/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
      body: JSON.stringify({ message: "Comment réserver un billet ?" }),
    });
    const faq = await json<{ success: boolean; data: { reply: string; resolved: boolean; category: string | null } }>(resFaq);
    const faqMs = Date.now() - t0;
    check("E1 FAQ directe HTTP 200", resFaq.status === 200);
    check("E2 FAQ directe résolue (zéro LLM)", faq.data.resolved === true && faq.data.category === "RESERVATION");
    check("E3 FAQ rapide (< 2 s → pas de LLM)", faqMs < 2000, `${faqMs} ms`);
    check("E4 réponse officielle cohérente", /réserver|Réserver/i.test(faq.data.reply));

    // Question dynamique → LLM RAG (avec données réelles)
    const resDyn = await fetch(`${BASE}/api/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko" },
      body: JSON.stringify({ sessionId: "e2e-v3-dyn", message: "Quel est le prix du trajet Pointe-Noire Brazzaville ?" }),
    });
    if (resDyn.ok) {
      const dyn = await json<{ success: boolean; data: { reply: string; resolved: boolean } }>(resDyn);
      check("E5 question dynamique (LLM RAG) répondue", dyn.data.reply.length > 10);
      check("E6 prix réel mentionné (anti-hallucination)", /18\s?000|FCFA/i.test(dyn.data.reply), dyn.data.reply.slice(0, 90));
    } else {
      check("E5 question dynamique (LLM RAG) répondue", false, `HTTP ${resDyn.status}`);
      check("E6 prix réel mentionné (anti-hallucination)", false);
    }

    // Journal AIQuestionLog
    const logCount = await db.aIQuestionLog.count();
    check("E7 questions journalisées (AIQuestionLog)", logCount >= 2, `${logCount} entrées`);

    // ==========================================================
    console.log("── F. ADMIN : quartiers / base IA / rapports");
    // ==========================================================
    const resHoods = await fetch(`${BASE}/api/admin/neighborhoods`, { headers: { cookie: admin } });
    const hoods = await json<{ success: boolean; data: { name: string; agencyCount: number }[] }>(resHoods);
    check("F1 quartiers listés (15)", resHoods.status === 200 && hoods.data.length === 15);

    const resKb = await fetch(`${BASE}/api/admin/knowledge-base`, { headers: { cookie: admin } });
    const kb = await json<{ success: boolean; data: { category: string; isActive: boolean }[] }>(resKb);
    check("F2 base de connaissances (27 FAQ)", resKb.status === 200 && kb.data.length >= 27, `${kb.data.length} FAQ`);
    const categories = new Set(kb.data.map((k) => k.category));
    check("F3 catégories couvertes (≥ 10)", categories.size >= 10, `${categories.size} catégories`);

    const resStats = await fetch(`${BASE}/api/admin/ai-questions?stats=true`, { headers: { cookie: admin } });
    const stats = await json<{ success: boolean; data: { total: number; resolved: number } }>(resStats);
    check("F4 stats questions IA", resStats.status === 200 && stats.data.total >= 2);

    for (const type of ["city", "agent"] as const) {
      const resRep = await fetch(`${BASE}/api/reports?type=${type}`, { headers: { cookie: admin } });
      const rep = await json<{ success: boolean; data: { rows: { label: string; bookings: number }[] } }>(resRep);
      check(`F5 rapport ${type === "city" ? "par ville" : "par agent"} (200 + lignes)`, resRep.status === 200 && rep.data.rows.length >= 1, rep.data.rows.slice(0, 2).map((r) => r.label).join(", "));
    }

    // Rappels de départ (action maintenance)
    const { createHmac } = await import("crypto");
    const fs = await import("fs");
    const env = fs.readFileSync(`${process.cwd()}/.env`, "utf8");
    const secret = env.match(/TRACKING_SECRET="([^"]+)"/)?.[1] ?? "nzoko-tracking-dev-secret-change-me";
    const body = JSON.stringify({ action: "reminders" });
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const resRem = await fetch(`${BASE}/api/tracking/maintenance`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sig },
      body,
    });
    const rem = await json<{ success: boolean; data: { reminders: { tripsScanned: number } | null } }>(resRem);
    check("F6 rappels départ (maintenance) exécutés", resRem.status === 200 && rem.data.reminders !== null, `${rem.data.reminders?.tripsScanned ?? 0} voyages scannés`);

    // ==========================================================
    console.log("── G. NETTOYAGE");
    // ==========================================================
    const resCancel = await fetch(`${BASE}/api/bookings/${bookingRef}/cancel`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-requested-with": "nzoko", cookie: admin },
    });
    const cancelled = await json<{ success: boolean; data: { status: string } }>(resCancel);
    check("G1 réservation de test annulée (siège libéré)", resCancel.status === 200 && ["CANCELLED", "COMPLETED"].includes(cancelled.data.status), cancelled.data.status);
  }

  // ==========================================================
  console.log("\n══════════════════ RÉSULTATS ══════════════════");
  for (const line of results) console.log(line);
  console.log("────────────────────────────────────────────────");
  console.log(`E2E V3 : ${passed}/${passed + failed} ✅${failed > 0 ? ` — ${failed} ÉCHEC(S) ❌` : " — TOUT EST VERT"}`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error("E2E V3 ÉCHOUÉ :", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
