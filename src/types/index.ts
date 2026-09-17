// ============================================================
// NZOKO TRANSPORT — Contrat de types partagé Frontend / Backend
// Toute l'API respecte l'enveloppe : { success: true, data } | { success: false, error: { code, message } }
// ============================================================

import type {
  RoleCode, PermissionCode, BookingStatus, TripStatus, BusStatus, DriverStatus,
  PaymentProvider, PaymentStatus, TicketStatus, SeatType, ExpenseCategory,
  TransactionType, NotificationType, ComplaintCategory, ComplaintStatus,
  LoyaltyTier, RewardKey,
} from "@/lib/constants";

// ---------- AUTH / SESSION ----------
export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: RoleCode;
  roleLabel: string;
  agencyId: string | null;
  agencyName: string | null;
  /** LOCAL = mot de passe NZOKO (bcrypt) · SUPABASE = compte client géré par Supabase Auth. */
  authProvider: "LOCAL" | "SUPABASE";
  permissions: PermissionCode[];
}

/** Réponse d'inscription lorsque la confirmation d'e-mail Supabase est requise. */
export interface RegisterConfirmationDTO {
  requiresEmailConfirmation: true;
  email: string;
}

export type RegisterResult = SessionUser | RegisterConfirmationDTO;

// ---------- RÉFÉRENTIEL ----------
export interface CityDTO {
  id: string;
  name: string;
  country: string;
  isActive: boolean;
}

export interface AgencyDTO {
  id: string;
  code: string;
  name: string;
  cityId: string;
  cityName?: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
}

export interface RouteStopDTO {
  id: string;
  cityId: string;
  cityName: string;
  position: number;
  minutesFromStart: number;
}

export interface RouteDTO {
  id: string;
  code: string;
  originCityId: string;
  originCityName: string;
  destinationCityId: string;
  destinationCityName: string;
  distanceKm: number;
  estimatedDurationMinutes: number;
  basePrice: number;
  isActive: boolean;
  stops?: RouteStopDTO[];
}

export interface SeatLayoutDTO {
  id: string;
  name: string;
  rows: number;
  columns: number;
  aisleAfter: number;
  description: string | null;
  seatCount?: number;
}

export interface BusDTO {
  id: string;
  registrationNumber: string;
  brand: string;
  model: string;
  year: number | null;
  capacity: number;
  status: BusStatus;
  agencyId: string;
  agencyName?: string;
  seatLayoutId: string;
  seatLayoutName?: string;
}

export interface DriverDTO {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  licenseNumber: string;
  userId: string | null;
  agencyId: string;
  agencyName?: string;
  status: DriverStatus;
}

export interface RoleDTO {
  id: string;
  code: RoleCode;
  name: string;
  permissions: PermissionCode[];
}

export interface UserDTO {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  role: RoleCode;
  roleLabel?: string;
  agencyId: string | null;
  agencyName?: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

// ---------- VOYAGES ----------
export interface TripSearchDTO {
  id: string;
  code: string;
  routeId: string;
  originCityName: string;
  destinationCityName: string;
  stops: { cityName: string; minutesFromStart: number }[];
  departureTime: string; // ISO
  estimatedArrivalTime: string; // ISO
  price: number;
  status: TripStatus;
  busRegistration: string;
  busBrand: string;
  busModel: string;
  seatLayoutId: string;
  totalSeats: number;
  availableSeats: number;
  agencyName: string;
  durationMinutes: number;
}

export interface SeatMapSeatDTO {
  id: string;
  seatNumber: string;
  row: number;
  column: string;
  type: SeatType;
  status: "AVAILABLE" | "HELD" | "BOOKED";
}

export interface SeatMapDTO {
  trip: {
    id: string;
    code: string;
    originCityName: string;
    destinationCityName: string;
    departureTime: string;
    estimatedArrivalTime: string;
    price: number;
    status: TripStatus;
    busRegistration: string;
    agencyName: string;
  };
  layout: { rows: number; columns: number; aisleAfter: number; name: string };
  seats: SeatMapSeatDTO[];
  availableSeats: number;
  holdMinutes: number;
}

// ---------- RÉSERVATION ----------
export interface PassengerInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  documentNumber?: string;
}

export interface CreateBookingInput {
  tripId: string;
  seatId: string;
  passenger: PassengerInput;
  channel?: "WEB" | "AGENT";
  promoCode?: string; // code fidélité/campagne — remise appliquée au montant
}

