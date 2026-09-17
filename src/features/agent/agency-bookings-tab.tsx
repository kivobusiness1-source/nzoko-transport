"use client";

// ============================================================
// NZOKO — Onglet « Réservations » du guichet agent
// Recherche, filtre statut, pagination, dialog détail + annulation.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bus, ChevronLeft, ChevronRight, Loader2, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingStatusBadge } from "@/components/shared/nzoko-badge";
import { NzokoBookingDetail } from "@/components/shared/nzoko-booking-detail";
import { api, ApiClientError, hasPerm } from "@/lib/api-client";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS } from "@/lib/constants";
import { useApp } from "@/lib/store";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { BookingDTO, BookingDetailDTO, Paginated } from "@/types";

export function AgencyBookingsTab() {
  const session = useApp((s) => s.session);
  const canManage = hasPerm(session, "booking:manage");

  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [data, setData] = useState<Paginated<BookingDTO> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<BookingDetailDTO | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.agency.bookings({
          page,
          q: q || undefined,
          status: status === "ALL" ? undefined : status,
        })
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounce recherche
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ((prev) => {
        if (prev === qInput) return prev;
        setPage(1);
        return qInput;
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [qInput]);

  const openDetail = async (b: BookingDTO) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      setDetail(await api.bookings.get(b.bookingReference));
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Impossible d'ouvrir la réservation.");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const cancelBooking = async () => {
    if (!detail) return;
    setCancelling(true);
    try {
      const updated = await api.bookings.cancel(detail.bookingReference);
      setDetail(updated);
      toast.success("Réservation annulée.");
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Impossible d'annuler.");
    } finally {
      setCancelling(false);
    }
  };

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-3">
      {/* Filtres */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_11rem]">
          <div>
            <Label htmlFor="agency-q" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Rechercher (référence, passager, téléphone)
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="agency-q"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="NZK-… / nom / 06…"
                className="h-10 pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="agency-status" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Statut
            </Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger id="agency-status" className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tous les statuts</SelectItem>
                {BOOKING_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{BOOKING_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Erreur */}
      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-red-700 dark:text-red-300">{error}</CardContent>
        </Card>
      )}

      {/* Liste */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Aucune réservation trouvée pour ces critères.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {data.items.map((b) => (
            <li key={b.id}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold">{b.bookingReference}</span>
                      <BookingStatusBadge status={b.status} />
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-sm font-medium">
                      <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      {b.passenger.firstName} {b.passenger.lastName}
                      <span className="text-muted-foreground">· {b.passenger.phone}</span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <Bus className="size-3.5 shrink-0" aria-hidden />
                      {b.trip.originCityName} → {b.trip.destinationCityName} · {formatDateTime(b.trip.departureTime)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="text-sm font-bold text-primary">{formatMoney(b.amount)}</span>
                    <Button variant="outline" size="sm" onClick={() => openDetail(b)} className="min-h-[36px]">
                      Voir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-2 pb-2">
          <p className="text-xs text-muted-foreground">
            {data.total} réservation{data.total > 1 ? "s" : ""} · page {data.page}/{Math.max(totalPages, 1)}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(p - 1, 1))} className="gap-1">
              <ChevronLeft className="size-4" aria-hidden /> Précédent
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="gap-1">
              Suivant <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {/* Dialog détail */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="nzoko-scroll max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Réservation</DialogTitle>
            <DialogDescription>Détail complet, paiements et billet.</DialogDescription>
          </DialogHeader>
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 animate-spin text-primary" aria-label="Chargement" />
            </div>
          ) : (
            <NzokoBookingDetail detail={detail} onCancel={canManage ? cancelBooking : undefined} cancelLoading={cancelling} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
