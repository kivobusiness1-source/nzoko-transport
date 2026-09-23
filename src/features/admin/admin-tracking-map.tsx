"use client";

// ============================================================
// NZOKO TRANSPORT — Carte Leaflet du suivi GPS V4 (client only)
// Tuiles depuis la configuration serveur (SEULE source légitime),
// couches togglables : bus (couleur par état GPS), agences,
// arrêts de lignes, tracés GeoJSON (surlignage de la ligne du
// bus sélectionné), replay animé, cadrage stabilisé.
// Géométries GeoJSON en [lng, lat] → converties en [lat, lng].
// ============================================================

import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { BUS_STATUS_LABELS, humanDistance } from "@/lib/geo";
import type {
  MapAgencyDTO,
  MapCityDTO,
  MapLineStringDTO,
  MapRouteDTO,
  TrackingSessionDTO,
} from "@/types";
import { BUS_STATUS_COLORS, busStatusOf, GPS_STATUS_LABELS } from "@/features/admin/admin-tracking-shared";
import type { MapLayersState } from "@/features/admin/admin-tracking-filters";

/** Instantané de configuration carte (depuis /api/tracking/config). */
export interface FleetMapSnapshot {
  tileUrl: string;
  attribution: string;
  defaultLat: number;
  defaultLng: number;
}

/** Point affiché pendant le replay (marqueur animé par le parent). */
export interface FleetReplayPoint {
  latitude: number;
  longitude: number;
  heading: number | null;
}

