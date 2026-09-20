// ============================================================
// NZOKO TRANSPORT — Seed initial (configuration opérationnelle)
// Rôles/permissions, comptes équipe, villes, agences, bus, chauffeurs,
// lignes et voyages des 7 prochains jours. AUCUNE donnée fictive
// (réservations/paiements/dépenses) : démarrage production propre.
// ⚠️ Changez les mots de passe des comptes après la première connexion.
// Exécution : bun prisma/seed.ts
// ============================================================

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const db = new PrismaClient();

const ROLES = [
  { code: "SUPER_ADMIN", name: "Super Administrateur", description: "Accès global à toute la plateforme" },
  { code: "ADMIN", name: "Administrateur", description: "Gestion opérationnelle complète" },
  { code: "AGENCY_MANAGER", name: "Responsable d'agence", description: "Gestion de son agence uniquement" },
  { code: "AGENT", name: "Agent de guichet", description: "Vente et encaissement au guichet" },
  { code: "CHECKER", name: "Contrôleur embarquement", description: "Scan QR et contrôle des billets" },
  { code: "ACCOUNTANT", name: "Comptable", description: "Finances, dépenses et rapports" },
  { code: "DRIVER", name: "Chauffeur", description: "Consultation de ses voyages" },
  { code: "SUPPORT", name: "Support client", description: "Assistance aux clients" },
  { code: "PASSENGER", name: "Client NZOKO", description: "Espace client : billets, fidélité, réclamations" },
];

const PERMISSIONS: { code: string; name: string }[] = [
  { code: "agency:manage", name: "Gérer les agences" },
  { code: "agency:read", name: "Consulter les agences" },
  { code: "user:manage", name: "Gérer les utilisateurs" },
  { code: "user:read", name: "Consulter les utilisateurs" },
  { code: "role:read", name: "Consulter les rôles" },
  { code: "city:manage", name: "Gérer les villes" },
  { code: "city:read", name: "Consulter les villes" },
  { code: "route:manage", name: "Gérer les routes" },
  { code: "route:read", name: "Consulter les routes" },
  { code: "bus:manage", name: "Gérer les bus" },
  { code: "bus:read", name: "Consulter les bus" },
  { code: "driver:manage", name: "Gérer les chauffeurs" },
  { code: "driver:read", name: "Consulter les chauffeurs" },
  { code: "seatlayout:manage", name: "Gérer les configurations de sièges" },
  { code: "seatlayout:read", name: "Consulter les configurations" },
  { code: "trip:manage", name: "Gérer les voyages" },
  { code: "trip:read", name: "Consulter les voyages" },
  { code: "booking:manage", name: "Gérer les réservations" },
  { code: "booking:read", name: "Consulter les réservations" },
  { code: "booking:create", name: "Créer des réservations" },
  { code: "payment:manage", name: "Gérer les paiements" },
  { code: "payment:read", name: "Consulter les paiements" },
  { code: "payment:cash-collect", name: "Encaisser les paiements espèces" },
  { code: "ticket:read", name: "Consulter les billets" },
  { code: "checker:scan", name: "Scanner les billets" },
  { code: "finance:read", name: "Consulter les finances" },
  { code: "expense:manage", name: "Gérer les dépenses" },
  { code: "expense:read", name: "Consulter les dépenses" },
  { code: "transaction:read", name: "Consulter les transactions" },
  { code: "report:read", name: "Consulter les rapports" },
  { code: "notification:read", name: "Consulter les notifications" },
  { code: "audit:read", name: "Consulter le journal d'audit" },
  { code: "security:read", name: "Consulter le journal de sécurité" },
  { code: "stats:global", name: "Statistiques globales" },
  { code: "stats:agency", name: "Statistiques d'agence" },
  // V3 — base de connaissances de l'assistant IA (sans cette permission en
  // base, l'onglet admin « Base IA » est invisible — bug vu en Task 30)
  { code: "kb:manage", name: "Gérer la base de connaissances IA" },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.code),
  ADMIN: [
    "agency:read", "user:manage", "user:read", "role:read",
    "city:manage", "city:read", "route:manage", "route:read",
    "bus:manage", "bus:read", "driver:manage", "driver:read",
    "seatlayout:manage", "seatlayout:read", "trip:manage", "trip:read",
    "booking:manage", "booking:read", "booking:create",
    "payment:manage", "payment:read", "payment:cash-collect", "ticket:read",
    "finance:read", "expense:manage", "expense:read", "transaction:read",
    "report:read", "notification:read", "audit:read", "security:read",
    "stats:global", "stats:agency", "kb:manage",
  ],
  AGENCY_MANAGER: [
    "agency:read", "user:read", "city:read", "route:read", "bus:read",
    "driver:manage", "driver:read", "seatlayout:read", "trip:manage", "trip:read",
    "booking:manage", "booking:read", "booking:create",
    "payment:read", "payment:cash-collect", "ticket:read",
    "finance:read", "expense:manage", "expense:read", "transaction:read",
    "report:read", "notification:read", "audit:read", "stats:agency",
  ],
  AGENT: ["city:read", "route:read", "trip:read", "booking:read", "booking:create", "payment:cash-collect", "ticket:read", "notification:read"],
  CHECKER: ["trip:read", "booking:read", "ticket:read", "checker:scan", "notification:read"],
  ACCOUNTANT: ["agency:read", "city:read", "route:read", "booking:read", "payment:read", "ticket:read", "finance:read", "expense:manage", "expense:read", "transaction:read", "report:read", "notification:read", "audit:read", "stats:agency", "stats:global"],
  DRIVER: ["trip:read", "booking:read", "ticket:read", "notification:read"],
  SUPPORT: ["booking:read", "trip:read", "city:read", "route:read", "notification:read"],
  // Espace client : auto-service strict — les routes /api/client/* vérifient
  // le rôle PASSENGER (données personnelles), pas ces permissions.
  PASSENGER: ["booking:create", "notification:read"],
};

