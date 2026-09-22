// ============================================================
// NZOKO TRANSPORT — Normalisation des segments historiques
// Les réservations/occupations créées avant la gestion par
// segment occupaient le voyage COMPLET : on leur attribue le
// segment [0, séquence complète de la route] pour qu'elles
// chevauchent tout segment partiel (comportement identique à
// l'ancien verrou unique tripId+seatId).
// Exécution unique : bun prisma/fix-segments.ts
// ============================================================

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // Longueur de séquence complète par route : origine + arrêts + destination
  const routes = await db.route.findMany({ include: { _count: { select: { stops: true } } } });
  const seqLength = new Map<string, number>();
  for (const r of routes) seqLength.set(r.id, r._count.stops + 2); // [origine, arrêts…, destination]

  let fixedBookings = 0;
  let fixedOccupancies = 0;

  const bookings = await db.booking.findMany({
    select: { id: true, fromPosition: true, toPosition: true, trip: { select: { routeId: true } } },
  });
  for (const b of bookings) {
    const len = seqLength.get(b.trip.routeId) ?? 999;
    if (b.fromPosition !== 0 || b.toPosition === 999 || b.toPosition !== len) {
      await db.booking.update({ where: { id: b.id }, data: { fromPosition: 0, toPosition: len } });
      fixedBookings++;
    }
  }

  const occupancies = await db.seatOccupancy.findMany({
    select: { id: true, fromPosition: true, toPosition: true, trip: { select: { routeId: true } } },
  });
  for (const o of occupancies) {
    const len = seqLength.get(o.trip.routeId) ?? 999;
    if (o.fromPosition !== 0 || o.toPosition === 999 || o.toPosition !== len) {
      await db.seatOccupancy.update({ where: { id: o.id }, data: { fromPosition: 0, toPosition: len } });
      fixedOccupancies++;
    }
  }

  console.log(`✓ Segments normalisés : ${fixedBookings} réservations, ${fixedOccupancies} occupations.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
