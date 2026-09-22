// ============================================================
// NZOKO TRANSPORT — Constantes métier (enums applicatives)
// SQLite ne supporte pas les enums Prisma : validation Zod côté serveur.
// ============================================================

export const APP_NAME = "NZOKO TRANSPORT";
export const APP_SLOGAN = "Voyagez simplement. Voyagez en confiance.";
export const APP_TIMEZONE = "Africa/Brazzaville"; // UTC+1 fixe
export const DEFAULT_CURRENCY = "XAF";

// ---------- RÔLES ----------
export const ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "AGENCY_MANAGER",
  "AGENT",
  "CHECKER",
  "ACCOUNTANT",
  "DRIVER",
  "SUPPORT",
  "PASSENGER",
] as const;
export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  SUPER_ADMIN: "Super Administrateur",
  ADMIN: "Administrateur",
  AGENCY_MANAGER: "Responsable d'agence",
  AGENT: "Agent de guichet",
  CHECKER: "Contrôleur embarquement",
  ACCOUNTANT: "Comptable",
  DRIVER: "Chauffeur",
  SUPPORT: "Support client",
  PASSENGER: "Client NZOKO",
};

export const GLOBAL_ROLES: RoleCode[] = ["SUPER_ADMIN", "ADMIN"]; // voient toutes les agences

// ---------- PERMISSIONS ----------
export const PERMISSIONS = [
  "agency:manage", "agency:read",
  "user:manage", "user:read",
  "role:read",
  "city:manage", "city:read",
  "route:manage", "route:read",
  "bus:manage", "bus:read",
  "driver:manage", "driver:read",
  "seatlayout:manage", "seatlayout:read",
  "trip:manage", "trip:read",
  "booking:manage", "booking:read", "booking:create",
  "payment:manage", "payment:read", "payment:cash-collect",
  "ticket:read",
  "checker:scan",
  "finance:read",
  "expense:manage", "expense:read",
  "transaction:read",
  "report:read",
  "notification:read",
  "audit:read",
  "security:read",
  "stats:global", "stats:agency",
  "kb:manage", // V3 — base de connaissances de l'assistant IA
] as const;
export type PermissionCode = (typeof PERMISSIONS)[number];

// Matrice RBAC par défaut (configurable en base via RolePermission)
export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
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
    "agency:read", "user:read",
    "city:read", "route:read", "bus:read", "driver:manage", "driver:read",
    "seatlayout:read", "trip:manage", "trip:read",
    "booking:manage", "booking:read", "booking:create",
    "payment:read", "payment:cash-collect", "ticket:read",
    "finance:read", "expense:manage", "expense:read", "transaction:read",
    "report:read", "notification:read", "audit:read",
    "stats:agency",
  ],
  AGENT: [
    "city:read", "route:read", "trip:read",
    "booking:read", "booking:create",
    "payment:cash-collect", "ticket:read",
    "notification:read",
  ],
  CHECKER: [
    "trip:read", "booking:read", "ticket:read", "checker:scan", "notification:read",
  ],
  ACCOUNTANT: [
    "agency:read", "city:read", "route:read",
    "booking:read", "payment:read", "ticket:read",
    "finance:read", "expense:manage", "expense:read", "transaction:read",
    "report:read", "notification:read", "audit:read", "stats:agency", "stats:global",
  ],
  DRIVER: [
    "trip:read", "booking:read", "ticket:read", "notification:read",
  ],
  SUPPORT: [
    "booking:read", "trip:read", "city:read", "route:read", "notification:read",
  ],
  // Espace client : auto-service strict — les routes /api/client/* vérifient
  // le rôle PASSENGER (données personnelles), pas ces permissions.
  PASSENGER: [
    "booking:create", "notification:read",
  ],
};

// ---------- STATUTS (libellés + couleurs UI) ----------
export const BOOKING_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "En attente",
  CONFIRMED: "Confirmée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
  COMPLETED: "Terminée",
};
export const BOOKING_STATUS_COLORS: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  CONFIRMED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
  EXPIRED: "bg-zinc-200 text-zinc-600 border-zinc-300",
  COMPLETED: "bg-teal-100 text-teal-800 border-teal-200",
};

