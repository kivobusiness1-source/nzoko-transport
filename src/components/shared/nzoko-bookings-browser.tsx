"use client";

// ============================================================
// NZOKO TRANSPORT — Navigateur de réservations (admin & agence)
// Filtres + cards mobiles + table md + pagination + détail
// ============================================================

import { useState } from "react";
import { MapPin, Search, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { useApiData, useDebounced } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoPagination } from "@/components/shared/nzoko-pagination";
import { NzokoBookingDetailDialog } from "@/components/shared/nzoko-booking-detail-dialog";
import type { AgencyDTO, BookingDTO, Paginated } from "@/types";

export interface NzokoBookingsBrowserParams {
  page: number;
  status?: string;
  q?: string;
  agencyId?: string;
}

export function NzokoBookingsBrowser({
  fetchPage,
  showAgencySelect = false,
  agencies = [],
  canCancel = false,
  refreshKey,
  unit = "réservations",
}: {
  fetchPage: (params: NzokoBookingsBrowserParams) => Promise<Paginated<BookingDTO>>;
  showAgencySelect?: boolean;
  agencies?: AgencyDTO[];
  canCancel?: boolean;
  refreshKey?: number;
  unit?: string;
}) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q);
  const [status, setStatus] = useState("ALL");
  const [agencyId, setAgencyId] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<BookingDTO | null>(null);

  // Retour en page 1 quand les filtres changent (ajustement pendant le rendu — pattern React officiel).
  const [prevFilters, setPrevFilters] = useState(`${status}|${debouncedQ}|${agencyId}`);
  const filtersKey = `${status}|${debouncedQ}|${agencyId}`;
  if (filtersKey !== prevFilters) {
    setPrevFilters(filtersKey);
    setPage(1);
  }

  const { data, loading, error, reload } = useApiData(
    () =>
      fetchPage({
        page,
        status: status === "ALL" ? undefined : status,
        q: debouncedQ || undefined,
        agencyId: showAgencySelect && agencyId !== "ALL" ? agencyId : undefined,
      }),
    { refetchKey: [page, status, debouncedQ, agencyId, showAgencySelect], refreshKey },
  );

  const items = data?.items ?? [];

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] lg:grid-cols-[1fr_auto_auto]">
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
        {showAgencySelect && (
          <Select value={agencyId} onValueChange={setAgencyId}>
            <SelectTrigger className="h-11 w-full sm:w-48" aria-label="Filtrer par agence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes agences</SelectItem>
              {agencies.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

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
                <button
                  key={b.id}
                  className="w-full text-left"
                  onClick={() => setSelected(b)}
                  aria-label={`Détail de la réservation ${b.bookingReference}`}
                >
                  <Card className="gap-2 p-4 transition-colors hover:border-primary/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">
                        {b.bookingReference}
                      </span>
                      <Badge variant="outline" className={BOOKING_STATUS_COLORS[b.status]}>
                        {BOOKING_STATUS_LABELS[b.status]}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium">
                      {b.passenger.firstName} {b.passenger.lastName}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {b.passenger.phone}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.trip.originCityName} → {b.trip.destinationCityName} ·{" "}
                      {formatDateTime(b.trip.departureTime)}
                    </p>
                    {b.dropOffNeighborhood && (
                      <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        <MapPin className="size-2.5" aria-hidden /> Arrêt : {b.dropOffNeighborhood.name}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold">{formatMoney(b.amount)}</span>
                      <span className="text-muted-foreground">
                        {b.channel === "AGENT" ? "Guichet" : "Web"}
                        {b.createdByName ? ` · ${b.createdByName}` : ""}
                      </span>
                    </div>
                  </Card>
                </button>
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
                        {b.dropOffNeighborhood && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            <MapPin className="size-2.5" aria-hidden /> {b.dropOffNeighborhood.name}
                          </span>
                        )}
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
              unit={unit}
            />
          </>
        )}
      </div>

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