export interface BookingDTO {
  id: string;
  bookingReference: string;
  status: BookingStatus;
  amount: number;
  channel: "WEB" | "AGENT";
  promoCode?: string | null; // code promo appliqué (null si aucun)
  expiresAt: string | null;
  createdAt: string;
  trip: {
    id: string;
    code: string;
    originCityName: string;
    destinationCityName: string;
    departureTime: string;
    estimatedArrivalTime: string;
    busRegistration: string;
    status: TripStatus;
    agencyName: string;
  };
  seat: { id: string; seatNumber: string; type: SeatType };
  passenger: { id: string; firstName: string; lastName: string; phone: string; documentNumber: string | null };
  agencyName: string | null;
  createdByName: string | null;
}

export interface TicketDTO {
  id: string;
  token: string;
  status: TicketStatus;
  issuedAt: string;
  checkedAt: string | null;
  checkedByName: string | null;
  qrDataUrl: string | null; // PNG data URL (généré serveur)
}

export interface BookingDetailDTO extends BookingDTO {
  payments: PaymentDTO[];
  ticket: TicketDTO | null;
}

// ---------- PAIEMENTS ----------
export interface PaymentDTO {
  id: string;
  bookingId: string;
  bookingReference?: string;
  provider: PaymentProvider;
  providerTransactionId: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  instructions: string | null; // consignes client (ex: approuver sur le téléphone)
  failureReason?: string | null; // motif d'échec fournisseur (MoMo…)
  createdAt: string;
  collectedByName: string | null;
  refund?: PaymentRefundDTO | null; // remboursement en cours/terminé (si initié)
}

export type RefundMode = "MOMO_REFUND" | "MOMO_TRANSFER" | "CASH";

export interface PaymentRefundDTO {
  mode: RefundMode;
  status: "PROCESSING" | "SUCCESSFUL" | "FAILED";
  amount: number;
  referenceId: string | null; // X-Reference-Id MoMo (refunds/transferts)
  msisdn: string | null; // bénéficiaire (transferts)
  reason: string | null; // motif d'échec éventuel
  initiatedByName: string | null;
  initiatedAt: string;
  confirmedAt: string | null;
  financialTransactionId: string | null;
}

export interface PayBookingInput {
  bookingId: string;
  provider: PaymentProvider;
  momoPhone?: string; // pour MTN/Airtel
  senderName?: string;
}

export interface RefundPaymentInput {
  mode: RefundMode;
  amount?: number; // défaut : montant intégral du paiement
  msisdn?: string; // requis pour MOMO_TRANSFER si le paiement n'a pas de numéro
}

// ---------- MTN MOMO (administration) ----------
export interface MomoBalanceDTO {
  availableBalance: string;
  currency: string;
}

export interface MomoProductOverviewDTO {
  configured: boolean;
  balance: MomoBalanceDTO | null;
  error: string | null;
}

export interface MomoOverviewDTO {
  environment: "sandbox" | "production";
  targetEnvironment: string;
  currency: string;
  callbackConfigured: boolean;
  collection: MomoProductOverviewDTO;
  disbursement: MomoProductOverviewDTO;
}

// ---------- ANNUATION : CONTACTS PASSAGERS ----------
export type TripContactPaymentState = "PAID" | "REFUNDED" | "UNPAID";

export interface TripContactPassengerDTO {
  bookingId: string;
  bookingReference: string;
  bookingStatus: BookingStatus;
  passengerName: string;
  phoneE164: string | null; // normalisé wa.me/tel: — null si numéro inexploitable
  rawPhone: string; // tel que saisi par le client
  seatLabel: string | null; // ex: "05"
  amount: number; // XAF
  paymentState: TripContactPaymentState;
  whatsappUrl: string | null; // https://wa.me/242…?text=… (message pré-rempli FR)
  telUrl: string | null; // tel:+242…
}

export interface TripContactsDTO {
  trip: {
    id: string;
    code: string;
    originCityName: string;
    destinationCityName: string;
    departureTime: string; // ISO
    status: TripStatus;
    busRegistration: string;
    agencyName: string;
    agencyPhone: string | null;
  };
  contacts: TripContactPassengerDTO[];
  summary: {
    total: number;
    paid: number;
    refunded: number;
    unpaid: number;
    refundDue: number; // total XAF à rembourser (payés non remboursés)
    withPhone: number; // passagers joignables (WhatsApp/appel)
  };
  broadcastMessage: string; // message générique pour diffusion de groupe
}

// ---------- CHECKER ----------
export type ScanResultCode = "VALID" | "ALREADY_USED" | "INVALID" | "PAYMENT_NOT_CONFIRMED" | "TRIP_CANCELLED" | "WRONG_AGENCY";