export const TRIP_STATUSES = ["SCHEDULED", "BOARDING", "DEPARTED", "ARRIVED", "CANCELLED", "COMPLETED"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  SCHEDULED: "Programmé",
  BOARDING: "Embarquement",
  DEPARTED: "Parti",
  ARRIVED: "Arrivé",
  CANCELLED: "Annulé",
  COMPLETED: "Terminé",
};
export const TRIP_STATUS_COLORS: Record<TripStatus, string> = {
  SCHEDULED: "bg-sky-100 text-sky-800 border-sky-200",
  BOARDING: "bg-amber-100 text-amber-800 border-amber-200",
  DEPARTED: "bg-orange-100 text-orange-800 border-orange-200",
  ARRIVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
  COMPLETED: "bg-teal-100 text-teal-800 border-teal-200",
};

export const BUS_STATUSES = ["ACTIVE", "MAINTENANCE", "INACTIVE", "OUT_OF_SERVICE"] as const;
export type BusStatus = (typeof BUS_STATUSES)[number];
export const BUS_STATUS_LABELS: Record<BusStatus, string> = {
  ACTIVE: "En service",
  MAINTENANCE: "Maintenance",
  INACTIVE: "Inactif",
  OUT_OF_SERVICE: "Hors service",
};
export const BUS_STATUS_COLORS: Record<BusStatus, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  MAINTENANCE: "bg-amber-100 text-amber-800 border-amber-200",
  INACTIVE: "bg-zinc-100 text-zinc-600 border-zinc-300",
  OUT_OF_SERVICE: "bg-red-100 text-red-800 border-red-200",
};

export const PAYMENT_PROVIDERS = ["MTN_MOMO", "AIRTEL_MONEY", "CASH", "CARD", "BANK_TRANSFER"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];
export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  MTN_MOMO: "MTN Mobile Money",
  AIRTEL_MONEY: "Airtel Money",
  CASH: "Espèces (guichet)",
  CARD: "Carte bancaire",
  BANK_TRANSFER: "Virement bancaire",
};

export const PAYMENT_STATUSES = ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "En attente",
  PROCESSING: "En cours",
  SUCCESS: "Réussi",
  FAILED: "Échoué",
  CANCELLED: "Annulé",
  REFUNDED: "Remboursé",
};
export const PAYMENT_STATUS_COLORS: Record<PaymentStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  PROCESSING: "bg-sky-100 text-sky-800 border-sky-200",
  SUCCESS: "bg-emerald-100 text-emerald-800 border-emerald-200",
  FAILED: "bg-red-100 text-red-800 border-red-200",
  CANCELLED: "bg-zinc-200 text-zinc-600 border-zinc-300",
  REFUNDED: "bg-violet-100 text-violet-800 border-violet-200",
};

export const TICKET_STATUSES = ["VALID", "USED", "CANCELLED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  VALID: "Valide",
  USED: "Utilisé",
  CANCELLED: "Annulé",
};

export const SEAT_TYPES = ["STANDARD", "VIP"] as const;
export type SeatType = (typeof SEAT_TYPES)[number];

export const SEAT_OCCUPANCY_STATUSES = ["HELD", "BOOKED"] as const;
export type SeatOccupancyStatus = (typeof SEAT_OCCUPANCY_STATUSES)[number];

export const EXPENSE_CATEGORIES = ["FUEL", "MAINTENANCE", "SALARY", "REPAIR", "SUPPLIES", "OTHER"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  FUEL: "Carburant",
  MAINTENANCE: "Maintenance",
  SALARY: "Salaires",
  REPAIR: "Réparation",
  SUPPLIES: "Fournitures",
  OTHER: "Autre",
};

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "REFUND", "ADJUSTMENT"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: "Revenu",
  EXPENSE: "Dépense",
  REFUND: "Remboursement",
  ADJUSTMENT: "Ajustement",
};

export const DRIVER_STATUSES = ["AVAILABLE", "ON_TRIP", "OFF_DUTY"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];
export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  AVAILABLE: "Disponible",
  ON_TRIP: "En voyage",
  OFF_DUTY: "Hors service",
};
// ⚠️ Complément ajouté (task 2-a) : DRIVER_STATUS_COLORS manquait alors que
// tous les autres statuts du fichier en ont un — le frontend en dépend.
export const DRIVER_STATUS_COLORS: Record<DriverStatus, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  ON_TRIP: "bg-sky-100 text-sky-800 border-sky-200",
  OFF_DUTY: "bg-zinc-100 text-zinc-600 border-zinc-300",
};

