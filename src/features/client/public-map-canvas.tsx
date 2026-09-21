"use client";

// ============================================================
// NZOKO TRANSPORT — Carte publique des lignes (client only)
// Composant Leaflet dédié à la vue « Carte des lignes NZOKO » :
// tuiles ouvertes (config serveur, jamais d'URL en dur), tracés
// des itinéraires, agences, arrêts par ville et positions bus
// VOLONTAIREMENT minimales (exigence 41 : aucune donnée chauffeur,
// immatriculation ou agence au-delà de /api/map/public).
// Indépendant du composant admin (admin-tracking-map.tsx).
// ============================================================

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { BUS_STATUS_LABELS, type BusStatus } from "@/lib/geo";
import { relativeTime } from "@/lib/format";
import type { MapBusDTO, MapPublicDTO, MapRouteDTO } from "@/types";

/** Couleur d'un bus selon son état GPS (contrat V4). */
export const BUS_STATUS_COLORS: Record<BusStatus, string> = {
  MOVING: "#059669",
  STOPPED: "#d97706",
  OFFLINE: "#6b7280",
  ARRIVED: "#0d9488",
  GPS_ERROR: "#dc2626",
};

/** Vert NZOKO des tracés. */
const ROUTE_COLOR = "#059669";
/** Ambre de surlignage de la ligne sélectionnée. */
const ROUTE_SELECTED_COLOR = "#f59e0b";
/** Gris-vert discret des arrêts (un point par ville). */
const STOP_FILL_COLOR = "#64826e";

/** Décimation d'affichage : points max par tracé (fidélité suffisante au zoom pays). */
const MAX_POINTS_PER_LINE = 400;

export interface PublicMapCanvasProps {
  tileUrl: string;
  attribution: string;
  centerLat: number;
  centerLng: number;
  data: MapPublicDTO;
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
}

/** Réduit un tracé à `max` points (premier et dernier toujours conservés). */
function decimate<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(items[Math.round(i * step)]);
  out.push(items[items.length - 1]);
  return out;
}

interface CityPoint {
  latitude: number;
  longitude: number;
}

/** Positions Leaflet [lat, lng] d'une ligne : géométrie GeoJSON [lng, lat]
 *  convertie, repli sur les villes connues si la géométrie est absente. */
function routeLinePositions(route: MapRouteDTO, citiesByName: Map<string, CityPoint>): [number, number][] {
  if (route.geometry && route.geometry.coordinates.length > 1) {
    const positions: [number, number][] = [];
    for (const [lng, lat] of route.geometry.coordinates) {
      if (Number.isFinite(lat) && Number.isFinite(lng)) positions.push([lat, lng]);
    }
    if (positions.length > 1) return decimate(positions, MAX_POINTS_PER_LINE);
  }
  // Repli sans géométrie : origine → arrêts → destination (villes connues).
  const positions: [number, number][] = [];
  const origin = citiesByName.get(route.originCityName);
  if (origin) positions.push([origin.latitude, origin.longitude]);
  for (const stop of route.stops) positions.push([stop.latitude, stop.longitude]);
  const destination = citiesByName.get(route.destinationCityName);
  if (destination) positions.push([destination.latitude, destination.longitude]);
  return positions;
}

/** Marqueur agence : pastille blanche à bord vert NZOKO. */
function agencyIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:30px;height:30px;border-radius:9999px;
      background:#ffffff;border:2px solid #059669;
      box-shadow:0 1px 4px rgba(0,0,0,.35);
      font-size:15px;line-height:1;
    ">🏢</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** Marqueur bus : pastille colorée selon l'état GPS, orientée selon le cap. */