// ---------- Générateurs ----------
const ref = (len: number): string => {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
};
const tripCode = () => `TRP-${ref(6)}`;

function at(dateStr: string, hour: number, minute = 0): Date {
  return new Date(`${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+01:00`);
}
function dateStr(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400_000 + 3600_000);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  console.log("🌱 Seed NZOKO TRANSPORT — démarrage…");

  // ---------- Purge ----------
  // Espace client & fidélité (Task ID 10) : purge complète pour installs fraîches
  // Modèles V3+ AVANT les parents FK, sinon P2003 sur city.deleteMany
  // (neighborhood→city) et driver.deleteMany (trackingSession→driver)
  // dès qu'une base V3 existe déjà (bug vu en Task 30).
  await db.gpsPoint.deleteMany(); // enfant de TrackingSession
  await db.trackingSession.deleteMany(); // enfant de Driver
  await db.aIQuestionLog.deleteMany(); // ⚠️ Prisma : model AIQuestionLog → db.aIQuestionLog
  await db.knowledgeBase.deleteMany();
  await db.neighborhood.deleteMany(); // enfant de City
  await db.complaintMessage.deleteMany();
  await db.complaint.deleteMany();
  await db.tripRating.deleteMany();
  await db.redemptionRequest.deleteMany();
  await db.promoCode.deleteMany();
  await db.loyaltyTransaction.deleteMany();
  await db.loyaltyAccount.deleteMany();
  await db.favoriteRoute.deleteMany();
  await db.otpCode.deleteMany();
  await db.securityLog.deleteMany();
  await db.auditLog.deleteMany();
  await db.notification.deleteMany();
  await db.expense.deleteMany();
  await db.transaction.deleteMany();
  await db.ticket.deleteMany();
  await db.seatOccupancy.deleteMany();
  await db.payment.deleteMany();
  await db.booking.deleteMany();
  await db.passenger.deleteMany();
  await db.trip.deleteMany();
  await db.driver.deleteMany();
  await db.bus.deleteMany();
  await db.routeStop.deleteMany();
  await db.route.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.rolePermission.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
  await db.agency.deleteMany();
  await db.seat.deleteMany();
  await db.seatLayout.deleteMany();
  await db.city.deleteMany();

  // ---------- Villes (Congo-Brazzaville) ----------
  const cityData = [
    { name: "Pointe-Noire", country: "CG" },
    { name: "Brazzaville", country: "CG" },
    { name: "Dolisie", country: "CG" },
    { name: "Nkayi", country: "CG" },
    { name: "Ouesso", country: "CG" },
    { name: "Gamboma", country: "CG" },
    { name: "Owando", country: "CG" },
  ];
  const cities = new Map<string, string>();
  for (const c of cityData) {
    const city = await db.city.create({ data: c });
    cities.set(c.name, city.id);
  }
  console.log(`✓ ${cityData.length} villes`);

  // ---------- Agences ----------
  const agencyPN = await db.agency.create({
    data: {
      code: "PNR-CENTRE",
      name: "NZOKO Pointe-Noire Centre",
      cityId: cities.get("Pointe-Noire")!,
      address: "Boulevard Charles de Gaulle, Pointe-Noire",
      phone: "+242 06 123 45 67",
      email: "pointenoire@nzoko.cg",
    },
  });
  const agencyBZV = await db.agency.create({
    data: {
      code: "BZV-CENTRE",
      name: "NZOKO Brazzaville Centre",
      cityId: cities.get("Brazzaville")!,
      address: "Avenue Marien Ngouabi, Brazzaville",
      phone: "+242 06 765 43 21",
      email: "brazzaville@nzoko.cg",
    },
  });
  console.log("✓ 2 agences");

  // ---------- Configurations de sièges ----------
  async function createLayout(name: string, rows: number, columns: number, aisleAfter: number, vipRows: number[], description: string) {
    const layout = await db.seatLayout.create({ data: { name, rows, columns, aisleAfter, description } });
    const letters = "ABCDEFGH".slice(0, columns).split("");
    let num = 1;
    for (let r = 1; r <= rows; r++) {
      for (let c = 0; c < columns; c++) {
        await db.seat.create({
          data: {
            seatLayoutId: layout.id,
            seatNumber: String(num).padStart(2, "0"),
            row: r,
            column: letters[c],
            type: vipRows.includes(r) ? "VIP" : "STANDARD",
          },
        });
        num++;
      }
    }
    return layout;
  }

  const layoutStandard = await createLayout("Standard 2+2 (40 places)", 10, 4, 2, [1], "Classique : 2+2 avec rangée 1 VIP");
  const layoutVip = await createLayout("VIP 1+2 (24 places)", 8, 3, 1, [1, 2, 3, 4], "Classe affaires : 1+2, rangées 1-4 VIP");
  const layoutMini = await createLayout("Minibus 2+2 (28 places)", 7, 4, 2, [], "Minibus interurbain");
  console.log("✓ 3 configurations de sièges");

  // ---------- Bus ----------
  const busData = [
    { registrationNumber: "PN-4521-AB", brand: "Toyota", model: "Hiace Luxury", year: 2022, layout: layoutMini, agency: agencyPN },
    { registrationNumber: "PN-7834-CD", brand: "Yutong", model: "ZK6122H", year: 2021, layout: layoutStandard, agency: agencyPN },
    { registrationNumber: "PN-1192-EF", brand: "Yutong", model: "ZK6122H", year: 2023, layout: layoutStandard, agency: agencyPN },
    { registrationNumber: "PN-9900-GH", brand: "Higer", model: "KLQ6119", year: 2024, layout: layoutVip, agency: agencyPN },
    { registrationNumber: "BZ-3341-IJ", brand: "Golden Dragon", model: "XML6957", year: 2022, layout: layoutStandard, agency: agencyBZV },
    { registrationNumber: "BZ-6675-KL", brand: "Yutong", model: "ZK6105", year: 2020, layout: layoutStandard, agency: agencyBZV },
    { registrationNumber: "BZ-8809-MN", brand: "Higer", model: "KLQ6125", year: 2023, layout: layoutVip, agency: agencyBZV },
  ];
  const buses = new Map<string, { id: string; capacity: number; agencyId: string; seats: { id: string; seatNumber: string; type: string }[] }>();
  for (const b of busData) {
    const seats = await db.seat.findMany({ where: { seatLayoutId: b.layout.id }, orderBy: { seatNumber: "asc" } });
    const bus = await db.bus.create({
      data: {
        registrationNumber: b.registrationNumber,
        brand: b.brand,
        model: b.model,
        year: b.year,
        capacity: seats.length,
        status: "ACTIVE",
        agencyId: b.agency.id,
        seatLayoutId: b.layout.id,
      },
    });
    buses.set(bus.id, { id: bus.id, capacity: seats.length, agencyId: bus.agencyId, seats });
  }
  console.log(`✓ ${busData.length} bus`);

  // ---------- Chauffeurs ----------
  const driverData = [
    { firstName: "Jean-Félix", lastName: "Mabiala", phone: "+242 06 111 22 33", license: "CG-PC-19871", userId: null as string | null },
    { firstName: "Michel", lastName: "Ngoma", phone: "+242 06 222 33 44", license: "CG-PC-20512", userId: null as string | null },
    { firstName: "Alain", lastName: "Loemba", phone: "+242 06 333 44 55", license: "CG-PC-22980", userId: null as string | null },
    { firstName: "Sylvain", lastName: "Tchibamba", phone: "+242 06 444 55 66", license: "CG-BZ-18700", userId: null as string | null },
    { firstName: "Guy-Roger", lastName: "Moussavou", phone: "+242 06 555 66 77", license: "CG-BZ-19235", userId: null as string | null },
    { firstName: "Firmin", lastName: "Bakala", phone: "+242 06 666 77 88", license: "CG-BZ-20114", userId: null as string | null },
  ];
  const drivers: { id: string; agencyId: string }[] = [];
  for (let i = 0; i < driverData.length; i++) {
    const agency = i < 3 ? agencyPN : agencyBZV;
    const created = await db.driver.create({
      data: {
        firstName: driverData[i].firstName,
        lastName: driverData[i].lastName,
        phone: driverData[i].phone,
        licenseNumber: driverData[i].license,
        agencyId: agency.id,
        status: "AVAILABLE",
      },
    });
    drivers.push({ id: created.id, agencyId: agency.id });
  }

  // ---------- Rôles & permissions ----------
  const permissionIds = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const perm = await db.permission.create({ data: p });
    permissionIds.set(p.code, perm.id);
  }
  const roleIds = new Map<string, string>();
  for (const r of ROLES) {
    const role = await db.role.create({ data: r });
    roleIds.set(r.code, role.id);
    for (const code of ROLE_PERMISSIONS[r.code]) {
      await db.rolePermission.create({
        data: { roleId: role.id, permissionId: permissionIds.get(code)! },
      });
    }
  }
  console.log(`✓ ${ROLES.length} rôles / ${PERMISSIONS.length} permissions`);

  // ---------- Comptes de l'équipe (⚠️ mots de passe à changer après 1re connexion) ----------
  // Téléphones DISTINCTS et normalisés E.164 digits — User.phone est UNIQUE
  // en base (clé OTP/récupération), un numéro partagé ferait échouer le seed.
  const teamUsers = [
    { email: "superadmin@nzoko.cg", password: "Nzoko@2026!", firstName: "Aimé", lastName: "Directeur", role: "SUPER_ADMIN", agencyId: null, phone: "242061000000" },
    { email: "admin@nzoko.cg", password: "Admin@2026!", firstName: "Clarisse", lastName: "Opérée", role: "ADMIN", agencyId: null, phone: "242061000001" },
    { email: "manager.pn@nzoko.cg", password: "Manager@2026!", firstName: "Hervé", lastName: "Responsable", role: "AGENCY_MANAGER", agencyId: agencyPN.id, phone: "242061000002" },
    { email: "agent.pn@nzoko.cg", password: "Agent@2026!", firstName: "Bénédicte", lastName: "Guichet", role: "AGENT", agencyId: agencyPN.id, phone: "242061000003" },
    { email: "checker.pn@nzoko.cg", password: "Checker@2026!", firstName: "Wilfried", lastName: "Contrôleur", role: "CHECKER", agencyId: agencyPN.id, phone: "242061000004" },
    { email: "comptable@nzoko.cg", password: "Compta@2026!", firstName: "Flore", lastName: "Comptable", role: "ACCOUNTANT", agencyId: null, phone: "242061000005" },
    { email: "chauffeur.jean@nzoko.cg", password: "Chauffeur@2026!", firstName: "Jean-Félix", lastName: "Mabiala", role: "DRIVER", agencyId: agencyPN.id, phone: "242061000006" },
    { email: "support@nzoko.cg", password: "Support@2026!", firstName: "Léa", lastName: "Assistance", role: "SUPPORT", agencyId: null, phone: "242061000007" },
  ];
  // AUCUN compte client de démo : les clients s'inscrivent eux-mêmes
  // (POST /api/auth/register ou OTP) — zéro donnée fictive.
  const users = new Map<string, string>();
  for (const u of teamUsers) {
    const user = await db.user.create({
      data: {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        passwordHash: await bcrypt.hash(u.password, 12),
        roleId: roleIds.get(u.role)!,
        agencyId: u.agencyId,
        isActive: true,
        phone: u.phone,
      },
    });
    users.set(u.role, user.id);
  }
  // Lien chauffeur ↔ compte (Jean-Félix = premier chauffeur)
  await db.driver.update({
    where: { id: drivers[0].id },
    data: { userId: users.get("DRIVER")! },
  });
  console.log(`✓ ${teamUsers.length} comptes équipe`);

  // ---------- Routes ----------
  async function createRoute(origin: string, dest: string, distanceKm: number, durationMin: number, basePrice: number, stops: { city: string; minutes: number }[]) {
    const route = await db.route.create({
      data: {
        code: `${origin.slice(0, 2).toUpperCase()}-${dest.slice(0, 2).toUpperCase()}-${ref(3)}`,
        originCityId: cities.get(origin)!,
        destinationCityId: cities.get(dest)!,
        distanceKm,
        estimatedDurationMinutes: durationMin,
        basePrice,
      },
    });
    for (let i = 0; i < stops.length; i++) {
      await db.routeStop.create({
        data: {
          routeId: route.id,
          cityId: cities.get(stops[i].city)!,
          position: i,
          minutesFromStart: stops[i].minutes,
        },
      });
    }
    return route;
  }

  const routePNR_BZV = await createRoute("Pointe-Noire", "Brazzaville", 535, 600, 18000, [
    { city: "Dolisie", minutes: 180 },
    { city: "Nkayi", minutes: 300 },
  ]);
  const routeBZV_PNR = await createRoute("Brazzaville", "Pointe-Noire", 535, 600, 18000, [
    { city: "Nkayi", minutes: 150 },
    { city: "Dolisie", minutes: 420 },
  ]);
  const routePNR_DOL = await createRoute("Pointe-Noire", "Dolisie", 165, 210, 7000, []);
  await createRoute("Dolisie", "Brazzaville", 370, 400, 13000, [{ city: "Nkayi", minutes: 120 }]);
  await createRoute("Brazzaville", "Ouesso", 830, 900, 30000, [
    { city: "Owando", minutes: 420 },
  ]);
  const routeBZV_PNM = await createRoute("Brazzaville", "Gamboma", 250, 270, 9000, []);
  console.log("✓ 6 routes");

  // ---------- Voyages planifiés (aujourd'hui + 7 jours) ----------
  interface TripTemplate { route: typeof routePNR_BZV; hour: number; minute: number; agencyId: string; busIds: string[]; driverIdx: number[] }
  const templates: TripTemplate[] = [
    { route: routePNR_BZV, hour: 6, minute: 30, agencyId: agencyPN.id, busIds: [...buses.keys()].filter((id) => buses.get(id)!.agencyId === agencyPN.id), driverIdx: [0, 1, 2] },
    { route: routePNR_BZV, hour: 14, minute: 0, agencyId: agencyPN.id, busIds: [...buses.keys()].filter((id) => buses.get(id)!.agencyId === agencyPN.id), driverIdx: [1, 2, 0] },
    { route: routeBZV_PNR, hour: 6, minute: 30, agencyId: agencyBZV.id, busIds: [...buses.keys()].filter((id) => buses.get(id)!.agencyId === agencyBZV.id), driverIdx: [3, 4, 5] },
    { route: routeBZV_PNR, hour: 14, minute: 0, agencyId: agencyBZV.id, busIds: [...buses.keys()].filter((id) => buses.get(id)!.agencyId === agencyBZV.id), driverIdx: [4, 5, 3] },
    { route: routePNR_DOL, hour: 8, minute: 0, agencyId: agencyPN.id, busIds: [...buses.keys()].filter((id) => buses.get(id)!.agencyId === agencyPN.id).slice(0, 1), driverIdx: [0] },
    { route: routeBZV_PNM, hour: 9, minute: 30, agencyId: agencyBZV.id, busIds: [...buses.keys()].filter((id) => buses.get(id)!.agencyId === agencyBZV.id).slice(0, 1), driverIdx: [3] },
  ];

  const now = new Date();
  let createdTrips = 0;

  for (let day = 0; day <= 7; day++) {
    const dStr = dateStr(day);

    for (let t = 0; t < templates.length; t++) {
      const tpl = templates[t];
      const busId = tpl.busIds[t % tpl.busIds.length];
      const busInfo = buses.get(busId!)!;
      const driver = drivers[tpl.driverIdx[t % tpl.driverIdx.length]];
      const departure = at(dStr, tpl.hour, tpl.minute);
      const arrival = new Date(departure.getTime() + tpl.route.estimatedDurationMinutes * 60_000);

      // Aujourd'hui : seulement les départs futurs
      if (day === 0 && departure < now) continue;

      const price = tpl.route.basePrice + (t === 0 ? 2000 : 0); // yield léger

      await db.trip.create({
        data: {
          code: tripCode(),
          routeId: tpl.route.id,
          busId: busInfo.id,
          driverId: driver.id,
          agencyId: tpl.agencyId,
          departureTime: departure,
          estimatedArrivalTime: arrival,
          price,
          status: "SCHEDULED",
        },
      });
      createdTrips++;
    }
  }
  console.log(`✓ ${createdTrips} voyages planifiés (7 jours)`);

  // ---------- Notifications ----------
  await db.notification.createMany({
    data: [
      { userId: users.get("SUPER_ADMIN")!, title: "Bienvenue sur NZOKO", message: "La plateforme est initialisée et prête pour l'exploitation.", type: "INFO" },
      { userId: users.get("SUPER_ADMIN")!, title: "Configuration MTN MoMo", message: "Renseignez les clés MOMO_* dans le fichier .env pour activer les paiements Mobile Money (voir README-MOMO.md).", type: "WARNING" },
      { userId: users.get("AGENCY_MANAGER")!, title: "Départs du jour", message: "Vérifiez l'affectation des bus pour les départs de ce soir.", type: "INFO" },
    ],
  });

  // ---------- Journal d'audit initial ----------
  await db.auditLog.create({
    data: { userId: users.get("SUPER_ADMIN")!, action: "SEED_EXECUTED", entity: "System", metadata: JSON.stringify({ version: "1.0.0" }) },
  });

  console.log("🌱 Seed terminé avec succès !");
  console.log("──────────────────────────────────────────────────");
  console.log("🔑 COMPTES ÉQUIPE (⚠️ changez les mots de passe après la 1re connexion) :");
  console.log("  superadmin@nzoko.cg     / Nzoko@2026!   (SUPER_ADMIN)");
  console.log("  admin@nzoko.cg          / Admin@2026!    (ADMIN)");
  console.log("  manager.pn@nzoko.cg     / Manager@2026!  (AGENCY_MANAGER — Pointe-Noire)");
  console.log("  agent.pn@nzoko.cg       / Agent@2026!    (AGENT — Pointe-Noire)");
  console.log("  checker.pn@nzoko.cg     / Checker@2026!  (CHECKER — Pointe-Noire)");
  console.log("  comptable@nzoko.cg      / Compta@2026!   (ACCOUNTANT)");
  console.log("  chauffeur.jean@nzoko.cg / Chauffeur@2026! (DRIVER)");
  console.log("  support@nzoko.cg        / Support@2026!  (SUPPORT)");
  console.log("──────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("❌ Échec du seed :", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
