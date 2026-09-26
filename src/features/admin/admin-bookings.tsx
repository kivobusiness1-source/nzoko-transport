"use client";

// ============================================================
// OCÉAN DU NORD — Réservations admin (filtre agence si global)
// ============================================================

import { useApp } from "@/lib/store";
import { api, hasPerm } from "@/lib/api-client";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoBookingsBrowser } from "@/components/shared/nzoko-bookings-browser";
import type { AgencyDTO } from "@/types";

export function AdminBookings({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();

  const isGlobal = session?.agencyId == null;
  const { data: agencies } = useApiData(
    () => (isGlobal ? api.admin.agencies() : Promise.resolve([] as AgencyDTO[])),
    { refetchKey: [isGlobal] },
  );

  if (!session) return null;

  return (
    <NzokoBookingsBrowser
      fetchPage={(p) =>
        api.admin.bookings({
          page: p.page,
          status: p.status,
          q: p.q,
          agencyId: p.agencyId ?? (isGlobal ? undefined : session.agencyId ?? undefined),
        })
      }
      showAgencySelect={isGlobal}
      agencies={agencies ?? []}
      canCancel={hasPerm(session, "booking:manage")}
      refreshKey={refreshKey}
    />
  );
}
