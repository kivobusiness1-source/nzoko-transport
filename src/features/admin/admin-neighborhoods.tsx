"use client";

// ============================================================
// NZOKO TRANSPORT — Parc : quartiers (CRUD géolocalisé)
// V3 — détection « Vous êtes probablement à [quartier] » et
// rattachement des agences. Suppression douce si agences.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { MapPinned, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import type { CityDTO, NeighborhoodDTO } from "@/types";

/** Affiche « 2,5 km »-friendly : 2500 → « 2 500 m ». */
function formatRadius(meters: number): string {
  return `${meters.toLocaleString("fr-FR")} m`;
}

function formatGps(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return "—";
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function agenciesLabel(count: number): string {
  return count === 1 ? "1 agence rattachée" : `${count} agences rattachées`;
}

/** Champ numérique optionnel : "" → null, sinon nombre fini ou NaN. */
function parseOptionalCoord(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function AdminNeighborhoods({ refreshKey }: { refreshKey?: number }) {
  const [cityFilter, setCityFilter] = useState("");
  const { data, loading, error, reload } = useApiData(
    () => api.adminV3.neighborhoods(cityFilter || undefined),
    { refetchKey: [cityFilter], refreshKey },
  );
  const { data: cities } = useApiData(() => api.admin.cities(), { refreshKey });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NeighborhoodDTO | null>(null);
  const [toDelete, setToDelete] = useState<NeighborhoodDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = data ?? [];

  const toggleActive = async (n: NeighborhoodDTO, isActive: boolean) => {
    setBusyId(n.id);
    try {
      await api.adminV3.updateNeighborhood(n.id, { isActive });
      toast.success(`Quartier « ${n.name} » ${isActive ? "activé" : "désactivé"}.`);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await api.adminV3.deleteNeighborhood(toDelete.id);
      if (res.deleted) {
        toast.success(`Quartier « ${toDelete.name} » supprimé.`);
      } else {
        toast.success(
          `Quartier « ${toDelete.name} » désactivé — ${agenciesLabel(res.agencies ?? 0)}.`,
        );
      }
      setToDelete(null);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={cityFilter || "all"} onValueChange={(v) => setCityFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="h-11 w-full sm:w-56" aria-label="Filtrer les quartiers par ville">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les villes</SelectItem>
            {(cities ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Nouveau quartier
        </Button>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <NzokoEmptyState
            icon={MapPinned}
            title="Aucun quartier"
            description="Ajoutez les quartiers desservis pour localiser les voyageurs et les agences."
          />
        )}
        {!loading && !error && items.length > 0 && (
          <>
            <div className="grid gap-2 md:hidden">
              {items.map((n) => (
                <Card key={n.id} className="gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{n.name}</p>
                      <p className="text-xs text-muted-foreground">{n.cityName}</p>
                    </div>
                    <Switch
                      checked={n.isActive}
                      disabled={busyId === n.id}
                      onCheckedChange={(v) => void toggleActive(n, v)}
                      aria-label={`Activer le quartier ${n.name}`}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <p>Rayon : {formatRadius(n.radiusMeters)}</p>
                    <p>GPS : {formatGps(n.latitude, n.longitude)}</p>
                    <p>{agenciesLabel(n.agencyCount)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5"
                      onClick={() => setEditing(n)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Modifier
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 text-red-600 hover:text-red-700"
                      onClick={() => setToDelete(n)}
                      aria-label={`Supprimer le quartier ${n.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Supprimer
                    </Button>
                    {!n.isActive && <Badge variant="outline">Inactif</Badge>}
                  </div>
                </Card>
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <div className="nzoko-scroll max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quartier</TableHead>
                      <TableHead>Ville</TableHead>
                      <TableHead className="text-right">Rayon</TableHead>
                      <TableHead className="hidden xl:table-cell">GPS</TableHead>
                      <TableHead className="text-right">Agences</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="text-sm font-semibold">{n.name}</TableCell>
                        <TableCell className="text-xs">{n.cityName}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatRadius(n.radiusMeters)}
                        </TableCell>
                        <TableCell className="hidden font-mono text-[11px] text-muted-foreground xl:table-cell">
                          {formatGps(n.latitude, n.longitude)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{n.agencyCount}</TableCell>
                        <TableCell>
                          <Switch
                            checked={n.isActive}
                            disabled={busyId === n.id}
                            onCheckedChange={(v) => void toggleActive(n, v)}
                            aria-label={`Activer le quartier ${n.name}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9"
                              onClick={() => setEditing(n)}
                              aria-label={`Modifier le quartier ${n.name}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9 text-red-600 hover:text-red-700"
                              onClick={() => setToDelete(n)}
                              aria-label={`Supprimer le quartier ${n.name}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </>
        )}
      </div>

      {formOpen && (
        <NeighborhoodForm cities={cities ?? []} onClose={() => setFormOpen(false)} onCreated={reload} />
      )}

      {editing && (
        <NeighborhoodEditDialog
          neighborhood={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce quartier ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? toDelete.agencyCount > 0
                  ? `${agenciesLabel(toDelete.agencyCount)} à « ${toDelete.name} » : le quartier sera simplement désactivé, l'historique reste cohérent.`
                  : `Le quartier « ${toDelete.name} » (${toDelete.cityName}) sera définitivement supprimé.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Retour</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================
// Création
// ============================================================

function NeighborhoodForm({
  cities,
  onClose,
  onCreated,
}: {
  cities: CityDTO[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [cityId, setCityId] = useState("");
  const [name, setName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("2500");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!cityId) {
      toast.error("Sélectionnez la ville du quartier.");
      return;
    }
    if (trimmedName.length < 2) {
      toast.error("Saisissez un nom de quartier (2 caractères minimum).");
      return;
    }
    const lat = parseOptionalCoord(latitude);
    const lng = parseOptionalCoord(longitude);
    if (latitude.trim() !== "" && lat === null) {
      toast.error("Latitude invalide — utilisez le format décimal (ex. -4,78 sous forme -4.78).");
      return;
    }
    if (longitude.trim() !== "" && lng === null) {
      toast.error("Longitude invalide — utilisez le format décimal (ex. 11.86).");
      return;
    }
    if (lat !== null && (lat < -90 || lat > 90)) {
      toast.error("La latitude doit être comprise entre -90 et 90.");
      return;
    }
    if (lng !== null && (lng < -180 || lng > 180)) {
      toast.error("La longitude doit être comprise entre -180 et 180.");
      return;
    }
    const radiusValue = Number(radius);
    if (!Number.isFinite(radiusValue) || radiusValue < 200 || radiusValue > 20000) {
      toast.error("Le rayon doit être un entier entre 200 et 20 000 mètres.");
      return;
    }

    setSubmitting(true);
    try {
      await api.adminV3.createNeighborhood({
        cityId,
        name: trimmedName,
        latitude: lat,
        longitude: lng,
        radiusMeters: Math.round(radiusValue),
      });
      toast.success(`Quartier « ${trimmedName} » créé.`);
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
      <DialogContent className="nzoko-scroll max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau quartier</DialogTitle>
          <DialogDescription>
            Le quartier sert à détecter la position des voyageurs (« Vous êtes probablement à… »)
            et à organiser les agences.
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
            <Label htmlFor="neighborhood-city">Ville</Label>
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger id="neighborhood-city" className="h-11" aria-label="Ville du quartier">
                <SelectValue placeholder="Choisir une ville" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="neighborhood-name">Nom du quartier</Label>
            <Input
              id="neighborhood-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Tié-Tié"
              className="h-11"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="neighborhood-lat">Latitude (optionnel)</Label>
              <Input
                id="neighborhood-lat"
                type="number"
                step="any"
                inputMode="decimal"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="-4.7847"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="neighborhood-lng">Longitude (optionnel)</Label>
              <Input
                id="neighborhood-lng"
                type="number"
                step="any"
                inputMode="decimal"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="11.8635"
                className="h-11"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="neighborhood-radius">Rayon de détection (mètres)</Label>
            <Input
              id="neighborhood-radius"
              type="number"
              min={200}
              max={20000}
              step={50}
              inputMode="numeric"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="h-11"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Entre 200 et 20 000 m — défaut 2 500 m autour du centre du quartier.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Créer le quartier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Édition
// ============================================================

function NeighborhoodEditDialog({
  neighborhood,
  onClose,
  onSaved,
}: {
  neighborhood: NeighborhoodDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(neighborhood.name);
  const [latitude, setLatitude] = useState(
    neighborhood.latitude === null ? "" : String(neighborhood.latitude),
  );
  const [longitude, setLongitude] = useState(
    neighborhood.longitude === null ? "" : String(neighborhood.longitude),
  );
  const [radius, setRadius] = useState(String(neighborhood.radiusMeters));
  const [isActive, setIsActive] = useState(neighborhood.isActive);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error("Saisissez un nom de quartier (2 caractères minimum).");
      return;
    }
    const lat = parseOptionalCoord(latitude);
    const lng = parseOptionalCoord(longitude);
    if (latitude.trim() !== "" && lat === null) {
      toast.error("Latitude invalide — utilisez le format décimal (ex. -4.78).");
      return;
    }
    if (longitude.trim() !== "" && lng === null) {
      toast.error("Longitude invalide — utilisez le format décimal (ex. 11.86).");
      return;
    }
    if (lat !== null && (lat < -90 || lat > 90)) {
      toast.error("La latitude doit être comprise entre -90 et 90.");
      return;
    }
    if (lng !== null && (lng < -180 || lng > 180)) {
      toast.error("La longitude doit être comprise entre -180 et 180.");
      return;
    }
    const radiusValue = Number(radius);
    if (!Number.isFinite(radiusValue) || radiusValue < 200 || radiusValue > 20000) {
      toast.error("Le rayon doit être un entier entre 200 et 20 000 mètres.");
      return;
    }

    setSubmitting(true);
    try {
      await api.adminV3.updateNeighborhood(neighborhood.id, {
        name: trimmedName,
        latitude: lat,
        longitude: lng,
        radiusMeters: Math.round(radiusValue),
        isActive,
      });
      toast.success(`Quartier « ${trimmedName} » mis à jour.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="nzoko-scroll max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le quartier</DialogTitle>
          <DialogDescription>
            {neighborhood.name} — {neighborhood.cityName}. La ville de rattachement ne peut pas
            être changée.
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
            <Label htmlFor="neighborhood-edit-name">Nom du quartier</Label>
            <Input
              id="neighborhood-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="neighborhood-edit-lat">Latitude</Label>
              <Input
                id="neighborhood-edit-lat"
                type="number"
                step="any"
                inputMode="decimal"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="neighborhood-edit-lng">Longitude</Label>
              <Input
                id="neighborhood-edit-lng"
                type="number"
                step="any"
                inputMode="decimal"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="neighborhood-edit-radius">Rayon de détection (mètres)</Label>
            <Input
              id="neighborhood-edit-radius"
              type="number"
              min={200}
              max={20000}
              step={50}
              inputMode="numeric"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="h-11"
              required
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">Quartier actif</p>
              <p className="text-[11px] text-muted-foreground">
                Un quartier inactif n’apparaît plus dans la détection de position.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Activer le quartier" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
