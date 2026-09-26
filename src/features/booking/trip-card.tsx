"use client";

// ============================================================
// Océan du Nord — Carte voyage (étape 2 du tunnel de réservation)
// ============================================================

import { ArrowRight, Bus, Clock, MapPin, MoveRight, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { arrivesNextDay, formatDuration } from "@/lib/dates";
import { formatMoney, formatTime } from "@/lib/format";
import type { TripSearchDTO } from "@/types";
import { cn } from "@/lib/utils";

interface TripCardProps {
  trip: TripSearchDTO;
  onSelect: (trip: TripSearchDTO) => void;
}

/** Badge places restantes : vert > 10, ambre 1-10, rouge 0 (complet) */
function SeatsBadge({ count }: { count: number }) {
  if (count <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
        Complet
      </span>
    );
  }
  const styles =
    count > 10
      ? "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
      : "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold", styles)}>
      <Users className="h-3 w-3" aria-hidden />
      {count} place{count > 1 ? "s" : ""}
    </span>
  );
}

/** Arrêts intermédiaires : pointillés + points + noms */
function IntermediateStops({ stops }: { stops: { cityName: string; minutesFromStart: number }[] }) {
  if (stops.length === 0) return null;
  return (
    <div className="mt-2 flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
        <span className="shrink-0" aria-hidden>·</span>
        {stops.map((s, i) => (
          <span key={`${s.cityName}-${i}`} className="inline-flex shrink-0 items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
            <span className="truncate">{s.cityName}</span>
          </span>
        ))}
        <span className="sr-only">arrêts intermédiaires</span>
      </div>
    </div>
  );
}

export function TripCard({ trip, onSelect }: TripCardProps) {
  const full = trip.availableSeats <= 0;
  const cancelled = trip.status === "CANCELLED";
  const disabled = full || cancelled;

  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-200 motion-safe:hover:-translate-y-0.5",
        disabled
          ? "border-border/60 opacity-70"
          : "cursor-pointer hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
      )}
      onClick={disabled ? undefined : () => onSelect(trip)}
    >
      {/* Fil conducteur décoratif — fine ligne d'accent à gauche, s'intensifie
          au survol (repère visuel « cette carte est active »). */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1 transition-colors",
          disabled ? "bg-muted" : "bg-primary/25 group-hover:bg-primary"
        )
      }
    />
    <CardContent className="p-4 pl-5">
      {/* Ligne horaire */}
      <div className="flex items-center gap-3">
        <div className="text-left">
          <p className="text-lg font-bold tabular-nums leading-none">{formatTime(trip.departureTime)}</p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Départ</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center px-1">
          <div className="flex w-full items-center gap-1" aria-hidden>
            <span className="size-2 rounded-full bg-primary ring-2 ring-primary/20" />
            <span className="h-px flex-1 bg-gradient-to-r from-primary/40 via-primary/25 to-primary/40" />
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              <Clock className="size-3" aria-hidden />
              {formatDuration(trip.durationMinutes)}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-primary/40 via-primary/25 to-primary/40" />
            <span className="size-2 rounded-full bg-primary ring-2 ring-primary/20" />
          </div>
          <p className="mt-1 sr-only">Durée du trajet {formatDuration(trip.durationMinutes)}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums leading-none">
            {formatTime(trip.estimatedArrivalTime)}
            {/* Voyage de nuit traversant minuit → mention explicite du jour +1
                (comparaison des JOURS CALENDAIRES Congo — pas des instants). */}
            {arrivesNextDay(trip.departureTime, trip.estimatedArrivalTime) && (
              <span
                className="ml-1 inline-block rounded bg-muted px-1 py-px align-middle text-[10px] font-semibold text-muted-foreground"
                title="Arrivée le lendemain matin"
              >
                J+1
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Arrivée</p>
        </div>
      </div>

      {/* Villes + arrêts */}
      <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold">
        <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="truncate">{trip.originCityName}</span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
        <span className="truncate">{trip.destinationCityName}</span>
      </div>
      <IntermediateStops stops={trip.stops} />

      {/* Bus */}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Bus className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {trip.busRegistration} · {trip.busBrand} {trip.busModel} · {trip.agencyName}
        </span>
      </p>

      {/* Prix + dispo + action */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-col gap-1">
          <p className="flex items-baseline gap-1">
            <span className="text-xl font-extrabold tracking-tight text-primary">{formatMoney(trip.price)}</span>
            <span className="text-[11px] font-medium text-muted-foreground">/ place</span>
          </p>
          <SeatsBadge count={trip.availableSeats} />
        </div>
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(trip);
          }}
          disabled={disabled}
          size="lg"
          className="min-w-[7.5rem] gap-1.5"
        >
          {cancelled ? "Voyage annulé" : full ? "Complet" : "Choisir"}
          {!cancelled && !full && (
            <MoveRight className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
          )}
        </Button>
      </div>
    </CardContent>
    </Card>
  );
}
