// ============================================================
// NZOKO — Backfill GPS (one-shot) : coordonnées des villes, des arrêts
// de route (≈ ville) et numéros de flotte des bus existants.
// Exécuté après l'ajout du module tracking V2 pour outiller la base
// sandbox SANS réinstaller le seed complet (les données existantes
// ne sont jamais supprimées — brief §70).
// Usage : bun run scripts/backfill-gps.ts [--cleanup n'opère rien]
// ============================================================

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Coordonnées des villes du Congo-Brazzaville (WGS84, approximation centre-ville)
const CITY_COORDS: Record<string, [number, number]> = {
  "Pointe-Noire": [-4.7761, 11.8635],
  "Brazzaville": [-4.2634, 15.2429],
  "Dolisie": [-4.2011, 12.6429],
  "Nkayi": [-4.1706, 13.2836],
  "Ouesso": [1.6136, 16.0507],
  "Gamboma": [-0.8333, 14.15],
  "Owando": [-0.4833, 15.9],
};

async function main() {
  console.log("🌱 Backfill GPS NZOKO…");

  // 1. Villes
  let citiesUpdated = 0;
  for (const [name, [lat, lng]] of Object.entries(CITY_COORDS)) {
    const r = await db.city.updateMany({
      where: { name, latitude: null },
      data: { latitude: lat, longitude: lng },
    });
    citiesUpdated += r.count;
  }
  console.log(`✓ ${citiesUpdated} ville(s) géolocalisée(s)`);

  // 2. Arrêts de route (≈ coordonnées de leur ville) — l'interpolation
  // fine entre villes viendra d'un outil de cartographie dédié.
  const stops = await db.routeStop.findMany({
    where: { latitude: null },
    include: { city: true },
  });
  let stopsUpdated = 0;
  for (const stop of stops) {
    const coords = CITY_COORDS[stop.city.name] ?? (stop.city.latitude !== null && stop.city.longitude !== null ? [stop.city.latitude, stop.city.longitude] : null);
    if (!coords) continue;
    await db.routeStop.update({
      where: { id: stop.id },
      data: { latitude: coords[0], longitude: coords[1] },
    });
    stopsUpdated++;
  }
  console.log(`✓ ${stopsUpdated} arrêt(s) de route géolocalisé(s)`);

  // 3. Numéros de flotte des bus (NZK-001…)
  const buses = await db.bus.findMany({ where: { fleetNumber: null }, orderBy: { createdAt: "asc" } });
  let busesUpdated = 0;
  let seq = 1;
  const existing = new Set(
    (await db.bus.findMany({ where: { fleetNumber: { not: null } }, select: { fleetNumber: true } })).map((b) => b.fleetNumber)
  );
  for (const bus of buses) {
    let fleet: string;
    do {
      fleet = `NZK-${String(seq).padStart(3, "0")}`;
      seq++;
    } while (existing.has(fleet));
    await db.bus.update({ where: { id: bus.id }, data: { fleetNumber: fleet } });
    existing.add(fleet);
    busesUpdated++;
  }
  console.log(`✓ ${busesUpdated} bus numérotés en flotte (NZK-xxx)`);

  console.log("✅ Backfill terminé.");
}

main()
  .catch((e) => {
    console.error("❌ Backfill échoué :", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
