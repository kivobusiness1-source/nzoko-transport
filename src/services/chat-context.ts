// ============================================================
// NZOKO TRANSPORT — Contexte factuel pour l'assistant IA (RAG léger)
// Injecte dans le prompt système les DONNÉES RÉELLES de la base :
// villes desservies, routes + tarifs de base, voyages à venir
// (7 prochains jours) avec prix et places restantes, baisses de
// prix réelles (yield) et agences. Cache mémoire court (60 s) pour
// épargner SQLite — l'assistant doit toujours parler de données
// fraîches sans jamais les inventer.
// ============================================================

import { db } from "@/lib/db";
import { formatDayLabel, formatTime, formatMoney } from "@/lib/format";

const CACHE_TTL_MS = 60_000;
const MAX_TRIPS = 40;
const HORIZON_DAYS = 7;

let cached: { at: number; text: string } | null = null;

/** 600 → « 10h » · 570 → « 9h30 » · 45 → « 45 min » */
function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/**
 * Construit le bloc « CONTEXTE RÉEL » du prompt système.
 * Ne contient QUE des faits issus de la base — si une rubrique est
 * vide, elle est explicitée comme vide (jamais inventée).
 */
export async function buildAssistantContext(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.text;
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const [cities, routes, trips, agencies] = await Promise.all([
    db.city.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.route.findMany({
      where: { isActive: true },
      include: {
        originCity: true,
        destinationCity: true,
        stops: { include: { city: true }, orderBy: { position: "asc" } },
      },
      orderBy: { basePrice: "asc" },
    }),
    db.trip.findMany({
      where: {
        status: { in: ["SCHEDULED", "BOARDING"] },
        departureTime: { gte: now, lt: horizon },
      },
      include: {
        route: { include: { originCity: true, destinationCity: true } },
        bus: { include: { seatLayout: { include: { seats: true } } } },
        agency: true,
        // Places réellement indisponibles = réservées OU verrouillées actives
        // (même règle que la recherche publique → cohérence des réponses)
        occupancies: {
          where: {
            OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }],
          },
        },
      },
      orderBy: { departureTime: "asc" },
      take: MAX_TRIPS,
    }),
    db.agency.findMany({
      where: { isActive: true },
      include: { city: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const lines: string[] = [];

  lines.push(`DATE & HEURE ACTUELLES (heure de Brazzaville) : ${formatDayLabel(now)} à ${formatTime(now)}.`);
  lines.push("");

  // ---------- Villes ----------
  if (cities.length > 0) {
    lines.push(`VILLES DESSERVIES (${cities.length}) : ${cities.map((c) => c.name).join(", ")}.`);
  } else {
    lines.push("VILLES DESSERVIES : aucune pour le moment (réseau en cours de mise en place).");
  }

  // ---------- Routes & tarifs ----------
  lines.push("");
  if (routes.length > 0) {
    lines.push(`ROUTES ET TARIFS DE BASE (${routes.length}) :`);
    for (const r of routes) {
      const parts = [
        `- ${r.originCity.name} → ${r.destinationCity.name} : ${formatMoney(r.basePrice)} · ${durationLabel(r.estimatedDurationMinutes)} · ${r.distanceKm} km`,
      ];
      if (r.stops.length > 0) {
        parts.push(`   arrêts : ${r.stops.map((s) => s.city.name).join(", ")}`);
      }
      lines.push(parts.join("\n"));
    }
  } else {
    lines.push("ROUTES ET TARIFS DE BASE : aucune route active actuellement.");
  }

  // ---------- Voyages à venir ----------
  lines.push("");
  if (trips.length > 0) {
    lines.push(`VOYAGES À VENIR (${HORIZON_DAYS} prochains jours, les ${Math.min(trips.length, MAX_TRIPS)} premiers) :`);
    for (const t of trips) {
      const total = t.bus.seatLayout.seats.length;
      const available = Math.max(0, total - t.occupancies.length);
      const promoNote = t.price < t.route.basePrice ? ` (tarif réduit, au lieu de ${formatMoney(t.route.basePrice)})` : "";
      lines.push(
        `- ${formatDayLabel(t.departureTime)} ${formatTime(t.departureTime)} : ${t.route.originCity.name} → ${t.route.destinationCity.name} · ${formatMoney(t.price)}${promoNote} · ${available} place(s) sur ${total} · ${t.agency.name}`
      );
    }
    if (trips.length >= MAX_TRIPS) lines.push("   (liste tronquée aux premiers départs)");
  } else {
    lines.push("VOYAGES À VENIR : aucun départ programmé dans les 7 prochains jours.");
  }

  // ---------- Promotions réelles ----------
  lines.push("");
  const promos = trips.filter((t) => t.price < t.route.basePrice);
  if (promos.length > 0) {
    lines.push(`PROMOTIONS RÉELLEMENT ACTIVES (${promos.length}) :`);
    for (const p of promos) {
      const cut = Math.round((1 - p.price / p.route.basePrice) * 100);
      lines.push(
        `- ${formatDayLabel(p.departureTime)} ${formatTime(p.departureTime)} ${p.route.originCity.name} → ${p.route.destinationCity.name} : ${formatMoney(p.price)} au lieu de ${formatMoney(p.route.basePrice)} (-${cut} %)`
      );
    }
  } else {
    lines.push("PROMOTIONS ACTIVES : aucune baisse de prix enregistrée actuellement sur les départs à venir.");
  }

  // ---------- Agences ----------
  lines.push("");
  if (agencies.length > 0) {
    lines.push(`AGENCES (${agencies.length}) :`);
    for (const a of agencies) {
      const contact = [a.address, a.phone].filter(Boolean).join(" · ");
      lines.push(`- ${a.name} (${a.city.name})${contact ? ` — ${contact}` : ""}`);
    }
  } else {
    lines.push("AGENCES : aucune agence enregistrée pour le moment.");
  }

  const text = lines.join("\n");
  cached = { at: Date.now(), text };
  return text;
}