export const NOTIFICATION_TYPES = ["INFO", "SUCCESS", "WARNING", "ALERT"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ---------- RÉCLAMATIONS (espace client) ----------
export const COMPLAINT_CATEGORIES = ["TICKET", "BUS", "STAFF", "PAYMENT", "DELAY", "SUGGESTION", "COMPLAINT"] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  TICKET: "Problème avec mon billet",
  BUS: "Problème avec le bus",
  STAFF: "Comportement du personnel",
  PAYMENT: "Problème de paiement",
  DELAY: "Retard",
  SUGGESTION: "Suggestion d'amélioration",
  COMPLAINT: "Réclamation",
};

export const COMPLAINT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  OPEN: "En attente",
  IN_PROGRESS: "En cours de traitement",
  RESOLVED: "Résolu",
  CLOSED: "Fermé",
};
export const COMPLAINT_STATUS_COLORS: Record<ComplaintStatus, string> = {
  OPEN: "bg-amber-100 text-amber-800 border-amber-200",
  IN_PROGRESS: "bg-sky-100 text-sky-800 border-sky-200",
  RESOLVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  CLOSED: "bg-zinc-200 text-zinc-600 border-zinc-300",
};

// ---------- FIDÉLITÉ ----------
export const LOYALTY = {
  pointsPerTrip: 100, // 1 voyage payé = 100 points
  tiers: [
    { key: "BRONZE", label: "NZOKO Bronze", min: 0, max: 999, icon: "🥉" },
    { key: "SILVER", label: "NZOKO Silver", min: 1000, max: 4999, icon: "🥈" },
    { key: "GOLD", label: "NZOKO Gold", min: 5000, max: 14999, icon: "🥇" },
    { key: "VIP", label: "NZOKO VIP", min: 15000, max: Number.MAX_SAFE_INTEGER, icon: "💎" },
  ],
} as const;
export type LoyaltyTier = (typeof LOYALTY.tiers)[number]["key"];

export const LOYALTY_TIER_LABELS: Record<LoyaltyTier, string> = {
  BRONZE: "NZOKO Bronze",
  SILVER: "NZOKO Silver",
  GOLD: "NZOKO Gold",
  VIP: "NZOKO VIP",
};

// Catalogue de récompenses (dépense de points)
export const LOYALTY_REWARDS = [
  { key: "REDUCTION_5", points: 500, label: "Réduction de 5 %", description: "Code promo -5 % sur votre prochaine réservation.", deliverable: "CODE" },
  { key: "REDUCTION_10", points: 1000, label: "Réduction de 10 %", description: "Code promo -10 % sur votre prochaine réservation.", deliverable: "CODE" },
  { key: "SPECIAL", points: 2000, label: "Réduction spéciale", description: "Offre personnalisée validée par nos équipes.", deliverable: "MANUAL" },
  { key: "FREE_TICKET", points: 5000, label: "Billet gratuit", description: "Un billet offert — traitement par nos équipes.", deliverable: "MANUAL" },
] as const;
export type RewardKey = (typeof LOYALTY_REWARDS)[number]["key"];

// ---------- OTP TÉLÉPHONE ----------
export const OTP = {
  codeLength: 6,
  ttlMinutes: 5,
  maxAttempts: 5,
} as const;

// ---------- IDENTIFIANTS COURTS → E-MAILS RÉELS ----------
// Alias de saisie acceptés au login (« superadmin » au lieu de l'e-mail
// complet). Toutes les adresses de démo utilisent le plus-addressing Gmail :
// elles sont uniques en base mais atterrissent TOUTES dans la même boîte
// (geormakoma1@gmail.com) — consultable pour tester les e-mails réels
// (codes de vérification, notifications).
export const SHORT_ID_EMAILS: Record<string, string> = {
  superadmin: "geormakoma1+superadmin@gmail.com",
  admin: "geormakoma1+admin@gmail.com",
  manager: "geormakoma1+manager@gmail.com",
  "manager.pn": "geormakoma1+manager@gmail.com",
  agent: "geormakoma1+agent@gmail.com",
  "agent.pn": "geormakoma1+agent@gmail.com",
  checker: "geormakoma1+checker@gmail.com",
  "checker.pn": "geormakoma1+checker@gmail.com",
  comptable: "geormakoma1+comptable@gmail.com",
  chauffeur: "geormakoma1+chauffeur@gmail.com",
  "chauffeur.jean": "geormakoma1+chauffeur@gmail.com",
  support: "geormakoma1+support@gmail.com",
} as const;

