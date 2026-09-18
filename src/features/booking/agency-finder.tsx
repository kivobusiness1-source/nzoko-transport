"use client";

// ============================================================
// NZOKO — « Trouver mon agence » (GPS client, V3)
// Panneau optionnel repliable du tunnel de réservation :
//  1. bouton « Trouver mon agence » → géolocalisation éphémère
//     (timeout 10 s, haute précision, JAMAIS stockée) ;
//  2. détection quartier/ville + agences proches : statut, distance,
//     horaires, départs du jour si le trajet est déjà choisi ;
//  3. « Choisir cette agence » → le parent filtre la recherche des
//     voyages par agencyId (bandeau « Agence — Modifier ») ;
//  4. fallback manuel sans GPS : sélection de ville → agences de la
//     ville (centres-villes connus du seed V3, triées par nom).
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Bus,
  Check,
  ChevronUp,
  Info,
  Loader2,
  MapPin,
  PencilLine,
  Phone,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/api-client";
import { formatMoney, formatTime } from "@/lib/format";
import type {
  AgencyNearbyResultDTO,
  AgencyRecommendationDTO,
  CityDTO,
  NearbyAgencyDTO,
} from "@/types";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------
// Centres-villes connus (seed V3) — fallback manuel sans GPS.
// Clés = nom de ville normalisé (minuscules, sans accents).
// ------------------------------------------------------------
const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  "pointe-noire": { lat: -4.7761, lng: 11.8435 },
  brazzaville: { lat: -4.2694, lng: 15.2747 },
  dolisie: { lat: -4.2, lng: 12.6667 },
  nkayi: { lat: -4.1833, lng: 13.2833 },
  ouesso: { lat: 1.6167, lng: 16.05 },
  gamboma: { lat: -0.85, lng: 15.0 },
  owando: { lat: -0.9333, lng: 15.9 },
};

function normalizeCityName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function errMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "Une erreur est survenue.";
}

function isRecommendation(
  data: AgencyNearbyResultDTO | AgencyRecommendationDTO
): data is AgencyRecommendationDTO {
  return "reason" in data;
}

interface FinderResult {
  source: "gps" | "manual";
  data: AgencyNearbyResultDTO | AgencyRecommendationDTO;
}

