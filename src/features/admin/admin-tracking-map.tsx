"use client";

// ============================================================
// NZOKO TRANSPORT — Carte Leaflet du suivi GPS (client only)
// Marqueurs divIcon (aucun asset externe), trail de la session
// sélectionnée, fit automatique sur la flotte.
// ============================================================

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackingSessionDTO } from "@/types";

export interface FleetMapProps {
  sessions: TrackingSessionDTO[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  trail: [number, number][];
}

function busIcon(heading: number | null, moving: boolean): L.DivIcon {
  const rotation = heading !== null ? Math.round(heading) : 0;
  return L.divIcon({
    className: "",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:9999px;
      background:${moving ? "#059669" : "#757575"};color:#fff;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
      font-size:16px;line-height:1;transform:rotate(${rotation}deg);
    ">🚌</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

type SessionWithPoint = TrackingSessionDTO & { lastPoint: NonNullable<TrackingSessionDTO["lastPoint"]> };

function FleetFit({ sessions }: { sessions: TrackingSessionDTO[] }) {
  const map = useMap();
  useEffect(() => {
    const points = sessions
      .filter((s): s is SessionWithPoint => s.lastPoint !== null)
      .map((s) => s.lastPoint);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 7);
      return;
    }
    map.fitBounds(
      L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])),
      { padding: [40, 40] }
    );
  }, [map, sessions]);
  return null;
}

export default function FleetMap({ sessions, selectedId, onSelect, trail }: FleetMapProps) {
  const markers = useMemo(() => {
    const withPoints = sessions.filter((s): s is SessionWithPoint => s.lastPoint !== null);
    return withPoints.map((s) => {
      const point = s.lastPoint;
      const moving = (point.speed ?? 0) >= 5;
      return (
        <Marker
          key={s.id}
          position={[point.latitude, point.longitude]}
          icon={busIcon(point.heading ?? null, moving)}
          eventHandlers={{ click: () => onSelect(s.id) }}
          zIndexOffset={s.id === selectedId ? 1000 : 0}
        >
          <Tooltip direction="top" offset={[0, -18]}>
            <span className="text-xs">
              <strong>{s.driver.firstName} {s.driver.lastName}</strong>
              {s.trip ? ` · ${s.trip.originCityName} → ${s.trip.destinationCityName}` : " · hors voyage"}
              {point.speed != null ? ` · ${Math.round(point.speed)} km/h` : ""}
            </span>
          </Tooltip>
        </Marker>
      );
    });
  }, [sessions, selectedId, onSelect]);

  return (
    <div className="overflow-hidden rounded-xl border" role="application" aria-label="Carte de la flotte en temps réel">
      <MapContainer
        center={[-4.27, 15.28]} // Brazzaville par défaut
        zoom={6}
        scrollWheelZoom
        style={{ height: "420px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {trail.length > 1 && (
          <Polyline positions={trail} pathOptions={{ color: "#059669", weight: 3, opacity: 0.8 }} />
        )}
        {markers}
        <FleetFit sessions={sessions} />
      </MapContainer>
    </div>
  );
}
