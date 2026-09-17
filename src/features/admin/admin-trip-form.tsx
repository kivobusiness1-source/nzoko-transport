"use client";

// ============================================================
// NZOKO TRANSPORT — Formulaire création de voyage(s)
// Route + bus + chauffeur + départ + prix + répétition 1-7 j
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { congoLocalToIso, todayCongoISO } from "@/components/shared/nzoko-format";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { Skeleton } from "@/components/ui/skeleton";
import type { TripSearchDTO } from "@/types";

function defaultDeparture(): string {
  return `${todayCongoISO()}T07:00`;
}

export function AdminTripForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: routes, loading: routesLoading } = useApiData(() => api.admin.routes(), {});
  const { data: buses } = useApiData(() => api.admin.buses(), {});
  const { data: drivers } = useApiData(() => api.admin.drivers(), {});

  const [routeId, setRouteId] = useState("");
  const [busId, setBusId] = useState("");
  const [driverId, setDriverId] = useState("NONE");
  const [departure, setDeparture] = useState(defaultDeparture());
  const [price, setPrice] = useState("");
  const [repeat, setRepeat] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  const selectedRoute = (routes ?? []).find((r) => r.id === routeId);
  const selectedBus = (buses ?? []).find((b) => b.id === busId);
  const activeBuses = (buses ?? []).filter((b) => b.status === "ACTIVE");

  useEffect(() => {
    if (selectedRoute) setPrice(String(selectedRoute.basePrice));
  }, [selectedRoute]);

  const submit = async () => {
    if (!routeId || !selectedRoute) {
      toast.error("Sélectionnez une route.");
      return;
    }
    if (!busId || !selectedBus) {
      toast.error("Sélectionnez un bus actif.");
      return;
    }
    if (!departure) {
      toast.error("Saisissez la date et l'heure de départ.");
      return;
    }
    const priceValue = Number(price);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      toast.error("Saisissez un prix valide (supérieur à 0).");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.admin.createTrip({
        routeId,
        busId,
        driverId: driverId === "NONE" ? null : driverId,
        agencyId: selectedBus.agencyId,
        departureTime: congoLocalToIso(departure),
        price: Math.round(priceValue),
        repeatDays: Number(repeat),
      });
      const created: TripSearchDTO[] = result.created ?? [];
      toast.success(
        created.length > 1
          ? `${created.length} voyages créés (${repeat} jours consécutifs).`
          : "Voyage créé."
      );
      onCreated();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="nzoko-scroll max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau voyage</DialogTitle>
          <DialogDescription>
            L&apos;heure d&apos;arrivée est calculée à partir de la durée de la route.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="trip-route">Route</Label>
            <Select value={routeId} onValueChange={setRouteId}>
              <SelectTrigger id="trip-route" className="h-11" aria-label="Route du voyage">
                <SelectValue placeholder="Choisir une route" />
              </SelectTrigger>
              <SelectContent>
                {(routes ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.originCityName} → {r.destinationCityName} · {formatMoney(r.basePrice)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {routesLoading && <Skeleton className="h-3 w-40" />}
            {selectedRoute && (
              <p className="text-[11px] text-muted-foreground">
                {selectedRoute.code} · {selectedRoute.distanceKm} km ·{" "}
                {selectedRoute.stops?.length ?? 0} arrêt(s)
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-bus">Bus (actifs)</Label>
            <Select value={busId} onValueChange={setBusId}>
              <SelectTrigger id="trip-bus" className="h-11" aria-label="Bus du voyage">
                <SelectValue placeholder="Choisir un bus" />
              </SelectTrigger>
              <SelectContent>
                {activeBuses.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.registrationNumber} — {b.brand} {b.model} · {b.agencyName ?? b.agencyId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-driver">Chauffeur</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger id="trip-driver" className="h-11" aria-label="Chauffeur du voyage">
                <SelectValue placeholder="Non assigné" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Non assigné</SelectItem>
                {(drivers ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.fullName} · {d.agencyName ?? d.agencyId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="trip-departure">Départ (heure locale)</Label>
              <Input
                id="trip-departure"
                type="datetime-local"
                value={departure}
                onChange={(e) => setDeparture(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trip-price">Prix du siège (FCFA)</Label>
              <Input
                id="trip-price"
                type="number"
                min={1}
                step={100}
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="h-11"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-repeat">Répétition (jours consécutifs)</Label>
            <Select value={repeat} onValueChange={setRepeat}>
              <SelectTrigger id="trip-repeat" className="h-11" aria-label="Répétition du voyage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d === 1 ? "1 (voyage unique)" : `${d} jours consécutifs`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Créer le voyage"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
