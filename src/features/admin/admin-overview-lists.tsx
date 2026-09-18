"use client";

// ============================================================
// NZOKO TRANSPORT — Vue d'ensemble admin : listes
// Top routes + dernières réservations + paiements + voyages
// ============================================================

import { Banknote, Bus, CreditCard, Route as RouteIcon, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  BOOKING_STATUS_COLORS,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_PROVIDER_LABELS,
  TRIP_STATUS_COLORS,
  TRIP_STATUS_LABELS,
} from "@/lib/constants";
import { formatMoney, formatTime } from "@/lib/format";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import type { AdminStatsDTO } from "@/types";

export function AdminOverviewLists({ stats }: { stats: AdminStatsDTO }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <OverviewListSection
        title="Top routes"
        icon={RouteIcon}
        emptyTitle="Aucune route active"
        items={stats.topRoutes.map((r) => (
          <li key={r.route} className="flex items-center justify-between gap-2 py-2.5">
            {/* min-w-0 indispensable en flex : sans lui, un nom de route long
                (ex. « Pointe-Noire → Brazzaville ») étire la carte au-delà
                du viewport mobile (débordement horizontal de tout l'espace). */}
            <p className="min-w-0 truncate text-sm font-medium">{r.route}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {r.bookings} réserv.
              </Badge>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(r.revenue)}</span>
            </div>
          </li>
        ))}
      />

      <OverviewListSection
        title="Dernières réservations"
        icon={Ticket}
        emptyTitle="Aucune réservation"
        items={stats.recentBookings.slice(0, 5).map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {b.passenger.firstName} {b.passenger.lastName}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {b.bookingReference} · {b.trip.originCityName} → {b.trip.destinationCityName}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className={BOOKING_STATUS_COLORS[b.status]}>
                {BOOKING_STATUS_LABELS[b.status]}
              </Badge>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(b.amount)}</span>
            </div>
          </li>
        ))}
      />

      <OverviewListSection
        title="Derniers paiements"
        icon={CreditCard}
        emptyTitle="Aucun paiement"
        items={stats.recentPayments.slice(0, 5).map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {PAYMENT_PROVIDER_LABELS[p.provider]}
                {p.passengerName ? ` · ${p.passengerName}` : ""}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {p.bookingReference ?? p.bookingId}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant="outline" className={PAYMENT_STATUS_COLORS[p.status]}>
                {PAYMENT_STATUS_LABELS[p.status]}
              </Badge>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(p.amount)}</span>
            </div>
          </li>
        ))}
      />

      <OverviewListSection
        title="Voyages imminents"
        icon={Bus}
        emptyTitle="Aucun voyage à venir"
        items={stats.upcomingTrips.slice(0, 5).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {t.originCityName} → {t.destinationCityName}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {t.code} · {formatTime(t.departureTime)} · {t.busRegistration}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className={TRIP_STATUS_COLORS[t.status]}>
                {TRIP_STATUS_LABELS[t.status]}
              </Badge>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Banknote className="h-3 w-3" aria-hidden="true" />
                {t.availableSeats} dispo
              </span>
            </div>
          </li>
        ))}
      />
    </div>
  );
}

function OverviewListSection({
  title,
  icon: Icon,
  items,
  emptyTitle,
}: {
  title: string;
  icon: typeof Ticket;
  items: React.ReactNode[];
  emptyTitle: string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" /> {title}
      </h2>
      {items.length === 0 ? (
        <NzokoEmptyState icon={Icon} title={emptyTitle} />
      ) : (
        <Card className="gap-0 p-0">
          <ul className="nzoko-scroll max-h-96 divide-y overflow-y-auto">{items}</ul>
        </Card>
      )}
    </section>
  );
}
