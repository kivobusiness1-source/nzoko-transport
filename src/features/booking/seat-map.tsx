"use client";

// ============================================================
// Océan du Nord — Plan de sièges interactif (étape 3)
// Grille générée depuis layout { rows, columns, aisleAfter }.
// MULTI-SÉLECTION (contrat §6) : le client choisit une ou plusieurs
// places, puis passe au formulaire passager.
// Statuts contractuels (API centrale §4) :
//   🟢 AVAILABLE · 🟡 HELD (hold temporaire) · 🔴 PAID · ⚫ BOARDED
// ============================================================

import { useMemo } from "react";
import { Info, Loader2, RefreshCw, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SeatMapDTO, SeatMapSeatDTO, TripSeatStatus } from "@/types";
import { cn } from "@/lib/utils";

interface SeatMapProps {
  seatMap: SeatMapDTO | null;
  loading: boolean;
  selectedSeatIds: string[];
  /** Toggle d'une place (le parent gère la sélection multi-sièges). */
  onSelect: (seat: SeatMapSeatDTO) => void;
  onRefresh?: () => void;
  /** Nombre max de places sélectionnables (contrat §7 : 6). */
  maxSeats?: number;
}

function colIndex(column: string): number {
  return column.toUpperCase().charCodeAt(0) - 65;
}

interface SeatButtonProps {
  seat: SeatMapSeatDTO;
  selected: boolean;
  selectionFull: boolean;
  onSelect: (seat: SeatMapSeatDTO) => void;
}

/** Style par statut contractuel (§6 — le front n'invente JAMAIS un état :
 *  il affiche celui renvoyé par le serveur, source unique de vérité). */
function seatStyle(seat: SeatMapSeatDTO, selected: boolean): string {
  if (selected)
    return "nzoko-seat-pop border-primary bg-primary text-primary-foreground shadow-md shadow-primary/40 ring-2 ring-primary/40 ring-offset-1 ring-offset-background";
  switch (seat.status) {
    case "HELD":
      return "cursor-not-allowed border-amber-300 bg-amber-100 text-amber-700 opacity-80 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
    case "PAID":
      return "cursor-not-allowed border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300";
    case "BOARDED":
      return "cursor-not-allowed border-zinc-400 bg-zinc-700 text-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
    case "CANCELLED":
      return "border-input bg-muted text-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:shadow-md";
    default: // AVAILABLE
      return seat.type === "VIP"
        ? "border-orange-400 bg-gradient-to-br from-orange-50 to-amber-100 text-orange-700 hover:-translate-y-0.5 hover:bg-orange-100 hover:shadow-md motion-safe:transition-transform dark:border-orange-600 dark:from-orange-950/40 dark:to-amber-950/30 dark:text-orange-300"
        : "border-input bg-muted text-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:shadow-md motion-safe:transition-transform";
  }
}

const STATUS_LABELS: Record<TripSeatStatus, string> = {
  AVAILABLE: "disponible",
  HELD: "temporairement réservé (hold en cours)",
  PAID: "déjà réservé / payé",
  CANCELLED: "libérée (annulation)",
  BOARDED: "passager embarqué",
};

function SeatButton({ seat, selected, selectionFull, onSelect }: SeatButtonProps) {
  const occupied = seat.status === "HELD" || seat.status === "PAID" || seat.status === "BOARDED";
  // Une place déjà sélectionnée reste cliquable (pour la désélectionner).
  const disabled = (occupied || (selectionFull && !selected)) && !selected;
  const stateLabel = selected
    ? `siège sélectionné — ${seat.status === "AVAILABLE" ? "disponible" : STATUS_LABELS[seat.status]}`
    : occupied
      ? `siège ${STATUS_LABELS[seat.status]}`
      : selectionFull
        ? `siège disponible — limite de ${MAX_SELECTION_LABEL} places atteinte`
        : seat.type === "VIP"
          ? "siège VIP disponible"
          : "siège disponible";

  return (
    <button
      type="button"
      onClick={() => onSelect(seat)}
      disabled={disabled}
      aria-label={`Siège ${seat.seatNumber} — ${stateLabel}`}
      aria-pressed={selected}
      title={`Siège ${seat.seatNumber} — ${selected ? "sélectionné" : STATUS_LABELS[seat.status]}`}
      className={cn(
        "flex size-10 items-center justify-center rounded-lg border text-xs font-semibold transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 motion-safe:hover:scale-[1.04]",
        seatStyle(seat, selected)
      )}
    >
      {seat.seatNumber}
    </button>
  );
}

const MAX_SELECTION_LABEL = "6";

