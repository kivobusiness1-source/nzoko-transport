// ============================================================
// NZOKO TRANSPORT — Génération des tracés de lignes (V4 GPS)
// Peuple Route.geometryJson pour chaque ligne active :
//   1. OSRM (si OSRM_BASE_URL configuré) : routage routier RÉEL —
//      GET {OSRM}/route/v1/driving/{lng},{lat};{lng},{lat};…
//      ?overview=full&geometries=geojson (timeout 15 s) ;
//   2. Fallback : LineString reliant directement les points villes.
// Séquence des points : [origine, ...arrêts triés par position, destination]
// (villes sans coordonnées ignorées). Convention GeoJSON [longitude, latitude].
//
// Exécution : bun scripts/generate-route-geometry.ts [--force]
//   - défaut : idempotent — seules les lignes actives SANS geometryJson
//     sont traitées (aucune donnée existante écrasée) ;
//   - --force : régénère TOUTES les lignes actives.
// ============================================================

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const FORCE = process.argv.includes("--force");

// OSRM_BASE_URL — même source de vérité que src/lib/gps-config.ts
// (lecture directe ici : ce script tourne hors bundler Next.js).
const OSRM_BASE_URL = (process.env.OSRM_BASE_URL ?? "").trim().replace(/\/+$/, "");
const OSRM_TIMEOUT_MS = 15_000;
const USER_AGENT = "NZOKO-Transport/1.0";

interface LineStringGeoJson {
  type: "LineString";
  coordinates: [number, number][];
}

/** Arrondit à 6 décimales (~11 cm) — réduit la taille du JSON stocké. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Routage routier RÉEL via OSRM (null si indisponible → fallback). */
async function osrmRoute(points: { lat: number; lng: number }[]): Promise<LineStringGeoJson | null> {
  if (!OSRM_BASE_URL || points.length < 2) return null;
  const path = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const url = `${OSRM_BASE_URL}/route/v1/driving/${path}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { routes?: { geometry?: unknown }[] };
    const geometry = body.routes?.[0]?.geometry;
    if (!geometry || typeof geometry !== "object") return null;
    const candidate = geometry as { type?: unknown; coordinates?: unknown };
    if (candidate.type !== "LineString" || !Array.isArray(candidate.coordinates) || candidate.coordinates.length < 2) {
      return null;
    }
    const coordinates: [number, number][] = [];
    for (const c of candidate.coordinates) {
      if (!Array.isArray(c) || c.length < 2) return null;
      const [lng, lat] = c as [unknown, unknown];
      if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
      }
      coordinates.push([round6(lng), round6(lat)]);
    }
    return { type: "LineString", coordinates };
  } catch {
    // Timeout / réseau indisponible — fallback silencieux.
    return null;
  }
}

/** Fallback : lignes droites reliant directement les points villes. */
function straightLine(points: { lat: number; lng: number }[]): LineStringGeoJson | null {
  if (points.length < 2) return null;
  return {
    type: "LineString",
    coordinates: points.map((p) => [round6(p.lng), round6(p.lat)] as [number, number]),
  };
}

async function main() {
  const routes = await db.route.findMany({
    where: { isActive: true, ...(FORCE ? {} : { geometryJson: null }) },
    include: {
      originCity: true,
      destinationCity: true,
      stops: { include: { city: true }, orderBy: { position: "asc" } },
    },
    orderBy: { code: "asc" },
  });

  console.log(`OSRM : ${OSRM_BASE_URL || "désactivé — tracés en lignes droites"}`);
  if (routes.length === 0) {
    console.log("Aucune ligne à traiter (tout est déjà peuplé — utilisez --force pour régénérer).");
    return;
  }

  let osrmCount = 0;
  let fallbackCount = 0;
  let skipped = 0;

  for (const route of routes) {
    // Séquence ordonnée [origine, ...arrêts, destination] — les villes sans
    // coordonnées sont ignorées (non cartographiables).
    const sequence: { lat: number; lng: number }[] = [];
    const push = (city: { name: string; latitude: number | null; longitude: number | null } | null, label: string) => {
      if (!city || city.latitude === null || city.longitude === null) {
        if (city) console.log(`  ⚠ ${route.code} : « ${label} » sans coordonnées — ignorée`);
        return;
      }
      sequence.push({ lat: city.latitude, lng: city.longitude });
    };
    push(route.originCity, route.originCity.name);
    for (const stop of route.stops) push(stop.city, stop.city.name);
    push(route.destinationCity, route.destinationCity.name);

    if (sequence.length < 2) {
      console.log(`✗ ${route.code} : moins de 2 villes avec coordonnées — aucun tracé`);
      skipped += 1;
      continue;
    }

    let source: "osrm" | "fallback" = "fallback";
    let geometry = await osrmRoute(sequence);
    if (geometry) {
      source = "osrm";
    } else {
      geometry = straightLine(sequence);
    }
    if (!geometry) {
      console.log(`✗ ${route.code} : génération impossible`);
      skipped += 1;
      continue;
    }

    await db.route.update({
      where: { id: route.id },
      data: { geometryJson: JSON.stringify(geometry) },
    });
    if (source === "osrm") osrmCount += 1;
    else fallbackCount += 1;
    console.log(
      `✓ ${route.code} (${route.originCity.name} → ${route.destinationCity.name}) : ${source}, ${geometry.coordinates.length} sommets`
    );
  }

  console.log(
    `--- RÉSUMÉ : ${routes.length} ligne(s) traitée(s) — OSRM ${osrmCount}, fallback ${fallbackCount}, ignorée(s) ${skipped}`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