export interface ScanResultDTO {
  result: ScanResultCode;
  message: string;
  boarded: boolean;
  ticket: {
    reference: string;
    token: string;
    status: TicketStatus;
    passengerName: string;
    passengerPhone: string;
    seatNumber: string;
    seatType: SeatType;
    tripCode: string;
    originCityName: string;
    destinationCityName: string;
    departureTime: string;
    busRegistration: string;
    agencyName: string;
    checkedAt: string | null;
  } | null;
}

export interface BoardingTripDTO {
  id: string;
  code: string;
  originCityName: string;
  destinationCityName: string;
  departureTime: string;
  status: TripStatus;
  busRegistration: string;
  totalSeats: number;
  boardedCount: number;
  soldCount: number;
}

// ---------- CHAUFFEUR ----------
export interface DriverTripDTO {
  id: string;
  code: string;
  originCityName: string;
  destinationCityName: string;
  departureTime: string;
  estimatedArrivalTime: string;
  status: TripStatus;
  busRegistration: string;
  busModel: string;
  passengers: { seatNumber: string; passengerName: string; boarded: boolean; reference: string }[];
  boardedCount: number;
  soldCount: number;
}

// ---------- SUIVI GPS TEMPS RÉEL (module tracking) ----------
export interface GpsPointInput {
  latitude: number;
  longitude: number;
  /** km/h (conversion m/s × 3,6 faite côté client). */
  speed?: number | null;
  /** Cap en degrés 0–360. */
  heading?: number | null;
  /** Rayon de confiance en mètres. */
  accuracy?: number | null;
  /** Altitude en mètres. */
  altitude?: number | null;
  /** Horodatage ORIGINAL du GPS (ISO 8601) — jamais réécrit. */
  recordedAt: string;
}

export interface GpsPointDTO {
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  recordedAt: string;
}

export type TrackingSessionStatus = "ACTIVE" | "PAUSED" | "COMPLETED";

export interface TrackingSessionDTO {
  id: string;
  status: TrackingSessionStatus;
  startedAt: string;
  endedAt: string | null;
  driver: { id: string; firstName: string; lastName: string; phone: string | null };
  agency: { id: string; name: string };
  trip: {
    id: string;
    code: string;
    originCityName: string;
    destinationCityName: string;
    departureTime: string;
  } | null;
  bus: { id: string; registrationNumber: string; model: string | null } | null;
  lastPoint: GpsPointDTO | null;
  pointsCount: number;
}

/** Réponse de démarrage/arrêt — inclut le jeton temps réel (socket.io). */
export interface TrackingSessionActionDTO extends TrackingSessionDTO {
  socketUrl: string;
}

/** Vue flotte admin : sessions actives + dernier point + jeton socket. */
export interface TrackingFleetDTO {
  sessions: TrackingSessionDTO[];
  /** Présent uniquement en réponse à ?sessionId= — historique de la session. */
  trail?: GpsPointDTO[];
  generatedAt: string;
  socketUrl: string;
  socketToken: string; // HMAC court — abonnement salon temps réel
}

/** Réponse du flush de la file offline. */
export interface TrackingBatchResultDTO {
  accepted: number;
  rejected: number; // points hors fenêtre de tolérance ou invalides
}

// ---------- DASHBOARD ADMIN ----------
export interface AdminStatsDTO {
  kpis: {
    bookingsToday: number;
    revenueToday: number;
    revenueMonth: number;
    activeTrips: number;
    activeBuses: number;
    occupancyRate: number; // %
    pendingPayments: number;
    expiringBookings: number;
  };
  revenueSeries: { date: string; amount: number }[]; // 14 derniers jours
  bookingsSeries: { date: string; count: number }[];
  agencyPerformance: { agencyId: string; agencyName: string; revenue: number; bookings: number; occupancy: number }[];
  topRoutes: { route: string; bookings: number; revenue: number }[];
  recentBookings: BookingDTO[];
  recentPayments: (PaymentDTO & { passengerName?: string })[];
  upcomingTrips: TripSearchDTO[];
  alerts: { level: "WARNING" | "ALERT" | "INFO"; message: string }[];
}

// ---------- DASHBOARD AGENCE ----------
export interface AgencyStatsDTO {
  kpis: {
    salesToday: number;
    bookingsToday: number;
    tripsToday: number;
    passengersToday: number;
    boardedToday: number;
    revenueMonth: number;
    pendingPayments: number;
  };
  salesSeries: { date: string; amount: number }[];
  upcomingDepartures: TripSearchDTO[];
  recentSales: BookingDTO[];
}

