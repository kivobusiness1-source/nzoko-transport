"use client";

// ============================================================
// NZOKO — Trajets favoris : manuels (ajout/suppression) ou
// détectés automatiquement. Réservation directe en un geste.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, Heart, HeartPlus, Loader2, Plus, Sparkles, Ticket, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { friendlyApiError, useApiData } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { todayStr } from "@/lib/dates";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import { congoDateStr } from "@/features/client/client-utils";
import type { FavoriteRouteDTO } from "@/types";

export function ClientFavorites({ refreshKey }: { refreshKey?: number }) {
  const setView = useApp((s) => s.setView);
  const setBookingSearch = useApp((s) => s.setBookingSearch);
  const { data, loading, error, reload } = useApiData(() => api.client.favorites(), { refreshKey });
  const { data: cities } = useApiData(() => api.cities());

  const [addOpen, setAddOpen] = useState(false);
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const favorites = data ?? [];
  const activeCities = (cities ?? []).filter((c) => c.isActive);

  const book = (fav: FavoriteRouteDTO) => {
    setBookingSearch({
      from: fav.originCityId,
      to: fav.destinationCityId,
      date: fav.nextDeparture ? congoDateStr(fav.nextDeparture.departureTime) : todayStr(),
    });
    setView("booking");
    window.scrollTo({ top: 0 });
  };

  const addFavorite = async () => {
    setAddError(null);
    if (!originId || !destinationId) {
      setAddError("Choisissez la ville de départ et la ville d'arrivée.");
      return;
    }
    if (originId === destinationId) {
      setAddError("Le départ et l'arrivée doivent être différents.");
      return;
    }
    setAdding(true);
    try {
      await api.client.addFavorite({ originCityId: originId, destinationCityId: destinationId });
      toast.success("Trajet ajouté à vos favoris ❤️");
      setAddOpen(false);
      setOriginId("");
      setDestinationId("");
      reload();
    } catch (err) {
      const message = friendlyApiError(err).message;
      setAddError(message);
      toast.error(message);
    } finally {
      setAdding(false);
    }
  };

  const removeFavorite = async (id: string) => {
    setDeleting(true);
    try {
      await api.client.removeFavorite(id);
      toast.success("Favori supprimé.");
      reload();
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setDeleting(false);
      setConfirmingId(null);
    }
  };

  if (loading) return <NzokoListSkeleton count={3} />;
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Vos trajets réguliers, prêts à réserver en un geste.
        </p>
        <Button onClick={() => setAddOpen(true)} className="h-10 shrink-0 gap-1.5">
          <Plus className="size-4" aria-hidden /> Ajouter
        </Button>
      </div>

      {favorites.length === 0 ? (
        <NzokoEmptyState
          icon={Heart}
          title="Aucun trajet favori"
          description="Ajoutez vos trajets habituels ou voyagez régulièrement : NZOKO détecte automatiquement vos trajets préférés."
          action={
            <Button variant="outline" onClick={() => setAddOpen(true)} className="gap-1.5">
              <HeartPlus className="size-4" aria-hidden /> Ajouter un favori
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {favorites.map((fav) => (
            <Card key={fav.id} className="nzoko-fade-up overflow-hidden py-0">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-base font-bold">
                    <span className="truncate">{fav.originCityName}</span>
                    <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="truncate">{fav.destinationCityName}</span>
                  </p>
                  {fav.isManual ? (
                    <Badge variant="secondary" className="shrink-0 gap-1">
                      <Heart className="size-3 fill-primary/40 text-primary" aria-hidden /> Manuel
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
                      <Sparkles className="size-3 text-primary" aria-hidden /> Détecté automatiquement
                    </Badge>
                  )}
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {fav.tripsCount > 0
                    ? `${fav.tripsCount} voyage${fav.tripsCount > 1 ? "s" : ""} effectué${fav.tripsCount > 1 ? "s" : ""}`
                    : "Aucun voyage pour le moment"}
                </p>

                {fav.nextDeparture ? (
                  <div className="mt-3 rounded-lg bg-primary/5 px-3 py-2.5">
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                      <span>
                        Prochain départ :{" "}
                        <span className="font-semibold text-foreground">
                          {formatDate(fav.nextDeparture.departureTime)} · {formatTime(fav.nextDeparture.departureTime)}
                        </span>{" "}
                        · <span className="font-bold text-primary">{formatMoney(fav.nextDeparture.price)}</span>
                      </span>
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                    Aucun départ planifié pour le moment.
                  </p>
                )}

                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                  <Button size="sm" className="h-9 gap-1.5" onClick={() => book(fav)}>
                    <Ticket className="size-3.5" aria-hidden /> Réserver
                  </Button>

                  {fav.isManual &&
                    (confirmingId === fav.id ? (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-9"
                          onClick={() => removeFavorite(fav.id)}
                          disabled={deleting}
                        >
                          {deleting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                          Confirmer
                        </Button>
                        <Button variant="ghost" size="sm" className="h-9" onClick={() => setConfirmingId(null)}>
                          Annuler
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground hover:text-red-600"
                        aria-label={`Supprimer le favori ${fav.originCityName} → ${fav.destinationCityName}`}
                        onClick={() => setConfirmingId(fav.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* --- Dialog ajout --- */}
      <Dialog open={addOpen} onOpenChange={(o) => !adding && setAddOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartPlus className="size-5 text-primary" aria-hidden /> Ajouter un trajet favori
            </DialogTitle>
            <DialogDescription>
              Le trajet sera conservé dans votre espace pour réserver plus vite.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="mb-1.5">Ville de départ</Label>
              <Select value={originId} onValueChange={setOriginId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Choisir la ville de départ" />
                </SelectTrigger>
                <SelectContent>
                  {activeCities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5">Ville d&apos;arrivée</Label>
              <Select value={destinationId} onValueChange={setDestinationId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Choisir la ville d'arrivée" />
                </SelectTrigger>
                <SelectContent>
                  {activeCities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {addError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {addError}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button onClick={addFavorite} disabled={adding} className="h-11 w-full gap-1.5">
              {adding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Heart className="size-4" aria-hidden />}
              {adding ? "Ajout…" : "Ajouter aux favoris"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
