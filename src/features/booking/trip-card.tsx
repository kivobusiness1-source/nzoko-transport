"use client";

// ============================================================
// Océan du Nord — Carte voyage (étape 2 du tunnel de réservation)
// ============================================================

import { ArrowRight, Bus, Clock, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration } from "@/lib/dates";
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
    <Card className={cn("transition-shadow", disabled ? "opacity-70" : "hover:shadow-md")}>
      <CardContent className="p-4">
        {/* Ligne horaire */}
        <div className="flex items-center gap-3">
          <div className="text-left">
            <p className="text-lg font-bold tabular-nums leading-none">{formatTime(trip.departureTime)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Départ</p>
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-center px-1">
            <div className="flex w-full items-center gap-1" aria-hidden>
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="h-0.5 flex-1 rounded bg-primary/30" />
              <Clock className="size-3 text-muted-foreground" />
              <span className="h-0.5 flex-1 rounded bg-primary/30" />
              <span className="size-1.5 rounded-full bg-primary" />
            </div>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">{formatDuration(trip.durationMinutes)}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tabular-nums leading-none">{formatTime(trip.estimatedArrivalTime)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Arrivée</p>
          </div>
        </div>

        {/* Villes + arrêts */}
        <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold">
          <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{trip.originCityName}</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
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
            <span className="text-base font-bold text-primary">{formatMoney(trip.price)}</span>
            <SeatsBadge count={trip.availableSeats} />
          </div>
          <Button onClick={() => onSelect(trip)} disabled={disabled} size="lg" className="min-w-[7.5rem]">
            {cancelled ? "Voyage annulé" : full ? "Complet" : "Choisir"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
