"use client";

// ============================================================
// OCÉAN DU NORD — Départs du jour (agence)
// ============================================================

import { Bus, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api-client";
import { TRIP_STATUS_COLORS, TRIP_STATUS_LABELS } from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/format";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { todayCongoISO } from "@/components/shared/nzoko-format";

export function AgencyDepartures({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.agency.stats(), {
    autoRefreshMs: 60_000,
    refreshKey,
  });

  const departures = (data?.upcomingDepartures ?? []).filter(
    (t) => t.departureTime.slice(0, 10) === todayCongoISO(),
  );

  return (
    <div>
      {loading && <NzokoListSkeleton count={3} />}
      {error && <NzokoErrorBox error={error} onRetry={reload} />}
      {!loading && !error && departures.length === 0 && (
        <NzokoEmptyState
          icon={CalendarClock}
          title="Aucun départ prévu aujourd'hui"
          description="Les départs du jour s'afficheront ici dès leur programmation."
        />
      )}
      {!loading && !error && departures.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {departures.map((t) => {
            const sold = t.totalSeats - t.availableSeats;
            const soldPct = t.totalSeats > 0 ? Math.round((sold / t.totalSeats) * 100) : 0;
            return (
              <Card key={t.id} className="gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">{t.code}</span>
                  <Badge variant="outline" className={TRIP_STATUS_COLORS[t.status]}>
                    {TRIP_STATUS_LABELS[t.status]}
                  </Badge>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold tabular-nums text-primary">
                    {formatTime(t.departureTime)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(t.departureTime)}</p>
                </div>
                <p className="text-sm font-semibold">
                  {t.originCityName} → {t.destinationCityName}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bus className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.busBrand} {t.busModel} · {t.busRegistration}
                </p>
                <div>
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>
                      {sold}/{t.totalSeats} places vendues
                    </span>
                    <span>{t.availableSeats} restantes</span>
                  </div>
                  <Progress
                    value={soldPct}
                    className="mt-1 h-2"
                    aria-label={`Remplissage du voyage ${t.code}`}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
