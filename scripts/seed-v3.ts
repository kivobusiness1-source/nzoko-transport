// ============================================================
// NZOKO TRANSPORT — SEED V3 (idempotent)
// Architecture géographique multi-agences :
//   City (slug + GPS) → Neighborhood (quartiers PN/BZV)
//   → Agency (quartier + GPS + horaires + manager)
//   → Bus + Trips (départs multi-agences réalistes 12 jours)
//   → Ticket.boardingNumber (backfill billets existants)
//   → KnowledgeBase (FAQ officielle de l'assistant IA)
// Exécution : bun scripts/seed-v3.ts
// ============================================================

import { db } from "../src/lib/db";
import { generateBoardingNumber, generateTripCode } from "../src/lib/security";

// ---------- Slugs sûrs ----------
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const now = new Date();

  // ============================================================
  // 1. VILLES — slug + coordonnées GPS (centre réel approximatif)
  // ============================================================
  const cityCoords: Record<string, { lat: number; lng: number }> = {
    "Pointe-Noire": { lat: -4.7761, lng: 11.8435 },
    Brazzaville: { lat: -4.2694, lng: 15.2747 },
    Dolisie: { lat: -4.2, lng: 12.6667 },
    Nkayi: { lat: -4.1833, lng: 13.2833 },
    Ouesso: { lat: 1.6167, lng: 16.05 },
    Gamboma: { lat: -0.85, lng: 15.0 },
    Owando: { lat: -0.9333, lng: 15.9 },
  };
  for (const [name, { lat, lng }] of Object.entries(cityCoords)) {
    await db.city.updateMany({
      where: { name, country: "CG" },
      data: { slug: slugify(name), latitude: lat, longitude: lng },
    });
  }
  const cities = await db.city.findMany();
  const cityByName = new Map(cities.map((c) => [c.name, c]));
  console.log(`✓ Villes : ${cities.length} mises à jour (slug + GPS)`);

  // ============================================================
  // 2. QUARTIERS — Pointe-Noire & Brazzaville
  // ============================================================
  const hoods: { city: string; name: string; lat: number; lng: number; radius: number }[] = [
    // Pointe-Noire
    { city: "Pointe-Noire", name: "Centre-ville", lat: -4.7787, lng: 11.8437, radius: 2000 },
    { city: "Pointe-Noire", name: "Tié-Tié", lat: -4.7517, lng: 11.867, radius: 2500 },
    { city: "Pointe-Noire", name: "Loandjili", lat: -4.7142, lng: 11.9042, radius: 2500 },
    { city: "Pointe-Noire", name: "Ngoyo", lat: -4.7586, lng: 11.8794, radius: 2500 },
    { city: "Pointe-Noire", name: "Mongo-Mpoukou", lat: -4.9206, lng: 11.9028, radius: 3000 },
    { city: "Pointe-Noire", name: "Mvou-Mvou", lat: -4.7928, lng: 11.8397, radius: 2000 },
    // Brazzaville
    { city: "Brazzaville", name: "Centre-ville (Plateau)", lat: -4.2694, lng: 15.2747, radius: 1500 },
    { city: "Brazzaville", name: "Poto-Poto", lat: -4.2594, lng: 15.2725, radius: 2000 },
    { city: "Brazzaville", name: "Bacongo", lat: -4.2869, lng: 15.2583, radius: 2500 },
    { city: "Brazzaville", name: "Moungali", lat: -4.2517, lng: 15.2717, radius: 2000 },
    { city: "Brazzaville", name: "Ouenzé", lat: -4.2447, lng: 15.2625, radius: 2000 },
    { city: "Brazzaville", name: "Talangaï", lat: -4.2361, lng: 15.2594, radius: 2500 },
    { city: "Brazzaville", name: "Makélékélé", lat: -4.3011, lng: 15.2567, radius: 2500 },
    { city: "Brazzaville", name: "Madibou", lat: -4.3164, lng: 15.2883, radius: 2500 },
    { city: "Brazzaville", name: "Mfilou", lat: -4.2969, lng: 15.2244, radius: 3000 },
  ];
  const hoodBySlug = new Map<string, { id: string; name: string }>();
  for (const h of hoods) {
    const city = cityByName.get(h.city);
    if (!city) continue;
    const slug = slugify(h.name);
    const existing = await db.neighborhood.findFirst({ where: { cityId: city.id, slug } });
    const row = existing
      ? await db.neighborhood.update({
          where: { id: existing.id },
          data: { name: h.name, latitude: h.lat, longitude: h.lng, radiusMeters: h.radius, isActive: true },
        })
      : await db.neighborhood.create({
          data: { cityId: city.id, name: h.name, slug, latitude: h.lat, longitude: h.lng, radiusMeters: h.radius },
        });
    hoodBySlug.set(`${h.city}/${slug}`, { id: row.id, name: row.name });
  }
  console.log(`✓ Quartiers : ${hoodBySlug.size} (Pointe-Noire + Brazzaville)`);

  // ============================================================
  // 3. AGENCES — mise à jour des 2 existantes + 7 nouvelles
  // ============================================================
  const managerPn = await db.user.findUnique({ where: { email: "manager.pn@nzoko.cg" } });
  const managerBzv = await db.user.findUnique({ where: { email: "admin@nzoko.cg" } });

  const agencySpecs = [
    {
      code: "PNR-CENTRE", name: "NZOKO Pointe-Noire Centre-ville", city: "Pointe-Noire", hood: "Centre-ville",
      lat: -4.7787, lng: 11.8437, phone: "+242055550101", address: "Boulevard Charles de Gaulle, face à la Place du Centre",
      desc: "Agence principale de Pointe-Noire — vente au guichet, espèces et Mobile Money, salle d'attente climatisée.",
      open: "05:30", close: "20:30", managerId: managerPn?.id,
    },
    {
      code: "PNR-TIETIE", name: "NZOKO Agence Tié-Tié", city: "Pointe-Noire", hood: "Tié-Tié",
      lat: -4.7517, lng: 11.867, phone: "+242055550102", address: "Avenue de la Paix, marché de Tié-Tié",
      desc: "Agence de quartier au cœur de Tié-Tié — idéale pour les passagers du centre-est.",
      open: "06:00", close: "19:30", managerId: null,
    },
    {
      code: "PNR-LOANDJILI", name: "NZOKO Agence Loandjili", city: "Pointe-Noire", hood: "Loandjili",
      lat: -4.7142, lng: 11.9042, phone: "+242055550103", address: "Route nationale, carrefour Loandjili",
      desc: "Agence de l'est de Pointe-Noire — départ direct vers la RN1.",
      open: "06:00", close: "19:00", managerId: null,
    },
    {
      code: "PNR-NGOYO", name: "NZOKO Agence Ngoyo", city: "Pointe-Noire", hood: "Ngoyo",
      lat: -4.7586, lng: 11.8794, phone: "+242055550104", address: "Boulevard de l'Aéroport, Ngoyo",
      desc: "Agence proche de l'aéroport — service VIP, navette de correspondance.",
      open: "06:00", close: "19:00", managerId: null,
    },
    {
      code: "PNR-MONGO", name: "NZOKO Agence Mongo-Mpoukou", city: "Pointe-Noire", hood: "Mongo-Mpoukou",
      lat: -4.9206, lng: 11.9028, phone: "+242055550105", address: "Route de Diosso, Mongo-Mpoukou",
      desc: "Agence du nord de Pointe-Noire — parking gratuit sécurisé.",
      open: "06:30", close: "18:30", managerId: null,
    },
    {
      code: "BZV-CENTRE", name: "NZOKO Brazzaville Centre (Plateau)", city: "Brazzaville", hood: "Centre-ville (Plateau)",
      lat: -4.2694, lng: 15.2747, phone: "+242055550201", address: "Boulevard Denis Sassou N'Guesso, Plateau",
      desc: "Agence principale de Brazzaville — guichets, espèces et Mobile Money.",
      open: "05:30", close: "20:30", managerId: managerBzv?.id,
    },
    {
      code: "BZV-POTOPOTO", name: "NZOKO Agence Poto-Poto", city: "Brazzaville", hood: "Poto-Poto",
      lat: -4.2594, lng: 15.2725, phone: "+242055550202", address: "Avenue de la Liberté, Poto-Poto",
      desc: "Agence centrale de Poto-Poto — à 5 min du Plateau.",
      open: "06:00", close: "19:30", managerId: null,
    },
    {
      code: "BZV-BACONGO", name: "NZOKO Agence Bacongo", city: "Brazzaville", hood: "Bacongo",
      lat: -4.2869, lng: 15.2583, phone: "+242055550203", address: "Boulevard Maréchal Lyautey, Bacongo",
      desc: "Agence du sud de Brazzaville — vente au guichet et retrait de billets.",
      open: "06:00", close: "19:00", managerId: null,
    },
    {
      code: "BZV-TALANGAI", name: "NZOKO Agence Talangaï", city: "Brazzaville", hood: "Talangaï",
      lat: -4.2361, lng: 15.2594, phone: "+242055550204", address: "Avenue de l'Oubangui, Talangaï",
      desc: "Agence du nord de Brazzaville — départ direct vers la RN2.",
      open: "06:00", close: "19:00", managerId: null,
    },
  ];

  const agencyByCode = new Map<string, string>();
  for (const spec of agencySpecs) {
    const city = cityByName.get(spec.city);
    const hood = hoodBySlug.get(`${spec.city}/${slugify(spec.hood)}`);
    if (!city) continue;
    const data = {
      name: spec.name,
      cityId: city.id,
      neighborhoodId: hood?.id ?? null,
      address: spec.address,
      phone: spec.phone,
      description: spec.desc,
      latitude: spec.lat,
      longitude: spec.lng,
      openingTime: spec.open,
      closingTime: spec.close,
      managerId: spec.managerId,
      isActive: true,
    };
    const existing = await db.agency.findUnique({ where: { code: spec.code } });
    const row = existing
      ? await db.agency.update({ where: { id: existing.id }, data })
      : await db.agency.create({ data: { code: spec.code, ...data } });
    agencyByCode.set(spec.code, row.id);
  }
  console.log(`✓ Agences : ${agencyByCode.size} (2 existantes enrichies + 7 nouvelles)`);

  // ============================================================
  // 4. BUS — un bus par nouvelle agence
  // ============================================================
  const layouts = await db.seatLayout.findMany();
  const layoutByName = new Map(layouts.map((l) => [l.name, l]));
  const std = layoutByName.get("Standard 2+2 (40 places)");
  const vip = layoutByName.get("VIP 1+2 (24 places)");
  const mini = layoutByName.get("Minibus 2+2 (28 places)");

  const busSpecs = [
    { reg: "PN-5290-QR", agency: "PNR-TIETIE", layout: std?.id, cap: 40 },
    { reg: "PN-6417-ST", agency: "PNR-LOANDJILI", layout: std?.id, cap: 40 },
    { reg: "PN-7703-UV", agency: "PNR-NGOYO", layout: vip?.id, cap: 24 },
    { reg: "PN-8814-WX", agency: "PNR-MONGO", layout: mini?.id, cap: 28 },
    { reg: "BZ-9905-YZ", agency: "BZV-POTOPOTO", layout: std?.id, cap: 40 },
    { reg: "BZ-1126-AB", agency: "BZV-BACONGO", layout: std?.id, cap: 40 },
    { reg: "BZ-2237-CD", agency: "BZV-TALANGAI", layout: mini?.id, cap: 28 },
  ];
  const busByReg = new Map<string, string>();
  for (const b of busSpecs) {
    if (!b.layout) continue;
    const agencyId = agencyByCode.get(b.agency);
    if (!agencyId) continue;
    const existing = await db.bus.findUnique({ where: { registrationNumber: b.reg } });
    const row = existing
      ? await db.bus.update({ where: { id: existing.id }, data: { agencyId, status: "ACTIVE" } })
      : await db.bus.create({
          data: {
            registrationNumber: b.reg,
            brand: "Toyota",
            model: "Hiace Coach",
            year: 2023,
            capacity: b.cap,
            status: "ACTIVE",
            agencyId,
            seatLayoutId: b.layout,
          },
        });
    busByReg.set(b.reg, row.id);
  }
  console.log(`✓ Bus : ${busByReg.size} neufs affectés aux nouvelles agences`);

  // ============================================================
  // 5. VOYAGES — départs multi-agences sur 12 jours
  // ============================================================
  const routes = await db.route.findMany();
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const routeBy = (from: string, to: string) =>
    routes.find((r) => cityById.get(r.originCityId)?.name === from && cityById.get(r.destinationCityId)?.name === to);

  const tripPlan = [
    { agency: "PNR-TIETIE", bus: "PN-5290-QR", from: "Pointe-Noire", to: "Brazzaville", hour: 7, minute: 30 },
    { agency: "PNR-LOANDJILI", bus: "PN-6417-ST", from: "Pointe-Noire", to: "Brazzaville", hour: 14, minute: 0 },
    { agency: "PNR-NGOYO", bus: "PN-7703-UV", from: "Pointe-Noire", to: "Dolisie", hour: 9, minute: 0 },
    { agency: "PNR-MONGO", bus: "PN-8814-WX", from: "Pointe-Noire", to: "Dolisie", hour: 15, minute: 30 },
    { agency: "BZV-POTOPOTO", bus: "BZ-9905-YZ", from: "Brazzaville", to: "Pointe-Noire", hour: 7, minute: 0 },
    { agency: "BZV-BACONGO", bus: "BZ-1126-AB", from: "Brazzaville", to: "Pointe-Noire", hour: 13, minute: 0 },
    { agency: "BZV-TALANGAI", bus: "BZ-2237-CD", from: "Brazzaville", to: "Gamboma", hour: 8, minute: 30 },
  ];

  let tripsCreated = 0;
  const DAYS = 12;
  const plannedRows: {
    code: string; routeId: string; busId: string; agencyId: string;
    departureTime: Date; estimatedArrivalTime: Date; price: number;
  }[] = [];
  for (let d = 1; d <= DAYS; d++) {
    const day = new Date(now.getTime() + d * 24 * 3600 * 1000);
    for (const plan of tripPlan) {
      const route = routeBy(plan.from, plan.to);
      const busId = busByReg.get(plan.bus);
      const agencyId = agencyByCode.get(plan.agency);
      if (!route || !busId || !agencyId) continue;
      const departure = new Date(day);
      departure.setUTCHours(plan.hour - 1, plan.minute, 0, 0); // heure Congo (UTC+1)
      if (departure <= now) continue;
      const arrival = new Date(departure.getTime() + route.estimatedDurationMinutes * 60 * 1000);
      plannedRows.push({
        code: generateTripCode(),
        routeId: route.id,
        busId,
        agencyId,
        departureTime: departure,
        estimatedArrivalTime: arrival,
        price: route.basePrice,
      });
    }
  }
  if (plannedRows.length > 0) {
    // Un seul aller-retour : findMany des doublons bus+date, puis createMany
    const busIds = [...new Set(plannedRows.map((r) => r.busId))];
    const existing = await db.trip.findMany({
      where: { busId: { in: busIds }, status: { in: ["SCHEDULED", "BOARDING"] } },
      select: { busId: true, departureTime: true },
    });
    const seen = new Set(existing.map((t) => `${t.busId}@${t.departureTime.getTime()}`));
    const fresh = plannedRows.filter((r) => !seen.has(`${r.busId}@${r.departureTime.getTime()}`));
    if (fresh.length > 0) {
      await db.trip.createMany({ data: fresh });
      tripsCreated = fresh.length;
    }
  }
  console.log(`✓ Voyages : ${tripsCreated} nouveaux programmés (multi-agences, 12 jours)`);

  // ============================================================
  // 6. BILLETS EXISTANTS — backfill numéro d'embarquement
  // ============================================================
  const tickets = await db.ticket.findMany({ where: { boardingNumber: null } });
  let backfilled = 0;
  for (const t of tickets) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await db.ticket.update({ where: { id: t.id }, data: { boardingNumber: generateBoardingNumber() } });
        backfilled++;
        break;
      } catch {
        // collision unique (improbable) → retry
      }
    }
  }
  console.log(`✓ Numéros d'embarquement : ${backfilled}/${tickets.length} billets backfillés`);

  // ============================================================
  // 7. BASE DE CONNAISSANCES — FAQ officielle de l'assistant
  // ============================================================
  const superadmin = await db.user.findUnique({ where: { email: "superadmin@nzoko.cg" } });
  const pnCity = cityByName.get("Pointe-Noire");
  const bzvCity = cityByName.get("Brazzaville");

  type Faq = {
    title: string; question: string; answer: string; category: string;
    keywords: string; priority?: number; cityId?: string | null;
  };
  const faqs: Faq[] = [
    {
      title: "Réserver un billet en ligne",
      question: "Comment réserver un billet NZOKO ?",
      answer:
        "Rendez-vous sur la page d'accueil puis « Réserver ». Choisissez la ville de départ, la destination et la date : les voyages disponibles s'affichent avec le prix et le nombre de places. Sélectionnez votre siège sur le plan, renseignez nom, prénom et téléphone, puis payez. Aucun compte n'est nécessaire.",
      category: "RESERVATION",
      keywords: "reserver, reserver billet, reserver, acheter, achat, commander, comment reserver, reservation, billet",
      priority: 100,
    },
    {
      title: "Réservation sans compte",
      question: "Puis-je réserver sans créer de compte ?",
      answer:
        "Oui. La réservation en ligne ne demande qu'un nom, un prénom et un numéro de téléphone. Votre billet reste accessible à tout moment via « Suivi billet » avec la référence reçue au moment de la réservation. Un compte client est utile uniquement pour retrouver automatiquement vos voyages, vos points de fidélité et vos réclamations.",
      category: "RESERVATION",
      keywords: "sans compte, compte, inscription, enregistrer, identifiant, connexion obligatoire",
      priority: 90,
    },
    {
      title: "Durée du blocage du siège",
      question: "Combien de temps mon siège est-il réservé ?",
      answer:
        "Lorsque vous choisissez un siège, il est bloqué pour vous pendant 10 minutes, le temps de compléter le paiement. Sans paiement confirmé dans ce délai, la réservation expire et le siège est automatiquement libéré pour les autres passagers.",
      category: "RESERVATION",
      keywords: "duree, minutes, blocage, bloque, verrou, attente, expirer, expiration, combien de temps, siège reserve",
      priority: 80,
    },
    {
      title: "Modifier une réservation",
      question: "Comment modifier ma réservation ?",
      answer:
        "Il n'est pas possible de modifier directement une réservation (date, siège ou nom). Vous pouvez l'annuler depuis « Suivi billet » avec votre référence — avant le départ — puis effectuer une nouvelle réservation. En agence, le guichet peut également vous accompagner pour un réajustement.",
      category: "RESERVATION",
      keywords: "modifier, modification, changer, changer date, changer siege, corriger, transformer",
      priority: 70,
    },
    {
      title: "Retrouver mon billet",
      question: "Comment retrouver mon billet ?",
      answer:
        "Utilisez la rubrique « Suivi billet » du site et saisissez la référence de réservation reçue (format NZK-2026-XXXXXX). Le billet s'affiche avec son QR code et son numéro d'embarquement, prêts à être présentés au contrôle. Vous pouvez aussi le télécharger en PDF pour l'imprimer ou le garder sur votre téléphone.",
      category: "RESERVATION",
      keywords: "retrouver, retrouver mon billet, ou est mon billet, recuperer, suivi, reference, numero de reservation, billet perdu",
      priority: 95,
    },
    {
      title: "Déroulement de l'embarquement",
      question: "Comment se passe l'embarquement ?",
      answer:
        "Présentez-vous à l'agence de départ indiquée sur votre billet au moins 30 minutes avant l'heure de départ. Au contrôle, présentez le QR code de votre billet depuis votre téléphone (ou sa version imprimée). Le contrôleur valide votre embarquement : votre billet passe alors au statut « utilisé » et ne peut plus resservir. Vous pouvez aussi dicter votre numéro d'embarquement NZK-XXXXXX si votre téléphone est déchargé.",
      category: "EMBARQUEMENT",
      keywords: "embarquement, embarquer, monter, controle, monter dans le bus, quai, quai d'embarquement, voyage, depart bus",
      priority: 100,
    },
    {
      title: "Numéro d'embarquement",
      question: "C'est quoi le numéro d'embarquement ?",
      answer:
        "Chaque billet confirmé reçoit un numéro d'embarquement unique au format NZK-XXXXXX (par exemple NZK-8F42K9). Il figure sur votre billet, à côté du QR code. Si vous ne pouvez pas présenter le QR code, donnez simplement ce numéro au contrôleur pour retrouver votre billet.",
      category: "EMBARQUEMENT",
      keywords: "numero d'embarquement, numero embarquement, board, code embarquement, nzk",
      priority: 90,
    },
    {
      title: "Lieu de présentation",
      question: "Où dois-je me présenter pour mon voyage ?",
      answer:
        "Présentez-vous à l'agence de départ indiquée sur votre billet. En réservant en ligne, le bouton « Trouver mon agence » peut détecter votre position et vous proposer l'agence la plus proche avec des places disponibles ; sinon choisissez-la manuellement. L'adresse complète de l'agence figure toujours sur le billet PDF.",
      category: "EMBARQUEMENT",
      keywords: "ou se presenter, ou aller, adresse, agence de depart, lieu, rendez-vous, se presenter",
      priority: 85,
    },
    {
      title: "Retard à l'embarquement",
      question: "Que se passe-t-il si j'arrive en retard ?",
      answer:
        "Le bus part à l'heure indiquée sur le billet. En cas de retard de votre part, contactez rapidement l'agence de départ : selon la disponibilité, votre place peut être réattribuée sur un départ ultérieur, sans garantie. Aucun remboursement automatique n'est dû après le départ du bus.",
      category: "EMBARQUEMENT",
      keywords: "retard, en retard, arrive tard, rater, rate le bus, manquer le bus",
      priority: 60,
    },
    {
      title: "Moyens de paiement",
      question: "Quels moyens de paiement acceptez-vous ?",
      answer:
        "En ligne : MTN Mobile Money (paiement approuvé directement sur votre téléphone). En agence : espèces (francs CFA) et Mobile Money. L'acceptation d'Airtel Money est en cours de déploiement. Nous n'acceptons aucun paiement par carte bancaire pour l'instant, et aucun agent ne vous demandera JAMAIS un code Mobile Money à communiquer à voix haute ou par message.",
      category: "PAIEMENT",
      keywords: "paiement, payer, moyens de paiement, mobile money, momo, mtn, airtel, especes, cash, carte bancaire, cb",
      priority: 100,
    },
    {
      title: "Sécurité du paiement Mobile Money",
      question: "Le paiement Mobile Money est-il sécurisé ?",
      answer:
        "Oui. Vous confirmez le paiement directement dans l'application MTN Mobile Money sur votre téléphone : le code secret ne circule jamais sur notre site. En cas de doute ou de message suspect prétendant venir de NZOKO, ne partagez aucun code et signalez-le à votre agence.",
      category: "PAIEMENT",
      keywords: "securite, securise, arnaque, code momo, code secret, fraude, usurpation",
      priority: 70,
    },
    {
      title: "Annuler une réservation",
      question: "Comment annuler ma réservation ?",
      answer:
        "Depuis « Suivi billet », ouvrez votre réservation avec sa référence et cliquez sur « Annuler ». L'annulation est possible tant que le voyage n'est pas parti. Le siège est immédiatement libéré et le billet est annulé.",
      category: "ANNULATION",
      keywords: "annuler, annulation, resilier, rembourser, desister, je veux annuler",
      priority: 90,
    },
    {
      title: "Politique de remboursement",
      question: "Suis-je remboursé si j'annule ?",
      answer:
        "Si vous avez payé par Mobile Money et que vous annulez avant le départ, le remboursement du montant payé est enregistré et traité par nos équipes sur votre compte Mobile Money. Les paiements en espèces au guichet sont remboursés en espèces à l'agence émettrice, sur présentation du billet. Aucun remboursement après le départ du bus.",
      category: "REMBOURSEMENT",
      keywords: "remboursement, rembourser, rembourse, se faire rembourser, decoller, argent retour, remboursement mobile money",
      priority: 85,
    },
    {
      title: "Franchise bagages",
      question: "Quelle est la franchise bagages ?",
      answer:
        "Chaque passager a droit à un bagage à main (max 10 kg, dimensions cabine) et à un bagage en soute (max 30 kg). L'excédent est facturé selon le tarif en vigueur à l'embarquement. Les marchandises dangereuses, produits inflammables et animaux ne sont pas acceptés, sauf accord préalable de l'agence.",
      category: "BAGAGES",
      keywords: "bagage, bagages, valise, soute, colis, franchise, poids, kilo, kg, excédent, surpoids",
      priority: 80,
    },
    {
      title: "Trouver l'agence la plus proche",
      question: "Où se trouve l'agence NZOKO la plus proche ?",
      answer:
        "Sur le site, cliquez sur « Trouver mon agence » : avec votre autorisation, votre position est utilisée pour détecter votre quartier et vous proposer l'agence ouverte la plus proche avec des places disponibles. Si vous refusez la géolocalisation, vous pouvez choisir votre agence manuellement. Les positions ne sont jamais enregistrées.",
      category: "GPS",
      keywords: "agence la plus proche, ou est l'agence, trouver agence, agence proche, geolocalisation, gps, position, quartier",
      priority: 100,
    },
    {
      title: "Suivi GPS des bus",
      question: "Peut-on suivre les bus en temps réel ?",
      answer:
        "Le suivi GPS est assuré pour les voyages équipés : les chauffeurs actifs transmettent leur position pendant le trajet. Les proches peuvent demander l'état du voyage à l'agence. Le suivi client du bus en temps réel est en déploiement progressif sur les lignes principales.",
      category: "GPS",
      keywords: "suivi, suivre le bus, temps reel, position du bus, ou est le bus, ou est mon bus, gps bus, retard bus, arrivee",
      priority: 75,
    },
    {
      title: "Horaires des départs",
      question: "Quels sont les horaires ?",
      answer:
        "Les horaires dépendent de la ligne, de la date et de l'agence. Utilisez la recherche « Réserver » (départ, destination, date) : tous les départs réellement programmés s'affichent avec leur heure exacte, leur prix et les places restantes. Les départs tôt le matin sont fréquents sur les grandes lignes.",
      category: "HORAIRES",
      keywords: "horaire, horaires, heures, heure de depart, a quelle heure, quand part, depart, planning, programme",
      priority: 90,
    },
    {
      title: "Prix affiché et prix final",
      question: "Le prix affiché est-il le prix final ?",
      answer:
        "Oui. Le prix affiché lors de la recherche est celui enregistré à la réservation : le montant est figé sur votre billet, sans frais cachés. Le prix peut varier selon la ligne, la date et la catégorie du bus (standard ou VIP), mais jamais après votre réservation.",
      category: "TARIFS",
      keywords: "prix, tarif, tarifs, cout, combien, cher, frais, prix final, augmentation, francs, fcfa, xaf",
      priority: 90,
    },
    {
      title: "Billets et classes VIP",
      question: "Y a-t-il des bus VIP ?",
      answer:
        "Oui. Certains bus disposent de sièges VIP plus spacieux (configuration 1+2). Ils sont identifiables sur le plan de sièges lors de la réservation et facturés au tarif en vigueur. Les buses standards offrent la configuration 2+2.",
      category: "SERVICES",
      keywords: "vip, siege vip, classe vip, confort, bus vip, premium, executive",
      priority: 60,
    },
    {
      title: "Programme de fidélité",
      question: "Comment fonctionne le programme de fidélité ?",
      answer:
        "Créez un compte client et voyagez : chaque voyage payé vous rapporte 100 points. Les paliers : BRONZE dès 0 point, SILVER à 1 000 points, GOLD à 5 000 points et VIP à 15 000 points cumulés. Vos points sont ensuite échangeables contre des réductions (jusqu'à 10 %) ou des billets gratuits, sur validation de l'équipe NZOKO.",
      category: "FIDELITE",
      keywords: "fidelite, fidele, points, fidélité, cumul, palier, bronze, silver, gold, vip palier, reduction, recompense, carte fidelite",
      priority: 85,
    },
    {
      title: "Utiliser mes points de fidélité",
      question: "Comment utiliser mes points de fidélité ?",
      answer:
        "Dans votre espace client, rubrique fidélité : choisissez une récompense (réduction 5 % ou 10 %, ou billet gratuit selon votre solde) et confirmez la demande. Après validation par nos équipes, un code promotionnel vous est attribué, à saisir lors d'une prochaine réservation.",
      category: "FIDELITE",
      keywords: "utiliser points, depenser points, echanger points, recompense, code promo, promotion, reduction",
      priority: 75,
    },
    {
      title: "Faire une réclamation",
      question: "Comment faire une réclamation ?",
      answer:
        "Créez un compte client puis ouvrez une réclamation depuis votre espace (rubrique « Mes réclamations ») : choisissez la catégorie (billet, bus, personnel, paiement, retard...) et décrivez le problème. Une référence NZK-R-… vous est attribuée et notre équipe support vous répond directement dans le fil de discussion.",
      category: "RECLAMATIONS",
      keywords: "reclamation, reclamation, plainte, litige, probleme, mecontent, avertissement, sav, support, assistance",
      priority: 80,
    },
    {
      title: "Contacter NZOKO Transport",
      question: "Comment contacter NZOKO Transport ?",
      answer:
        "Le plus rapide : passez à l'agence NZOKO la plus proche de vous (le bouton « Trouver mon agence » vous la propose). Vous pouvez aussi utiliser la rubrique réclamations de votre espace client, ou appeler le numéro affiché sur la page d'accueil. Nos agences sont ouvertes tous les jours.",
      category: "CONTACT",
      keywords: "contacter, contact, telephone, appeler, numero, joindre, whatsapp, email, adresse, ou appeler",
      priority: 95,
    },
    {
      title: "Documents requis",
      question: "Quels documents dois-je présenter ?",
      answer:
        "Votre billet suffit (QR code ou numéro d'embarquement). Une pièce d'identité au nom du passager est recommandée pour les voyages interurbains et exigée par la réglementation pour certains contrôles. Pour les enfants voyageant seuls, contactez l'agence avant le départ.",
      category: "EMBARQUEMENT",
      keywords: "document, documents, piece d'identite, cni, passeport, justificatif, papier, identite",
      priority: 55,
    },
    {
      title: "Billet pour un tiers",
      question: "Puis-je réserver pour une autre personne ?",
      answer:
        "Oui. Renseignez simplement le nom, le prénom et le téléphone du passager concerné lors de la réservation : le billet est nominatif et devra être présenté par cette personne au contrôle. Le paiement peut être effectué par un tiers.",
      category: "RESERVATION",
      keywords: "pour quelqu'un, pour une autre personne, tiers, famille, amis, reserver pour, nom, autre nom",
      priority: 50,
    },
    {
      title: "Agences de Pointe-Noire",
      question: "Quelles agences avez-vous à Pointe-Noire ?",
      answer:
        "NZOKO dispose de plusieurs agences à Pointe-Noire : Centre-ville (boulevard Charles de Gaulle), Tié-Tié (avenue de la Paix), Loandjili (route nationale), Ngoyo (boulevard de l'Aéroport) et Mongo-Mpoukou (route de Diosso). Toutes vendent les mêmes voyages selon les disponibilités — le bouton « Trouver mon agence » vous indique la plus proche avec des places.",
      category: "AGENCES",
      keywords: "agences pointe-noire, agence pointe noire, ou acheter pointe-noire, guichet pointe-noire, tie-tie, loandjili, ngoyo, mongo-mpoukou, centre-ville pointe-noire",
      priority: 70,
      cityId: pnCity?.id,
    },
    {
      title: "Agences de Brazzaville",
      question: "Quelles agences avez-vous à Brazzaville ?",
      answer:
        "À Brazzaville, NZOKO est présent au Centre-ville (Plateau, boulevard Denis Sassou N'Guesso), à Poto-Poto (avenue de la Liberté), à Bacongo (boulevard Maréchal Lyautey) et à Talangaï (avenue de l'Oubangui). Le bouton « Trouver mon agence » détecte votre quartier et vous propose l'agence la plus proche avec des places disponibles.",
      category: "AGCES_PLACEHOLDER",
      keywords: "agences brazzaville, agence brazzaville, ou acheter brazzaville, guichet brazzaville, plateau, poto-poto, bacongo, talangai, ouenze, moungali",
      priority: 70,
      cityId: bzvCity?.id,
    },
  ];

  // Correction catégorie (prévention faute de frappe)
  for (const f of faqs) {
    if (f.category === "AGCES_PLACEHOLDER") f.category = "AGENCES";
  }

  let kbCreated = 0;
  for (const f of faqs) {
    const existing = await db.knowledgeBase.findFirst({ where: { title: f.title } });
    if (existing) {
      await db.knowledgeBase.update({
        where: { id: existing.id },
        data: {
          question: f.question,
          answer: f.answer,
          category: f.category,
          keywords: f.keywords,
          priority: f.priority ?? 0,
          isActive: true,
          cityId: f.cityId ?? null,
        },
      });
      continue;
    }
    await db.knowledgeBase.create({
      data: {
        title: f.title,
        question: f.question,
        answer: f.answer,
        category: f.category,
        keywords: f.keywords,
        priority: f.priority ?? 0,
        cityId: f.cityId ?? null,
        createdById: superadmin?.id ?? null,
        updatedById: superadmin?.id ?? null,
      },
    });
    kbCreated++;
  }
  console.log(`✓ Base de connaissances : ${kbCreated} FAQ créées (${faqs.length} au total, à jour)`);

  // ============================================================
  // Récapitulatif
  // ============================================================
  console.log("\n--- RÉCAPITULATIF V3 ---");
  console.log(`Villes actives        : ${await db.city.count({ where: { isActive: true } })}`);
  console.log(`Quartiers             : ${await db.neighborhood.count()}`);
  console.log(`Agences actives       : ${await db.agency.count({ where: { isActive: true } })}`);
  console.log(`Bus actifs            : ${await db.bus.count({ where: { status: "ACTIVE" } })}`);
  console.log(`Voyages programmés    : ${await db.trip.count({ where: { status: "SCHEDULED" } })}`);
  console.log(`Billets avec n° board : ${await db.ticket.count({ where: { NOT: { boardingNumber: null } } })}/${await db.ticket.count()}`);
  console.log(`FAQ actives           : ${await db.knowledgeBase.count({ where: { isActive: true } })}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("SEED V3 ÉCHOUÉ :", e);
    process.exit(1);
  });
