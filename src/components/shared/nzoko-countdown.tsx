"use client";

// ============================================================
// NZOKO — Compte à rebours du verrou de réservation (10 min)
// Affiche mm:ss, avertit en dessous de 2 minutes, notifie l'expiration.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Timer } from "lucide-react";
import { minutesToCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";

interface NzokoCountdownProps {
  expiresAt: string;
  /** Déclenché UNE fois quand le délai est écoulé */
  onExpire?: () => void;
  className?: string;
  prefix?: string;
}

function remainingMs(expiresAt: string): number {
  return new Date(expiresAt).getTime() - Date.now();
}

export function NzokoCountdown({ expiresAt, onExpire, className, prefix }: NzokoCountdownProps) {
  const [label, setLabel] = useState(() => minutesToCountdown(expiresAt));
  const [critical, setCritical] = useState(() => remainingMs(expiresAt) < 2 * 60_000);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    const tick = () => {
      const ms = remainingMs(expiresAt);
      setLabel(minutesToCountdown(expiresAt));
      setCritical(ms < 2 * 60_000);
      if (ms <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);

  const expired = label === "expiré";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-sm font-semibold tabular-nums",
        expired
          ? "bg-red-100 text-red-700"
          : critical
            ? "bg-amber-100 text-amber-800"
            : "bg-primary/10 text-primary",
        className
      )}
      role="timer"
      aria-label={`${prefix ?? "Temps restant"} : ${expired ? "expiré" : label}`}
    >
      {expired ? (
        <AlertTriangle className="h-4 w-4" aria-hidden />
      ) : (
        <Timer className="h-4 w-4" aria-hidden />
      )}
      <span aria-hidden>
        {prefix ? `${prefix} ` : ""}
        {expired ? "Expiré" : label}
      </span>
    </span>
  );
}
