// ============================================================
// OCÉAN DU NORD — Contrat de types partagé Frontend / Backend
// Toute l'API respecte l'enveloppe : { success: true, data } | { success: false, error: { code, message } }
// ============================================================

import type {
  RoleCode, PermissionCode, BookingStatus, TripStatus, BusStatus as VehicleBusStatus, DriverStatus,
  PaymentProvider, PaymentStatus, TicketStatus, SeatType, ExpenseCategory,
  TransactionType, NotificationType, ComplaintCategory, ComplaintStatus,
  LoyaltyTier, RewardKey,
} from "@/lib/constants";
// V4 GPS — BusStatus ici = état GPS DÉRIVÉ du bus suivi (MOVING/STOPPED/…).
// Le statut du VÉHICULE (ACTIVE/MAINTENANCE/…) reste `BusStatus` de @/lib/constants
// (alias local VehicleBusStatus ci-dessus pour éviter la collision de noms).
import type { BusStatus } from "@/lib/geo";

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
  /** LOCAL = mot de passe Océan du Nord (bcrypt) · SUPABASE = miroir client Supabase Auth (historique) · NEON_AUTH = compte client géré par Neon Auth (Managed Better Auth). */
  authProvider: "LOCAL" | "SUPABASE" | "NEON_AUTH";
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
  status: VehicleBusStatus;
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
  originCityId: string;
  originCityName: string;
  destinationCityId: string;
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

// Statut d'une place POUR UN VOYAGE (TripSeat) — vocabulaire contractuel
// partagé avec le SITE AGENCES (docs/api-centrale-contract.md).
// - AVAILABLE : aucune occupation active (verrou expiré → redevenue libre)
// - HELD      : verrou temporaire (hold 10 min) en cours
// - PAID      : réservation confirmée/payée (interne BOOKED)
// - CANCELLED : annulée — règle métier : la place REDEVIENT disponible
// - BOARDED   : passager embarqué (ticket scanné USED)
export type TripSeatStatus = "AVAILABLE" | "HELD" | "PAID" | "CANCELLED" | "BOARDED";

export interface SeatMapSeatDTO {
  id: string;
  seatNumber: string;
  /** Alias contractuel de seatNumber (API centrale). */
  number: string;
  row: number;
  column: string;
  type: SeatType;
  status: TripSeatStatus;
}

