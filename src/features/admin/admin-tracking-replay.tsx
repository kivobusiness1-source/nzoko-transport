"use client";

// ============================================================
// NZOKO TRANSPORT — Suivi GPS V4 : panneau de replay du trail
// (exigence 32). Lecture pas-à-pas du trail GPS d'un bus : le
// minuteur vit dans le parent (admin-tracking.tsx), ce panneau
// est purement présentationnel + contrôles.
// ============================================================

import { History, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { BatteryMedium, Gauge } from "lucide-react";
import { formatTime } from "@/lib/format";
import type { GpsPointDTO } from "@/types";

export type ReplaySpeed = 1 | 2 | 5;

interface AdminTrackingReplayProps {
  /** Trail complet de la session (déjà chargé par le parent). */
  points: GpsPointDTO[];
  /** Index du point courant (0-based). */
  index: number;
  playing: boolean;
  speed: ReplaySpeed;
  label: string;
  onTogglePlay: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onStop: () => void;
}

export function AdminTrackingReplay({
  points,
  index,
  playing,
  speed,
  label,
  onTogglePlay,
  onSeek,
  onSpeedChange,
  onStop,
}: AdminTrackingReplayProps) {
  const safeIndex = Math.min(Math.max(index, 0), Math.max(points.length - 1, 0));
  const current = points[safeIndex] ?? null;
  const speeds: ReplaySpeed[] = [1, 2, 5];

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 shadow-sm" role="region" aria-label="Replay du trajet GPS">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" aria-hidden="true" />
          Replay du trajet — {label}
        </p>
        <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
          Point {points.length > 0 ? safeIndex + 1 : 0} / {points.length}
        </span>
      </div>

      {/* Position : slider de progression (point i/N) */}
      <div className="mt-3 flex min-h-[40px] items-center">
        <Slider
          value={[safeIndex]}
          min={0}
          max={Math.max(points.length - 1, 0)}
          step={1}
          onValueChange={(values) => onSeek(values[0] ?? 0)}
          disabled={points.length < 2}
          aria-label="Position dans le trail GPS"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          size="sm"
          className="min-h-[40px]"
          onClick={onTogglePlay}
          disabled={points.length < 2}
          aria-label={playing ? "Mettre le replay en pause" : "Lire le replay"}
        >
          {playing ? (
            <Pause className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Play className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {playing ? "Pause" : "Lecture"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="min-h-[40px]"
          onClick={onStop}
          aria-label="Arrêter et fermer le replay"
        >
          <Square className="mr-2 h-4 w-4" aria-hidden="true" />
          Arrêter
        </Button>

        {/* Vitesse de lecture ×1 / ×2 / ×5 */}
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Vitesse de lecture du replay">
          {speeds.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onSpeedChange(value)}
              aria-pressed={speed === value}
              className={`min-h-[40px] px-3 text-sm font-medium transition-colors ${
                speed === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
              aria-label={`Vitesse de lecture ×${value}`}
            >
              ×{value}
            </button>
          ))}
        </div>

        {/* Infos du point courant */}
        {current && (
          <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatTime(current.recordedAt)}</span>
            {current.speed !== null && current.speed !== undefined && (
              <span className="flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
                {Math.round(current.speed)} km/h
              </span>
            )}
            {current.batteryLevel !== null && current.batteryLevel !== undefined && (
              <span className="flex items-center gap-1">
                <BatteryMedium className="h-3.5 w-3.5" aria-hidden="true" />
                {Math.round(current.batteryLevel)} %
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
