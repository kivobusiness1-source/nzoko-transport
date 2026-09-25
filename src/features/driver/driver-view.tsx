"use client";

// ============================================================
// NZOKO TRANSPORT — Espace CHAUFFEUR
// Onglet 1 : timeline des voyages (aujourd'hui / à venir / récents)
//            + manifeste passagers. Aucune donnée financière.
// Onglet 2 : suivi GPS temps réel (module tracking) — démarrage/
//            pause/reprise/arrêt, file offline, état du signal.
// ============================================================

import { useMemo, useState } from "react";
import { BusFront, CalendarClock, History, Navigation } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoTabs } from "@/components/shared/nzoko-chips";
import { NzokoWorkspaceHeader } from "@/components/shared/nzoko-workspace-header";
import { todayCongoISO } from "@/components/shared/nzoko-format";
import { DriverTripCard } from "@/features/driver/driver-trip-card";
import { DriverGpsPanel } from "@/features/driver/driver-gps-panel";

export default function DriverView() {
  const { session } = useApp();
  const [tab, setTab] = useState("trips");
  const { data, loading, error, reload } = useApiData(() => api.driver.trips(), {
    autoRefreshMs: 60_000,
  });

  const { todayCount, sections } = useMemo(() => {
    const trips = data ?? [];
    const sorted = [...trips].sort((a, b) => a.departureTime.localeCompare(b.departureTime));
    const today = todayCongoISO();
    const todayTrips = sorted.filter((t) => t.departureTime.slice(0, 10) === today);
    const upcoming = sorted.filter((t) => t.departureTime.slice(0, 10) > today);
    const past = sorted.filter((t) => t.departureTime.slice(0, 10) < today).reverse();
    return {
      todayCount: todayTrips.length,
      sections: [
        { key: "today", label: "Aujourd'hui", icon: CalendarClock, trips: todayTrips },
        { key: "upcoming", label: "À venir", icon: BusFront, trips: upcoming },
        { key: "past", label: "Récents", icon: History, trips: past },
      ].filter((s) => s.trips.length > 0),
    };
  }, [data]);

  if (!session) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 pb-6">
      <NzokoWorkspaceHeader
        title="Espace chauffeur"
        icon={BusFront}
        session={session}
        onRefresh={reload}
        extra={
          <Badge
            variant="outline"
            className={todayCount > 0 ? "border-emerald-300 bg-emerald-100 text-emerald-800" : ""}
          >
            {todayCount > 0 ? `Aujourd'hui : ${todayCount} voyage${todayCount > 1 ? "s" : ""}` : "Aucun voyage aujourd'hui"}
          </Badge>
        }
      />

      <NzokoTabs
        ariaLabel="Sections espace chauffeur"
        tabs={[
          { key: "trips", label: "Mes voyages", icon: CalendarClock },
          { key: "gps", label: "Suivi GPS", icon: Navigation },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "gps" && <DriverGpsPanel trips={data ?? []} />}

      {tab === "trips" && (
        <div className="space-y-6">
          {loading && <NzokoListSkeleton count={3} />}
          {error && <NzokoErrorBox error={error} onRetry={reload} />}
          {!loading && !error && (data ?? []).length === 0 && (
            <NzokoEmptyState
              icon={BusFront}
              title="Aucun voyage planifié"
              description="Vous n'avez pas de voyage assigné pour le moment. Revenez plus tard."
            />
          )}
          {!loading &&
            !error &&
            sections.map((section) => (
              <section key={section.key} aria-label={section.label}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  <section.icon className="h-4 w-4" aria-hidden="true" />
                  {section.label}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold">
                    {section.trips.length}
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {section.trips.map((t) => (
                    <DriverTripCard key={t.id} trip={t} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </section>
  );
}