export interface FleetMapProps {
  /** Sessions À AFFICHER (déjà filtrées par le parent). */
  sessions: TrackingSessionDTO[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  /** Trail de la session sélectionnée (vide si masqué). */
  trail: [number, number][];
  snapshot: FleetMapSnapshot;
  layers: MapLayersState;
  /** Agences à afficher (filtrées par le filtre agence). */
  agencies: MapAgencyDTO[];
  cities: MapCityDTO[];
  /** Lignes dont le tracé est affiché (filtrées par le filtre ligne). */
  routes: MapRouteDTO[];
  /** Ligne à surligner (celle du bus sélectionné). */
  highlightRouteId: string | null;
  /** Position courante du replay (null = replay inactif). */
  replay: FleetReplayPoint | null;
}

type SessionWithPoint = TrackingSessionDTO & { lastPoint: NonNullable<TrackingSessionDTO["lastPoint"]> };

function hasPoint(session: TrackingSessionDTO): session is SessionWithPoint {
  return session.lastPoint !== null;
}

// ------------------------------------------------------------
// Icônes (aucun asset externe — divIcon HTML)
// ------------------------------------------------------------

/** Marqueur bus 🚌 : fond coloré PAR ÉTAT GPS, rotation du cap. */
function busIcon(heading: number | null, background: string): L.DivIcon {
  const rotation = heading !== null && Number.isFinite(heading) ? Math.round(heading) : 0;
  return L.divIcon({
    className: "",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:9999px;
      background:${background};color:#fff;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
      font-size:16px;line-height:1;transform:rotate(${rotation}deg);
    ">🚌</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

/** Marqueur agence 🏢 : fond blanc, bord vert NZOKO. */
function agencyIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:30px;height:30px;border-radius:9999px;
      background:#ffffff;color:#059669;
      border:2px solid #059669;box-shadow:0 1px 3px rgba(0,0,0,.3);
      font-size:14px;line-height:1;
    ">🏢</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** Marqueur du replay 🚌 : plus grand, double anneau blanc, au-dessus. */
function replayIcon(heading: number | null): L.DivIcon {
  const rotation = heading !== null && Number.isFinite(heading) ? Math.round(heading) : 0;
  return L.divIcon({
    className: "",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:40px;height:40px;border-radius:9999px;
      background:#059669;color:#fff;
      border:3px solid #fff;box-shadow:0 0 0 3px rgba(5,150,105,.35),0 2px 6px rgba(0,0,0,.4);
      font-size:18px;line-height:1;transform:rotate(${rotation}deg);
    ">🚌</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

// ------------------------------------------------------------
// Géométries GeoJSON ([lng, lat]) → positions Leaflet ([lat, lng])
// ------------------------------------------------------------

/**
 * Convertit une LineString GeoJSON en positions Leaflet en
 * sous-échantillonnant (pas régulier) : les tracés OSRM comptent
 * 3 000–7 000 sommets par ligne, trop lourds pour six <polyline>
 * SVG — on plafonne à ~500 sommets, forme identique à l'échelle
 * pays. Premier et dernier sommets toujours conservés.
 */
function geometryToLatLngs(geometry: MapLineStringDTO, maxVertices = 500): [number, number][] {
  const coordinates = geometry.coordinates;
  if (coordinates.length === 0) return [];
  const stride = Math.max(1, Math.ceil(coordinates.length / maxVertices));
  const positions: [number, number][] = [];
  for (let i = 0; i < coordinates.length; i += stride) {
    positions.push([coordinates[i][1], coordinates[i][0]]);
  }
  const last = coordinates[coordinates.length - 1];
  const lastPosition: [number, number] = [last[1], last[0]];
  const tail = positions[positions.length - 1];
  if (tail[0] !== lastPosition[0] || tail[1] !== lastPosition[1]) positions.push(lastPosition);
  return positions;
}

/** Arrêt de ligne regroupé (une même ville peut servir plusieurs lignes). */
interface StopMarkerData {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: { code: string; position: number; minutesFromStart: number }[];
}

function buildStopMarkers(routes: MapRouteDTO[]): StopMarkerData[] {
  const byKey = new Map<string, StopMarkerData>();
  for (const route of routes) {
    for (const stop of route.stops) {
      const key = `${stop.name}@${stop.latitude.toFixed(2)},${stop.longitude.toFixed(2)}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.lines.push({ code: route.code, position: stop.position, minutesFromStart: stop.minutesFromStart });
      } else {
        byKey.set(key, {
          key,
          name: stop.name,
          latitude: stop.latitude,
          longitude: stop.longitude,
          lines: [{ code: route.code, position: stop.position, minutesFromStart: stop.minutesFromStart }],
        });
      }
    }
  }
  return Array.from(byKey.values());
}

// ------------------------------------------------------------
// Composants internes pilotant la carte
// ------------------------------------------------------------

/**
 * Cadrage automatique (hérité de la V3) : englobe les bus visibles.
 * STABILISÉ : on ne recadre que quand l'ensemble des sessions
 * affichées change (filtres, bus qui apparaît/disparaît) — les
 * rafraîchissements de position (poll 10 s, événements GPS) ne
 * volent plus le zoom/panoramique de l'administrateur.
 * Sans aucun point : centre par défaut de la configuration.
 */
function FleetFit({ sessions, defaultCenter }: { sessions: TrackingSessionDTO[]; defaultCenter: [number, number] }) {
  const map = useMap();
  const fitKey = sessions.map((s) => s.id).join("|");
  useEffect(() => {
    const points = sessions.filter(hasPoint).map((s) => s.lastPoint);
    if (points.length === 0) {
      map.setView(defaultCenter, 6);
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 7);
      return;
    }
    map.fitBounds(
      L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])),
      { padding: [40, 40] }
    );
    // Cadrage volontairement piloté par fitKey (identifiants) uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

/** Suit le bus de replay s'il sort du cadre (panoramique doux). */
function ReplayFollow({ replay }: { replay: FleetReplayPoint | null }) {
  const map = useMap();
  const lat = replay?.latitude ?? null;
  const lng = replay?.longitude ?? null;
  useEffect(() => {
    if (lat === null || lng === null) return;
    if (!map.getBounds().pad(-0.2).contains([lat, lng])) {
      map.panTo([lat, lng], { animate: true });
    }
  }, [map, lat, lng]);
  return null;
}

// ------------------------------------------------------------
// Carte
// ------------------------------------------------------------

export default function FleetMap({
  sessions,
  selectedId,
  onSelect,
  trail,
  snapshot,
  layers,
  agencies,
  cities,
  routes,
  highlightRouteId,
  replay,
}: FleetMapProps) {
  const cityNameById = useMemo(() => new Map(cities.map((c) => [c.id, c.name])), [cities]);
  const stopMarkers = useMemo(() => buildStopMarkers(routes), [routes]);

  // Bus 🚌 — fond coloré par état GPS + tooltip enrichi.
  const busMarkers = useMemo(() => {
    if (!layers.buses) return null;
    return sessions.filter(hasPoint).map((s) => {
      const point = s.lastPoint;
      const status = busStatusOf(s);
      // V5 (§11) — la couleur du marqueur reflète l'état GPS TECHNIQUE
      // quand il est connu : 🟢 actif / 🟡 silencieux / 🔴 hors ligne.
      // Sans gpsStatus (payload V4), le busStatus historique reste la source.
      const gpsStatus = s.gpsStatus ?? null;
      const background =
        gpsStatus === "GPS_OFFLINE"
          ? "#6b7280" // gris — téléphone hors ligne
          : gpsStatus === "GPS_STALE"
            ? "#d97706" // ambre — GPS silencieux
            : BUS_STATUS_COLORS[status];
      return (
        <Marker
          key={s.id}
          position={[point.latitude, point.longitude]}
          icon={busIcon(point.heading ?? null, background)}
          eventHandlers={{ click: () => onSelect(s.id) }}
          zIndexOffset={s.id === selectedId ? 1000 : 0}
        >
          <Tooltip direction="top" offset={[0, -18]}>
            <span className="text-xs">
              <strong>
                {s.driver.firstName} {s.driver.lastName}
              </strong>
              {s.trip ? ` · ${s.trip.originCityName} → ${s.trip.destinationCityName}` : " · hors voyage"}
              {point.speed != null ? ` · ${Math.round(point.speed)} km/h` : ""}
              {` · ${BUS_STATUS_LABELS[status]}`}
              {gpsStatus ? ` · ${GPS_STATUS_LABELS[gpsStatus] ?? gpsStatus}` : ""}
              {point.batteryLevel != null ? ` · 🔋 ${Math.round(point.batteryLevel)} %` : ""}
              {s.distanceToDestinationM != null ? ` · ${humanDistance(s.distanceToDestinationM)} restants` : ""}
            </span>
          </Tooltip>
        </Marker>
      );
    });
  }, [sessions, selectedId, onSelect, layers.buses]);

  // Agences 🏢 — popup : nom, adresse, téléphone, ville.
  const agencyMarkers = useMemo(() => {
    if (!layers.agencies) return null;
    return agencies.map((agency) => (
      <Marker
        key={agency.id}
        position={[agency.latitude, agency.longitude]}
        icon={agencyIcon()}
        zIndexOffset={-500}
      >
        <Popup>
          <span className="text-xs">
            <strong>🏢 {agency.name}</strong>
            <br />
            {agency.address ?? "Adresse non renseignée"}
            <br />
            {cityNameById.get(agency.cityId) ?? ""}
            {agency.phone ? (
              <>
                <br />
                ☎ {agency.phone}
              </>
            ) : null}
          </span>
        </Popup>
      </Marker>
    ));
  }, [agencies, layers.agencies, cityNameById]);

  // Arrêts 📍 — petits cercles, popup : ville, position dans la ligne,
  // minutes depuis le départ (une entrée par ligne desservie).
  const stopCircles = useMemo(() => {
    if (!layers.stops) return null;
    return stopMarkers.map((stop) => (
      <CircleMarker
        key={stop.key}
        center={[stop.latitude, stop.longitude]}
        radius={5}
        pathOptions={{ color: "#059669", weight: 2, fillColor: "#ffffff", fillOpacity: 1 }}
      >
        <Popup>
          <span className="text-xs">
            <strong>📍 {stop.name}</strong>
            {stop.lines.map((line) => (
              <span key={`${stop.key}-${line.code}`}>
                <br />
                Ligne {line.code} · arrêt n° {line.position} · à +{line.minutesFromStart} min du départ
              </span>
            ))}
          </span>
        </Popup>
      </CircleMarker>
    ));
  }, [stopMarkers, layers.stops]);

  // Tracés des lignes — gris pointillé fin ; VERT pour la ligne du
  // bus sélectionné.
  const routeLines = useMemo(() => {
    if (!layers.routes) return null;
    return routes.map((route) => {
      if (!route.geometry) return null;
      const positions = geometryToLatLngs(route.geometry);
      if (positions.length < 2) return null;
      const highlighted = route.id === highlightRouteId;
      return (
        <Polyline
          key={route.id}
          positions={positions}
          pathOptions={
            highlighted
              ? { color: "#059669", weight: 4, opacity: 0.9 }
              : { color: "#64748b", weight: 2.5, opacity: 0.5, dashArray: "6 6" }
          }
        />
      );
    });
  }, [routes, layers.routes, highlightRouteId]);

  return (
    <div className="overflow-hidden rounded-xl border" role="application" aria-label="Carte de la flotte en temps réel">
      <MapContainer
        center={[snapshot.defaultLat, snapshot.defaultLng]} // centre par défaut : configuration serveur
        zoom={6}
        scrollWheelZoom
        className="h-[300px] w-full sm:h-[420px]"
      >
        {/* Tuiles raster — URL et attribution UNIQUEMENT depuis la config serveur. */}
        <TileLayer attribution={snapshot.attribution} url={snapshot.tileUrl} />

        {routeLines}
        {stopCircles}
        {agencyMarkers}
        {busMarkers}

        {/* Trail de la session sélectionnée (visible ou pendant le replay). */}
        {trail.length > 1 && (
          <Polyline positions={trail} pathOptions={{ color: "#059669", weight: 3, opacity: 0.8 }} />
        )}

        {/* Marqueur animé du replay (au-dessus de tout). */}
        {replay && (
          <Marker
            position={[replay.latitude, replay.longitude]}
            icon={replayIcon(replay.heading)}
            zIndexOffset={2000}
          >
            <Tooltip direction="top" offset={[0, -22]}>
              <span className="text-xs">Replay — position rejouée</span>
            </Tooltip>
          </Marker>
        )}

        <FleetFit sessions={sessions} defaultCenter={[snapshot.defaultLat, snapshot.defaultLng]} />
        <ReplayFollow replay={replay} />
      </MapContainer>
    </div>
  );
}
