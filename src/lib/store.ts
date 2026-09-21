"use client";

// ============================================================
// NZOKO TRANSPORT — État global (zustand) : session + navigation
// + persistance courte de la vue (sessionStorage, Task 31) : un
// rechargement de page ne renvoie PLUS un utilisateur connecté à
// l'accueil — sa dernière vue (workspace/booking/tracking/map) est
// restaurée. JAMAIS login/register. Purgée à la déconnexion.
// ============================================================

import { create } from "zustand";
import { api } from "@/lib/api-client";
import type { SessionUser } from "@/types";

export type ViewKey = "home" | "booking" | "tracking" | "map" | "login" | "register" | "workspace";

export interface BookingSearchParams {
  from: string; // cityId
  to: string; // cityId
  date: string; // YYYY-MM-DD
}

/** Clé sessionStorage de la dernière vue persistable. */
const VIEW_STORAGE_KEY = "nzoko:view";
/** Vues restaurables après rechargement — JAMAIS les écrans d'auth.
 *  « map » suit le même régime public que « tracking ». */
const PERSISTABLE_VIEWS: readonly ViewKey[] = ["booking", "tracking", "map", "workspace"];

/**
 * Restaure la dernière vue persistée — appelé UNE fois au montage du
 * shell applicatif (côté client uniquement). La restauration se fait au
 * montage — et non à l'évaluation du module — pour rester compatible
 * avec le premier rendu serveur : l'accueil SSR reste la source de
 * vérité de l'hydratation, la vue persistée s'applique juste après.
 */
export function restorePersistedView(): void {
  if (typeof window === "undefined") return;
  try {
    const stored = window.sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (!stored) return;
    const view = stored as ViewKey;
    if (PERSISTABLE_VIEWS.includes(view)) useApp.setState({ view });
  } catch {
    // sessionStorage indisponible (navigation privée) : on reste sur home.
  }
}

interface AppState {
  session: SessionUser | null;
  sessionReady: boolean;
  view: ViewKey;
  bookingSearch: BookingSearchParams | null;
  setSession: (session: SessionUser | null) => void;
  setSessionReady: (ready: boolean) => void;
  setView: (view: ViewKey) => void;
  setBookingSearch: (params: BookingSearchParams | null) => void;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useApp = create<AppState>((set) => ({
  session: null,
  sessionReady: false,
  view: "home",
  bookingSearch: null,
  setSession: (session) => set({ session }),
  setSessionReady: (sessionReady) => set({ sessionReady }),
  setView: (view) => {
    set({ view });
    // Persistance best effort (jamais bloquante) : uniquement les vues
    // restaurables — login/register ne doivent jamais être restaurées.
    try {
      if (typeof window !== "undefined") {
        if (PERSISTABLE_VIEWS.includes(view)) {
          window.sessionStorage.setItem(VIEW_STORAGE_KEY, view);
        } else {
          window.sessionStorage.removeItem(VIEW_STORAGE_KEY);
        }
      }
    } catch {
      // quota / navigation privée : ignorer.
    }
  },
  setBookingSearch: (bookingSearch) => set({ bookingSearch }),
  refreshSession: async () => {
    try {
      const me = await api.auth.me();
      set({ session: me ?? null });
    } catch {
      set({ session: null });
    } finally {
      set({ sessionReady: true });
    }
  },
  logout: async () => {
    try {
      await api.auth.logout();
    } catch {
      // la session locale est purgée quoi qu'il arrive
    }
    // Session Neon Auth : déconnexion du service managé en best-effort —
    // systématique depuis l'unification de l'identité (sans objet si
    // aucune session Neon n'existe : l'appel échoue silencieusement).
    // (import dynamique : le SDK ne charge que lorsqu'il sert vraiment.)
    void import("@/lib/neon-auth/client")
      .then(({ neonAuthClient }) => neonAuthClient.signOut())
      .catch(() => {});
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(VIEW_STORAGE_KEY);
      } catch {
        // navigation privée : ignorer.
      }
    }
    set({ session: null, view: "home" });
  },
}));
