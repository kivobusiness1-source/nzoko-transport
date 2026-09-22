"use client";

// ============================================================
// NZOKO TRANSPORT — Carte de la flotte en direct (Leaflet)
// Composant CHARGÉ DYNAMIQUEMENT (ssr:false) par ses parents
// (fleet-view) : Leaflet exige window. Fonds OpenStreetMap avec
// attribution obligatoire. Marqueurs divIcon (bus-marker.tsx),
// recentrage fitBounds + focus bus depuis le panneau latéral.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BusMarker } from "./bus-marker";
import { BUS_STATE_DOT_COLOR } from "./fleet-utils";
import type { FleetBusDTO } from "@/types";

import "leaflet/dist/leaflet.css";

// CSS des marqueurs (divIcon = HTML brut) — injecté une seule fois
// avec la carte (client-only), aucun impact hors de ce composant.
const MARKER_CSS = `
.fzm-marker { background: transparent; border: none; }
.fzm-wrap { position: relative; display: flex; flex-direction: column; align-items: center; }
.fzm-dot { position: relative; width: 30px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; color: #fff; border: 2.5px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.45); }
.fzm-bus-svg { width: 15px; height: 15px; }
.fzm-arrow { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center; pointer-events: none; }
.fzm-arrow svg { width: 11px; height: 11px; margin-top: -7px; filter: drop-shadow(0 0 1px rgba(0,0,0,.55)); }
.fzm-label { margin-top: 2px; background: rgba(255,255,255,.95); border: 1px solid rgba(0,0,0,.12); border-radius: 4px; padding: 0 4px; font: 700 10px/1.4 ui-sans-serif, system-ui, sans-serif; color: #1c1917; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.fzm-halo { position: absolute; inset: -6px; border-radius: 999px; border: 3px solid rgba(220,38,38,.6); animation: fzm-ping 1.6s ease-out infinite; pointer-events: none; }
@keyframes fzm-ping { 0% { transform: scale(.65); opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
.leaflet-container { font: inherit; background: #e7e5e4; }
.fzm-popup .leaflet-popup-content { margin: 10px 12px; line-height: 1.35; }
.fzm-popup .leaflet-popup-content-wrapper { border-radius: 12px; }
`;

const DEFAULT_CENTER: L.LatLngExpression = [-4.3, 12.4]; // corridor routier Congo
const DEFAULT_ZOOM = 6;

export interface FleetMapFocus {
  busId: string;
  lat: number;
  lng: number;
  nonce: number; // changement → recentrage (même bus re-cliqué)
}

interface FleetMapProps {
  buses: FleetBusDTO[];
  now: number;
  focus: FleetMapFocus | null;
  onSelectBus?: (busId: string) => void;
}

/** Contrôles impératifs de la carte : fit initial/recentrage + focus bus. */
function MapController({
  positions,
  focus,
  fitSignal,
}: {
  positions: L.LatLngExpression[];
  focus: FleetMapFocus | null;
  fitSignal: number;
}) {
  const map = useMap();
  // Dernières positions connues — synchronisées en effet (jamais pendant le rendu).
  const positionsRef = useRef<L.LatLngExpression[]>(positions);
  useEffect(() => {
    positionsRef.current = positions;
  });
  const prevCount = useRef(-1);

  const fitToPositions = () => {
    const pts = positionsRef.current;
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 13, { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(pts).pad(0.18), { animate: true });
    }
  };

  // Ajustement initial (montage) + chaque clic sur « Recentrer ».
  useEffect(() => {
    fitToPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché uniquement par le signal du bouton Recentrer
  }, [map, fitSignal]);

  // Auto-fit quand les bus apparaissent après le montage (chargement REST).
  useEffect(() => {
    const n = positionsRef.current.length;
    if (prevCount.current === 0 && n > 0) fitToPositions();
    prevCount.current = n;
  });

  // Focus demandé depuis le panneau latéral → centre + zoom 13.
  useEffect(() => {
    if (focus) {
      map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 13), { animate: true });
    }
  }, [focus, map]);

  return null;
}

export default function FleetMap({ buses, now, focus, onSelectBus }: FleetMapProps) {
  const [fitSignal, setFitSignal] = useState(0);
  const visibleBuses = useMemo(
    () => buses.filter((b) => b.latitude !== null && b.longitude !== null),
    [buses],
  );
  const positions = useMemo(
    () => visibleBuses.map((b) => [b.latitude, b.longitude] as [number, number]),
    [visibleBuses],
  );

  const recenter = () => setFitSignal((s) => s + 1);

  return (
    <div className="relative isolate h-[45vh] min-h-[280px] w-full overflow-hidden rounded-2xl border shadow-sm lg:h-full">
      <style>{MARKER_CSS}</style>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        className="h-full w-full"
        aria-label="Carte de localisation des bus en temps réel"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributeurs'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        {visibleBuses.map((bus) => (
          <BusMarker key={bus.busId} bus={bus} now={now} onSelect={onSelectBus} />
        ))}
        <MapController positions={positions} focus={focus} fitSignal={fitSignal} />
      </MapContainer>

      {/* Recentre la vue sur tous les bus localisés */}
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={recenter}
        aria-label="Recentrer la carte sur les bus visibles"
        title="Recentrer sur les bus"
        className="absolute right-3 top-3 z-[1001] h-10 w-10 rounded-xl bg-background/95 shadow-md backdrop-blur"
      >
        <LocateFixed className="h-4 w-4 text-primary" aria-hidden />
      </Button>

      {/* Légende (desktop) */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 z-[1001] hidden items-center gap-2.5 rounded-xl border bg-background/90 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-md backdrop-blur lg:flex"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: BUS_STATE_DOT_COLOR.EN_ROUTE }} /> En route</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: BUS_STATE_DOT_COLOR.PAUSED }} /> Pause</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: BUS_STATE_DOT_COLOR.OFFLINE }} /> Hors ligne</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: BUS_STATE_DOT_COLOR.OFF_ROUTE }} /> Hors itinéraire</span>
      </div>
    </div>
  );
}