// ---------- FINANCES ----------
export interface FinanceSummaryDTO {
  period: { from: string; to: string };
  income: number;
  expenses: number;
  net: number;
  byMonth: { month: string; income: number; expenses: number }[];
  byAgency: { agencyName: string; income: number; expenses: number }[];
  byRoute: { routeName: string; income: number; bookings: number }[];
  byCategory: { category: string; amount: number }[];
}

export interface TransactionDTO {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  reference: string | null;
  description: string;
  agencyName: string | null;
  createdByName: string | null;
  paymentId: string | null;
  createdAt: string;
}

export interface ExpenseDTO {
  id: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  agencyId: string | null;
  agencyName: string | null;
  tripId: string | null;
  createdByName: string | null;
  date: string;
}

export interface ExpenseInput {
  category: ExpenseCategory;
  amount: number;
  description: string;
  agencyId?: string | null;
  tripId?: string | null;
  date?: string;
}

// ---------- RAPPORTS ----------
export interface ReportDTO {
  type: "daily" | "weekly" | "monthly" | "agency" | "bus" | "route";
  period: { from: string; to: string; label: string };
  totalBookings: number;
  totalRevenue: number;
  totalExpenses: number;
  netResult: number;
  rows: { label: string; bookings: number; revenue: number; expenses: number }[];
}