// ---------- E-MAILS ACTUELS → ANCIENS E-MAILS (@nzoko.cg) ----------
// Les comptes internes de la base de PRODUCTION (Neon PostgreSQL, migrée
// avant le renommage des seeds) portent les ANCIENS e-mails @nzoko.cg.
// Cet alias permet au pont d'import (/api/auth/login, mode Neon) de
// retrouver le compte local quand l'utilisateur saisit la convention
// ACTUELLE (geormakoma1+<role>@gmail.com) : le compte est importé vers
// Neon Auth avec l'e-mail SAISI et son e-mail local est modernisé au
// passage (renommage) — les deux conventions fonctionnent ensuite.
// Carte FIXE et contrôlée serveur : aucune énumération possible (les
// réponses d'échec restent génériques).
export const LEGACY_EMAIL_ALIASES: Record<string, string> = {
  "geormakoma1+superadmin@gmail.com": "superadmin@nzoko.cg",
  "geormakoma1+admin@gmail.com": "admin@nzoko.cg",
  "geormakoma1+manager@gmail.com": "manager.pn@nzoko.cg",
  "geormakoma1+agent@gmail.com": "agent.pn@nzoko.cg",
  "geormakoma1+checker@gmail.com": "checker.pn@nzoko.cg",
  "geormakoma1+comptable@gmail.com": "comptable@nzoko.cg",
  "geormakoma1+chauffeur@gmail.com": "chauffeur.jean@nzoko.cg",
  "geormakoma1+support@gmail.com": "support@nzoko.cg",
} as const;

// Client inactif (intelligence fidélisation) — seuil en jours
export const INACTIVE_CLIENT_DAYS = 60;

// ---------- PARAMÈTRES MÉTIER ----------
export const SEAT_HOLD_MINUTES = 10; // verrou temporaire de siège
export const SESSION_HOURS = 12;
export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  booking: { limit: 10, windowMs: 60 * 1000 },
  payment: { limit: 10, windowMs: 60 * 1000 },
  checker: { limit: 30, windowMs: 60 * 1000 },
  public: { limit: 60, windowMs: 60 * 1000 },
  // MTN MoMo — suivi des transactions asynchrones
  momoStatus: { limit: 15, windowMs: 60 * 1000 }, // polling public Request to Pay
  momoWebhook: { limit: 60, windowMs: 60 * 1000 }, // callback officiel MTN (re-vérifié par GET)
  refund: { limit: 10, windowMs: 60 * 1000 }, // initiation/suivi remboursement (admin)
  momoOverview: { limit: 10, windowMs: 60 * 1000 }, // soldes MoMo (admin)
  // Assistant IA — questions voyages / promotions / tarifs
  assistant: { limit: 10, windowMs: 60 * 1000 },
  // Routes publiques GET — anti-énumération / anti-scrapping
  bookingDetail: { limit: 15, windowMs: 60 * 1000 }, // suivi billet par référence
  search: { limit: 30, windowMs: 60 * 1000 }, // recherche de voyages
  ticketQr: { limit: 30, windowMs: 60 * 1000 }, // QR d'un billet (token secret)
  seatMap: { limit: 20, windowMs: 60 * 1000 }, // plan de sièges (releaseExpiredHolds + requêtes)
  // Annulation voyage — contacts passagers (données personnelles → accès journalisé)
  tripContacts: { limit: 10, windowMs: 60 * 1000 },
  // Webhook générique signé HMAC (anti brute-force de la signature)
  webhookPayments: { limit: 60, windowMs: 60 * 1000 },
  // Lectures authentifiées coûteuses (tableaux/agrégats — confort anti-abus)
  authedRead: { limit: 30, windowMs: 60 * 1000 },
  // Espace client & fidélisation (Task ID 10)
  register: { limit: 5, windowMs: 15 * 60 * 1000 },
  otpRequest: { limit: 3, windowMs: 15 * 60 * 1000 }, // par téléphone
  otpVerify: { limit: 5, windowMs: 15 * 60 * 1000 },
  clientRead: { limit: 30, windowMs: 60 * 1000 },
  complaintCreate: { limit: 5, windowMs: 60 * 60 * 1000 },
  ratingCreate: { limit: 10, windowMs: 60 * 60 * 1000 },
  redeem: { limit: 3, windowMs: 60 * 60 * 1000 },
  // Suivi GPS temps réel — écriture points (8 s en mouvement + bursts offline
  // reflushés par lots de 50 → 120/min par chauffeur), et actions session.
  trackingWrite: { limit: 120, windowMs: 60 * 1000 },
  trackingSession: { limit: 30, windowMs: 60 * 1000 },
  // Maintenance GPS (watchdog + rétention) — scheduler mini-service 5 min +
  // cron Vercel : ~12/h en service, marge pour les reprises/manuels admin.
  trackingMaintenance: { limit: 30, windowMs: 60 * 60 * 1000 },
} as const;

