"use client";

// ============================================================
// NZOKO TRANSPORT — Contacts passagers d'un voyage annulé
// Outil agent/agence : prévenir chaque client par WhatsApp
// (wa.me, message pré-rempli) ou par appel (tel:), plus message
// de diffusion générique pour les groupes WhatsApp.
// Responsive 375px — cartes empilées, boutons pleine largeur.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Copy, MessageCircle, Phone, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { friendlyApiError, type ApiErrorInfo } from "@/components/shared/nzoko-use-api";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import type { TripContactsDTO, TripContactPassengerDTO } from "@/types";

const PAYMENT_STATE_LABELS: Record<TripContactPassengerDTO["paymentState"], string> = {
  PAID: "Payé — à rembourser",
  REFUNDED: "Remboursé",
  UNPAID: "Non payé",
};

const PAYMENT_STATE_TONES: Record<TripContactPassengerDTO["paymentState"], string> = {
  PAID: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  REFUNDED: "bg-primary/10 text-primary",
  UNPAID: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

export function TripContactsDialog({
  tripId,
  tripLabel,
  open,
  onOpenChange,
}: {
  tripId: string | null;
  tripLabel: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [data, setData] = useState<TripContactsDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.admin.tripContacts(id));
    } catch (err) {
      setError(friendlyApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && tripId) void load(tripId);
    if (!open) {
      setData(null);
      setError(null);
    }
  }, [open, tripId, load]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copié dans le presse-papiers.`);
    } catch {
      toast.error("Copie impossible sur ce navigateur.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-red-600" aria-hidden="true" />
            Prévenir les passagers — {tripLabel}
          </DialogTitle>
          <DialogDescription>
            Voyage annulé : contactez chaque passager par WhatsApp ou par appel, puis traitez les
            remboursements des billets payés.
          </DialogDescription>
        </DialogHeader>

        {loading && <NzokoListSkeleton count={3} />}
        {error && !loading && <NzokoErrorBox error={error} onRetry={() => tripId && void load(tripId)} />}
        {data && !loading && (
          <div className="space-y-4">
            {/* --- Résumé --- */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile value={data.summary.total} label="Passagers" icon={Users} />
              <SummaryTile value={data.summary.paid} label="À rembourser" icon={AlertTriangle} tone="amber" />
              <SummaryTile value={formatMoney(data.summary.refundDue)} label="Total dû" small />
              <SummaryTile value={data.summary.withPhone} label="Joignables WhatsApp" icon={MessageCircle} />
            </div>

            {/* --- Trajet --- */}
            <p className="text-xs text-muted-foreground">
              {data.trip.code} · {data.trip.originCityName} → {data.trip.destinationCityName} ·{" "}
              {formatDateTime(data.trip.departureTime)} · bus {data.trip.busRegistration} ·{" "}
              {data.trip.agencyName}
              {data.trip.agencyPhone ? ` · ${data.trip.agencyPhone}` : ""}
            </p>

            {/* --- Message de diffusion (groupes WhatsApp) --- */}
            {data.contacts.length > 0 && (
              <Card className="gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">Message de diffusion (groupes WhatsApp)</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void copy(data.broadcastMessage, "Message de diffusion")}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copier
                  </Button>
                </div>
                <p className="rounded-md bg-muted/60 p-2 text-xs leading-relaxed text-muted-foreground">
                  {data.broadcastMessage}
                </p>
              </Card>
            )}

            {/* --- Liste des passagers --- */}
            {data.contacts.length === 0 ? (
              <NzokoEmptyState
                icon={Users}
                title="Aucun passager à prévenir"
                description="Aucune réservation active n'était enregistrée sur ce voyage."
              />
            ) : (
              <div className="nzoko-scroll grid max-h-96 gap-2 overflow-y-auto pr-1">
                {data.contacts.map((c) => (
                  <ContactCard key={c.bookingId} contact={c} />
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  value,
  label,
  icon: Icon,
  tone,
  small,
}: {
  value: string | number;
  label: string;
  icon?: typeof Users;
  tone?: "amber";
  small?: boolean;
}) {
  return (
    <div className="rounded-md border p-2">
      <p
        className={`font-semibold tabular-nums ${small ? "text-sm" : "text-lg"} ${
          tone === "amber" ? "text-amber-600 dark:text-amber-400" : ""
        }`}
      >
        {value}
      </p>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
        {label}
      </p>
    </div>
  );
}

function ContactCard({ contact }: { contact: TripContactPassengerDTO }) {
  return (
    <Card className="gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{contact.passengerName}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {contact.bookingReference}
            {contact.seatLabel ? ` · siège ${contact.seatLabel}` : ""} · {formatMoney(contact.amount)}
          </p>
          <p className="text-[11px] text-muted-foreground">{contact.rawPhone || "—"}</p>
        </div>
        <Badge variant="outline" className={PAYMENT_STATE_TONES[contact.paymentState]}>
          {PAYMENT_STATE_LABELS[contact.paymentState]}
        </Badge>
      </div>

      {contact.whatsappUrl && contact.telUrl ? (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild className="h-10 gap-1.5 bg-green-600 text-white hover:bg-green-700">
            <a
              href={contact.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Envoyer un WhatsApp à ${contact.passengerName}`}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
            </a>
          </Button>
          <Button asChild variant="outline" className="h-10 gap-1.5">
            <a href={contact.telUrl} aria-label={`Appeler ${contact.passengerName}`}>
              <Phone className="h-4 w-4" aria-hidden="true" /> Appeler
            </a>
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">
          Numéro inexploitable (format invalide) : appelez la réservation depuis votre téléphone ou
          corrigez le contact en agence.
        </p>
      )}
    </Card>
  );
}
