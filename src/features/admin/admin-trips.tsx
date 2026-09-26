"use client";

// ============================================================
// OCÉAN DU NORD — Voyages admin : liste + gestion des statuts
// (formulaire de création : admin-trip-form.tsx)
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Plus, Truck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { TRIP_STATUSES, TRIP_STATUS_COLORS, TRIP_STATUS_LABELS } from "@/lib/constants";
import type { TripStatus } from "@/lib/constants";
import { formatDateTime, formatMoney, formatTime } from "@/lib/format";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { todayCongoISO } from "@/components/shared/nzoko-format";
import { AdminTripForm } from "@/features/admin/admin-trip-form";
import { TripContactsDialog } from "@/features/admin/trip-contacts-dialog";
import type { TripSearchDTO } from "@/types";

const NEXT_STATUS: Partial<Record<TripStatus, { to: TripStatus; label: string }>> = {
  SCHEDULED: { to: "BOARDING", label: "Passer à l'embarquement" },
  BOARDING: { to: "DEPARTED", label: "Marquer le départ" },
  DEPARTED: { to: "ARRIVED", label: "Marquer l'arrivée" },
  ARRIVED: { to: "COMPLETED", label: "Terminer" },
};

const CANCELLABLE: TripStatus[] = ["SCHEDULED", "BOARDING"];

