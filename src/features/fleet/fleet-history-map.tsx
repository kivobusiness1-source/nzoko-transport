"use client";

// ============================================================
// NZOKO TRANSPORT — Carte d'historique GPS d'un voyage (Leaflet)
// Polyligne du parcours réel (points fiables en vert, points peu
// fiables en pointillé gris), arrêts (CircleMarker), départ/arrivée.
// Chargé dynamiquement (ssr:false) par fleet-history-view.
// ============================================================

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from "react-leaflet";
import type { TripHistoryDTO } from "@/types";

import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: L.LatLngExpression = [-4.3, 12.4];
const DEFAULT_ZOOM = 6;

const RELIABLE_COLOR = "#16a34a"; // vert NZOKO
const UNRELIABLE_COLOR = "#9ca3af"; // gris
const DEPART_COLOR = "#16a34a";
const ARRIVEE_COLOR = "#d97706"; // orange NZOKO

const PIN_CSS = `
.fhz-pin { background: transparent; border: none; }
.fhz-pin-dot { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 999px; color: #fff; font: 800 12px/1 ui-sans-serif, system-ui, sans-serif; border: 2.5px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.45); }
.fhz-pin-label { margin-top: 2px; background: rgba(255,255,255,.95); border: 1px solid rgba(0,0,0,.12); border-radius: 4px; padding: 0 4px; font: 700 10px/1.4 ui-sans-serif, system-ui, sans-serif; color: #1c1917; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.leaflet-container { font: inherit; background: #e7e5e4; }
`;

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function makePinIcon(letter: string, color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: "fhz-pin",
    html: `
      <span style="display:flex;flex-direction:column;align-items:center">
        <span class="fhz-pin-dot" style="background-color:${color}">${letter}</span>
        <span class="fhz-pin-label">${escapeHtml(label)}</span>
      </span>`,
    iconSize: [30, 44],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

/** Ajuste la vue sur le parcours à chaque changement de voyage. */
function HistoryFit({ positions, tripId }: { positions: L.LatLngExpression[]; tripId: string }) {
  const map = useMap();
  // Dernières positions connues — synchronisées en effet (jamais pendant le rendu).
  const positionsRef = useRef<L.LatLngExpression[]>(positions);
  useEffect(() => {
    positionsRef.current = positions;
  });
  const prevTrip = useRef<string>("");
  useEffect(() => {
    if (prevTrip.current === tripId) return;
    prevTrip.current = tripId;
    const pts = positionsRef.current;
    if (pts.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false });
      return;
    }
    if (pts.length === 1) {
      map.setView(pts[0], 13, { animate: false });
    } else {
      map.fitBounds(L.latLngBounds(pts).pad(0.15), { animate: false });
    }
  }, [tripId, map]);
  return null;
}

