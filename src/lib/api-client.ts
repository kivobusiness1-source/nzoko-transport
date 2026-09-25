// ============================================================
// NZOKO TRANSPORT — Client API typé (frontend)
// Contrat unique consommé par toute l'interface.
// Enveloppe : { success: true, data } | { success: false, error: { code, message } }
// ============================================================

import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@/lib/auth-shared";
import type {
  AgencyDTO, AgencyStatsDTO, AdminStatsDTO, AssistantReplyDTO, AuditLogDTO, BoardingTripDTO, BookingDTO,
  BookingDetailDTO, BusDTO, CityDTO, DriverDTO, DriverTripDTO, ExpenseDTO, FinanceSummaryDTO,
  GpsPointInput, TrackingSessionDTO, TrackingSessionActionDTO, TrackingFleetDTO, TrackingBatchResultDTO,
  TrackingConfigDTO, TrackingLocationResultDTO, MapPublicDTO,
  MomoOverviewDTO, NotificationDTO, Paginated, PaymentDTO, RefundMode, ReportDTO, RoleDTO, RouteDTO, ScanResultDTO,
  SeatLayoutDTO, SeatMapDTO, SecurityLogDTO, SessionUser, TransactionDTO, TripContactsDTO, TripSearchDTO, UserDTO,
  RegisterInput, OtpRequestDTO, OtpVerifyInput, RegisterResult, ClientProfileDTO, ClientStatsDTO, ClientTripDTO, TripRatingInput,
  AuthProvidersDTO, MigrationBridgeDTO, PasswordResetRequestDTO, PasswordResetResultDTO,
  FavoriteRouteDTO, FavoriteRouteInput, SpendingDTO, LoyaltyDTO, ComplaintDTO, ComplaintDetailDTO,
  ComplaintCreateInput, ComplaintReplyInput, AdminClientDTO, AdminComplaintDTO, AdminLoyaltyStatsDTO, CampaignInput,
  PromoCodeValidationDTO, RedemptionRequestDTO,
  AgencyNearbyResultDTO, AgencyRecommendationDTO, NeighborhoodDTO, KnowledgeBaseDTO, PublicNeighborhoodDTO,
  AIQuestionLogDTO, AIQuestionsStatsDTO,
} from "@/types";
import type { ComplaintStatus, ExpenseCategory, PaymentProvider, PermissionCode, RewardKey, RoleCode } from "@/lib/constants";

export class ApiClientError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      [CSRF_HEADER]: CSRF_HEADER_VALUE,
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });

  let body: { success?: boolean; data?: T; error?: { code: string; message: string } } | null = null;
  try {
    body = await res.json();
  } catch {
    // réponse non JSON (ex: 500 nu) — géré ci-dessous
  }

  if (!res.ok || !body?.success) {
    const err = body?.error;
    throw new ApiClientError(err?.code ?? "NETWORK_ERROR", err?.message ?? "Connexion au serveur impossible. Vérifiez votre réseau.", res.status);
  }
  return body.data as T;
}

