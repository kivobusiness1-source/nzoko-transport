"use client";

// ============================================================
// OCÉAN DU NORD — Parc : routes (timeline + toggle + création)
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, MapPin, Plus, Route as RouteIcon, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { formatDuration } from "@/components/shared/nzoko-format";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import type { RouteDTO } from "@/types";

interface StopDraft {
  key: number;
  cityId: string;
  minutesFromStart: string;
}

export function AdminFleetRoutes({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.admin.routes(), { refreshKey });
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const routes = data ?? [];

  const toggleActive = async (route: RouteDTO, isActive: boolean) => {
    setBusyId(route.id);
    try {
      await api.admin.updateRoute(route.id, { isActive });
      toast.success(`Route ${route.code} ${isActive ? "activée" : "désactivée"}.`);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-end">
        <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle route
        </Button>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={3} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && routes.length === 0 && (
          <NzokoEmptyState icon={RouteIcon} title="Aucune route" description="Créez la première ligne du réseau." />
        )}
        {!loading && !error && routes.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {routes.map((r) => (
              <Card key={r.id} className="gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-bold">
                    {r.originCityName}
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {r.destinationCityName}
                    <span className="font-mono text-[10px] font-normal text-muted-foreground">
                      {r.code}
                    </span>
                  </p>
                  <Badge variant={r.isActive ? "secondary" : "outline"}>
                    {r.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.distanceKm} km · {formatDuration(r.estimatedDurationMinutes)} · tarif de base{" "}
                  {formatMoney(r.basePrice)}
                </p>
                <ol className="relative ml-1.5 space-y-2 border-l border-border pl-4">
                  <TimelineDot tone="primary" label={`${r.originCityName} · départ`} />
                  {(r.stops ?? []).map((s) => (
                    <TimelineDot
                      key={s.id}
                      tone="orange"
                      label={`${s.cityName} · ${formatDuration(s.minutesFromStart)}`}
                    />
                  ))}
                  <TimelineDot
                    tone="primary"
                    label={`${r.destinationCityName} · ${formatDuration(r.estimatedDurationMinutes)}`}
                  />
                </ol>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {(r.stops?.length ?? 0)} arrêt{(r.stops?.length ?? 0) > 1 ? "s" : ""} intermédiaire
                    {(r.stops?.length ?? 0) > 1 ? "s" : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`route-active-${r.id}`} className="text-xs text-muted-foreground">
                      Active
                    </Label>
                    <Switch
                      id={`route-active-${r.id}`}
                      checked={r.isActive}
                      disabled={busyId === r.id}
                      onCheckedChange={(v) => void toggleActive(r, v)}
                      aria-label={`Activer la route ${r.code}`}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {formOpen && <AdminRouteForm onClose={() => setFormOpen(false)} onCreated={reload} />}
    </div>
  );
}

function TimelineDot({ tone, label }: { tone: "primary" | "orange"; label: string }) {
  return (
    <li className="relative">
      <span
        className={`absolute -left-[22.5px] top-1 h-2.5 w-2.5 rounded-full ${
          tone === "primary" ? "bg-primary" : "bg-orange-400"
        }`}
        aria-hidden="true"
      />
      <p className="text-xs text-muted-foreground">{label}</p>
    </li>
  );
}

function AdminRouteForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: cities } = useApiData(() => api.admin.cities(), {});

  const [originCityId, setOriginCityId] = useState("");
  const [destinationCityId, setDestinationCityId] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const addStop = () => {
    setStops((prev) => [
      ...prev,
      { key: Date.now() + prev.length, cityId: "", minutesFromStart: "" },
    ]);
  };

  const removeStop = (key: number) => {
    setStops((prev) => prev.filter((s) => s.key !== key));
  };

  const submit = async () => {
    if (!originCityId || !destinationCityId) {
      toast.error("Sélectionnez la ville de départ et la ville d'arrivée.");
      return;
    }
    if (originCityId === destinationCityId) {
      toast.error("La ville de départ doit être différente de la ville d'arrivée.");
      return;
    }
    const km = Number(distanceKm);
    const minutes = Number(durationMinutes);
    const price = Number(basePrice);
    if (!Number.isFinite(km) || km <= 0 || !Number.isFinite(minutes) || minutes <= 0) {
      toast.error("Renseignez la distance (km) et la durée (minutes).");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Renseignez le tarif de base.");
      return;
    }
    const invalidStop = stops.find((s) => !s.cityId || !Number(s.minutesFromStart));
    if (invalidStop) {
      toast.error("Chaque arrêt doit avoir une ville et une durée valide.");
      return;
    }
    setSubmitting(true);
    try {
      const route = await api.admin.createRoute({
        originCityId,
        destinationCityId,
        distanceKm: Math.round(km),
        estimatedDurationMinutes: Math.round(minutes),
        basePrice: Math.round(price),
        stops: stops.map((s) => ({
          cityId: s.cityId,
          minutesFromStart: Math.round(Number(s.minutesFromStart)),
        })),
      });
      toast.success(`Route ${route.code} créée.`);
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
          <DialogTitle>Nouvelle route</DialogTitle>
          <DialogDescription>
            Le code de la route est généré automatiquement. Les arrêts sont optionnels.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="route-origin">Départ</Label>
              <Select value={originCityId} onValueChange={setOriginCityId}>
                <SelectTrigger id="route-origin" className="h-11" aria-label="Ville de départ">
                  <SelectValue placeholder="Choisir" />
                </SelectTrigger>
                <SelectContent>
                  {(cities ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="route-destination">Arrivée</Label>
              <Select value={destinationCityId} onValueChange={setDestinationCityId}>
                <SelectTrigger id="route-destination" className="h-11" aria-label="Ville d'arrivée">
                  <SelectValue placeholder="Choisir" />
                </SelectTrigger>
                <SelectContent>
                  {(cities ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="route-km">Distance (km)</Label>
              <Input
                id="route-km"
                type="number"
                min={1}
                inputMode="numeric"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="route-duration">Durée (min)</Label>
              <Input
                id="route-duration"
                type="number"
                min={1}
                inputMode="numeric"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="route-price">Tarif de base (FCFA)</Label>
              <Input
                id="route-price"
                type="number"
                min={1}
                step={500}
                inputMode="numeric"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="h-11"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Arrêts intermédiaires
              </Label>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={addStop}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Ajouter
              </Button>
            </div>
            {stops.length === 0 && (
              <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                Aucun arrêt intermédiaire.
              </p>
            )}
            {stops.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <Select
                  value={s.cityId}
                  onValueChange={(v) =>
                    setStops((prev) =>
                      prev.map((p) => (p.key === s.key ? { ...p, cityId: v } : p)),
                    )
                  }
                >
                  <SelectTrigger className="h-11 flex-1" aria-label="Ville de l'arrêt">
                    <SelectValue placeholder="Ville" />
                  </SelectTrigger>
                  <SelectContent>
                    {(cities ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={s.minutesFromStart}
                  onChange={(e) =>
                    setStops((prev) =>
                      prev.map((p) => (p.key === s.key ? { ...p, minutesFromStart: e.target.value } : p)),
                    )
                  }
                  className="h-11 w-28"
                  aria-label="Minutes depuis le départ"
                  placeholder="min"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 text-red-600"
                  onClick={() => removeStop(s.key)}
                  aria-label="Supprimer cet arrêt"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Créer la route"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