export default function FleetHistoryMap({ history }: { history: TripHistoryDTO }) {
  const positions = useMemo(
    () => history.points.map((p) => [p.latitude, p.longitude] as [number, number]),
    [history.points],
  );

  // Tronçons fiables (contigus) et peu fiables (pointillés gris).
  const { reliableRuns, unreliableRuns } = useMemo(() => {
    const reliable: L.LatLngExpression[][] = [];
    const unreliable: L.LatLngExpression[][] = [];
    let currentReliable: L.LatLngExpression[] = [];
    let currentUnreliable: L.LatLngExpression[] = [];
    const flush = () => {
      if (currentReliable.length > 1) reliable.push(currentReliable);
      else if (currentReliable.length === 1 && unreliable.length > 0) {
        // point isolé fiable → rattaché au tronçon peu fiable pour la continuité
        currentUnreliable.push(currentReliable[0]);
      }
      if (currentUnreliable.length > 1) unreliable.push(currentUnreliable);
      currentReliable = [];
      currentUnreliable = [];
    };
    for (const p of history.points) {
      const pos: L.LatLngExpression = [p.latitude, p.longitude];
      if (p.isReliable) {
        if (currentUnreliable.length > 0) {
          // continuité visuelle : dernier point peu fiable en tête du tronçon fiable
          currentReliable.push(currentUnreliable[currentUnreliable.length - 1]);
          if (currentUnreliable.length > 1) unreliable.push(currentUnreliable);
          currentUnreliable = [];
        }
        currentReliable.push(pos);
      } else {
        if (currentReliable.length > 0) {
          currentUnreliable.push(currentReliable[currentReliable.length - 1]);
          if (currentReliable.length > 1) reliable.push(currentReliable);
          currentReliable = [];
        }
        currentUnreliable.push(pos);
      }
    }
    flush();
    return { reliableRuns: reliable, unreliableRuns: unreliable };
  }, [history.points]);

  const first = history.points[0];
  const last = history.points[history.points.length - 1];
  const stops = history.stops.filter((s) => s.latitude !== null && s.longitude !== null);

  return (
    <div className="relative isolate h-[45vh] min-h-[280px] w-full overflow-hidden rounded-2xl border shadow-sm lg:h-[420px]">
      <style>{PIN_CSS}</style>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        className="h-full w-full"
        aria-label={`Carte du parcours du voyage ${history.tripCode}`}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributeurs'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {/* Parcours réel */}
        {reliableRuns.map((run, i) => (
          <Polyline key={`r-${i}`} positions={run} pathOptions={{ color: RELIABLE_COLOR, weight: 4, opacity: 0.85 }} />
        ))}
        {unreliableRuns.map((run, i) => (
          <Polyline key={`u-${i}`} positions={run} pathOptions={{ color: UNRELIABLE_COLOR, weight: 3, opacity: 0.9, dashArray: "6 8" }} />
        ))}

        {/* Arrêts de l'itinéraire (coordonnées connues) */}
        {stops.map((stop) => (
          <CircleMarker
            key={`s-${stop.position}`}
            center={[stop.latitude as number, stop.longitude as number]}
            radius={6}
            pathOptions={{ color: "#1c1917", fillColor: "#ffffff", fillOpacity: 1, weight: 2 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span className="text-xs">
                <strong>{stop.name}</strong> · {stop.minutesFromStart > 0 ? `+${stop.minutesFromStart} min` : "départ"}
              </span>
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Départ / arrivée réels (premier et dernier point GPS) */}
        {first && (
          <Marker
            position={[first.latitude, first.longitude]}
            icon={makePinIcon("D", DEPART_COLOR, history.originCityName)}
            title={`Départ — ${history.originCityName}`}
            alt={`Point de départ ${history.originCityName}`}
            zIndexOffset={400}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <span className="text-xs">
                Départ · {first.speed !== null ? `${Math.round(first.speed)} km/h` : ""}
              </span>
            </Tooltip>
          </Marker>
        )}
        {last && (
          <Marker
            position={[last.latitude, last.longitude]}
            icon={makePinIcon("A", ARRIVEE_COLOR, history.destinationCityName)}
            title={`Arrivée — ${history.destinationCityName}`}
            alt={`Point d'arrivée ${history.destinationCityName}`}
            zIndexOffset={400}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              <span className="text-xs">
                Dernier point · {last.speed !== null ? `${Math.round(last.speed)} km/h` : ""}
              </span>
            </Tooltip>
          </Marker>
        )}

        <HistoryFit positions={positions} tripId={history.tripId} />
      </MapContainer>

      {/* Légende parcours (desktop) */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 z-[1001] hidden items-center gap-3 rounded-xl border bg-background/90 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-md backdrop-blur lg:flex"
        aria-hidden="true"
      >
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-5 rounded-full" style={{ background: RELIABLE_COLOR }} /> Parcours fiable
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-5 rounded-full border-t-2 border-dashed" style={{ borderColor: UNRELIABLE_COLOR }} /> GPS peu fiable
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-stone-800 bg-white" /> Arrêt
        </span>
      </div>
    </div>
  );
}