// ---------- NOTIFICATIONS & LOGS ----------
export interface NotificationDTO {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogDTO {
  id: string;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface SecurityLogDTO {
  id: string;
  email: string | null;
  event: string;
  ipAddress: string | null;
  details: string | null;
  createdAt: string;
}

// ---------- PAGINATION ----------
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------- DIVERS ----------
export interface ApiEnvelopeError {
  success: false;
  error: { code: string; message: string };
}

export interface IdName {
  id: string;
  name: string;
}

// ---------- ASSISTANT IA (voyages / promotions / tarifs) ----------
export interface AssistantReplyDTO {
  sessionId: string; // identifiant de conversation (généré serveur si absent)
  reply: string; // réponse en français, ancrée sur les données réelles
}

// ============================================================
// ESPACE CLIENT & FIDÉLISATION — Task ID 10
// ============================================================

// ---------- AUTH CLIENT ----------
export interface RegisterInput {
  firstName: string;
  lastName: string;
  phone: string; // accepté : "06 123 45 67", "+242 06 123 45 67"… (normalisé serveur)
  email?: string; // optionnel — si absent, email synthétique (téléphone)
  password: string; // min 8
}

export interface OtpRequestDTO {
  phone: string; // E.164 digits normalisé
  expiresInSec: number;
  // Uniquement si OTP_DEBUG=true (sandbox/ZIP sans passerelle SMS) :
  devCode?: string;
}

export interface OtpVerifyInput {
  phone: string;
  code: string; // 6 chiffres
}

// ---------- PROFIL ----------
export interface ClientProfileDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string; // E.164 digits
  emailIsSynthetic: boolean; // true = email dérivé du téléphone (jamais vérifié)
  createdAt: string;
}

// ---------- APERÇU / STATS ----------
export interface ClientStatsDTO {
  tripsCompleted: number; // voyages effectués (payés + terminés)
  tripsUpcoming: number; // à venir (confirmés, départ futur)
  totalSpent: number; // FCFA cumulés (paiements SUCCESS)
  totalTravelMinutes: number; // durée cumulée des voyages effectués
  agenciesUsed: number; // agences distinctes
  pointsBalance: number;
  lifetimePoints: number;
  tier: LoyaltyTier;
  nextTier: { key: LoyaltyTier; label: string; pointsRemaining: number } | null;
  favoriteRoute: {
    originCityId: string;
    originCityName: string;
    destinationCityId: string;
    destinationCityName: string;
    tripsCount: number;
  } | null;
  // Promotion personnalisée calculée sur les habitudes (null si aucune habitude)
  personalizedOffer: { headline: string; detail: string } | null;
}

// ---------- MES VOYAGES ----------
export interface ClientTripDTO {
  bookingId: string;
  bookingReference: string;
  status: BookingStatus;
  originCityName: string;
  destinationCityName: string;
  departureTime: string; // ISO
  arrivalTime: string; // ISO
  tripStatus: TripStatus;
  agencyName: string;
  busRegistration: string;
  seatNumber: string;
  seatType: SeatType;
  amount: number; // FCFA payé
  hasRated: boolean; // évaluation déjà déposée
  ratingEligible: boolean; // voyage terminé + pas encore évalué
}

export interface TripRatingInput {
  bookingId: string;
  cleanliness: number; // 1-5
  comfort: number;
  punctuality: number;
  staff: number;
  security: number;
  comment?: string;
}

// ---------- FAVORIS ----------
export interface FavoriteRouteDTO {
  id: string;
  originCityId: string;
  originCityName: string;
  destinationCityId: string;
  destinationCityName: string;
  isManual: boolean;
  tripsCount: number; // voyages effectués sur ce trajet
  nextDeparture: { tripId: string; departureTime: string; price: number } | null;
}

export interface FavoriteRouteInput {
  originCityId: string;
  destinationCityId: string;
}

// ---------- DÉPENSES ----------
export interface SpendingDTO {
  thisMonth: number;
  thisYear: number;
  total: number;
  monthly: { month: string; amount: number }[]; // 12 derniers mois "2026-01"
}

// ---------- FIDÉLITÉ ----------
export interface LoyaltyRewardDTO {
  key: RewardKey;
  label: string;
  description: string;
  points: number;
  deliverable: "CODE" | "MANUAL";
}

export interface LoyaltyTransactionDTO {
  id: string;
  type: "EARN" | "SPEND" | "ADJUST";
  points: number;
  reason: string;
  description: string;
  createdAt: string;
}

export interface RedemptionRequestDTO {
  id: string;
  rewardKey: RewardKey;
  rewardLabel: string;
  pointsSpent: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  promoCode: string | null; // généré à l'approbation (deliverable CODE)
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface LoyaltyDTO {
  pointsBalance: number;
  lifetimePoints: number;
  tier: LoyaltyTier;
  tierLabel: string;
  nextTier: { key: LoyaltyTier; label: string; pointsRemaining: number } | null;
  nextReward: LoyaltyRewardDTO | null; // prochaine récompense atteignable
  transactions: LoyaltyTransactionDTO[];
  rewards: LoyaltyRewardDTO[]; // catalogue
  redemptions: RedemptionRequestDTO[];
}

// ---------- RÉCLAMATIONS ----------
export interface ComplaintMessageDTO {
  id: string;
  authorName: string;
  isStaff: boolean;
  message: string;
  createdAt: string;
}

export interface ComplaintDTO {
  id: string;
  reference: string; // NZK-R-2026-000123
  category: ComplaintCategory;
  categoryLabel: string;
  subject: string;
  status: ComplaintStatus;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageAt: string | null;
  preview: string; // 80 premiers caractères
}

export interface ComplaintDetailDTO extends ComplaintDTO {
  message: string; // texte initial complet
  bookingReference: string | null;
  assignedToName: string | null;
  resolvedAt: string | null;
  messages: ComplaintMessageDTO[];
}

export interface ComplaintCreateInput {
  category: ComplaintCategory;
  subject: string; // max 120
  message: string; // max 2000
  bookingReference?: string;
}

export interface ComplaintReplyInput {
  message: string; // max 2000
}

// ---------- ADMIN : CLIENTS & FIDÉLITÉ ----------
export interface AdminClientDTO {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  tripsCompleted: number;
  totalSpent: number;
  pointsBalance: number;
  lifetimePoints: number;
  tier: LoyaltyTier;
  lastTripAt: string | null;
  inactiveDays: number | null; // jours depuis dernier voyage (null si jamais voyagé)
}

export interface AdminComplaintDTO extends ComplaintDetailDTO {
  clientName: string;
  clientPhone: string | null;
}

export interface AdminLoyaltyStatsDTO {
  totalClients: number;
  activeClients: number; // ayant voyagé les 60 derniers jours
  inactiveClients: number; // INACTIVE_CLIENT_DAYS sans voyager
  pointsOutstanding: number; // somme des soldes
  pointsIssued: number; // somme lifetime
  tierCounts: Record<LoyaltyTier, number>;
  openComplaints: number;
  pendingRedemptions: number;
  averageRating: number | null; // moyenne des évaluations (0-5, 1 déc.)
  ratingCount: number;
  ratingsByRoute: {
    routeId: string;
    routeLabel: string; // "Pointe-Noire → Brazzaville"
    average: number;
    count: number;
  }[];
}

export interface CampaignInput {
  segment: "INACTIVE" | "BRONZE" | "SILVER" | "GOLD" | "VIP" | "ALL";
  title: string; // max 90
  message: string; // max 300
}

// ---------- CODES PROMO ----------
export interface PromoCodeValidationDTO {
  code: string;
  type: "PERCENT" | "FREE_TICKET";
  value: number;
  label: string;
  originalAmount: number;
  discountedAmount: number; // après remise
}