function busIcon(bus: MapBusDTO): L.DivIcon {
  const rotation = bus.heading !== null ? Math.round(bus.heading) : 0;
  const color = BUS_STATUS_COLORS[bus.busStatus] ?? "#6b7280";
  return L.divIcon({
    className: "",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:9999px;
      background:${color};color:#fff;border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,.35);
      font-size:16px;line-height:1;transform:rotate(${rotation}deg);
    ">🚌</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

/** Recadre la carte quand la clé de focus change (première donnée ou
 *  sélection de ligne) — JAMAIS au simple polling silencieux. */
function MapFocus({ bounds, focusKey }: { bounds: L.LatLngBounds | null; focusKey: string }) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!bounds || !bounds.isValid()) return;
    if (lastKey.current === focusKey) return;
    lastKey.current = focusKey;
    // Bornes réduites à un point : vue centrée plutôt que zoom maximal.
    if (bounds.getNorth() === bounds.getSouth() && bounds.getEast() === bounds.getWest()) {
      map.setView(bounds.getCenter(), 11);
      return;
    }
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, bounds, focusKey]);
  return null;
}

/** Un tracé de ligne cliquable avec sa popup (Pointe-Noire → Brazzaville · 536 km). */
function RouteLine({
  route,
  positions,
  selected,
  onSelect,
}: {
  route: MapRouteDTO;
  positions: [number, number][];
  selected: boolean;
  onSelect: (routeId: string) => void;
}) {
  if (positions.length < 2) return null;
  return (
    <Polyline
      positions={positions}
      pathOptions={
        selected
          ? { color: ROUTE_SELECTED_COLOR, weight: 5, opacity: 0.95 }
          : { color: ROUTE_COLOR, weight: 3, opacity: 0.75 }
      }
      eventHandlers={{ click: () => onSelect(route.id) }}
    >
      <Popup>
        <span className="block text-sm font-semibold text-stone-800">
          {route.originCityName} → {route.destinationCityName}
        </span>
        <span className="block text-xs text-stone-500">
          {Math.round(route.distanceKm)} km ·{" "}
          {route.stops.length === 0
            ? "trajet direct"
            : `${route.stops.length} arrêt${route.stops.length > 1 ? "s" : ""}`}
        </span>
      </Popup>
    </Polyline>
  );
}

