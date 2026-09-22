"use client";

// ============================================================
// NZOKO TRANSPORT — Marqueur de bus sur la carte Leaflet
// divIcon custom : pastille circulaire colorée par état + icône
// bus + flèche de direction (SEULEMENT si heading non null — on
// n'invente jamais un cap) + halo rouge pour HORS ITINÉRAIRE.
// ============================================================

import { useMemo } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import { BUS_STATE_DOT_COLOR, BUS_STATE_BADGE_CLASS, lastSeenLabel } from "./fleet-utils";
import type { FleetBusDTO } from "@/types";

/** Échappe les données dynamiques injectées dans le HTML du divIcon. */
function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const BUS_SVG_PATHS = `
  <path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/>
  <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>
  <circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>
`;

/**
 * Fabrique l'icône divIcon d'un bus.
 * - pastille colorée par état + contour blanc + ombre douce
 * - flèche rotatée par le heading (transform rotate) si non null
 * - halo pulsé rouge autour d'un bus HORS ITINÉRAIRE
 * - étiquette fleetNumber sous la pastille
 */
export function makeBusIcon(bus: FleetBusDTO): L.DivIcon {
  const color = BUS_STATE_DOT_COLOR[bus.state] ?? "#6b7280";
  const label = esc(bus.fleetNumber ?? bus.registrationNumber);
  const headingDeg: number | null =
    typeof bus.heading === "number" && !Number.isNaN(bus.heading) ? bus.heading : null;
  const rotation = headingDeg !== null ? Math.round(headingDeg) % 360 : 0;
  const halo = bus.state === "OFF_ROUTE" ? `<span class="fzm-halo" aria-hidden="true"></span>` : "";

  const html = `
    <span class="fzm-wrap">
      ${halo}
      <span class="fzm-dot" style="background-color:${color}">
        <svg class="fzm-bus-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BUS_SVG_PATHS}</svg>
        ${headingDeg !== null ? `
        <span class="fzm-arrow" style="transform: rotate(${rotation}deg)" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3l4.5 15.5L12 14.7 7.5 18.5 12 3z" fill="${color}" stroke="#fff" stroke-width="1.4"/></svg>
        </span>` : ""}
      </span>
      <span class="fzm-label">${label}</span>
    </span>`;

  return L.divIcon({
    className: "fzm-marker",
    html,
    iconSize: [34, 46],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });
}

interface BusMarkerProps {
  bus: FleetBusDTO;
  /** Horloge partagée (ms) pour recalculer « il y a X s » sans recharger. */
  now: number;
  onSelect?: (busId: string) => void;
}

export function BusMarker({ bus, now, onSelect }: BusMarkerProps) {
  // L'icône est mémorisée avant tout retour conditionnel (règle des hooks) ;
  // pas de marqueur si la position est inconnue (OFFLINE sans fix GPS) :
  // le bus reste listé dans le panneau, pas sur la carte.
  const icon = useMemo(
    () => makeBusIcon(bus),
    // Recréer l'icône uniquement quand son rendu change réellement.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendances volontairement restreintes (identité du rendu de l'icône)
    [bus.state, bus.heading, bus.fleetNumber, bus.registrationNumber, bus.offRoute],
  );

  if (bus.latitude === null || bus.longitude === null) return null;

  const title = bus.fleetNumber ?? bus.registrationNumber;
  const route = bus.originCityName && bus.destinationCityName
    ? `${bus.originCityName} → ${bus.destinationCityName}`
    : "Trajet inconnu";

  return (
    <Marker
      position={[bus.latitude, bus.longitude]}
      icon={icon}
      title={title}
      alt={`Bus ${title} — ${bus.stateLabel}`}
      zIndexOffset={bus.state === "OFF_ROUTE" ? 500 : bus.state === "EN_ROUTE" ? 300 : 0}
      eventHandlers={{ click: () => onSelect?.(bus.busId) }}
    >
      <Popup maxWidth={280} className="fzm-popup" aria-label={`Détails du bus ${title}`}>
        <div className="min-w-0 space-y-1 text-[13px] leading-snug">
          <p className="font-semibold">
            <span className="font-mono">{title}</span>
            <span className="mx-1 text-muted-foreground">—</span>
            <span className="text-foreground/90">{route}</span>
          </p>
          <p className="text-muted-foreground">
            Chauffeur : <span className="font-medium text-foreground">{driverLabel(bus)}</span>
            {bus.driverPhone && (
              <>
                {" · "}
                <a href={`tel:${bus.driverPhone}`} className="font-mono text-primary underline-offset-2 hover:underline">
                  {bus.driverPhone}
                </a>
              </>
            )}
          </p>
          <p className="text-muted-foreground">
            Vitesse :{" "}
            <span className="font-medium text-foreground">
              {bus.speed !== null ? `${Math.round(bus.speed)} km/h` : "—"}
            </span>
            {" · "}
            {bus.accuracy !== null ? `±${Math.round(bus.accuracy)} m` : "précision inconnue"}
          </p>
          <p className="text-muted-foreground">
            Dernière position :{" "}
            <span className="font-medium text-foreground">
              {bus.lastSeenAt ? lastSeenLabel(bus.lastSeenAt, now) : "inconnue"}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${BUS_STATE_BADGE_CLASS[bus.state]}`}
            >
              {bus.stateLabel}
            </span>
            {bus.tripStatus && (
              <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Voyage : {bus.tripStatus === "DEPARTED" ? "parti" : bus.tripStatus === "ARRIVED" ? "arrivé" : bus.tripStatus === "SCHEDULED" ? "programmé" : bus.tripStatus.toLowerCase()}
              </span>
            )}
            {bus.delayed && (
              <span className="inline-flex items-center rounded-md border border-orange-200 bg-orange-100 px-1.5 py-0.5 text-[11px] font-bold text-orange-800 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300">
                EN RETARD
              </span>
            )}
            {bus.offRoute && bus.state !== "OFF_ROUTE" && (
              <span className="inline-flex items-center rounded-md border border-red-200 bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
                SORTIE D&apos;ITINÉRAIRE
              </span>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

function driverLabel(bus: FleetBusDTO): string {
  const name = `${bus.driverFirstName ?? ""} ${bus.driverLastName ?? ""}`.trim();
  return name || "non affecté";
}
