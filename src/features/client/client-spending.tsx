"use client";

// ============================================================
// Océan du Nord — Dépenses : ce mois / cette année / total + graphique
// en barres (recharts) des 12 derniers mois + récapitulatif
// des voyages payés (montant + date).
// ============================================================

import { useMemo } from "react";
import { ArrowRight, CalendarDays, CalendarRange, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NzokoChartEmpty, NzokoTrendChart } from "@/components/shared/nzoko-charts";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoChartSkeleton } from "@/components/shared/nzoko-skeletons";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ClientKpiCard } from "@/features/client/client-kpi-card";
import { monthLabel } from "@/features/client/client-utils";

export function ClientSpending({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.client.spending(), { refreshKey });
  const { data: trips } = useApiData(() => api.client.trips(), { refreshKey });

  const paidTrips = useMemo(
    () =>
      (trips ?? [])
        .filter((t) => t.status === "COMPLETED" || t.status === "CONFIRMED")
        .sort((a, b) => b.departureTime.localeCompare(a.departureTime)),
    [trips],
  );

  const chartPoints = useMemo(
    () => (data?.monthly ?? []).map((m) => ({ label: monthLabel(m.month), value: m.amount })),
    [data],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="gap-0 p-4 py-4">
              <Skeleton className="size-10 rounded-xl" />
              <Skeleton className="mt-3 h-6 w-24" />
              <Skeleton className="mt-2 h-3 w-20" />
            </Card>
          ))}
        </div>
        <NzokoChartSkeleton height={280} />
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const totalPaid = paidTrips.reduce((sum, t) => sum + t.amount, 0);
  const hasChartData = chartPoints.some((p) => p.value > 0);

  return (
    <div className="space-y-6">
      {/* --- 3 KPI --- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ClientKpiCard label="Ce mois" value={formatMoney(data.thisMonth)} icon={CalendarDays} tone="green" />
        <ClientKpiCard label="Cette année" value={formatMoney(data.thisYear)} icon={CalendarRange} tone="orange" />
        <ClientKpiCard label="Total depuis le début" value={formatMoney(data.total)} icon={Wallet} tone="amber" />
      </div>

      {/* --- Graphique 12 mois (recharts) --- */}
      <Card className="nzoko-fade-up">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <Wallet className="size-4 text-primary" aria-hidden /> Dépenses des 12 derniers mois
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasChartData ? (
            <NzokoTrendChart
              kind="bar"
              points={chartPoints}
              color="var(--primary)"
              formatValue={(v) => formatMoney(v)}
              height={220}
            />
          ) : (
            <NzokoChartEmpty message="Aucune dépense enregistrée sur les 12 derniers mois." />
          )}
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Survolez une barre pour afficher le montant du mois.
          </p>
        </CardContent>
      </Card>

      {/* --- Récapitulatif des voyages payés --- */}
      <Card className="nzoko-fade-up">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-1.5">
              <CalendarRange className="size-4 text-primary" aria-hidden /> Voyages payés
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {paidTrips.length} billet{paidTrips.length > 1 ? "s" : ""} · {formatMoney(totalPaid)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paidTrips.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card/50 px-4 py-5 text-center text-sm text-muted-foreground">
              Aucun voyage payé pour le moment — vos billets réglés apparaîtront ici.
            </p>
          ) : (
            <ul
              className="nzoko-scroll max-h-80 space-y-1.5 overflow-y-auto pr-1"
              role="list"
              aria-label="Voyages payés, du plus récent au plus ancien"
            >
              {paidTrips.map((t) => (
                <li
                  key={t.bookingId}
                  role="listitem"
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">{t.originCityName}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <span className="truncate">{t.destinationCityName}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {formatDateTime(t.departureTime)} · {t.agencyName}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums">{formatMoney(t.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
