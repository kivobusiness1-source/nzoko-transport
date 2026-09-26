"use client";

// ============================================================
// Océan du Nord — Onglet « Paiements en attente » du guichet agent
// Réservations PENDING : chrono + encaissement espèces / Mobile Money.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, Loader2, RefreshCw, Smartphone, Timer } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NzokoCountdown } from "@/components/shared/nzoko-countdown";
import { api, ApiClientError } from "@/lib/api-client";
import { formatMoney, formatTime } from "@/lib/format";
import type { BookingDTO } from "@/types";

function apiErr(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "Une erreur est survenue.";
}

export function PendingPaymentsTab() {
  const [items, setItems] = useState<BookingDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const paginated = await api.agency.bookings({ status: "PENDING" });
      setItems(paginated.items);
    } catch (err) {
      setError(apiErr(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const collectCash = async (b: BookingDTO) => {
    setBusyId(b.id);
    try {
      const payment = await api.payments.create({ bookingId: b.id, provider: "CASH" });
      const confirmed = await api.payments.confirmCash(payment.id);
      if (confirmed.status === "SUCCESS") {
        toast.success(`Espèces encaissées — billet émis pour ${b.bookingReference}.`);
        load();
      } else {
        toast.error("Encaissement non confirmé, réessayez.");
      }
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      setBusyId(null);
    }
  };

  const collectMomo = async (b: BookingDTO) => {
    setBusyId(b.id);
    try {
      await api.payments.create({
        bookingId: b.id,
        provider: "MTN_MOMO",
        momoPhone: b.passenger.phone,
      });
      toast.info(`Demande de paiement MTN envoyée au ${b.passenger.phone}.`);
      load();
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Timer className="size-4 text-amber-600" aria-hidden />
          Réservations en attente de paiement (verrou 10 min)
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden /> Actualiser
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && items === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Aucune réservation en attente de paiement. 👍
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((b) => {
            const busy = busyId === b.id;
            return (
              <li key={b.id}>
                <Card className="border-amber-200 dark:border-amber-900">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold">{b.bookingReference}</p>
                        <p className="truncate text-sm">
                          {b.passenger.firstName} {b.passenger.lastName} · siège {b.seat.seatNumber}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {b.trip.originCityName} → {b.trip.destinationCityName} · départ {formatTime(b.trip.departureTime)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="text-base font-bold text-primary">{formatMoney(b.amount)}</span>
                        {b.expiresAt && <NzokoCountdown expiresAt={b.expiresAt} prefix="Expire dans" />}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button onClick={() => collectCash(b)} disabled={busy} className="h-11 gap-2">
                        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Banknote className="size-4" aria-hidden />}
                        Encaisser espèces
                      </Button>
                      <Button variant="outline" onClick={() => collectMomo(b)} disabled={busy} className="h-11 gap-2">
                        <Smartphone className="size-4" aria-hidden /> Mobile Money
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
