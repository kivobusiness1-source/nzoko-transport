"use client";

// ============================================================
// NZOKO — Affichage QR (PNG data URL servi par /api/tickets/[token]/qr)
// ============================================================

import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface NzokoQrProps {
  token: string;
  size?: number;
  className?: string;
  /** Texte alternatif de l'image QR */
  alt?: string;
}

export function NzokoQr({ token, size = 150, className, alt = "QR code du billet" }: NzokoQrProps) {
  // État indexé par token : évite les setState synchrones lors d'un changement de token.
  const [state, setState] = useState<{ token: string; dataUrl: string | null; failed: boolean }>({
    token,
    dataUrl: null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    api.tickets
      .qr(token)
      .then((res) => {
        if (!cancelled) setState({ token, dataUrl: res.dataUrl, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ token, dataUrl: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const dataUrl = state.token === token ? state.dataUrl : null;
  const failed = state.token === token && state.failed;

  if (failed) {
    return (
      <div
        className={cn("flex flex-col items-center justify-center gap-1.5 rounded-lg bg-white p-3 text-center", className)}
        style={{ width: size, height: size }}
      >
        <QrCode className="h-8 w-8 text-muted-foreground" />
        <p className="text-[10px] leading-tight text-muted-foreground">QR indisponible</p>
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className={cn("animate-pulse rounded-lg bg-zinc-200", className)}
        style={{ width: size, height: size }}
        aria-label="Chargement du QR code"
        role="img"
      />
    );
  }

  // Fond blanc obligatoire pour un scan fiable.
  return (
    <div className={cn("rounded-lg bg-white p-2 shadow-sm", className)} style={{ width: size + 16, height: size + 16 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL QR générée côté client : next/image n’apporte aucune optimisation */}
      <img src={dataUrl} alt={alt} width={size} height={size} className="block h-auto w-full" />
    </div>
  );
}
