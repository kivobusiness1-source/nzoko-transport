"use client";

// ============================================================
// NZOKO TRANSPORT — Tableau de bord agence
// KPIs + ventes 14 j + départs à venir + dernières ventes
// ============================================================

import {
  Bus,
  CalendarClock,
  Hourglass,
  LayoutDashboard,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { BOOKING_STATUS_COLORS, BOOKING_STATUS_LABELS, TRIP_STATUS_COLORS, TRIP_STATUS_LABELS } from "@/lib/constants";
import { formatDateTime, formatMoney, formatDateShort } from "@/lib/format";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoKpiCard } from "@/components/shared/nzoko-kpi-card";
import { NzokoChartSkeleton, NzokoKpiSkeletons, NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoTrendChart } from "@/components/shared/nzoko-charts";
import type { BookingDTO, TripSearchDTO } from "@/types";

export function AgencyDashboard({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.agency.stats(), {
    autoRefreshMs: 60_000,
    refreshKey,
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <NzokoKpiSkeletons count={6} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-3 p-4">
            <p className="text-sm font-semibold">Ventes des 14 derniers jours</p>
            <NzokoChartSkeleton />
          </Card>
          <NzokoListSkeleton count={3} />
        </div>
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const { kpis } = data;
  const salesPoints = data.salesSeries.map((s) => ({ label: formatDateShort(s.date), value: s.amount }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <NzokoKpiCard label="Ventes du jour" value={formatMoney(kpis.salesToday)} icon={Wallet} tone="green" />
        <NzokoKpiCard label="Réservations du jour" value={String(kpis.bookingsToday)} icon={Ticket} tone="amber" />
        <NzokoKpiCard label="Départs du jour" value={String(kpis.tripsToday)} icon={Bus} tone="orange" />
        <NzokoKpiCard
          label="Passagers embarqués"
          value={String(kpis.boardedToday)}
          icon={Users}
          tone="green"
          hint={`${kpis.passengersToday} passagers attendus aujourd'hui`}
        />
        <NzokoKpiCard label="Revenus du mois" value={formatMoney(kpis.revenueMonth)} icon={TrendingUp} tone="green" />
        <NzokoKpiCard
          label="Paiements en attente"
          value={String(kpis.pendingPayments)}
          icon={Hourglass}
          tone={kpis.pendingPayments > 0 ? "red" : "neutral"}
        />
      </div>

      <Card className="gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <LayoutDashboard className="h-4 w-4 text-primary" aria-hidden="true" />
          Ventes des 14 derniers jours
        </p>
        {salesPoints.length === 0 ? (
          <NzokoEmptyState title="Pas encore de ventes" description="Les ventes apparaîtront ici." />
        ) : (
          <NzokoTrendChart points={salesPoints} kind="area" color="var(--chart-1)" />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Prochains départs">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="h-4 w-4" aria-hidden="true" /> Prochains départs
          </h2>
          {data.upcomingDepartures.length === 0 ? (
            <NzokoEmptyState icon={Bus} title="Aucun départ à venir" />
          ) : (
            <div className="nzoko-scroll grid max-h-96 gap-3 overflow-y-auto pr-1">
              {data.upcomingDepartures.slice(0, 5).map((t) => (
                <DepartureMiniCard key={t.id} trip={t} />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Dernières ventes">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Ticket className="h-4 w-4" aria-hidden="true" /> Dernières ventes
          </h2>
          {data.recentSales.length === 0 ? (
            <NzokoEmptyState icon={Ticket} title="Aucune vente enregistrée" />
          ) : (
            <div className="nzoko-scroll grid max-h-96 gap-3 overflow-y-auto pr-1">
              {data.recentSales.slice(0, 8).map((b) => (
                <SaleMiniCard key={b.id} booking={b} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DepartureMiniCard({ trip }: { trip: TripSearchDTO }) {
  const sold = trip.totalSeats - trip.availableSeats;
  return (
    <Card className="gap-1.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-primary">{trip.code}</span>
        <Badge variant="outline" className={TRIP_STATUS_COLORS[trip.status]}>
          {TRIP_STATUS_LABELS[trip.status]}
        </Badge>
      </div>
      <p className="text-sm font-semibold">
        {trip.originCityName} → {trip.destinationCityName}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(trip.departureTime)} · {trip.busRegistration}
      </p>
      <p className="text-xs text-muted-foreground">
        {trip.availableSeats} place{trip.availableSeats > 1 ? "s" : ""} restante
        {trip.availableSeats > 1 ? "s" : ""} · {sold}/{trip.totalSeats} vendues
      </p>
    </Card>
  );
}

function SaleMiniCard({ booking }: { booking: BookingDTO }) {
  return (
    <Card className="gap-1.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-primary">{booking.bookingReference}</span>
        <Badge variant="outline" className={BOOKING_STATUS_COLORS[booking.status]}>
          {BOOKING_STATUS_LABELS[booking.status]}
        </Badge>
      </div>
      <p className="text-sm font-medium">
        {booking.passenger.firstName} {booking.passenger.lastName}
      </p>
      <p className="text-xs text-muted-foreground">
        {booking.trip.originCityName} → {booking.trip.destinationCityName} · Siège{" "}
        {booking.seat.seatNumber}
      </p>
      <p className="text-sm font-bold">{formatMoney(booking.amount)}</p>
    </Card>
  );
}