export interface SeatMapDTO {
  tripId: string;
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
  total: number; // total de places physiques du bus (= seats.length)
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

/** Quartier d'arrêt public (formulaire de réservation) — liste légère
 *  des quartiers ACTIFS d'une ville, configurés dans l'admin. */
export interface PublicNeighborhoodDTO {
  id: string;
  name: string;
}

/** Client minimal du contrat API centrale (POST /api/bookings/hold §7). */
export interface HoldCustomerInput {
  name: string; // « Jean Mbala » — split serveur en prénom/nom
  phone: string;
  email?: string;
}

export interface CreateBookingInput {
  tripId: string;
  /** Siège unique (compatibilité POST /api/bookings historique). */
  seatId?: string;
  /** Multi-sièges (contrat §7) — prioritaire sur seatId, 1..6 places. */
  seatIds?: string[];
  /** Passager complet (flux historique) — requis si `customer` absent. */
  passenger?: PassengerInput;
  /** Passagers NOMMÉS par place (extension §24, alignés par index sur
   *  seatIds) — chaque place peut porter un voyageur différent (famille,
   *  groupe). Phone optionnel : le serveur utilise le téléphone de
   *  l'acheteur comme contact de repli. */
  passengers?: Array<Omit<PassengerInput, "phone"> & { phone?: string }>;
  /** Client simplifié (contrat §7) — utilisé si passenger absent. */
  customer?: HoldCustomerInput;
  channel?: "WEB" | "AGENT";
  /** Agence choisie par le client (contrat §5) — canal de vente de la
   *  réservation. Validée serveur : existante + ACTIVE. Ne possède PAS
   *  la place (la disponibilité reste globale au voyage). */
  agencyId?: string;
  promoCode?: string; // code fidélité/campagne — remise appliquée au montant
  dropOffNeighborhoodId?: string; // quartier d'arrêt à la destination (optionnel)
  /** Idempotency-Key (contrat §16) — rejouer la requête ne crée JAMAIS
   *  une seconde réservation. */
  idempotencyKey?: string;
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
  /** Toutes les places de la réservation (multi-sièges, contrat §7) —
   *  avec le passager nommé de chaque place et son embarquement (§6.1). */
  seats: { id: string; seatNumber: string; type: SeatType; passenger: { firstName: string; lastName: string } | null; boardedAt: string | null }[];
  passenger: { id: string; firstName: string; lastName: string; phone: string; documentNumber: string | null };
  dropOffNeighborhood?: { id: string; name: string; cityName: string } | null;
  agencyName: string | null;
  createdByName: string | null;
  /** Statut contractuel API centrale (PENDING→HELD, COMPLETED→CONFIRMED). */
  contractStatus: "HELD" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
  /** Alias contractuel de expiresAt (contrat §9). */
  holdExpiresAt: string | null;
}

export interface TicketDTO {
  id: string;
  token: string;
  boardingNumber: string | null; // V3 — « NZK-8F42K9 » : contrôle manuel
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

// ---------- ÉVÉNEMENTS (contrat §14/§15) ----------
export interface DomainEventDTO {
  id: string;
  type: string; // SEAT_HELD, SEAT_RELEASED, SEAT_PAID, BOOKING_CONFIRMED…
  aggregateType: string;
  aggregateId: string;
  tripId: string | null;
  bookingId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EventsResponseDTO {
  events: DomainEventDTO[];
  cursor: string | null;
  hasMore: boolean;
  pollAfterMs: number;
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

/** Méthode de paiement exposée AU PUBLIC (contrat §3.1 — /api/payments/methods).
 *  Disponibilité HONNÊTE : le client ne voit jamais une méthode qui échouerait
 *  systématiquement (503) — l'état est calculé côté serveur, sans aucun secret. */
export interface PaymentMethodDTO {
  provider: PaymentProvider;
  label: string;
  /** Utilisable dès maintenant (clés fournisseur présentes / confirmation humaine possible). */
  available: boolean;
  /** instant = confirmation automatique (MoMo) · manual = confirmation humaine (guichet, comptable). */
  kind: "instant" | "manual";
  /** Message honnête si indisponible (ex. « Bientôt disponible ») — null sinon. */
  note: string | null;
}

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
  /** Paiement ciblé par l'action « Marquer remboursé » (§3.16) — null si aucun. */
  paymentId: string | null;
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

/** Une place du groupe au scan d'embarquement (extension passagers nommés §24). */
export interface ScanSeatDTO {
  seatNumber: string;
  seatType: SeatType;
  passengerName: string;
  /** true = passager acheteur (contact de référence de la réservation). */
  isBuyer: boolean;
  /** null = passager pas encore embarqué. */
  boardedAt: string | null;
}

export interface ScanResultDTO {
  result: ScanResultCode;
  message: string;
  boarded: boolean;
  /** true = aperçu SANS mutation : vérifications passées, embarquement à confirmer. */
  preview?: boolean;
  ticket: {
    reference: string;
    token: string;
    boardingNumber: string | null;
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
    agencyAddress: string | null;
    checkedAt: string | null;
    checkedByName: string | null;
    /** Toutes les places du billet avec LEUR passager nommé (multi-passagers §24). */
    seats: ScanSeatDTO[];
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
  passengers: { seatNumber: string; passengerName: string; boarded: boolean; reference: string; dropOffNeighborhoodName: string | null }[];
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
  /** V4 GPS — pourcentage de batterie du téléphone chauffeur (0–100). */
  batteryLevel?: number | null;
  /** Horodatage ORIGINAL du GPS (ISO 8601) — jamais réécrit. */
  recordedAt: string;
  /** V5 — identifiant d'idempotence (UUID généré à la capture, §9). */
  positionId?: string | null;
}

export interface GpsPointDTO {
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  /** V4 GPS — pourcentage de batterie du téléphone chauffeur (0–100, null si inconnu). */
  batteryLevel?: number | null;
  recordedAt: string;
}

export type TrackingSessionStatus = "ACTIVE" | "PAUSED" | "COMPLETED";

/** V5 — phase technique GPS du trajet (distincte du statut métier §22). */
export type SessionTripPhase = "IN_TRANSIT" | "AT_STOP" | "ARRIVING";

/** V5 — état GPS technique de la session (§11 : heartbeat vs position). */
export type SessionGpsStatus = "GPS_ACTIVE" | "GPS_STALE" | "GPS_OFFLINE" | "TERMINATED";

/** V5 — retard au prochain arrêt (§23). */
export type DelayStatus = "ON_TIME" | "SLIGHT_DELAY" | "HEAVY_DELAY";

export interface SessionNextStopDTO {
  name: string;
  distanceM: number | null;
  /** ETA estimée (ISO) selon la vitesse effective. */
  etaIso: string | null;
  /** Horaire prévu de passage (ISO). */
  scheduledIso: string | null;
  /** Retard en minutes (négatif = en avance). */
  delayMin: number | null;
  delayStatus: DelayStatus | null;
}

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
  /** V4 GPS — état dérivé du bus (voir deriveBusStatus, @/lib/geo). */
  busStatus?: BusStatus;
  /** V4 GPS — distance restante jusqu'à la destination officielle (m, arrondie ; null si indisponible). */
  distanceToDestinationM?: number | null;
  /** V5 — phase technique GPS du trajet (§22). */
  tripPhase?: SessionTripPhase | null;
  /** V5 — état GPS technique (heartbeat vs positions, §11). */
  gpsStatus?: SessionGpsStatus;
  /** V5 — dernier signal quelconque (heartbeat ou position, ISO). */
  lastSignalAt?: string | null;
  /** V5 — batterie du téléphone au dernier point (0–100). */
  batteryLevel?: number | null;
  /** V5 — arrêt courant lorsque le car est À L'ARRÊT (§20). */
  geofenceStopName?: string | null;
  /** V5 — prochain arrêt + ETA + retard (§15/§23). */
  nextStop?: SessionNextStopDTO | null;
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
  /** V5 — événements récents (vue flotte : WARN+CRITICAL ; détail : tous). */
  events?: TrackingEventItemDTO[];
  generatedAt: string;
  socketUrl: string;
  socketToken: string; // HMAC court — abonnement salon temps réel
  /** V4 GPS — compteurs par état (UNIQUEMENT en vue flotte, pas sur le trail). */
  kpi?: FleetKpi;
}

/** V5 — événement du journal GPS (panneau d'alertes + onglet Événements). */
export interface TrackingEventItemDTO {
  id: string;
  type: string;
  severity: "INFO" | "WARN" | "CRITICAL" | string;
  message: string | null;
  sessionId: string | null;
  tripId: string | null;
  busId: string | null;
  driverId: string | null;
  agencyId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

/** Compteurs d'états de la flotte GPS (vue admin). */
export interface FleetKpi {
  total: number;
  moving: number;
  stopped: number;
  offline: number;
  arrived: number;
  paused: number;
  /** V5 — bus en retard (léger ou important) au prochain arrêt. */
  delayed?: number;
  /** V5 — bus GPS silencieux (téléphone en ligne, positions périmées). */
  stale?: number;
}

/** V5 — verdict d'une position après jugement serveur (§38). */
export type GpsPositionVerdict =
  | "ACCEPT"
  | "ACCEPT_HISTORY_ONLY"
  | "ACCEPT_FLAGGED"
  | "DUPLICATE"
  | "REJECT_INVALID_COORDS"
  | "REJECT_FUTURE_TIMESTAMP"
  | "REJECT_STALE_TIMESTAMP"
  | "REJECT_IMPOSSIBLE_SPEED"
  | "REJECT_TELEPORT";

/** V5 — réponse du point isolé (verdict détaillé). */
export interface TrackingLocationResultDTO {
  verdict: GpsPositionVerdict;
  label: string;
  reason: string | null;
  accepted: number;
  rejected: number;
  duplicate: boolean;
  flagged: boolean;
  historyOnly: boolean;
  destinationArrived?: boolean;
  routeLabel?: string | null;
}

/** V5 — résultat PAR position d'un lot (§38). */
export interface TrackingBatchPointResultDTO {
  positionId: string | null;
  verdict: GpsPositionVerdict;
  reason: string | null;
}

/** Réponse du flush de la file offline. */
export interface TrackingBatchResultDTO {
  accepted: number;
  rejected: number; // points hors fenêtre de tolérance ou invalides
  /** V5 — doublons idempotents (aucune écriture). */
  duplicates?: number;
  /** V5 — arrivée destination détectée pendant le lot. */
  destinationArrived?: boolean;
  /** V5 — verdict PAR position. */
  results?: TrackingBatchPointResultDTO[];
}

// ---------- V4 GPS — CONFIG & CARTE PUBLIQUE ----------

/** Configuration de la carte ouverte (tuiles raster Leaflet, sans Google). */
export interface MapConfigDTO {
  provider: string;
  tileUrl: string; // template {z}/{x}/{y} — SEULE source d'URL de tuiles
  attribution: string; // HTML d'attribution légale
  defaultLat: number;
  defaultLng: number;
}

/** GET /api/tracking/config — valeurs EFFECTIVES serveur (aucune donnée sensible).
 *  Source unique du hook chauffeur (intervalles) et des cartes (tuiles). */
export interface TrackingConfigDTO {
  activeIntervalMs: number;
  idleIntervalMs: number;
  stoppedIntervalMs: number;
  stoppedSpeedKmh: number;
  offlineThresholdMs: number;
  arrivalRadiusM: number;
  map: MapConfigDTO;
}

/** LineString GeoJSON — convention [longitude, latitude] OBLIGATOIRE. */
export interface MapLineStringDTO {
  type: "LineString";
  coordinates: [number, number][];
}

/** Ville exposée sur la carte publique (uniquement avec coordonnées). */
export interface MapCityDTO {
  id: string;
  name: string;
  slug: string | null;
  latitude: number;
  longitude: number;
}

/** Agence publique (uniquement actives avec coordonnées — aucune donnée chauffeur). */
export interface MapAgencyDTO {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  cityId: string;
  latitude: number;
  longitude: number;
}

/** Arrêt d'une ligne sur la carte publique. */
export interface MapStopDTO {
  name: string;
  latitude: number;
  longitude: number;
  position: number;
  minutesFromStart: number;
}

/** Ligne (Route) publique avec son tracé. */
export interface MapRouteDTO {
  id: string;
  code: string;
  originCityName: string;
  destinationCityName: string;
  distanceKm: number;
  stops: MapStopDTO[];
  /** Tracé LineString GeoJSON [lng, lat] — null si non généré. */
  geometry: MapLineStringDTO | null;
}

/** Position d'un bus sur la carte publique (données VOLONTAIREMENT minimales :
 *  ni nom de chauffeur, ni immatriculation, ni agence). */
export interface MapBusDTO {
  sessionId: string;
  routeLabel: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  busStatus: BusStatus;
  recordedAt: string;
}

/** GET /api/map/public — données de la carte ouverte. */
export interface MapPublicDTO {
  cities: MapCityDTO[];
  agencies: MapAgencyDTO[];
  routes: MapRouteDTO[];
  /** Vide si PUBLIC_BUS_POSITIONS=false. */
  buses: MapBusDTO[];
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
  type: "daily" | "weekly" | "monthly" | "agency" | "bus" | "route" | "city" | "agent";
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
  resolved: boolean; // V3 — la réponse s'appuie sur des données certaines
  escalated: boolean; // V3 — escalade humaine proposée (information indisponible)
  category: string | null; // V3 — catégorie FAQ détectée (le cas échéant)
}

// ============================================================
// V3 — GÉOLOCALISATION CLIENT & ROUTING D'AGENCES
// ============================================================

export type NearbyAgencyStatus = "OPEN" | "CLOSED" | "FULL";

export interface NearbyAgencyDTO {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  cityId: string;
  cityName: string;
  neighborhoodId: string | null;
  neighborhoodName: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  distanceLabel: string | null; // "350 m" / "1,4 km"
  openNow: boolean;
  openingTime: string | null;
  closingTime: string | null;
  /** Intention de voyage : départs du jour sur la ligne (null = non demandé) */
  departuresToday: number | null;
  nextDepartureTime: string | null;
  nextDepartureSeats: number | null;
  nextDeparturePrice: number | null;
  status: NearbyAgencyStatus;
}

export interface AgencyNearbyResultDTO {
  neighborhood: { id: string; name: string; cityName: string } | null;
  detectedCity: { id: string; name: string } | null;
  agencies: NearbyAgencyDTO[];
  recommended: NearbyAgencyDTO | null;
  message: string;
}

export interface AgencyRecommendationDTO extends AgencyNearbyResultDTO {
  alternatives: NearbyAgencyDTO[];
  reason: string;
  seats: number;
}

export interface NeighborhoodDTO {
  id: string;
  cityId: string;
  cityName: string;
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  isActive: boolean;
  agencyCount: number;
  createdAt: string;
}

export interface CityWithGeoDTO {
  id: string;
  name: string;
  slug: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
}

// ============================================================
// V3 — BASE DE CONNAISSANCES & JOURNAL IA
// ============================================================

export const KNOWLEDGE_CATEGORIES = [
  "HORAIRES", "TARIFS", "AGENCES", "RESERVATION", "PAIEMENT", "BAGAGES",
  "EMBARQUEMENT", "ANNULATION", "REMBOURSEMENT", "CONTACT", "SERVICES",
  "GPS", "FIDELITE", "RECLAMATIONS",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export interface KnowledgeBaseDTO {
  id: string;
  title: string;
  question: string;
  answer: string;
  category: string;
  keywords: string;
  cityId: string | null;
  cityName: string | null;
  agencyId: string | null;
  agencyName: string | null;
  isActive: boolean;
  priority: number;
  version: number;
  createdByName: string | null;
  updatedByName: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface AIQuestionLogDTO {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  confidence: number | null;
  resolved: boolean;
  category: string | null;
  createdAt: string;
}

export interface AIQuestionsStatsDTO {
  total: number;
  resolved: number;
  unresolved: number;
  last7Days: number;
  topQuestions: { question: string; count: number }[];
  topCategories: { category: string | null; count: number }[];
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
  /** Mode "local" : pipeline sandbox (code local, devCode si OTP_DEBUG). */
  mode: "local" | "neon";
  /** E.164 (mode local : digits sans « + » ; mode Neon : avec « + »). */
  phone: string;
  expiresInSec?: number;
  // Uniquement si OTP_DEBUG=true (sandbox/ZIP sans passerelle SMS) :
  devCode?: string;
  // Mode Neon uniquement : un nouveau compte a été provisionné
  provisioned?: boolean;
}

export interface OtpVerifyInput {
  phone: string;
  code: string; // 6 chiffres
}

// ---------- RÉINITIALISATION DE MOT DE PASSE (mot de passe oublié) ----------

/** Réponse de la demande de réinitialisation (POST /api/auth/password-reset, action "request"). */
export interface PasswordResetRequestDTO {
  mode: "neon" | "local";
  /** Adresse e-mail canonisée effectivement utilisée (identifiants courts résolus). */
  email: string;
  /** Durée de validité du code en secondes (15 min, aligné Neon). */
  expiresInSec: number;
  // Uniquement si OTP_DEBUG=true (sandbox) :
  devCode?: string;
  /** Sandbox uniquement (OTP_DEBUG) : adresse inconnue dans cet environnement de démonstration. */
  demoUnknown?: boolean;
}

/** Réponse de la validation du code + nouveau mot de passe (action "verify"). */
export interface PasswordResetResultDTO {
  mode: "neon" | "local";
  ok: true;
}

/** Modes d'authentification actifs (GET /api/auth/providers). */
export interface AuthProvidersDTO {
  supabase: boolean;
  neon: boolean;
  /** "neon" = identité/session centralisées Neon Auth (production) ; "local" = stub sandbox. */
  mode: "local" | "neon";
  /** Compte de service Neon configuré (provisioning téléphone + pont d'import). */
  neonService: boolean;
  /** Fournisseur de livraison e-mail actif (NOM uniquement, aucun secret). "log" = aucune livraison réelle. */
  emailDelivery?: string;
  /** Fournisseur de livraison SMS actif (NOM uniquement, aucun secret). "log" = aucune livraison réelle. */
  smsDelivery?: string;
}

/** Réponse du pont d'import (POST /api/auth/login en mode Neon). */
export interface MigrationBridgeDTO {
  migrated: true;
  email: string;
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
  originCityId: string; // pour « Réserver à nouveau » (pré-remplissage recherche)
  originCityName: string;
  destinationCityId: string;
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
