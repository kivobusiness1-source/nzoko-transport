"use client";

// ============================================================
// Océan du Nord — Voyages du jour du contrôleur (embarquement, progression)
//
// Tri opérationnel : les voyages ACTIFS (à embarquer / en route) d'abord,
// les voyages terminés ou annulés en fin de liste. Un voyage ANNULÉ reste
// visible (le contrôleur doit savoir pourquoi des clients se présentent)
// mais signalé « embarquement bloqué » — ses billets sont VOID côté serveur.
// ============================================================

import { Bus, Clock, MapPin, RefreshCw, ShieldX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TripStatusBadge } from "@/components/shared/nzoko-badge";
import { formatTime } from "@/lib/format";
import type { BoardingTripDTO } from "@/types";
import { cn } from "@/lib/utils";

interface TripsBoardProps {
  trips: BoardingTripDTO[] | null;
  loading: boolean;
  onRefresh: () => void;
}

/** Rang de tri : 0 = actif (à traiter), 1 = terminé/annulé (consultation). */
function tripRank(status: BoardingTripDTO["status"]): number {
  return status === "SCHEDULED" || status === "BOARDING" || status === "DEPARTED" ? 0 : 1;
}

export function TripsBoard({ trips, loading, onRefresh }: TripsBoardProps) {
  const sorted = trips ? [...trips].sort((a, b) => tripRank(a.status) - tripRank(b.status) || a.departureTime.localeCompare(b.departureTime)) : null;
  const cancelledCount = trips?.filter((t) => t.status === "CANCELLED").length ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Voyages du jour</CardTitle>
          {sorted && sorted.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {sorted.length} voyage{sorted.length > 1 ? "s" : ""}
              {cancelledCount > 0 && (
                <span className="text-red-700 dark:text-red-300"> · {cancelledCount} annulé{cancelledCount > 1 ? "s" : ""}</span>
              )}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden />
          Actualiser
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted === null && loading && (
          <>
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </>
        )}

        {sorted !== null && sorted.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucun voyage programmé aujourd&apos;hui pour votre agence.
          </p>
        )}

        {sorted?.map((t) => {
          const cancelled = t.status === "CANCELLED";
          const finished = tripRank(t.status) === 1;
          const boardedPct = t.totalSeats > 0 ? Math.round((t.boardedCount / t.totalSeats) * 100) : 0;
          return (
            <div
              key={t.id}
              className={cn(
                "relative overflow-hidden rounded-xl border p-3 pl-4 transition-shadow",
                cancelled
                  ? "border-red-200 bg-red-50/40 opacity-75 dark:border-red-900/60 dark:bg-red-950/20"
                  : finished
                    ? "opacity-80 hover:shadow-sm"
                    : "hover:shadow-md"
              )}
            >
              {/* Barre d'accent latérale : rouge = annulé, primaire = actif */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  cancelled ? "bg-red-400 dark:bg-red-600" : finished ? "bg-muted-foreground/25" : "bg-primary"
                )}
              />
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

              {cancelled ? (
                <p className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-100/70 px-2.5 py-1.5 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                  <ShieldX className="size-3.5 shrink-0" aria-hidden />
                  Voyage annulé — embarquement bloqué, billets invalidés.
                </p>
              ) : (
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
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
