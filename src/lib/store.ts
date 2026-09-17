"use client";

// ============================================================
// NZOKO TRANSPORT — État global (zustand) : session + navigation
// ============================================================

import { create } from "zustand";
import { api } from "@/lib/api-client";
import type { SessionUser } from "@/types";

export type ViewKey = "home" | "booking" | "tracking" | "login" | "register" | "workspace";

export interface BookingSearchParams {
  from: string; // cityId
  to: string; // cityId
  date: string; // YYYY-MM-DD
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
  setView: (view) => set({ view }),
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
    set({ session: null, view: "home" });
  },
}));