function Legend() {
  const items = [
    { label: "Disponible", className: "border-input bg-muted" },
    { label: "VIP", className: "border-orange-400 bg-gradient-to-br from-orange-50 to-amber-100 dark:border-orange-600 dark:from-orange-950/40 dark:to-amber-950/30" },
    { label: "Sélectionné", className: "border-primary bg-primary shadow-sm shadow-primary/40" },
    { label: "Hold en cours", className: "border-amber-300 bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50" },
    { label: "Payé", className: "border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/50" },
    { label: "Embarqué", className: "border-zinc-400 bg-zinc-700" },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Légende du plan des sièges">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
        >
          <span className={cn("size-3 rounded-[4px] border", item.className)} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Contrôle d'actualisation : bouton libellé + heure du dernier rafraîchissement
 *  (renforce la confiance « c'est l'état réel du serveur » — §3.15). */
function RefreshControl({ onRefresh, busy, seatMap }: { onRefresh: () => void; busy: boolean; seatMap: SeatMapDTO | null }) {
  // Horodatage dérivé du rendu : recalculé uniquement quand une NOUVELLE
  // carte arrive du serveur (identité d'objet différente) — ni effet ni
  // état supplémentaire (chargement initial, poussée SSE, refresh manuel).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendance VOLONTAIRE à l'identité de seatMap (clé de re-calcul)
  const at = useMemo(() => new Date(), [seatMap]);

  return (
    <div className="flex shrink-0 flex-col items-end gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={busy}
        className="h-8 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
        Actualiser
      </Button>
      {seatMap && (
        <span className="pr-1 text-[10px] tabular-nums text-muted-foreground/70" aria-hidden>
          à jour {at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}

export function SeatMap({ seatMap, loading, selectedSeatIds, onSelect, onRefresh, maxSeats = 6 }: SeatMapProps) {
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
  const selectionFull = selectedSeatIds.length >= maxSeats;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Choisissez vos places</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold text-primary">{seatMap.availableSeats}</span> place
            {seatMap.availableSeats > 1 ? "s" : ""} disponible{seatMap.availableSeats > 1 ? "s" : ""} sur{" "}
            {seatMap.total} · {layout.name}
          </p>
          {selectedSeatIds.length > 0 && (
            <p className="mt-1 text-sm font-medium text-primary" aria-live="polite">
              {selectedSeatIds.length} place{selectedSeatIds.length > 1 ? "s" : ""} sélectionnée
              {selectedSeatIds.length > 1 ? "s" : ""} (max {maxSeats})
            </p>
          )}
        </div>
        {onRefresh && <RefreshControl onRefresh={onRefresh} busy={loading} seatMap={seatMap} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* « Carrosserie » du bus : cadre arrondi, dégradé de paroi, ombre
            intérieure — le plan se lit d'un coup d'œil comme l'intérieur d'un
            véhicule (avant = conducteur). */}
        <div className="relative rounded-2xl border-2 border-border/70 bg-gradient-to-b from-muted/50 via-muted/25 to-background p-3 shadow-inner sm:p-4">
          {/* Avant du bus */}
          <div className="mx-auto mb-4 flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary ring-1 ring-primary/20">
            <User className="size-3" aria-hidden /> Conducteur · avant du bus
          </div>

          {/* Grille + numéros de rangée à gauche (lisibilité famille/groupes) */}
          <div className="nzoko-scroll overflow-x-auto" role="group" aria-label="Plan des sièges du bus">
            <div className="mx-auto flex w-fit flex-col gap-2">
              {rows.map((seats, rowIndex) => (
                <div key={`row-${seats[0]?.row ?? rowIndex}`} className="flex items-center gap-2">
                  <span
                    className="w-4 shrink-0 text-right text-[10px] font-semibold tabular-nums text-muted-foreground/60"
                    aria-hidden
                  >
                    {seats[0]?.row}
                  </span>
                  {seats.map((seat, seatIdx) => {
                    const cIdx = colIndex(seat.column);
                    const showAisle = seatIdx > 0 && cIdx === aisleAfter;
                    return (
                      <span key={seat.id} className="flex items-center gap-2">
                        {showAisle && <span className="w-3 sm:w-4" aria-hidden />}
                        <SeatButton
                          seat={seat}
                          selected={selectedSeatIds.includes(seat.id)}
                          selectionFull={selectionFull}
                          onSelect={onSelect}
                        />
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
          Vos places sont bloquées {seatMap.holdMinutes} minutes le temps de compléter la réservation et le paiement.
          Les places affichées reflètent l&apos;état réel du serveur, actualisé en continu.
        </p>
      </CardContent>
    </Card>
  );
}
