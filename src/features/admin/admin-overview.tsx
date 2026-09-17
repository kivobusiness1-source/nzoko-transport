"use client";

// ============================================================
// NZOKO TRANSPORT — Vue d'ensemble admin
// KPIs + séries 14 j + perf agences + alertes
// (listes : admin-overview-lists.tsx)
// ============================================================

import {
  AlertTriangle,
  Building2,
  Bus,
  Info,
  OctagonAlert,
  Percent,
  Ticket,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { formatMoney, formatDateShort } from "@/lib/format";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoKpiCard } from "@/components/shared/nzoko-kpi-card";
import {
  NzokoChartSkeleton,
  NzokoKpiSkeletons,
  NzokoListSkeleton,
} from "@/components/shared/nzoko-skeletons";
import { NzokoChartEmpty, NzokoTrendChart } from "@/components/shared/nzoko-charts";
import { AdminOverviewLists } from "@/features/admin/admin-overview-lists";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import type { AdminStatsDTO } from "@/types";
import { cn } from "@/lib/utils";

const ALERT_STYLES: Record<AdminStatsDTO["alerts"][number]["level"], string> = {
  ALERT: "border-red-200 bg-red-50 text-red-800",
  WARNING: "border-amber-200 bg-amber-50 text-amber-800",
  INFO: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function AdminOverview({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.admin.stats(14), {
    autoRefreshMs: 60_000,
    refreshKey,
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <NzokoKpiSkeletons count={6} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-3 p-4">
            <p className="text-sm font-semibold">Revenus des 14 derniers jours</p>
            <NzokoChartSkeleton />
          </Card>
          <Card className="gap-3 p-4">
            <p className="text-sm font-semibold">Réservations des 14 derniers jours</p>
            <NzokoChartSkeleton />
          </Card>
        </div>
        <NzokoListSkeleton count={3} />
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const { kpis } = data;
  const revenuePoints = data.revenueSeries.map((s) => ({
    label: formatDateShort(s.date),
    value: s.amount,
  }));
  const bookingPoints = data.bookingsSeries.map((s) => ({
    label: formatDateShort(s.date),
    value: s.count,
  }));

  return (
    <div className="space-y-6">
      {(kpis.pendingPayments > 0 || kpis.expiringBookings > 0) && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          role="status"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> À traiter
          </p>
          {kpis.pendingPayments > 0 && (
            <p>
              <span className="font-bold tabular-nums">{kpis.pendingPayments}</span> paiement
              {kpis.pendingPayments > 1 ? "s" : ""} en attente
            </p>
          )}
          {kpis.expiringBookings > 0 && (
            <p>
              <span className="font-bold tabular-nums">{kpis.expiringBookings}</span> réservation
              {kpis.expiringBookings > 1 ? "s" : ""} expirant bientôt
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <NzokoKpiCard label="Réservations du jour" value={String(kpis.bookingsToday)} icon={Ticket} tone="amber" />
        <NzokoKpiCard label="Revenus du jour" value={formatMoney(kpis.revenueToday)} icon={Wallet} tone="green" />
        <NzokoKpiCard label="Revenus du mois" value={formatMoney(kpis.revenueMonth)} icon={TrendingUp} tone="orange" />
        <NzokoKpiCard label="Voyages actifs" value={String(kpis.activeTrips)} icon={Bus} tone="green" />
        <NzokoKpiCard label="Bus actifs" value={String(kpis.activeBuses)} icon={Truck} tone="neutral" />
        <NzokoKpiCard
          label="Taux d'occupation"
          value={`${kpis.occupancyRate.toFixed(1).replace(".", ",")} %`}
          icon={Percent}
          tone="green"
          hint="Sièges vendus sur l'ensemble des voyages"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <p className="text-sm font-semibold">Revenus des 14 derniers jours</p>
          {revenuePoints.length === 0 ? (
            <NzokoChartEmpty message="Pas encore de revenus enregistrés." />
          ) : (
            <NzokoTrendChart points={revenuePoints} kind="area" color="var(--chart-1)" />
          )}
        </Card>
        <Card className="gap-3 p-4">
          <p className="text-sm font-semibold">Réservations des 14 derniers jours</p>
          {bookingPoints.length === 0 ? (
            <NzokoChartEmpty message="Pas encore de réservations enregistrées." />
          ) : (
            <NzokoTrendChart
              points={bookingPoints}
              kind="bar"
              color="var(--chart-2)"
              formatValue={(v) => `${v} réservation${v > 1 ? "s" : ""}`}
              formatAxis={(v) => String(Math.round(v))}
            />
          )}
        </Card>
      </div>

      {data.alerts.length > 0 && (
        <section className="grid gap-2" aria-label="Alertes système">
          {data.alerts.map((a, i) => (
            <div
              key={i}
              role="alert"
              className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-sm", ALERT_STYLES[a.level])}
            >
              {a.level === "ALERT" ? (
                <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : a.level === "WARNING" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <p>{a.message}</p>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Performance des agences">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Building2 className="h-4 w-4" aria-hidden="true" /> Performance des agences
        </h2>
        {data.agencyPerformance.length === 0 ? (
          <NzokoEmptyState icon={Building2} title="Aucune agence active" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.agencyPerformance.map((a) => (
              <Card key={a.agencyId} className="gap-2 p-4">
                <p className="text-sm font-semibold">{a.agencyName}</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Revenus</p>
                    <p className="text-sm font-semibold text-emerald-600">{formatMoney(a.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Réserv.</p>
                    <p className="text-sm font-semibold tabular-nums">{a.bookings}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Occupation</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {a.occupancy.toFixed(0)} %
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <AdminOverviewLists stats={data} />
    </div>
  );
}
