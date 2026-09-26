"use client";

// ============================================================
// OCÉAN DU NORD — Parc : villes (toggle + création)
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { MapPin, Plus } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import type { CityDTO } from "@/types";

export function AdminFleetCities({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.admin.cities(), { refreshKey });
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cities = data ?? [];

  const toggleActive = async (city: CityDTO, isActive: boolean) => {
    setBusyId(city.id);
    try {
      await api.admin.updateCity(city.id, { isActive });
      toast.success(`${city.name} ${isActive ? "activée" : "désactivée"}.`);
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
          <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle ville
        </Button>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={3} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && cities.length === 0 && (
          <NzokoEmptyState icon={MapPin} title="Aucune ville" description="Ajoutez les villes du réseau." />
        )}
        {!loading && !error && cities.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cities.map((c) => (
              <Card key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                    aria-hidden="true"
                  >
                    <MapPin className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground">{c.country}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!c.isActive && <Badge variant="outline">Inactive</Badge>}
                  <Switch
                    checked={c.isActive}
                    disabled={busyId === c.id}
                    onCheckedChange={(v) => void toggleActive(c, v)}
                    aria-label={`Activer la ville ${c.name}`}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {formOpen && <AdminCityForm onClose={() => setFormOpen(false)} onCreated={reload} />}
    </div>
  );
}

function AdminCityForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("CG");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error("Saisissez un nom de ville.");
      return;
    }
    setSubmitting(true);
    try {
      await api.admin.createCity({ name: name.trim(), country: country.trim() || "CG" });
      toast.success(`Ville « ${name.trim()} » créée.`);
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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nouvelle ville</DialogTitle>
          <DialogDescription>Ajoutez une ville desservie au réseau Océan du Nord.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="city-name">Nom</Label>
            <Input
              id="city-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Gamboma"
              className="h-11"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city-country">Pays (code)</Label>
            <Input
              id="city-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="CG"
              className="h-11"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Créer la ville"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