// ============================================================
// AUTH
// ============================================================
export const api = {
  auth: {
    // Le login accepte un identifiant : email OU téléphone (E.164, national, +242…)
    login: (identifier: string, password: string) =>
      request<SessionUser>("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
    // Pont d'import (mode Neon) : bcrypt local vérifié → compte Neon créé/aligné.
    // Le client enchaîne ensuite signIn.email (SDK) puis exchangeNeonSession.
    loginBridge: (identifier: string, password: string) =>
      request<MigrationBridgeDTO>("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
    // Inscription : SessionUser (session immédiate) OU demande de confirmation
    // d'e-mail (mode Supabase avec confirmation activée).
    register: (input: RegisterInput) =>
      request<RegisterResult>("/auth/register", { method: "POST", body: JSON.stringify(input) }),
    // Modes d'authentification actifs (adaptation de l'écran de connexion)
    providers: () => request<AuthProvidersDTO>("/auth/providers"),
    // Pont Neon Auth → session NZOKO (après signIn/signUp/OTP réussis côté SDK)
    exchangeNeonSession: () => request<SessionUser>("/neon-auth/exchange", { method: "POST" }),
    otpRequest: (phone: string) =>
      request<OtpRequestDTO>("/auth/otp", { method: "POST", body: JSON.stringify({ phone, action: "request" }) }),
    otpVerify: (input: OtpVerifyInput) =>
      request<SessionUser>("/auth/otp", { method: "POST", body: JSON.stringify({ ...input, action: "verify" }) }),
    // Mot de passe oublié — demande d'un code de réinitialisation par e-mail
    // (accepte un e-mail OU un identifiant court interne ; canonisation serveur).
    passwordResetRequest: (identifier: string) =>
      request<PasswordResetRequestDTO>("/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({ action: "request", email: identifier }),
      }),
    // Mot de passe oublié — validation du code + définition du nouveau mot de passe.
    passwordResetVerify: (email: string, code: string, password: string) =>
      request<PasswordResetResultDTO>("/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({ action: "verify", email, code, password }),
      }),
    logout: () => request<true>("/auth/logout", { method: "POST" }),
    me: () => request<SessionUser | null>("/auth/me"),
  },

  // ============================================================
  // COMPTE (paramètres) — identité de connexion
  // ============================================================
  account: {
    /** Change l'e-mail de connexion (exige le mot de passe actuel). Révoque toutes les sessions. */
    changeEmail: (newEmail: string, currentPassword: string) =>
      request<{ email: string; signedOut: boolean }>("/account/email", {
        method: "POST",
        body: JSON.stringify({ newEmail, currentPassword }),
      }),
  },

  // ============================================================
  // PUBLIC — villes, recherche, sièges, carte ouverte
  // ============================================================
  cities: () => request<CityDTO[]>("/cities"),

  /** Quartiers d'arrêt ACTIFS d'une ville (configurés dans l'admin) —
   *  liste publique légère pour le tunnel de réservation. */
  neighborhoods: (cityId: string) =>
    request<PublicNeighborhoodDTO[]>(`/neighborhoods?cityId=${encodeURIComponent(cityId)}`),

  /** V4 GPS — données de la carte publique (villes, agences, lignes + tracés, bus si activés). */
  mapPublic: () => request<MapPublicDTO>("/map/public"),

  trips: {
    search: (from: string, to: string, date: string, agencyId?: string) =>
      request<TripSearchDTO[]>(`/trips/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}${agencyId ? `&agencyId=${agencyId}` : ""}`),
    seats: (tripId: string) => request<SeatMapDTO>(`/trips/${tripId}/seats`),
  },

  // ============================================================
  // RÉSERVATIONS
  // ============================================================
  bookings: {
    create: (input: { tripId: string; seatId: string; channel?: "WEB" | "AGENT"; promoCode?: string; dropOffNeighborhoodId?: string; passenger: { firstName: string; lastName: string; phone: string; email?: string; documentNumber?: string } }) =>
      request<BookingDTO>("/bookings", { method: "POST", body: JSON.stringify(input) }),
    validatePromo: (code: string, tripId: string) =>
      request<PromoCodeValidationDTO>("/bookings/promo/validate", { method: "POST", body: JSON.stringify({ code, tripId }) }),
    get: (idOrRef: string) => request<BookingDetailDTO>(`/bookings/${encodeURIComponent(idOrRef)}`),
    cancel: (idOrRef: string) => request<BookingDetailDTO>(`/bookings/${encodeURIComponent(idOrRef)}/cancel`, { method: "PATCH" }),
  },

  // ============================================================
  // PAIEMENTS
  // ============================================================
  payments: {
    create: (input: { bookingId: string; provider: PaymentProvider; momoPhone?: string; senderName?: string }) =>
      request<PaymentDTO>("/payments", { method: "POST", body: JSON.stringify(input) }),
    confirmCash: (paymentId: string) => request<PaymentDTO>(`/payments/${paymentId}/confirm-cash`, { method: "POST" }),
    // MTN MoMo réel — suivi Request to Pay (polling, idempotent)
    momoStatus: (paymentId: string) =>
      request<PaymentDTO>("/payments/momo/status", { method: "POST", body: JSON.stringify({ paymentId }) }),
  },

  tickets: {
    qr: (token: string) => request<{ dataUrl: string }>(`/tickets/${encodeURIComponent(token)}/qr`),
    // V3 — URL de téléchargement du billet PDF A4 (token = secret du billet)
    pdfUrl: (token: string) => `/api/tickets/${encodeURIComponent(token)}/pdf`,
  },

  // ============================================================
  // V3 — GÉOLOCALISATION CLIENT & AGENCES
  // ============================================================
  agencies: {
    nearby: (
      lat: number,
      lng: number,
      cityId?: string,
      opts?: { accuracy?: number | null; approximate?: boolean }
    ) =>
      request<AgencyNearbyResultDTO>(
        `/agencies/nearby?lat=${lat}&lng=${lng}${cityId ? `&cityId=${cityId}` : ""}${
          opts?.accuracy != null ? `&accuracy=${Math.round(opts.accuracy)}` : ""
        }${opts?.approximate ? "&approximate=true" : ""}`
      ),
    recommend: (input: {
      lat: number;
      lng: number;
      fromCityId: string;
      toCityId: string;
      date: string;
      seats?: number;
      accuracy?: number | null;
    }) =>
      request<AgencyRecommendationDTO>("/agencies/recommend", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },

  // ============================================================
  // ASSISTANT IA — voyages / promotions / tarifs
  // ============================================================
  assistant: {
    chat: (input: { sessionId?: string; message: string }) =>
      request<AssistantReplyDTO>("/assistant", { method: "POST", body: JSON.stringify(input) }),
  },

  // ============================================================
  // CHECKER
  // ============================================================
  checker: {
    scan: (code: string) => request<ScanResultDTO>("/checker/scan", { method: "POST", body: JSON.stringify({ code }) }),
    trips: () => request<BoardingTripDTO[]>("/checker/trips"),
  },

  // ============================================================
  // V3 — ADMIN : QUARTIERS, BASE DE CONNAISSANCES, QUESTIONS IA
  // ============================================================
  adminV3: {
    neighborhoods: (cityId?: string) =>
      request<NeighborhoodDTO[]>(`/admin/neighborhoods${cityId ? `?cityId=${cityId}` : ""}`),
    createNeighborhood: (input: { cityId: string; name: string; latitude?: number | null; longitude?: number | null; radiusMeters?: number }) =>
      request<NeighborhoodDTO>("/admin/neighborhoods", { method: "POST", body: JSON.stringify(input) }),
    updateNeighborhood: (id: string, input: Partial<{ name: string; latitude: number | null; longitude: number | null; radiusMeters: number; isActive: boolean }>) =>
      request<NeighborhoodDTO>(`/admin/neighborhoods/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    deleteNeighborhood: (id: string) =>
      request<{ deleted?: boolean; deactivated?: boolean; agencies?: number }>(`/admin/neighborhoods/${id}`, { method: "DELETE" }),

    knowledgeBase: (params: { category?: string; cityId?: string; active?: string; q?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.category) qs.set("category", params.category);
      if (params.cityId) qs.set("cityId", params.cityId);
      if (params.active) qs.set("active", params.active);
      if (params.q) qs.set("q", params.q);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<KnowledgeBaseDTO[]>(`/admin/knowledge-base${suffix}`);
    },
    createKnowledge: (input: { title: string; question: string; answer: string; category: string; keywords?: string; cityId?: string | null; agencyId?: string | null; priority?: number }) =>
      request<KnowledgeBaseDTO>("/admin/knowledge-base", { method: "POST", body: JSON.stringify(input) }),
    updateKnowledge: (id: string, input: Partial<{ title: string; question: string; answer: string; category: string; keywords: string; cityId: string | null; agencyId: string | null; priority: number; isActive: boolean }>) =>
      request<KnowledgeBaseDTO>(`/admin/knowledge-base/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    deleteKnowledge: (id: string) =>
      request<{ deleted: boolean }>(`/admin/knowledge-base/${id}`, { method: "DELETE" }),

    aiQuestions: (params: { resolved?: "true" | "false"; category?: string; days?: number; take?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.resolved) qs.set("resolved", params.resolved);
      if (params.category) qs.set("category", params.category);
      if (params.days) qs.set("days", String(params.days));
      if (params.take) qs.set("take", String(params.take));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<AIQuestionLogDTO[]>(`/admin/ai-questions${suffix}`);
    },
    aiQuestionsStats: (days?: number) =>
      request<AIQuestionsStatsDTO>(`/admin/ai-questions?stats=true${days ? `&days=${days}` : ""}`),
  },

  // ============================================================
  // CHAUFFEUR
  // ============================================================
  driver: {
    trips: () => request<DriverTripDTO[]>("/driver/trips"),
  },

  // ============================================================
  // SUIVI GPS TEMPS RÉEL — session du chauffeur connecté
  // ============================================================
  tracking: {
    /** V4 GPS — configuration EFFECTIVE serveur (intervalles, seuils, tuiles de carte).
     *  Source unique du hook chauffeur et des cartes — aucune donnée sensible. */
    config: () => request<TrackingConfigDTO>("/tracking/config"),
    /** Session courante (ACTIVE/PAUSED) — réconciliation après rechargement. */
    session: () => request<TrackingSessionDTO | null>("/tracking/session"),
    start: (input: { tripId?: string | null; deviceId?: string | null } = {}) =>
      request<TrackingSessionActionDTO>("/tracking/session", {
        method: "POST",
        body: JSON.stringify({ action: "START", tripId: input.tripId ?? null, deviceId: input.deviceId ?? null }),
      }),
    pause: () =>
      request<TrackingSessionActionDTO>("/tracking/session", {
        method: "POST",
        body: JSON.stringify({ action: "PAUSE" }),
      }),
    resume: () =>
      request<TrackingSessionActionDTO>("/tracking/session", {
        method: "POST",
        body: JSON.stringify({ action: "RESUME" }),
      }),
    stop: () =>
      request<TrackingSessionActionDTO>("/tracking/session", {
        method: "POST",
        body: JSON.stringify({ action: "STOP" }),
      }),
    /** V5 — battement de cœur (§11) : téléphone en ligne, sans position. */
    heartbeat: (sessionId: string, input: { batteryLevel?: number | null } = {}) =>
      request<{ ok: boolean; positionFresh: boolean; sessionStatus: string }>("/tracking/heartbeat", {
        method: "POST",
        body: JSON.stringify({ sessionId, batteryLevel: input.batteryLevel ?? null }),
      }),
    /** Point isolé (envoi en ligne) — réponse V5 : verdict détaillé. */
    location: (sessionId: string, point: GpsPointInput, deviceId?: string | null) =>
      request<TrackingLocationResultDTO>("/tracking/location", {
        method: "POST",
        body: JSON.stringify({ sessionId, deviceId: deviceId ?? null, ...point }),
      }),
    /** Lot de points ≤ TRACKING.batchMaxPoints (flush file offline) —
     *  réponse V5 : verdict PAR position (§38). */
    batch: (sessionId: string, points: GpsPointInput[], deviceId?: string | null) =>
      request<TrackingBatchResultDTO>("/tracking/batch", {
        method: "POST",
        body: JSON.stringify({ sessionId, deviceId: deviceId ?? null, points }),
      }),
  },

  // ============================================================
  // AGENCE
  // ============================================================
  agency: {
    stats: () => request<AgencyStatsDTO>("/agency/stats"),
    bookings: (params: { page?: number; status?: string; q?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.page) qs.set("page", String(params.page));
      if (params.status) qs.set("status", params.status);
      if (params.q) qs.set("q", params.q);
      return request<Paginated<BookingDTO>>(`/agency/bookings?${qs.toString()}`);
    },
  },

  // ============================================================
  // ADMIN — stats & gestion
  // ============================================================
  admin: {
    stats: (days = 14) => request<AdminStatsDTO>(`/admin/stats?days=${days}`),

    users: (q?: string) => request<UserDTO[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    createUser: (input: { email: string; firstName: string; lastName: string; password: string; role: RoleCode; agencyId?: string | null; phone?: string }) =>
      request<UserDTO>("/admin/users", { method: "POST", body: JSON.stringify(input) }),
    updateUser: (id: string, input: Partial<{ email: string; firstName: string; lastName: string; password: string; role: RoleCode; agencyId: string | null; phone: string; isActive: boolean }>) =>
      request<UserDTO>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    roles: () => request<RoleDTO[]>("/admin/roles"),

    agencies: () => request<AgencyDTO[]>("/admin/agencies"),
    createAgency: (input: { code: string; name: string; cityId: string; address?: string; phone?: string; email?: string }) =>
      request<AgencyDTO>("/admin/agencies", { method: "POST", body: JSON.stringify(input) }),
    updateAgency: (id: string, input: Partial<{ code: string; name: string; cityId: string; address?: string | null; phone?: string | null; email?: string | null; isActive: boolean }>) =>
      request<AgencyDTO>(`/admin/agencies/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    cities: () => request<CityDTO[]>("/admin/cities"),
    createCity: (input: { name: string; country: string }) => request<CityDTO>("/admin/cities", { method: "POST", body: JSON.stringify(input) }),
    updateCity: (id: string, input: Partial<{ name: string; country: string; isActive: boolean }>) =>
      request<CityDTO>(`/admin/cities/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    routes: () => request<RouteDTO[]>("/admin/routes"),
    createRoute: (input: { originCityId: string; destinationCityId: string; distanceKm: number; estimatedDurationMinutes: number; basePrice: number; stops: { cityId: string; minutesFromStart: number }[] }) =>
      request<RouteDTO>("/admin/routes", { method: "POST", body: JSON.stringify(input) }),
    updateRoute: (id: string, input: Partial<{ distanceKm: number; estimatedDurationMinutes: number; basePrice: number; isActive: boolean }>) =>
      request<RouteDTO>(`/admin/routes/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    buses: () => request<BusDTO[]>("/admin/buses"),
    createBus: (input: { registrationNumber: string; brand: string; model: string; year?: number; status: string; agencyId: string; seatLayoutId: string }) =>
      request<BusDTO>("/admin/buses", { method: "POST", body: JSON.stringify(input) }),
    updateBus: (id: string, input: Partial<{ registrationNumber: string; brand: string; model: string; year: number | null; status: string; agencyId: string; seatLayoutId: string }>) =>
      request<BusDTO>(`/admin/buses/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    seatLayouts: () => request<SeatLayoutDTO[]>("/admin/seat-layouts"),
    createSeatLayout: (input: { name: string; rows: number; columns: number; aisleAfter: number; vipRows: number[]; description?: string }) =>
      request<SeatLayoutDTO>("/admin/seat-layouts", { method: "POST", body: JSON.stringify(input) }),

    drivers: () => request<DriverDTO[]>("/admin/drivers"),
    createDriver: (input: { firstName: string; lastName: string; phone?: string; licenseNumber: string; agencyId: string }) =>
      request<DriverDTO>("/admin/drivers", { method: "POST", body: JSON.stringify(input) }),
    updateDriver: (id: string, input: Partial<{ firstName: string; lastName: string; phone: string | null; licenseNumber: string; agencyId: string; status: string; userId: string | null }>) =>
      request<DriverDTO>(`/admin/drivers/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

    trips: (params: { date?: string; routeId?: string; agencyId?: string; status?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, String(v)));
      return request<TripSearchDTO[]>(`/admin/trips?${qs.toString()}`);
    },
    createTrip: (input: { routeId: string; busId: string; driverId?: string | null; agencyId: string; departureTime: string; price: number; repeatDays?: number }) =>
      request<{ created: TripSearchDTO[] }>("/admin/trips", { method: "POST", body: JSON.stringify(input) }),
    updateTrip: (id: string, input: Partial<{ status: string; price: number; driverId: string | null; busId: string }>) =>
      request<TripSearchDTO>(`/admin/trips/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    tripContacts: (id: string) => request<TripContactsDTO>(`/admin/trips/${id}/contacts`),

    bookings: (params: { page?: number; status?: string; q?: string; agencyId?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, String(v)));
      return request<Paginated<BookingDTO>>(`/admin/bookings?${qs.toString()}`);
    },
    payments: (params: { status?: string; provider?: string; q?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
      return request<PaymentDTO[]>(`/admin/payments?${qs.toString()}`);
    },
    // MTN MoMo — remboursements (envoi de fonds aux clients)
    initiateRefund: (paymentId: string, input: { mode: RefundMode; amount?: number; msisdn?: string }) =>
      request<PaymentDTO>(`/admin/payments/${paymentId}/refund`, { method: "POST", body: JSON.stringify(input) }),
    refundStatus: (paymentId: string) => request<PaymentDTO>(`/admin/payments/${paymentId}/refund`, { method: "GET" }),
    // MTN MoMo — état de configuration + soldes
    momoOverview: () => request<MomoOverviewDTO>("/admin/momo/overview"),
    // Suivi GPS temps réel — flotte live + trail d'une session
    tracking: (sessionId?: string) =>
      request<TrackingFleetDTO>(`/admin/tracking${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`),
  },

  // ============================================================
  // FINANCES & RAPPORTS
  // ============================================================
  finance: {
    summary: (from?: string, to?: string) => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      return request<FinanceSummaryDTO>(`/finance/summary?${qs.toString()}`);
    },
    transactions: (params: { type?: string; agencyId?: string; page?: number } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, String(v)));
      return request<Paginated<TransactionDTO>>(`/finance/transactions?${qs.toString()}`);
    },
    expenses: (params: { agencyId?: string; category?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
      return request<ExpenseDTO[]>(`/finance/expenses?${qs.toString()}`);
    },
    createExpense: (input: { category: ExpenseCategory; amount: number; description: string; agencyId?: string | null; tripId?: string | null; date?: string }) =>
      request<ExpenseDTO>("/finance/expenses", { method: "POST", body: JSON.stringify(input) }),
    deleteExpense: (id: string) => request<true>(`/finance/expenses/${id}`, { method: "DELETE" }),
  },

  reports: {
    get: (type: string, from?: string, to?: string, agencyId?: string) => {
      const qs = new URLSearchParams({ type });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (agencyId) qs.set("agencyId", agencyId);
      return request<ReportDTO>(`/reports?${qs.toString()}`);
    },
    downloadCsv: async (type: string, from?: string, to?: string, agencyId?: string): Promise<void> => {
      const qs = new URLSearchParams({ type, format: "csv" });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (agencyId) qs.set("agencyId", agencyId);
      const res = await fetch(`/api/reports?${qs.toString()}`, {
        headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
        credentials: "same-origin",
      });
      if (!res.ok) throw new ApiClientError("EXPORT_ERROR", "Impossible de générer l'export.", res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nzoko-rapport-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  },

  // ============================================================
  // NOTIFICATIONS & JOURNAUX
  // ============================================================
  notifications: {
    list: () => request<NotificationDTO[]>("/notifications"),
    markRead: (id?: string) => request<true>("/notifications/read", { method: "POST", body: JSON.stringify(id ? { id } : { all: true }) }),
  },

  logs: {
    audit: (params: { entity?: string; userId?: string; page?: number } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, String(v)));
      return request<Paginated<AuditLogDTO>>(`/audit-logs?${qs.toString()}`);
    },
    security: (params: { event?: string; page?: number } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, String(v)));
      return request<Paginated<SecurityLogDTO>>(`/security-logs?${qs.toString()}`);
    },
  },

  // ============================================================
  // ESPACE CLIENT — MON ESPACE NZOKO (Task ID 10)
  // ============================================================
  client: {
    profile: () => request<ClientProfileDTO>("/client/profile"),
    updateProfile: (input: Partial<{ firstName: string; lastName: string; email: string }>) =>
      request<ClientProfileDTO>("/client/profile", { method: "PATCH", body: JSON.stringify(input) }),
    changePassword: (input: { currentPassword: string; newPassword: string }) =>
      request<true>("/client/profile/password", { method: "PATCH", body: JSON.stringify(input) }),

    overview: () => request<ClientStatsDTO>("/client/overview"),
    trips: () => request<ClientTripDTO[]>("/client/trips"),
    spending: () => request<SpendingDTO>("/client/spending"),

    favorites: () => request<FavoriteRouteDTO[]>("/client/favorites"),
    addFavorite: (input: FavoriteRouteInput) =>
      request<FavoriteRouteDTO>("/client/favorites", { method: "POST", body: JSON.stringify(input) }),
    removeFavorite: (id: string) => request<true>(`/client/favorites/${encodeURIComponent(id)}`, { method: "DELETE" }),

    loyalty: () => request<LoyaltyDTO>("/client/loyalty"),
    redeem: (rewardKey: RewardKey) =>
      request<RedemptionRequestDTO>("/client/loyalty/redeem", { method: "POST", body: JSON.stringify({ rewardKey }) }),

    rateTrip: (input: TripRatingInput) =>
      request<true>("/client/ratings", { method: "POST", body: JSON.stringify(input) }),

    complaints: () => request<ComplaintDTO[]>("/client/complaints"),
    complaint: (id: string) => request<ComplaintDetailDTO>(`/client/complaints/${encodeURIComponent(id)}`),
    createComplaint: (input: ComplaintCreateInput) =>
      request<ComplaintDetailDTO>("/client/complaints", { method: "POST", body: JSON.stringify(input) }),
    replyComplaint: (id: string, input: ComplaintReplyInput) =>
      request<ComplaintDetailDTO>(`/client/complaints/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify(input) }),
  },

  // ============================================================
  // ADMIN — CLIENTS, FIDÉLITÉ, RÉCLAMATIONS (Task ID 10)
  // ============================================================
  clientAdmin: {
    stats: () => request<AdminLoyaltyStatsDTO>("/admin/clients/stats"),
    clients: (q?: string) => request<AdminClientDTO[]>(`/admin/clients${q ? `?q=${encodeURIComponent(q)}` : ""}`),

    complaints: (params: { status?: ComplaintStatus; q?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => v && qs.set(k, String(v)));
      return request<AdminComplaintDTO[]>(`/admin/complaints?${qs.toString()}`);
    },
    complaint: (id: string) => request<AdminComplaintDTO>(`/admin/complaints/${encodeURIComponent(id)}`),
    replyComplaint: (id: string, message: string) =>
      request<AdminComplaintDTO>(`/admin/complaints/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ message }) }),
    updateComplaint: (id: string, input: { status?: ComplaintStatus; assignToSelf?: boolean }) =>
      request<AdminComplaintDTO>(`/admin/complaints/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),

    redemptions: () => request<RedemptionRequestDTO[]>("/admin/clients/redemptions"),
    decideRedemption: (id: string, decision: "APPROVED" | "REJECTED", note?: string) =>
      request<RedemptionRequestDTO>(`/admin/clients/redemptions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ decision, note }) }),

    campaign: (input: CampaignInput) =>
      request<{ notified: number }>("/admin/clients/campaign", { method: "POST", body: JSON.stringify(input) }),
  },
};

// Ré-export pratique pour vérifier une permission côté UI (l'autorisation
// réelle reste TOUJOURS côté serveur — ceci ne sert qu'à l'affichage)
export function hasPerm(session: SessionUser | null, permission: PermissionCode): boolean {
  return session?.permissions.includes(permission) ?? false;
}