export function AdminTrips({ refreshKey }: { refreshKey?: number }) {
  const [date, setDate] = useState(todayCongoISO());
  const [status, setStatus] = useState("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toCancel, setToCancel] = useState<TripSearchDTO | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [contactsTrip, setContactsTrip] = useState<TripSearchDTO | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);

  const openContacts = (t: TripSearchDTO) => {
    setContactsTrip(t);
    setContactsOpen(true);
  };

  const { data, loading, error, reload } = useApiData(
    () => api.admin.trips({ date: date || undefined, status: status === "ALL" ? undefined : status }),
    { refetchKey: [date, status], refreshKey },
  );

  const trips = data ?? [];

  const updateTripStatus = async (trip: TripSearchDTO, next: TripStatus) => {
    setBusyId(trip.id);
    try {
      await api.admin.updateTrip(trip.id, { status: next });
      toast.success(`Voyage ${trip.code} : ${TRIP_STATUS_LABELS[next]}.`);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const cancelTrip = async () => {
    if (!toCancel) return;
    setCancelling(true);
    try {
      await api.admin.updateTrip(toCancel.id, { status: "CANCELLED" });
      toast.success(`Voyage ${toCancel.code} annulé.`);
      const cancelled = toCancel;
      setToCancel(null);
      reload();
      // Ouvre immédiatement la liste des passagers à prévenir (WhatsApp/appel).
      openContacts(cancelled);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_auto_1fr]">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-11 sm:w-44"
          aria-label="Filtrer par date de départ"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 w-full sm:w-44" aria-label="Filtrer par statut de voyage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous statuts</SelectItem>
            {TRIP_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TRIP_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex sm:justify-end">
          <Button className="h-11 w-full gap-2 sm:w-auto" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Nouveau voyage
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && trips.length === 0 && (
          <NzokoEmptyState
            icon={Truck}
            title="Aucun voyage"
            description="Aucun voyage ne correspond à ces critères. Créez-en un."
            action={
              <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Nouveau voyage
              </Button>
            }
          />
        )}
        {!loading && !error && trips.length > 0 && (
          <>
            <div className="grid gap-3 md:hidden">
              {trips.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  busy={busyId === t.id}
                  onStatus={(next) => void updateTripStatus(t, next)}
                  onCancel={() => setToCancel(t)}
                  onContacts={() => openContacts(t)}
                />
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Voyage</TableHead>
                    <TableHead>Départ</TableHead>
                    <TableHead>Bus</TableHead>
                    <TableHead>Remplissage</TableHead>
                    <TableHead className="text-right">Prix</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trips.map((t) => {
                    const sold = t.totalSeats - t.availableSeats;
                    const next = NEXT_STATUS[t.status];
                    const cancellable = CANCELLABLE.includes(t.status);
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <p className="font-mono text-xs font-semibold text-primary">{t.code}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.originCityName} → {t.destinationCityName} · {t.agencyName}
                          </p>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDateTime(t.departureTime)}
                          <span className="block text-muted-foreground">
                            arrivée {formatTime(t.estimatedArrivalTime)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          {t.busRegistration}
                          <span className="block text-muted-foreground">
                            {t.busBrand} {t.busModel}
                          </span>
                        </TableCell>
                        <TableCell className="w-36">
                          <div className="text-[11px] text-muted-foreground">
                            {sold}/{t.totalSeats} vendues
                          </div>
                          <Progress value={t.totalSeats ? (sold / t.totalSeats) * 100 : 0} className="h-1.5" />
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatMoney(t.price)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={TRIP_STATUS_COLORS[t.status]}>
                            {TRIP_STATUS_LABELS[t.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            {next && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-9"
                                disabled={busyId === t.id}
                                onClick={() => void updateTripStatus(t, next.to)}
                              >
                                {next.label}
                              </Button>
                            )}
                            {cancellable && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 text-red-600"
                                onClick={() => setToCancel(t)}
                                aria-label={`Annuler le voyage ${t.code}`}
                              >
                                <Ban className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                            {t.status === "CANCELLED" && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-9 gap-1.5"
                                onClick={() => openContacts(t)}
                                aria-label={`Contacts des passagers du voyage ${t.code}`}
                              >
                                <Users className="h-4 w-4" aria-hidden="true" /> Contacts
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </div>

      {formOpen && (
        <AdminTripForm onClose={() => setFormOpen(false)} onCreated={reload} />
      )}

      <AlertDialog open={toCancel !== null} onOpenChange={(o) => { if (!o) setToCancel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler ce voyage ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toCancel
                ? `Le voyage ${toCancel.code} (${toCancel.originCityName} → ${toCancel.destinationCityName} du ${formatDateTime(toCancel.departureTime)}) sera annulé. Les réservations en attente seront annulées et les sièges libérés. La liste des passagers à prévenir (WhatsApp/appel) et les remboursements à traiter s'affichera juste après.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Retour</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void cancelTrip();
              }}
            >
              {cancelling ? "Annulation…" : "Confirmer l'annulation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TripContactsDialog
        tripId={contactsTrip?.id ?? null}
        tripLabel={contactsTrip ? contactsTrip.code : ""}
        open={contactsOpen}
        onOpenChange={setContactsOpen}
      />
    </div>
  );
}

function TripCard({
  trip: t,
  busy,
  onStatus,
  onCancel,
  onContacts,
}: {
  trip: TripSearchDTO;
  busy: boolean;
  onStatus: (next: TripStatus) => void;
  onCancel: () => void;
  onContacts: () => void;
}) {
  const sold = t.totalSeats - t.availableSeats;
  const next = NEXT_STATUS[t.status];
  const cancellable = CANCELLABLE.includes(t.status);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-primary">{t.code}</span>
        <Badge variant="outline" className={TRIP_STATUS_COLORS[t.status]}>
          {TRIP_STATUS_LABELS[t.status]}
        </Badge>
      </div>
      <p className="text-sm font-semibold">
        {t.originCityName} → {t.destinationCityName}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(t.departureTime)} · arrivée {formatTime(t.estimatedArrivalTime)}
      </p>
      <p className="text-xs text-muted-foreground">
        {t.busBrand} {t.busModel} ({t.busRegistration}) · {t.agencyName}
      </p>
      <div>
        <p className="text-[11px] text-muted-foreground">
          {sold}/{t.totalSeats} places vendues · {t.availableSeats} dispo · {formatMoney(t.price)}
        </p>
        <Progress
          value={t.totalSeats ? (sold / t.totalSeats) * 100 : 0}
          className="h-1.5"
          aria-label={`Remplissage du voyage ${t.code}`}
        />
      </div>
      {(next || cancellable || t.status === "CANCELLED") && (
        <div className="flex flex-wrap gap-2">
          {next && (
            <Button
              variant="secondary"
              size="sm"
              className="h-10 flex-1"
              disabled={busy}
              onClick={() => onStatus(next.to)}
            >
              {next.label}
            </Button>
          )}
          {cancellable && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 text-red-600"
              onClick={onCancel}
              aria-label={`Annuler le voyage ${t.code}`}
            >
              <Ban className="h-4 w-4" aria-hidden="true" /> Annuler
            </Button>
          )}
          {t.status === "CANCELLED" && (
            <Button
              variant="secondary"
              size="sm"
              className="h-10 flex-1 gap-1.5"
              onClick={onContacts}
              aria-label={`Contacts des passagers du voyage ${t.code}`}
            >
              <Users className="h-4 w-4" aria-hidden="true" /> Prévenir les passagers
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
