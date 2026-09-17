"use client";

// ============================================================
// NZOKO — Plan de sièges interactif (étape 3)
// Grille générée depuis layout { rows, columns, aisleAfter }.
// ============================================================

import { useMemo } from "react";
import { Info, Loader2, RefreshCw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SeatMapDTO, SeatMapSeatDTO } from "@/types";
import { cn } from "@/lib/utils";

interface SeatMapProps {
  seatMap: SeatMapDTO | null;
  loading: boolean;
  selectedSeatId: string | null;
  onSelect: (seat: SeatMapSeatDTO) => void;
  onRefresh?: () => void;
}

function colIndex(column: string): number {
  return column.toUpperCase().charCodeAt(0) - 65;
}

interface SeatButtonProps {
  seat: SeatMapSeatDTO;
  selected: boolean;
  onSelect: (seat: SeatMapSeatDTO) => void;
}

function SeatButton({ seat, selected, onSelect }: SeatButtonProps) {
  const occupied = seat.status !== "AVAILABLE";
  const disabled = occupied && !selected;
  const stateLabel = selected
    ? "siège sélectionné"
    : occupied
      ? seat.status === "HELD" ? "siège temporairement réservé" : "siège occupé"
      : seat.type === "VIP" ? "siège VIP disponible" : "siège disponible";

  return (
    <button
      type="button"
      onClick={() => onSelect(seat)}
      disabled={disabled}
      aria-label={`Siège ${seat.seatNumber} — ${stateLabel}`}
      aria-pressed={selected}
      className={cn(
        "flex size-10 items-center justify-center rounded-lg border text-xs font-semibold transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected
          ? "nzoko-pulse border-primary bg-primary text-primary-foreground"
          : occupied
            ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 line-through dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
            : seat.type === "VIP"
              ? "border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600 dark:bg-orange-950/40 dark:text-orange-300"
              : "border-input bg-muted text-foreground hover:border-primary/40 hover:bg-primary/10"
      )}
    >
      {seat.seatNumber}
    </button>
  );
}

function Legend() {
  const items = [
    { label: "Disponible", className: "border-input bg-muted" },
    { label: "VIP", className: "border-orange-400 bg-orange-50 dark:border-orange-600 dark:bg-orange-950/40" },
    { label: "Sélectionné", className: "border-primary bg-primary" },
    { label: "Occupé", className: "border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("size-3.5 rounded border", item.className)} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function SeatMap({ seatMap, loading, selectedSeatId, onSelect, onRefresh }: SeatMapProps) {
  const rows = useMemo(() => {
    if (!seatMap) return [];
    const byRow = new Map<number, SeatMapSeatDTO[]>();
    for (const seat of seatMap.seats) {
      const list = byRow.get(seat.row) ?? [];
      list.push(seat);
      byRow.set(seat.row, list);
    }
    return [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, seats]) => seats.slice().sort((a, b) => colIndex(a.column) - colIndex(b.column)));
  }, [seatMap]);

  if (loading || !seatMap) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan des sièges</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-6">
          {loading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Chargement du plan des sièges" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-2">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <Skeleton key={j} className="size-10 rounded-lg" />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Plan indisponible.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const { layout } = seatMap;
  const aisleAfter = Math.min(Math.max(layout.aisleAfter, 0), Math.max(layout.columns - 1, 0));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Choisissez votre siège</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold text-primary">{seatMap.availableSeats}</span> place
            {seatMap.availableSeats > 1 ? "s" : ""} disponible{seatMap.availableSeats > 1 ? "s" : ""} · {layout.name}
          </p>
        </div>
        {onRefresh && (
          <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Actualiser le plan des sièges" className="size-9">
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border bg-muted/30 p-3 sm:p-4">
          {/* Avant du bus */}
          <div className="mx-auto mb-4 flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <User className="size-3" aria-hidden /> Conducteur · avant du bus
          </div>

          {/* Grille */}
          <div className="nzoko-scroll overflow-x-auto" role="group" aria-label="Plan des sièges du bus">
            <div className="mx-auto flex w-fit flex-col gap-2">
              {rows.map((seats, rowIndex) => (
                <div key={`row-${seats[0]?.row ?? rowIndex}`} className="flex items-center gap-2">
                  {seats.map((seat, seatIdx) => {
                    const cIdx = colIndex(seat.column);
                    const showAisle = seatIdx > 0 && cIdx === aisleAfter;
                    return (
                      <span key={seat.id} className="flex items-center gap-2">
                        {showAisle && <span className="w-3 sm:w-4" aria-hidden />}
                        <SeatButton seat={seat} selected={seat.id === selectedSeatId} onSelect={onSelect} />
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <Legend />

        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Votre siège est bloqué {seatMap.holdMinutes} minutes le temps de compléter la réservation et le paiement.
        </p>
      </CardContent>
    </Card>
  );
}
