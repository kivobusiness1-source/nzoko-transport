"use client";

// ============================================================
// Océan du Nord — Voyages du jour du contrôleur (embarquement, progression)
// ============================================================

import { Bus, Clock, MapPin, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TripStatusBadge } from "@/components/shared/nzoko-badge";
import { formatTime } from "@/lib/format";
import type { BoardingTripDTO } from "@/types";

interface TripsBoardProps {
  trips: BoardingTripDTO[] | null;
  loading: boolean;
  onRefresh: () => void;
}

export function TripsBoard({ trips, loading, onRefresh }: TripsBoardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Voyages du jour</CardTitle>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden />
          Actualiser
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {trips === null && loading && (
          <>
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </>
        )}

        {trips !== null && trips.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucun voyage programmé aujourd&apos;hui pour votre agence.
          </p>
        )}

        {trips?.map((t) => {
          const boardedPct = t.totalSeats > 0 ? Math.round((t.boardedCount / t.totalSeats) * 100) : 0;
          return (
            <div key={t.id} className="rounded-xl border p-3 transition-shadow hover:shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                  <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">
                    {t.originCityName} → {t.destinationCityName}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
                    <Clock className="size-3.5 text-muted-foreground" aria-hidden /> {formatTime(t.departureTime)}
                  </span>
                  <TripStatusBadge status={t.status} />
                </div>
              </div>

              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Bus className="size-3.5 shrink-0" aria-hidden /> {t.busRegistration} · {t.code}
              </p>

              <div className="mt-2.5">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 font-medium">
                    <Users className="size-3.5 text-primary" aria-hidden />
                    {t.boardedCount}/{t.totalSeats} embarqués · {t.soldCount} vendus
                  </span>
                  <span className="text-muted-foreground">{boardedPct}%</span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={t.boardedCount}
                  aria-valuemin={0}
                  aria-valuemax={t.totalSeats}
                  aria-label={`Embarquement ${t.originCityName} → ${t.destinationCityName}`}
                >
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${boardedPct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