// ------------------------------------------------------------
// Statut affiché : 🟢 ouverte · 🟠 places limitées · 🔴 fermée/complète
// ------------------------------------------------------------
function statusInfo(agency: NearbyAgencyDTO): { label: string; dot: string; text: string } {
  if (agency.status === "CLOSED") {
    return { label: "Fermée", dot: "bg-red-500", text: "text-red-700 dark:text-red-300" };
  }
  if (agency.status === "FULL") {
    return { label: "Complète", dot: "bg-red-500", text: "text-red-700 dark:text-red-300" };
  }
  if (agency.nextDepartureSeats !== null && agency.nextDepartureSeats < 5) {
    return { label: "Places limitées", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" };
  }
  return { label: "Ouverte", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" };
}

// ------------------------------------------------------------
// Carte d'une agence (liste « Trouver mon agence »)
// ------------------------------------------------------------
function AgencyCard({
  agency,
  recommended,
  reason,
  selected,
  onChoose,
}: {
  agency: NearbyAgencyDTO;
  recommended: boolean;
  reason: string | null;
  selected: boolean;
  onChoose: (agency: NearbyAgencyDTO) => void;
}) {
  const status = statusInfo(agency);
  const hours =
    agency.openingTime && agency.closingTime
      ? `${agency.openingTime}–${agency.closingTime}`
      : null;
  const closed = agency.status === "CLOSED" || agency.status === "FULL";
  const limited =
    agency.status === "OPEN" &&
    agency.nextDepartureSeats !== null &&
    agency.nextDepartureSeats < 5;

  return (
    <Card
      className={cn(
        "transition-shadow",
        recommended && "border-primary shadow-md shadow-primary/10 ring-1 ring-primary/30",
        selected && "border-primary bg-primary/5",
        closed && "opacity-80"
      )}
    >
      <CardContent className="space-y-2.5 p-4">
        {/* Nom + recommandation */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-snug">{agency.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {agency.neighborhoodName && (
                <span className="shrink-0">{agency.neighborhoodName} ·</span>
              )}
              <span className="shrink-0">{agency.cityName}</span>
              {agency.distanceLabel && (
                <span className="font-semibold text-foreground/80">· à {agency.distanceLabel}</span>
              )}
            </p>
          </div>
          {recommended && (
            <Badge className="shrink-0 gap-1 bg-primary text-primary-foreground">
              <Sparkles className="size-3" aria-hidden />
              Recommandée
            </Badge>
          )}
        </div>

        {/* Adresse */}
        {agency.address && (
          <p className="text-xs text-muted-foreground">{agency.address}</p>
        )}

        {/* Statut + horaires */}
        <p className={cn("flex items-center gap-1.5 text-xs font-semibold", status.text)}>
          <span className={cn("size-2 shrink-0 rounded-full", status.dot)} aria-hidden />
          {hours ? `${status.label} · ${hours}` : status.label}
        </p>

        {/* Intention de voyage : prochain départ, places, prix */}
        {agency.nextDepartureTime !== null && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
              <Bus className="size-3.5 shrink-0 text-primary" aria-hidden />
              Prochain départ {formatTime(agency.nextDepartureTime)}
            </span>
            {agency.nextDepartureSeats !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  limited && "font-semibold text-amber-700 dark:text-amber-300"
                )}
              >
                <Users className="size-3.5 shrink-0" aria-hidden />
                {agency.nextDepartureSeats} place{agency.nextDepartureSeats > 1 ? "s" : ""}
              </span>
            )}
            {agency.nextDeparturePrice !== null && (
              <span className="font-medium text-primary">{formatMoney(agency.nextDeparturePrice)}</span>
            )}
          </p>
        )}
        {limited && agency.nextDepartureSeats !== null && (
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            Dépêchez-vous : plus que {agency.nextDepartureSeats}{" "}
            place{agency.nextDepartureSeats > 1 ? "s" : ""} pour le prochain départ !
          </p>
        )}
        {agency.status === "FULL" && (
          <p className="text-xs text-red-700 dark:text-red-300">
            Aucun départ disponible pour ce voyage à cette date.
          </p>
        )}

        {/* Justification de la recommandation */}
        {recommended && reason && (
          <p className="flex items-start gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-primary dark:text-emerald-300">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {reason}
          </p>
        )}

        {/* Téléphone */}
        {agency.phone && (
          <a
            href={`tel:${agency.phone.replace(/\s+/g, "")}`}
            className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Phone className="size-3.5 shrink-0" aria-hidden />
            {agency.phone}
          </a>
        )}

        {/* Action */}
        {closed ? (
          <Button variant="outline" disabled className="h-10 w-full">
            {agency.status === "CLOSED" ? "Agence fermée" : "Agence complète"}
          </Button>
        ) : selected ? (
          <Button variant="secondary" disabled className="h-10 w-full gap-1.5">
            <Check className="size-4" aria-hidden />
            Agence sélectionnée
          </Button>
        ) : (
          <Button onClick={() => onChoose(agency)} className="h-10 w-full gap-1.5">
            <Check className="size-4" aria-hidden />
            Choisir cette agence
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------
// Composant principal — panneau repliable « Trouver mon agence »
// ------------------------------------------------------------
export function AgencyFinder({
  cities,
  from,
  to,
  date,
  selectedAgency,
  onAgencyChange,
  compact = false,
}: {
  cities: CityDTO[] | null;
  /** cityId de départ choisi dans le flux ("" si aucun) */
  from: string;
  /** cityId de destination choisi dans le flux ("" si aucun) */
  to: string;
  /** date de voyage choisie dans le flux */
  date: string;
  /** agence actuellement choisie (possédée par le booking-flow) */
  selectedAgency: NearbyAgencyDTO | null;
  onAgencyChange: (agency: NearbyAgencyDTO | null) => void;
  /** rendu discret (étape Voyages) plutôt que bouton large (étape Trajet) */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FinderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualCityId, setManualCityId] = useState("");

  // Intention de voyage complète ? → recommandation, sinon simple proximité
  const hasTripIntent = from !== "" && to !== "" && from !== to && date !== "";

  const recommendation =
    result && isRecommendation(result.data) ? result.data : null;
  const recommended = result?.data.recommended ?? null;

  // Fallback manuel : agences de la ville triées par nom
  const displayed = useMemo(() => {
    const list = result ? [...result.data.agencies] : [];
    if (result?.source === "manual") {
      list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    }
    return list;
  }, [result]);

  const manualCity = useMemo(
    () => (cities ?? []).find((c) => c.id === manualCityId) ?? null,
    [cities, manualCityId]
  );

  // Position GPS obtenue → agences proches (ou recommandation si trajet choisi).
  // Les coordonnées ne sont JAMAIS conservées : elles vivent le temps de l'appel.
  const loadFromPosition = async (lat: number, lng: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = hasTripIntent
        ? await api.agencies.recommend({ lat, lng, fromCityId: from, toCityId: to, date })
        : await api.agencies.nearby(lat, lng);
      setResult({ source: "gps", data });
      setOpen(true);
    } catch (err) {
      toast.error(errMessage(err));
      setError("Impossible de récupérer les agences proches. Réessayez ou choisissez votre ville ci-dessous.");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleLocate = () => {
    if (locating || loading) return;
    setError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      toast.info("La géolocalisation n'est pas disponible sur cet appareil. Choisissez votre ville ci-dessous.");
      setOpen(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void loadFromPosition(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setLocating(false);
        toast.info(
          err.code === err.PERMISSION_DENIED
            ? "Géolocalisation refusée. Choisissez votre ville ci-dessous pour trouver une agence."
            : "Position introuvable (GPS éteint ou réseau faible). Choisissez votre ville ci-dessous."
        );
        setOpen(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // Fallback manuel : centre-ville connu → agences de la ville
  const handleManualCity = async (cityId: string) => {
    setManualCityId(cityId);
    setError(null);
    const city = (cities ?? []).find((c) => c.id === cityId);
    const center = city ? CITY_CENTERS[normalizeCityName(city.name)] : undefined;
    if (!city || !center) {
      setResult(null);
      toast.info(
        city
          ? `Le centre de ${city.name} n'est pas encore référencé. Vous pouvez continuer sans choisir d'agence.`
          : "Ville introuvable. Vous pouvez continuer sans choisir d'agence."
      );
      return;
    }
    setLoading(true);
    try {
      const data = await api.agencies.nearby(center.lat, center.lng, cityId);
      setResult({ source: "manual", data });
      setOpen(true);
    } catch (err) {
      toast.error(errMessage(err));
      setError("Impossible de lister les agences de cette ville. Réessayez.");
    } finally {
      setLoading(false);
    }
  };

  const choose = (agency: NearbyAgencyDTO) => {
    onAgencyChange(agency);
    toast.success(`Recherches filtrées sur l'agence ${agency.name}.`);
    setOpen(false);
  };

  const busy = locating || loading;

  return (
    <section aria-label="Trouver mon agence (géolocalisation)" className="space-y-3">
      {selectedAgency ? (
        // Bannière « Agence : X — Modifier / Retirer » au-dessus des résultats
        <div className="rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-3 sm:px-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Building2 className="size-4 text-primary" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                Agence de départ
              </p>
              <p className="truncate text-sm font-semibold">{selectedAgency.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {selectedAgency.cityName}
                {selectedAgency.neighborhoodName ? ` · ${selectedAgency.neighborhoodName}` : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen((v) => !v)}
              className="h-9 shrink-0 gap-1.5"
            >
              {open ? (
                <ChevronUp className="size-4" aria-hidden />
              ) : (
                <PencilLine className="size-4" aria-hidden />
              )}
              {open ? "Masquer" : "Modifier"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onAgencyChange(null)}
              aria-label="Retirer le filtre par agence"
              className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        // Bouton « Trouver mon agence » — min 44 px tactile
        <Button
          type="button"
          variant="outline"
          size={compact ? "sm" : "lg"}
          onClick={handleLocate}
          disabled={busy}
          className={cn(
            "w-full font-medium",
            compact ? "min-h-[44px] text-sm" : "h-12 text-base"
          )}
        >
          {busy ? (
            <Loader2 className={compact ? "size-4 animate-spin" : "size-5 animate-spin"} aria-hidden />
          ) : (
            <MapPin className={compact ? "size-4" : "size-5"} aria-hidden />
          )}
          {locating
            ? "Localisation en cours…"
            : loading
              ? "Recherche des agences…"
              : "Trouver mon agence"}
        </Button>
      )}

      {/* Panneau repliable : détection + liste des agences + fallback ville */}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleContent>
          <Card className="border shadow-lg shadow-primary/5">
            <CardContent className="space-y-3 p-4">
              {/* En-tête du panneau */}
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
                  {result?.source === "manual" && manualCity
                    ? `Agences de ${manualCity.name}`
                    : "Agences NZOKO à proximité"}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label="Fermer la recherche d'agence"
                  className="size-8 shrink-0 text-muted-foreground"
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>

              {/* Quartier détecté (badge visible — largeur fluide sur mobile) */}
              {result?.data.neighborhood && (
                <Badge
                  variant="outline"
                  className="w-fit max-w-full gap-1.5 break-words border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary [&_span]:break-words whitespace-normal"
                >
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  Vous êtes probablement à {result.data.neighborhood.name} (
                  {result.data.neighborhood.cityName})
                </Badge>
              )}
              {result?.source === "manual" && manualCity && (
                <p className="text-xs text-muted-foreground">
                  Sélection manuelle — distances calculées depuis le centre de {manualCity.name}.
                </p>
              )}

              {/* Message d'aide du serveur (CAS 1/2/3) */}
              {result && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {result.data.message}
                </p>
              )}

              {error && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}

              {/* Liste des agences (hauteur bornée + défilement) */}
              {loading ? (
                <div className="space-y-3" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 rounded-xl" />
                  ))}
                </div>
              ) : displayed.length === 0 ? (
                <p className="rounded-lg bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
                  Aucune agence trouvée{result?.source === "manual" && manualCity ? ` à ${manualCity.name}` : " à proximité"}.
                  Choisissez une autre ville ou continuez sans agence.
                </p>
              ) : (
                <ul
                  className="nzoko-scroll max-h-96 space-y-2.5 overflow-y-auto pr-1"
                  aria-label="Agences disponibles"
                >
                  {displayed.map((agency) => (
                    <li key={agency.id}>
                      <AgencyCard
                        agency={agency}
                        recommended={recommended?.id === agency.id}
                        reason={recommendation?.reason ?? null}
                        selected={selectedAgency?.id === agency.id}
                        onChoose={choose}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {/* Fallback manuel — toujours accessible */}
              <div className="rounded-lg border border-dashed bg-muted/30 p-3">
                <Label htmlFor="agency-manual-city" className="text-xs font-medium text-muted-foreground">
                  GPS indisponible ou refusé ? Choisissez votre ville :
                </Label>
                <div className="mt-2 space-y-1.5">
                  <Select
                    value={manualCityId || undefined}
                    onValueChange={(v) => void handleManualCity(v)}
                  >
                    <SelectTrigger
                      id="agency-manual-city"
                      className="h-11 w-full"
                      aria-label="Choisir une ville pour lister ses agences"
                    >
                      <SelectValue placeholder="Sélectionner une ville" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 nzoko-scroll">
                      {(cities ?? []).length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                          Aucune ville disponible.
                        </div>
                      ) : (
                        (cities ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Vous pouvez aussi continuer sans choisir d&apos;agence.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