export default function PublicMapCanvas({
  tileUrl,
  attribution,
  centerLat,
  centerLng,
  data,
  selectedRouteId,
  onSelectRoute,
}: PublicMapCanvasProps) {
  // Nom de ville par id (popup agence) et coordonnées par nom (repli sans géométrie).
  const cityNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const city of data.cities) map.set(city.id, city.name);
    return map;
  }, [data.cities]);

  const cityPointsByName = useMemo(() => {
    const map = new Map<string, CityPoint>();
    for (const city of data.cities) map.set(city.name, { latitude: city.latitude, longitude: city.longitude });
    return map;
  }, [data.cities]);

  // Tracés décimés par ligne (GeoJSON [lng, lat] → Leaflet [lat, lng]).
  const routeLines = useMemo(() => {
    const map = new Map<string, [number, number][]>();
    for (const route of data.routes) map.set(route.id, routeLinePositions(route, cityPointsByName));
    return map;
  }, [data.routes, cityPointsByName]);

  // Arrêts desservis, dédoublonnés par ville (un point discret par ville).
  const uniqueStopCities = useMemo(() => {
    const map = new Map<string, { name: string; latitude: number; longitude: number }>();
    for (const route of data.routes) {
      for (const stop of route.stops) {
        if (!map.has(stop.name)) {
          map.set(stop.name, { name: stop.name, latitude: stop.latitude, longitude: stop.longitude });
        }
      }
    }
    return [...map.values()];
  }, [data.routes]);

  // Bornes de recadrage : la ligne sélectionnée, sinon tout (agences + tracés).
  // La clé reste stable d'un poll à l'autre (identifiants) → pas de recadrage intempestif.
  const focus = useMemo(() => {
    const selected = selectedRouteId
      ? data.routes.find((r) => r.id === selectedRouteId) ?? null
      : null;
    if (selected) {
      const points: [number, number][] = [...(routeLines.get(selected.id) ?? [])];
      for (const stop of selected.stops) points.push([stop.latitude, stop.longitude]);
      return { bounds: L.latLngBounds(points), key: `route:${selected.id}` };
    }
    const points: [number, number][] = [];
    for (const line of routeLines.values()) points.push(...line);
    for (const agency of data.agencies) points.push([agency.latitude, agency.longitude]);
    const signature = `${data.routes.map((r) => r.id).join(",")}|${data.agencies.length}`;
    return { bounds: L.latLngBounds(points), key: `all:${signature}` };
  }, [data.routes, data.agencies, routeLines, selectedRouteId]);

  const selectedRoute = selectedRouteId
    ? data.routes.find((r) => r.id === selectedRouteId) ?? null
    : null;

  return (
    <div
      className="overflow-hidden rounded-xl border"
      role="application"
      aria-label="Carte des lignes NZOKO — agences, itinéraires et bus en circulation"
    >
      <MapContainer
        center={[centerLat, centerLng]}
        zoom={6}
        scrollWheelZoom
        className="h-[320px] w-full sm:h-[480px]"
      >
        {/* Tuiles ouvertes — SEULE source : la config serveur (tuileUrl passée en prop) */}
        <TileLayer attribution={attribution} url={tileUrl} />

        {/* Tracés des lignes (la sélection est rendue en dernier → au-dessus) */}
        {data.routes
          .filter((route) => route.id !== selectedRoute?.id)
          .map((route) => (
            <RouteLine
              key={route.id}
              route={route}
              positions={routeLines.get(route.id) ?? []}
              selected={false}
              onSelect={onSelectRoute}
            />
          ))}
        {selectedRoute && (
          <RouteLine
            route={selectedRoute}
            positions={routeLines.get(selectedRoute.id) ?? []}
            selected
            onSelect={onSelectRoute}
          />
        )}

        {/* Arrêts desservis : point gris-vert discret par ville */}
        {uniqueStopCities.map((stop) => (
          <CircleMarker
            key={stop.name}
            center={[stop.latitude, stop.longitude]}
            radius={5}
            pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: STOP_FILL_COLOR, fillOpacity: 0.9 }}
          >
            <Popup>
              <span className="block text-sm font-semibold text-stone-800">📍 {stop.name}</span>
              <span className="block text-xs text-stone-500">Ville desservie par nos lignes</span>
            </Popup>
          </CircleMarker>
        ))}

        {/* Agences : pastille 🏢 + coordonnées publiques */}
        {data.agencies.map((agency) => (
          <Marker
            key={agency.id}
            position={[agency.latitude, agency.longitude]}
            icon={agencyIcon()}
            zIndexOffset={200}
          >
            <Popup>
              <span className="block text-sm font-semibold text-stone-800">🏢 {agency.name}</span>
              {agency.address && <span className="block text-xs text-stone-600">{agency.address}</span>}
              {agency.phone && (
                <a
                  href={`tel:${agency.phone}`}
                  className="block text-xs font-semibold text-emerald-700 underline"
                >
                  {agency.phone}
                </a>
              )}
              {cityNamesById.has(agency.cityId) && (
                <span className="block text-xs text-stone-500">{cityNamesById.get(agency.cityId)}</span>
              )}
            </Popup>
          </Marker>
        ))}

        {/* Bus en circulation — popup MINIMALE (exigence 41) :
            ligne, vitesse, dernière mise à jour. RIEN d'autre. */}
        {data.buses.map((bus) => (
          <Marker
            key={bus.sessionId}
            position={[bus.latitude, bus.longitude]}
            icon={busIcon(bus)}
            zIndexOffset={1000}
          >
            <Popup>
              <span className="block text-sm font-semibold text-stone-800">🚌 {bus.routeLabel}</span>
              <span className="block text-xs text-stone-500">
                {BUS_STATUS_LABELS[bus.busStatus]}
                {bus.speedKmh !== null ? ` · ${Math.round(bus.speedKmh)} km/h` : ""}
              </span>
              <span className="block text-xs text-stone-500">Mis à jour {relativeTime(bus.recordedAt)}</span>
            </Popup>
          </Marker>
        ))}

        <MapFocus bounds={focus.bounds} focusKey={focus.key} />
      </MapContainer>
    </div>
  );
}
