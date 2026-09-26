"use client";

// ============================================================
// Océan du Nord — Formulaire de recherche de voyages (Départ / Destination / Date)
// Composant CONTRÔLÉ : l'état appartient au parent (accueil, étape 1 du tunnel).
// ============================================================

import { useMemo, useState } from "react";
import { ArrowLeftRight, CalendarDays, Loader2, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayStr } from "@/lib/dates";
import type { CityDTO } from "@/types";
import { cn } from "@/lib/utils";

export interface SearchParams {
  from: string;
  to: string;
  date: string;
}

interface SearchFormProps {
  cities: CityDTO[] | null;
  from: string;
  to: string;
  date: string;
  onFromChange: (cityId: string) => void;
  onToChange: (cityId: string) => void;
  onDateChange: (date: string) => void;
  onSearch: (params: SearchParams) => void;
  submitLabel?: string;
  loading?: boolean;
  className?: string;
}

function CitySelect({
  id,
  label,
  value,
  onChange,
  cities,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (cityId: string) => void;
  cities: CityDTO[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-11 w-full" aria-label={label}>
          <span className="flex min-w-0 items-center gap-2">
            <MapPin className="size-4 shrink-0 text-primary" aria-hidden />
            <SelectValue placeholder={placeholder} />
          </span>
        </SelectTrigger>
        <SelectContent className="max-h-72 nzoko-scroll">
          {cities.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Aucune ville disponible.</div>
          ) : (
            cities.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SearchForm({
  cities,
  from,
  to,
  date,
  onFromChange,
  onToChange,
  onDateChange,
  onSearch,
  submitLabel = "Rechercher",
  loading = false,
  className,
}: SearchFormProps) {
  const [error, setError] = useState<string | null>(null);
  const minDate = useMemo(() => todayStr(), []);

  const swap = () => {
    onFromChange(to);
    onToChange(from);
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cities || cities.length === 0) {
      setError("Villes indisponibles pour le moment. Réessayez bientôt.");
      return;
    }
    if (!from || !to) {
      setError("Choisissez une ville de départ et une destination.");
      return;
    }
    if (from === to) {
      setError("Le départ et la destination doivent être différents.");
      return;
    }
    if (!date || date < minDate) {
      setError("Choisissez une date valide (aujourd'hui ou plus tard).");
      return;
    }
    setError(null);
    onSearch({ from, to, date });
  };

  const loadingCities = cities === null;
  const list = cities ?? [];

  return (
    <Card className={cn("border shadow-lg shadow-primary/5", className)}>
      <CardContent className="p-4 sm:p-6">
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {loadingCities ? (
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
              </div>
            ) : (
              <CitySelect
                id="search-from"
                label="Départ"
                value={from}
                onChange={onFromChange}
                cities={list}
                placeholder="Ville de départ"
              />
            )}

            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={swap}
              disabled={loadingCities}
              aria-label="Échanger départ et destination"
              className="mx-auto h-11 w-11 shrink-0 self-end rounded-full"
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden />
            </Button>

            {loadingCities ? (
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
              </div>
            ) : (
              <CitySelect
                id="search-to"
                label="Destination"
                value={to}
                onChange={onToChange}
                cities={list}
                placeholder="Ville d'arrivée"
              />
            )}
          </div>

          <div>
            <Label htmlFor="search-date" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Date de voyage
            </Label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" aria-hidden />
              <input
                id="search-date"
                type="date"
                value={date}
                min={minDate}
                onChange={(e) => onDateChange(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                aria-label="Date de voyage"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={loading} className="h-12 w-full text-base">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Search className="h-5 w-5" aria-hidden />}
            {loading ? "Recherche…" : submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
