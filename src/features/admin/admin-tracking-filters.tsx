"use client";

// ============================================================
// NZOKO TRANSPORT — Suivi GPS V4 : filtres & légende des couches
// Filtres persistants (état React local du parent, conservés
// pendant la session d'affichage) : agence, état du bus, ligne.
// Légende : activation des couches carte (bus, agences, arrêts,
// tracés des lignes).
// ============================================================

import { Filter, Layers, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BUS_STATUS_LABELS, type BusStatus } from "@/lib/geo";

/** Option agence du filtre (structure minimale — la carte publique la
 *  remplit complètement, le repli la déduit des sessions). */
export interface AgencyFilterOption {
  id: string;
  name: string;
}

/** Option ligne du filtre (structure minimale). */
export interface RouteFilterOption {
  id: string;
  code: string;
  originCityName: string;
  destinationCityName: string;
}

/** Valeur du filtre agence (« all » = toutes). */
export const AGENCY_FILTER_ALL = "all";
/** Valeur du filtre état (« all » = tous). */
export const STATUS_FILTER_ALL = "all";
/** Valeur du filtre ligne (« all » = toutes). */
export const ROUTE_FILTER_ALL = "all";

export type StatusFilterValue = typeof STATUS_FILTER_ALL | BusStatus;
export type SimpleFilterValue = string; // agence / ligne : identifiant ou "all"

/** État d'activation des couches de la carte. */
export interface MapLayersState {
  buses: boolean;
  agencies: boolean;
  stops: boolean;
  routes: boolean;
}

/** Libellé lisible d'une ligne de la carte publique. */
export function routeOptionLabel(route: RouteFilterOption): string {
  return `${route.originCityName} → ${route.destinationCityName}`;
}

interface AdminTrackingFiltersProps {
  agencies: AgencyFilterOption[];
  routes: RouteFilterOption[];
  agencyFilter: SimpleFilterValue;
  statusFilter: StatusFilterValue;
  routeFilter: SimpleFilterValue;
  onAgencyFilterChange: (value: SimpleFilterValue) => void;
  onStatusFilterChange: (value: StatusFilterValue) => void;
  onRouteFilterChange: (value: SimpleFilterValue) => void;
  layers: MapLayersState;
  onLayerToggle: (layer: keyof MapLayersState) => void;
  hasActiveFilters: boolean;
  onReset: () => void;
}

export function AdminTrackingFilters({
  agencies,
  routes,
  agencyFilter,
  statusFilter,
  routeFilter,
  onAgencyFilterChange,
  onStatusFilterChange,
  onRouteFilterChange,
  layers,
  onLayerToggle,
  hasActiveFilters,
  onReset,
}: AdminTrackingFiltersProps) {
  // Les états proposés au filtrage (GPS_ERROR exclu volontairement :
  // il n'apparaît pas dans la barre KPI du cahier des charges).
  const statusOptions: BusStatus[] = ["MOVING", "STOPPED", "OFFLINE", "ARRIVED"];

  const layerItems: { key: keyof MapLayersState; label: string; emoji: string }[] = [
    { key: "buses", label: "Bus", emoji: "🚌" },
    { key: "agencies", label: "Agences", emoji: "🏢" },
    { key: "stops", label: "Arrêts", emoji: "📍" },
    { key: "routes", label: "Tracés des lignes", emoji: "➰" },
  ];

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      {/* --- Filtres (marqueurs + liste + cadrage) --- */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="tracking-filter-agency" className="text-xs font-medium text-muted-foreground">
              <Filter className="mr-1 inline h-3 w-3" aria-hidden="true" />
              Agence
            </Label>
            <Select value={agencyFilter} onValueChange={onAgencyFilterChange}>
              <SelectTrigger
                id="tracking-filter-agency"
                className="h-10 w-full"
                aria-label="Filtrer par agence"
              >
                <SelectValue placeholder="Toutes les agences" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AGENCY_FILTER_ALL}>Toutes les agences</SelectItem>
                {agencies.map((agency) => (
                  <SelectItem key={agency.id} value={agency.id}>
                    {agency.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="tracking-filter-status" className="text-xs font-medium text-muted-foreground">
              État du bus
            </Label>
            <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as StatusFilterValue)}>
              <SelectTrigger
                id="tracking-filter-status"
                className="h-10 w-full"
                aria-label="Filtrer par état du bus"
              >
                <SelectValue placeholder="Tous les états" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STATUS_FILTER_ALL}>Tous les états</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {BUS_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="tracking-filter-route" className="text-xs font-medium text-muted-foreground">
              Ligne
            </Label>
            <Select value={routeFilter} onValueChange={onRouteFilterChange}>
              <SelectTrigger
                id="tracking-filter-route"
                className="h-10 w-full"
                aria-label="Filtrer par ligne"
              >
                <SelectValue placeholder="Toutes les lignes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROUTE_FILTER_ALL}>Toutes les lignes</SelectItem>
                {routes.map((route) => (
                  <SelectItem key={route.id} value={route.id}>
                    {routeOptionLabel(route)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-[40px] shrink-0"
            onClick={onReset}
            aria-label="Réinitialiser les filtres"
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/* --- Légende / couches de la carte --- */}
      <div
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3"
        role="group"
        aria-label="Couches affichées sur la carte"
      >
        <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          Couches
        </span>
        {layerItems.map((item) => (
          <label
            key={item.key}
            className="flex min-h-[40px] cursor-pointer select-none items-center gap-2 rounded-md px-1 text-sm"
          >
            <Checkbox
              checked={layers[item.key]}
              onCheckedChange={() => onLayerToggle(item.key)}
              aria-label={`Afficher la couche ${item.label}`}
            />
            <span aria-hidden="true">{item.emoji}</span>
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
