"use client";

// ============================================================
// NZOKO TRANSPORT — Dialog détail réservation (partagé)
// Trip + passager + siège + paiements + billet + annulation
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Ban, Phone, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api-client";
import {
  BOOKING_STATUS_COLORS,
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_PROVIDER_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
} from "@/lib/constants";
import { formatDateTime, formatMoney } from "@/lib/format";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import type { BookingDTO } from "@/types";
import { cn } from "@/lib/utils";

const TICKET_COLORS: Record<string, string> = {
  VALID: "bg-emerald-100 text-emerald-800 border-emerald-200",
  USED: "bg-zinc-200 text-zinc-600 border-zinc-300",
  CANCELLED: "bg-red-100 text-red-800 border-red-200",
};

export function NzokoBookingDetailDialog({
  booking,
  canCancel,
  onClose,
  onChanged,
}: {
  booking: BookingDTO;
  canCancel: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: detail, loading, reload } = useApiData(() => api.bookings.get(booking.id), {
    refetchKey: [booking.id],
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const d = detail ?? booking;
  const cancellable = canCancel && (d.status === "PENDING" || d.status === "CONFIRMED");

  const cancelBooking = async () => {
    setCancelling(true);
    try {
      await api.bookings.cancel(booking.id);
      toast.success("Réservation annulée.");
      setConfirmOpen(false);
      reload();
      onChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{d.bookingReference}</span>
            <Badge variant="outline" className={BOOKING_STATUS_COLORS[d.status]}>
              {BOOKING_STATUS_LABELS[d.status]}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Créée le {formatDateTime(d.createdAt)}
            {d.createdByName ? ` · par ${d.createdByName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        )}

        <div className="space-y-3">
          <Card className="gap-2 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              {d.trip.originCityName}
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {d.trip.destinationCityName}
            </p>
            <p className="text-xs text-muted-foreground">
              Départ {formatDateTime(d.trip.departureTime)} · Bus {d.trip.busRegistration} ·{" "}
              {d.trip.agencyName}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Badge variant="secondary" className="text-[10px]">
                Siège {d.seat.seatNumber}
              </Badge>
              {d.seat.type === "VIP" && (
                <Badge variant="outline" className="border-orange-300 bg-orange-100 text-orange-800">
                  VIP
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {d.channel === "AGENT" ? "Guichet" : "Web"}
              </Badge>
            </div>
          </Card>

          <Card className="gap-1.5 p-4">
            <p className="text-sm font-semibold">
              {d.passenger.firstName} {d.passenger.lastName}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {d.passenger.phone}
              {d.passenger.documentNumber ? ` · Pièce ${d.passenger.documentNumber}` : ""}
            </p>
            <p className="pt-1 text-sm font-bold text-primary">{formatMoney(d.amount)}</p>
          </Card>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Paiements
            </p>
            {detail && detail.payments.length === 0 && (
              <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                Aucun paiement enregistré.
              </p>
            )}
            <div className="space-y-2">
              {detail?.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-1.5 rounded-xl border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{PAYMENT_PROVIDER_LABELS[p.provider]}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateTime(p.createdAt)}
                      {p.collectedByName ? ` · ${p.collectedByName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={PAYMENT_STATUS_COLORS[p.status]}>
                      {PAYMENT_STATUS_LABELS[p.status]}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(p.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {detail?.ticket && (
            <Card className="flex items-center justify-between gap-2 p-4">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Ticket className="h-4 w-4 text-primary" aria-hidden="true" /> Billet
              </p>
              <Badge
                variant="outline"
                className={cn(
                  TICKET_COLORS[TICKET_STATUSES.find((s) => s === detail.ticket?.status) ?? "VALID"],
                )}
              >
                {TICKET_STATUS_LABELS[detail.ticket.status]}
              </Badge>
            </Card>
          )}
        </div>

        <Separator />

        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>
            Fermer
          </Button>
          {cancellable && (
            <Button
              variant="destructive"
              className="h-11 gap-2"
              onClick={() => setConfirmOpen(true)}
              disabled={cancelling}
            >
              <Ban className="h-4 w-4" aria-hidden="true" />
              {cancelling ? "Annulation…" : "Annuler la réservation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette réservation ?</AlertDialogTitle>
            <AlertDialogDescription>
              La réservation {d.bookingReference} ({d.passenger.firstName} {d.passenger.lastName}) sera
              annulée. Cette action libérera le siège {d.seat.seatNumber}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Retour</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void cancelBooking();
              }}
            >
              {cancelling ? "Annulation…" : "Confirmer l'annulation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
