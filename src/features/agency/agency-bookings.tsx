"use client";

// ============================================================
// NZOKO TRANSPORT — Réservations agence (guichet)
// Filtres + liste + détail + billet PDF A4 par réservation payée
// (V3 : le token du billet est un secret, absent du DTO liste —
//  le détail est chargé au clic puis le PDF officiel est ouvert)
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { FileDown, Loader2, Search, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BOOKING_STATUSES, BOOKING_STATUS_COLORS, BOOKING_STATUS_LABELS } from "@/lib/constants";
import { formatDateTime, formatMoney } from "@/lib/format";
import { api, ApiClientError, hasPerm } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { apiErrorMessage, useApiData, useDebounced } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoPagination } from "@/components/shared/nzoko-pagination";
import { NzokoBookingDetailDialog } from "@/components/shared/nzoko-booking-detail-dialog";
import type { BookingDTO, SessionUser } from "@/types";

/** Réservations payées (billet émis côté serveur) → candidats au PDF A4. */
function isPdfCandidate(b: BookingDTO): boolean {
  return b.status === "CONFIRMED" || b.status === "COMPLETED";
}

function AgencyBookingsList({ session, refreshKey }: { session: SessionUser; refreshKey?: number }) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q);
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<BookingDTO | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  // Retour en page 1 quand les filtres changent (ajustement pendant le rendu — pattern React officiel).
  const [prevFilters, setPrevFilters] = useState(`${status}|${debouncedQ}`);
  const filtersKey = `${status}|${debouncedQ}`;
  if (filtersKey !== prevFilters) {
    setPrevFilters(filtersKey);
    setPage(1);
  }

  const { data, loading, error, reload } = useApiData(
    () =>
      api.agency.bookings({
        page,
        status: status === "ALL" ? undefined : status,
        q: debouncedQ || undefined,
      }),
    { refetchKey: [page, status, debouncedQ], refreshKey },
  );

  const items = data?.items ?? [];
  const canCancel = hasPerm(session, "booking:manage");

  /**
   * Billet PDF A4 : le DTO liste n'expose pas le token du billet (secret),
   * le détail est chargé à la volée puis le PDF est ouvert.
   * La fenêtre est ouverte AVANT l'await pour conserver le geste utilisateur
   * (compatibilité bloqueurs de fenêtres surgissantes) puis naviguée.
   */
  const openTicketPdf = (booking: BookingDTO) => {
    const win = window.open("", "_blank");
    setPdfLoadingId(booking.id);
    void (async () => {
      try {
        const detail = await api.bookings.get(booking.id);
        const token = detail.ticket?.token ?? null;
        if (!token) {
          win?.close();
          toast.error("Aucun billet n'est émis pour cette réservation.");
          return;
        }
        const url = api.tickets.pdfUrl(token);
        if (win) {
          win.location.href = url;
        } else {
          const fallback = window.open(url, "_blank");
          if (!fallback) {
            toast.error("Autorisez les fenêtres surgissantes pour télécharger le billet PDF.");
          }
        }
      } catch (err) {
        win?.close();
        toast.error(err instanceof ApiClientError ? err.message : apiErrorMessage(err));
      } finally {
        setPdfLoadingId(null);
      }
    })();
  };

  const pdfButton = (b: BookingDTO, compact: boolean) => {
    const busy = pdfLoadingId === b.id;
    if (compact) {
      return (
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          disabled={busy}
          aria-label={`Télécharger le billet PDF de la réservation ${b.bookingReference}`}
          onClick={(e) => {
            e.stopPropagation();
            openTicketPdf(b);
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
        </Button>
      );
    }
    return (
      <Button
        variant="outline"
        className="h-11 w-full gap-2"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          openTicketPdf(b);
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
        {busy ? "Préparation…" : "Billet PDF"}
      </Button>
    );
  };

  return (
    <div>
      {/* Filtres */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher (référence, passager, téléphone…)"
            className="h-11 pl-9"
            aria-label="Rechercher une réservation"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 w-full sm:w-44" aria-label="Filtrer par statut">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous statuts</SelectItem>
            {BOOKING_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {BOOKING_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Liste */}
      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <NzokoEmptyState
            icon={Ticket}
            title="Aucune réservation"
            description="Aucune réservation ne correspond à ces critères."
          />
        )}
        {!loading && !error && items.length > 0 && (
          <>
            {/* Mobile : cards empilées */}
            <div className="grid gap-3 md:hidden">
              {items.map((b) => (
                <Card key={b.id} className="gap-2 p-4">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Détail de la réservation ${b.bookingReference}`}
                    className="cursor-pointer"
                    onClick={() => setSelected(b)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(b);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">
                        {b.bookingReference}
                      </span>
                      <Badge variant="outline" className={BOOKING_STATUS_COLORS[b.status]}>
                        {BOOKING_STATUS_LABELS[b.status]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm font-medium">
                      {b.passenger.firstName} {b.passenger.lastName}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {b.passenger.phone}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.trip.originCityName} → {b.trip.destinationCityName} ·{" "}
                      {formatDateTime(b.trip.departureTime)}
                    </p>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold">{formatMoney(b.amount)}</span>
                      <span className="text-muted-foreground">
                        {b.channel === "AGENT" ? "Guichet" : "Web"}
                        {b.createdByName ? ` · ${b.createdByName}` : ""}
                      </span>
                    </div>
                  </div>
                  {isPdfCandidate(b) && pdfButton(b, false)}
                </Card>
              ))}
            </div>

            {/* Desktop : table */}
            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Référence</TableHead>
                    <TableHead>Passager</TableHead>
                    <TableHead>Trajet</TableHead>
                    <TableHead>Départ</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-center">Billet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((b) => (
                    <TableRow
                      key={b.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Détail de la réservation ${b.bookingReference}`}
                      className="cursor-pointer"
                      onClick={() => setSelected(b)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(b);
                        }
                      }}
                    >
                      <TableCell className="font-mono text-xs font-semibold text-primary">
                        {b.bookingReference}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">
                          {b.passenger.firstName} {b.passenger.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{b.passenger.phone}</p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {b.trip.originCityName} → {b.trip.destinationCityName}
                      </TableCell>
                      <TableCell className="text-xs">{formatDateTime(b.trip.departureTime)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {formatMoney(b.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={BOOKING_STATUS_COLORS[b.status]}>
                          {BOOKING_STATUS_LABELS[b.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.channel === "AGENT" ? "Guichet" : "Web"}
                      </TableCell>
                      <TableCell className="text-center">
                        {isPdfCandidate(b) ? (
                          pdfButton(b, true)
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <NzokoPagination
              page={data?.page ?? 1}
              totalPages={data?.totalPages ?? 1}
              total={data?.total ?? 0}
              onPageChange={setPage}
              unit="réservations"
            />
          </>
        )}
      </div>

      {/* Détail (annulation, paiements, billet) */}
      {selected && (
        <NzokoBookingDetailDialog
          booking={selected}
          canCancel={canCancel}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

export function AgencyBookings({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();

  if (!session) return null;

  return <AgencyBookingsList session={session} refreshKey={refreshKey} />;
}
