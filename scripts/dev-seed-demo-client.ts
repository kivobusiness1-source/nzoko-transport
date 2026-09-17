// One-shot Task ID 11 : données de démonstration pour l'espace client de test
// (test.supauth@nzoko.cg) — sert UNIQUEMENT à peupler l'interface pendant la
// refonte visuelle. Nettoyage intégral via : bun run scripts/dev-seed-demo-client.ts --cleanup
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEMO_EMAIL = "test.supauth@nzoko.cg";
const DEMO_PHONE = "242065554433";
const TAG = "demo-client-11"; // dans Payment.metadata + références NZK-2026-DEMO*
const D = 24 * 3600 * 1000;

function ref(n: number) {
  return `NZK-2026-DEMO${String(n).padStart(2, "0")}`;
}
function randHex(bytes: number) {
  let s = "";
  for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return s;
}

async function main() {
  const cleanup = process.argv.includes("--cleanup");

  if (cleanup) {
    const user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
    if (user) {
      const bookings = await db.booking.findMany({ where: { bookingReference: { startsWith: "NZK-2026-DEMO" } }, select: { id: true } });
      const bookingIds = bookings.map((b) => b.id);
      await db.tripRating.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await db.ticket.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await db.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await db.loyaltyTransaction.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await db.seatOccupancy.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await db.booking.deleteMany({ where: { id: { in: bookingIds } } });
      const complaints = await db.complaint.findMany({ where: { userId: user.id }, select: { id: true } });
      for (const c of complaints) await db.complaintMessage.deleteMany({ where: { complaintId: c.id } });
      await db.complaint.deleteMany({ where: { userId: user.id } });
      await db.notification.deleteMany({ where: { userId: user.id } });
      await db.redemptionRequest.deleteMany({ where: { userId: user.id } });
      if (user.loyaltyAccount?.id) {
        await db.loyaltyTransaction.deleteMany({ where: { accountId: user.loyaltyAccount.id } });
        await db.loyaltyAccount.delete({ where: { id: user.loyaltyAccount.id } });
      }
      await db.favoriteRoute.deleteMany({ where: { userId: user.id } });
      await db.passenger.deleteMany({ where: { userId: user.id } });
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.securityLog.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
      console.log(`✓ utilisateur ${DEMO_EMAIL} + données supprimés`);
    }
    await db.promoCode.deleteMany({ where: { code: "NZOKO-DEMO10" } });
    // Restaure les voyages touchés (repasse SCHEDULED demain 08:00)
    const touched = await db.trip.findMany({
      where: { bookings: { some: { bookingReference: { startsWith: "NZK-2026-DEMO" } } } },
      select: { id: true },
    });
    for (const t of touched) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      await db.trip.update({
        where: { id: t.id },
        data: { status: "SCHEDULED", departureTime: tomorrow, estimatedArrivalTime: new Date(tomorrow.getTime() + 5 * 3600 * 1000) },
      });
    }
    console.log(`✓ ${touched.length} voyage(s) restauré(s) SCHEDULED`);
    console.log("Nettoyage terminé.");
    return;
  }

  // ---------- 1. Utilisateur + passager + fidélité ----------
  const user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    console.error(`Créez d'abord le compte via POST /api/auth/register (${DEMO_EMAIL}).`);
    return;
  }
  let passenger = await db.passenger.findFirst({ where: { userId: user.id } });
  if (!passenger) {
    passenger = await db.passenger.create({
      data: { firstName: user.firstName, lastName: user.lastName, phone: DEMO_PHONE, email: user.email, userId: user.id },
    });
  }
  const account =
    (await db.loyaltyAccount.findUnique({ where: { userId: user.id } })) ??
    (await db.loyaltyAccount.create({ data: { userId: user.id, tier: "BRONZE" } }));

  // ---------- 2. Voyages : 1 passé (ARRIVED) + 1 futur ----------
  const tripPast = (await db.trip.findFirst({
    where: { status: "SCHEDULED", departureTime: { gt: new Date() } },
    orderBy: { departureTime: "asc" },
    include: { route: { include: { originCity: true, destinationCity: true } }, bus: { include: { seatLayout: { include: { seats: true } } } } },
  }))!;
  const tripFuture = (await db.trip.findFirst({
    where: { status: "SCHEDULED", departureTime: { gt: new Date(Date.now() + 2 * D) }, id: { not: tripPast.id } },
    orderBy: { departureTime: "asc" },
    include: { route: { include: { originCity: true, destinationCity: true } }, bus: { include: { seatLayout: { include: { seats: true } } } } },
  }))!;

  const pastDep = new Date(Date.now() - 20 * D);
  pastDep.setHours(8, 0, 0, 0);
  const pastArr = new Date(pastDep.getTime() + tripPast.route.estimatedDurationMinutes * 60 * 1000);
  await db.trip.update({ where: { id: tripPast.id }, data: { departureTime: pastDep, estimatedArrivalTime: pastArr, status: "ARRIVED" } });

  const routeLabel = `${tripPast.route.originCity.name} → ${tripPast.route.destinationCity.name}`;
  console.log(`• voyage passé : ${tripPast.code} (${routeLabel}) → ARRIVED ${pastDep.toISOString().slice(0, 10)}`);
  console.log(`• voyage futur : ${tripFuture.code} (${tripFuture.route.originCity.name} → ${tripFuture.route.destinationCity.name})`);

  // ---------- 3. Réservations passées (3 sièges = 3 voyages, +100 pts chacun) ----------
  const takenPast = await db.seatOccupancy.findMany({ where: { tripId: tripPast.id }, select: { seatId: true } });
  const takenFuture = await db.seatOccupancy.findMany({ where: { tripId: tripFuture.id }, select: { seatId: true } });
  const freePast = tripPast.bus.seatLayout.seats.filter((s) => !takenPast.some((t) => t.seatId === s.id)).slice(0, 3);
  const freeFuture = tripFuture.bus.seatLayout.seats.filter((s) => !takenFuture.some((t) => t.seatId === s.id)).slice(0, 1);

  const monthsAgo = [3, 2, 1]; // étale les dépenses sur 3 mois
  let created = 0;
  for (let i = 0; i < freePast.length; i++) {
    const seat = freePast[i];
    const createdAt = new Date(Date.now() - monthsAgo[i] * 30 * D);
    const b = await db.booking.create({
      data: {
        bookingReference: ref(i + 1),
        tripId: tripPast.id,
        passengerId: passenger.id,
        seatId: seat.id,
        amount: tripPast.price,
        status: "COMPLETED",
        channel: "WEB",
        createdAt,
        updatedAt: createdAt,
      },
    });
    await db.seatOccupancy.create({ data: { tripId: tripPast.id, seatId: seat.id, bookingId: b.id, status: "BOOKED" } });
    await db.payment.create({
      data: { bookingId: b.id, provider: "CASH", amount: tripPast.price, status: "SUCCESS", metadata: `{"tag":"${TAG}"}`, createdAt, updatedAt: createdAt },
    });
    await db.ticket.create({ data: { bookingId: b.id, token: randHex(16), status: "USED", issuedAt: createdAt, checkedAt: pastArr } });
    await db.loyaltyTransaction.create({
      data: { accountId: account.id, type: "EARN", points: 100, reason: "VOYAGE", bookingId: b.id, description: `Voyage ${routeLabel}`, createdAt },
    });
    created++;
  }

  // ---------- 4. Réservation à venir (confirmée + billet VALID) ----------
  if (freeFuture[0]) {
    const seat = freeFuture[0];
    const b = await db.booking.create({
      data: {
        bookingReference: ref(90),
        tripId: tripFuture.id,
        passengerId: passenger.id,
        seatId: seat.id,
        amount: tripFuture.price,
        status: "CONFIRMED",
        channel: "WEB",
      },
    });
    await db.seatOccupancy.create({ data: { tripId: tripFuture.id, seatId: seat.id, bookingId: b.id, status: "BOOKED" } });
    await db.payment.create({ data: { bookingId: b.id, provider: "CASH", amount: tripFuture.price, status: "SUCCESS", metadata: `{"tag":"${TAG}"}` } });
    await db.ticket.create({ data: { bookingId: b.id, token: randHex(16), status: "VALID" } });
    created++;
  }

  // ---------- 5. Évaluation d'un voyage terminé ----------
  const firstPast = await db.booking.findUnique({ where: { bookingReference: ref(1) } });
  if (firstPast && !(await db.tripRating.findUnique({ where: { bookingId: firstPast.id } }))) {
    const scores = { cleanliness: 5, comfort: 4, punctuality: 4, staff: 5, security: 5 };
    const average = Math.round((scores.cleanliness + scores.comfort + scores.punctuality + scores.staff + scores.security) / 5);
    await db.tripRating.create({
      data: { bookingId: firstPast.id, tripId: tripPast.id, userId: user.id, ...scores, average, comment: "Bus confortable, départ à l'heure. Je recommande !" },
    });
  }

  // ---------- 6. Fidélité : bonus + échange approuvé (SILVER) ----------
  const bonus = new Date(Date.now() - 15 * D);
  await db.loyaltyTransaction.create({
    data: { accountId: account.id, type: "ADJUST", points: 700, reason: "ADMIN", description: "Bonus fidélité — lancement de l'espace client", createdAt: bonus },
  });
  const spend = new Date(Date.now() - 5 * D);
  await db.loyaltyTransaction.create({
    data: { accountId: account.id, type: "SPEND", points: 500, reason: "REDUCTION_5", description: "Échange : réduction 5%", createdAt: spend },
  });
  const redemption = await db.redemptionRequest.create({
    data: { userId: user.id, rewardKey: "REDUCTION_5", pointsSpent: 500, status: "APPROVED", promoCode: "NZOKO-DEMO10", decidedAt: spend, createdAt: spend },
  });
  await db.promoCode.create({
    data: { code: "NZOKO-DEMO10", type: "PERCENT", value: 5, label: "Réduction fidélité 5% (démo)", userId: user.id, maxUses: 1, usedCount: 0, expiresAt: new Date(Date.now() + 90 * D), isActive: true },
  });
  const balance = 100 * created + 700 - 500;
  const lifetime = 100 * created + 700;
  const tier = lifetime >= 15000 ? "VIP" : lifetime >= 5000 ? "GOLD" : lifetime >= 1000 ? "SILVER" : "BRONZE";
  await db.loyaltyAccount.update({ where: { id: account.id }, data: { pointsBalance: balance, lifetimePoints: lifetime, tier } });
  console.log(`• fidélité : solde ${balance} pts, cumul ${lifetime} → ${tier}`);

  // ---------- 7. Trajet favori manuel ----------
  await db.favoriteRoute.upsert({
    where: { userId_originCityId_destinationCityId: { userId: user.id, originCityId: tripPast.route.originCityId, destinationCityId: tripPast.route.destinationCityId } },
    update: {},
    create: { userId: user.id, originCityId: tripPast.route.originCityId, destinationCityId: tripPast.route.destinationCityId, isManual: true },
  });

  // ---------- 8. Réclamation avec échange ----------
  const existingComplaint = await db.complaint.findFirst({ where: { userId: user.id } });
  if (!existingComplaint) {
    const complaint = await db.complaint.create({
      data: {
        reference: "NZK-R-2026-DEMO01",
        userId: user.id,
        category: "DELAY",
        subject: "Retard de 45 minutes au départ de Pointe-Noire",
        message: "Bonjour, le bus du 08h00 est parti avec 45 minutes de retard sans annonce. Merci de prévoir une communication.",
        bookingReference: ref(1),
        status: "IN_PROGRESS",
        createdAt: new Date(Date.now() - 10 * D),
      },
    });
    await db.complaintMessage.create({
      data: { complaintId: complaint.id, authorId: null, authorName: "Moi", message: "Bonjour, le bus du 08h00 est parti avec 45 minutes de retard sans annonce. Merci de prévoir une communication.", createdAt: new Date(Date.now() - 10 * D) },
    });
    await db.complaintMessage.create({
      data: { complaintId: complaint.id, authorId: null, isStaff: true, authorName: "Support NZOKO", message: "Bonjour, merci pour votre signalement. Nous prenons en charge votre réclamation et revenons vers vous sous 48 h.", createdAt: new Date(Date.now() - 9 * D) },
    });
  }

  // ---------- 9. Notifications ----------
  const notifCount = await db.notification.count({ where: { userId: user.id } });
  if (notifCount < 3) {
    await db.notification.createMany({
      data: [
        { userId: user.id, title: "Départ dans 2 heures 🚌", message: `Votre voyage ${routeLabel} part bientôt. Présentez-vous 30 min avant.`, type: "WARNING" },
        { userId: user.id, title: "100 points crédités 🎉", message: "Merci pour votre fidélité : +100 points sur votre dernier voyage.", type: "SUCCESS" },
        { userId: user.id, title: "Votre réduction fidélité est prête", message: "Code NZOKO-DEMO10 : -5% à appliquer lors de votre prochaine réservation.", type: "INFO" },
      ],
    });
  }
  void redemption;
  console.log(`✓ ${created} réservations, évaluation, fidélité ${tier} (${balance} pts), réclamation, favori, notifications — prêts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
