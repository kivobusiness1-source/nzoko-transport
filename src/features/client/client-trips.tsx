"use client";

// ============================================================
// NZOKO — Mes voyages : historique riche (bande latérale colorée
// selon le statut, groupement par mois, référence copiable,
// évaluations post-voyage via RatingDialog).
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Building2, Bus, Copy, Star, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookingStatusBadge } from "@/components/shared/nzoko-badge";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useApp } from "@/lib/store";
import { RatingDialog } from "@/features/client/rating-dialog";
import { monthGroupLabel, monthKey } from "@/features/client/client-utils";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/constants";
import type { ClientTripDTO } from "@/types";

type TripFilter = "all" | "upcoming" | "past" | "ratable";

const FILTERS: { key: TripFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "upcoming", label: "À venir" },
  { key: "past", label: "Terminés" },
  { key: "ratable", label: "À évaluer" },
];

/** Bande latérale colorée selon le statut de réservation. */
const STATUS_BAND: Record<BookingStatus, string> = {
  PENDING: "border-l-amber-400",
  CONFIRMED: "border-l-emerald-500",
  COMPLETED: "border-l-teal-500",
  CANCELLED: "border-l-red-500",
  EXPIRED: "border-l-zinc-400",
};

/** Petit bouton « copier la référence » (repli textarea + toast). */
function CopyReferenceButton({ value }: { value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Repli anciens navigateurs / contextes sans permission clipboard
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        toast.error("Copie impossible sur ce navigateur.");
        return;
      }
    }
    toast.success("Référence copiée", { description: value });
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-primary"
      onClick={copy}
      aria-label={`Copier la référence ${value}`}
      title="Copier la référence"
    >
      <Copy className="size-3.5" aria-hidden />
    </Button>
  );
}

function TripCard({ trip, onRate }: { trip: ClientTripDTO; onRate: (t: ClientTripDTO) => void }) {
  return (
    <Card
      role="listitem"
      className={cn("nzoko-fade-up gap-0 overflow-hidden border-l-4 p-0 py-0", STATUS_BAND[trip.status])}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5 text-base font-bold">
              <span className="truncate">{trip.originCityName}</span>
              <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{trip.destinationCityName}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(trip.departureTime)}</p>
          </div>
          <BookingStatusBadge status={trip.status} className="shrink-0" />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <Building2 className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{trip.agencyName}</span>
          </span>
          <span className="flex items-center gap-1">
            <Bus className="size-3.5 shrink-0" aria-hidden /> {trip.busRegistration}
          </span>
          <Badge variant="secondary" className="font-mono font-semibold">Siège {trip.seatNumber}</Badge>
          {trip.seatType === "VIP" && (
            <Badge variant="outline" className="border-orange-200 bg-orange-100 text-[10px] font-bold uppercase text-orange-700 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300">
              VIP
            </Badge>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-bold tabular-nums">{formatMoney(trip.amount)}</span>
            <span className="flex items-center gap-0.5 rounded-md border bg-muted/40 py-0.5 pl-1.5 pr-0.5 font-mono text-[10px] text-muted-foreground">
              <span className="truncate">{trip.bookingReference}</span>
              <CopyReferenceButton value={trip.bookingReference} />
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {trip.hasRated && (
              <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden /> Évalué ✓
              </span>
            )}
            {trip.ratingEligible && !trip.hasRated && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => onRate(trip)}
              >
                <Star className="size-3.5 text-amber-500" aria-hidden /> Évaluer
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClientTrips({ refreshKey }: { refreshKey?: number }) {
  const setView = useApp((s) => s.setView);
  const { data, loading, error, reload } = useApiData(() => api.client.trips(), { refreshKey });
  const [filter, setFilter] = useState<TripFilter>("all");
  const [ratingTrip, setRatingTrip] = useState<ClientTripDTO | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);

  const trips = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    // Date courante via constructeur (convention projet — Date.now() est
    // signalé impur par react-hooks/purity, new Date() est la forme admise).
    const now = new Date().getTime();
    const isUpcoming = (t: ClientTripDTO) =>
      t.status === "CONFIRMED" && new Date(t.departureTime).getTime() >= now;
    const isPast = (t: ClientTripDTO) =>
      t.status === "COMPLETED" ||
      t.tripStatus === "COMPLETED" ||
      t.tripStatus === "ARRIVED" ||
      new Date(t.departureTime).getTime() < now;

    const list = trips.filter((t) => {
      switch (filter) {
        case "upcoming":
          return isUpcoming(t);
        case "past":
          return isPast(t);
        case "ratable":
          return t.ratingEligible;
        default:
          return true;
      }
    });
    // À venir : du plus proche au plus lointain ; les autres : du plus récent au plus ancien.
    return [...list].sort((a, b) =>
      filter === "upcoming"
        ? a.departureTime.localeCompare(b.departureTime)
        : b.departureTime.localeCompare(a.departureTime),
    );
  }, [trips, filter]);

  const counts = useMemo(
    () => {
      const now = new Date().getTime();
      return {
        all: trips.length,
        upcoming: trips.filter((t) => t.status === "CONFIRMED" && new Date(t.departureTime).getTime() >= now).length,
        past: trips.filter(
          (t) =>
            t.status === "COMPLETED" ||
            t.tripStatus === "COMPLETED" ||
            t.tripStatus === "ARRIVED" ||
            new Date(t.departureTime).getTime() < now,
        ).length,
        ratable: trips.filter((t) => t.ratingEligible).length,
      };
    },
    [trips],
  );

  // Groupement par mois (« Septembre 2026 ») — l'ordre de `filtered` est conservé.
  const groups = useMemo(() => {
    const map = new Map<string, ClientTripDTO[]>();
    for (const t of filtered) {
      const key = monthKey(t.departureTime);
      const bucket = map.get(key);
      if (bucket) bucket.push(t);
      else map.set(key, [t]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  if (loading) return <NzokoListSkeleton count={5} />;
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      {/* Filtres */}
      <div role="group" aria-label="Filtrer mes voyages" className="nzoko-scroll flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-70">({counts[f.key]})</span>
          </button>
        ))}
      </div>

      {trips.length === 0 ? (
        <NzokoEmptyState
          icon={Ticket}
          title="Aucun voyage pour le moment"
          description="Réservez votre premier voyage — il apparaîtra ici avec votre billet et vos points."
          action={
            <Button onClick={() => setView("booking")} className="gap-1.5">
              <Ticket className="size-4" aria-hidden /> Réserver un voyage
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <NzokoEmptyState
          icon={Ticket}
          title="Aucun voyage dans cette catégorie"
          description="Changez de filtre pour voir vos autres voyages."
        />
      ) : (
        <div className="nzoko-scroll max-h-[70vh] space-y-5 overflow-y-auto pr-1" role="list" aria-label="Mes voyages">
          {groups.map(([key, items]) => (
            <div key={key} className="space-y-2.5">
              <p className="flex items-center gap-2 px-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {monthGroupLabel(items[0].departureTime)}
                </span>
                <span className="h-px flex-1 bg-border" aria-hidden />
                <span className="text-[10px] text-muted-foreground">
                  {items.length} voyage{items.length > 1 ? "s" : ""}
                </span>
              </p>
              {items.map((t) => (
                <TripCard
                  key={t.bookingId}
                  trip={t}
                  onRate={(trip) => {
                    setRatingTrip(trip);
                    setRatingOpen(true);
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <RatingDialog
        trip={ratingTrip}
        open={ratingOpen}
        onOpenChange={setRatingOpen}
        onDone={reload}
      />
    </div>
  );
}
