"use client";

// ============================================================
// NZOKO TRANSPORT — Réservations agence (filtres + détail)
// ============================================================

import { useApp } from "@/lib/store";
import { api, hasPerm } from "@/lib/api-client";
import { NzokoBookingsBrowser } from "@/components/shared/nzoko-bookings-browser";

export function AgencyBookings({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();

  if (!session) return null;

  return (
    <NzokoBookingsBrowser
      fetchPage={(p) => api.agency.bookings({ page: p.page, status: p.status, q: p.q })}
      canCancel={hasPerm(session, "booking:manage")}
      refreshKey={refreshKey}
    />
  );
}