// ---------- SUIVI GPS TEMPS RÉEL (module tracking) ----------
// Fréquences pilotées par la vitesse : envoi intelligent côté client,
// pas de timer serveur. Le serveur rejette les points hors fenêtres.
export const TRACKING = {
  /** Intervalle d'envoi en mouvement (vitesse ≥ stoppedSpeedKmh). */
  movingIntervalMs: 8_000,
  /** Intervalle d'envoi à l'arrêt (vitesse < stoppedSpeedKmh). */
  stoppedIntervalMs: 30_000,
  /** Seuil km/h en dessous duquel le car est considéré à l'arrêt. */
  stoppedSpeedKmh: 5,
  /** Plancher anti-burst : JAMAIS deux envois plus rapprochés que ça. */
  minSendIntervalMs: 4_000,
  /** Tolérance passé : les points plus anciens sont purgés/rejetés (> 6 h). */
  pastToleranceMs: 6 * 60 * 60 * 1000,
  /** Lot maximum envoyé au flush de la file offline IndexedDB. */
  batchMaxPoints: 50,
  /** Historique trail renvoyé à l'admin pour une session (fenêtre glissante). */
  trailMaxPoints: 500,
  /** Watchdog : session ACTIVE sans AUCUN point depuis ce délai → PAUSED
   *  (chauffeur ayant fermé son navigateur sans STOP — il peut reprendre). */
  watchdogStaleMs: 45 * 60 * 1000,
  /** Watchdog : session vivante (ACTIVE/PAUSED) plus vieille que ce délai →
   *  COMPLETED + chauffeur libéré (un car ne roule pas 24 h d'affilée). */
  watchdogHardMs: 24 * 60 * 60 * 1000,
  /** Rétention : points GPS des sessions terminées purgés après ce délai
   *  (les sessions vivantes ne sont JAMAIS purgées). */
  retentionPointDays: 30,
  /** Rétention : sessions COMPLETED supprimées après ce délai. */
  retentionSessionDays: 90,
} as const;

// ---------- GÉOLOCALISATION PUBLIC (agency finder V3) ----------
export const GEO = {
  /** Précision GPS (mètres) en dessous de laquelle le quartier détecté est
   *  affirmé (« Vous êtes probablement à X »). Au-delà : position jugée
   *  approximative — le quartier est seulement suggéré dans le message. */
  neighborhoodClaimAccuracyM: 2_500,
  /** Précision GPS (mètres) au-delà de laquelle AUCUN quartier n'est même
   *  suggéré (position IP/wifi grossière, souvent le centre-ville). */
  neighborhoodSuggestAccuracyM: 10_000,
} as const;

export const TRACKING_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "En cours",
  PAUSED: "En pause",
  COMPLETED: "Terminée",
};

export const DRIVER_STATE_LABELS: Record<string, string> = {
  AVAILABLE: "Disponible",
  ON_TRIP: "En voyage",
  OFF_DUTY: "Hors service",
};

// Garde-fous de l'assistant IA (LLM) — appliqués côté client ET serveur
export const ASSISTANT_LIMITS = {
  maxMessageLength: 500, // caractères max par question
  maxHistory: 16, // messages conservés par conversation (≈ 8 échanges)
  conversationTtlMs: 30 * 60 * 1000, // conversation inactive purgée après 30 min
  maxConversations: 400, // conversations simultanées en mémoire serveur
  contextTtlMs: 5 * 60 * 1000, // cache du contexte de données réelles
} as const;

// Couleurs de marque (vert/orange africains — pas de bleu/indigo)
export const BRAND = {
  primary: "oklch(0.45 0.12 150)", // vert profond
  accent: "oklch(0.72 0.16 60)", // orange terre
} as const;
