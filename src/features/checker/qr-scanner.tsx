"use client";

// ============================================================
// Océan du Nord — Scanner QR caméra (composant réutilisable)
// getUserMedia (caméra arrière) + boucle requestAnimationFrame
// + décodage jsQR sur canvas. Nettoyage intégral des flux au
// démontage, arrêt automatique après un scan réussi, anti-
// doublon 1,5 s. S'installe dans un Dialog plein cadre.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, CheckCircle2, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface QrScannerProps {
  /** Appelé UNE fois quand un QR code est décodé — le scanner s'arrête ensuite. */
  onCode: (code: string) => void;
  /** Appelé à la fermeture (bouton, croix ou Échap). */
  onClose: () => void;
}

const SCAN_EVERY_MS = 140; // cadence max de décodage jsQR (performances mobiles)
const ANTI_DUPLICATE_MS = 1500; // garde anti double déclenchement
const MAX_DIMENSION = 640; // réduction de l'image avant décodage

const QR_SCANNER_CSS = `
@keyframes nzoko-qr-scanline {
  0%, 100% { top: 8%; }
  50% { top: 88%; }
}
.nzoko-qr-scanline { animation: nzoko-qr-scanline 2.2s ease-in-out infinite; }
`;

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Accès caméra refusé. Autorisez la caméra pour ce site (cadenas dans la barre d'adresse), puis réessayez.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "Aucune caméra détectée sur cet appareil. Utilisez la saisie manuelle du code billet.";
      case "NotReadableError":
        return "La caméra est déjà utilisée par une autre application. Fermez-la, puis réessayez.";
      default:
        return "Impossible d'activer la caméra. Utilisez la saisie manuelle du code billet.";
    }
  }
  return "Impossible d'activer la caméra. Utilisez la saisie manuelle du code billet.";
}

export function QrScanner({ onCode, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false); // flux caméra démarré
  const [detected, setDetected] = useState(false); // QR décodé avec succès

  // Dernière version du callback, sans relancer la caméra à chaque rendu.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const retry = useCallback(() => {
    setError(null);
    setDetected(false);
    setActive(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let lastScanAt = 0;
    let deliveredAt = 0;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      // Différé hors du corps synchrone de l'effet (évite les rendus en cascade)
      const t = setTimeout(() => setError("Impossible d'initialiser le lecteur de QR code sur cet appareil."), 0);
      return () => clearTimeout(t);
    }

    const stopAll = () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const loop = (timestamp: number): void => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || timestamp - lastScanAt < SCAN_EVERY_MS) {
        rafId = requestAnimationFrame(loop);
        return;
      }
      lastScanAt = timestamp;

      const sourceW = video.videoWidth;
      const sourceH = video.videoHeight;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceW, sourceH));
      const w = Math.max(1, Math.round(sourceW * scale));
      const h = Math.max(1, Math.round(sourceH * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const qr = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      const value = qr?.data;

      if (value && Date.now() - deliveredAt >= ANTI_DUPLICATE_MS) {
        // Scan réussi : livraison unique puis arrêt complet du scanner.
        deliveredAt = Date.now();
        setDetected(true);
        stopAll();
        onCodeRef.current(value);
        return;
      }
      rafId = requestAnimationFrame(loop);
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Caméra non disponible sur cet appareil (connexion sécurisée requise). Utilisez la saisie manuelle.");
        return;
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (!video) {
          stopAll();
          return;
        }
        video.srcObject = media;
        await video.play().catch(() => undefined);
        if (cancelled) {
          stopAll();
          return;
        }
        setActive(true);
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        setError(cameraErrorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [attempt]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="size-5 text-primary" aria-hidden /> Scanner le QR code
          </DialogTitle>
          <DialogDescription>
            Présentez le QR code du billet dans le cadre — la détection est automatique.
          </DialogDescription>
        </DialogHeader>

        <style>{QR_SCANNER_CSS}</style>

        {error ? (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40"
          >
            <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={retry} className="h-11 flex-1 gap-2">
                <RotateCw className="size-4" aria-hidden /> Réessayer
              </Button>
              <Button variant="outline" onClick={onClose} className="h-11 flex-1">
                Utiliser la saisie manuelle
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl border bg-zinc-950">
              <video
                ref={videoRef}
                className="aspect-square w-full object-cover"
                playsInline
                muted
                autoPlay
                aria-label="Flux caméra servant à lire le QR code du billet"
              />

              {/* Viseur animé (coins + ligne de balayage) */}
              {!detected && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                  <div className="relative h-[64%] w-[64%] max-w-[280px] rounded-2xl">
                    <span className="absolute left-0 top-0 size-9 rounded-tl-xl border-l-4 border-t-4 border-emerald-400" />
                    <span className="absolute right-0 top-0 size-9 rounded-tr-xl border-r-4 border-t-4 border-emerald-400" />
                    <span className="absolute bottom-0 left-0 size-9 rounded-bl-xl border-b-4 border-l-4 border-emerald-400" />
                    <span className="absolute bottom-0 right-0 size-9 rounded-br-xl border-b-4 border-r-4 border-emerald-400" />
                    <span className="nzoko-qr-scanline absolute left-2 right-2 h-0.5 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.95)]" />
                  </div>
                </div>
              )}

              {/* Confirmation visuelle après détection */}
              {detected && (
                <div
                  role="status"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/95 text-white"
                >
                  <CheckCircle2 className="size-14" strokeWidth={1.5} aria-hidden />
                  <p className="text-sm font-bold uppercase tracking-widest">QR code détecté</p>
                </div>
              )}

              {!active && !detected && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-zinc-300">
                  <p className="flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Activation de la caméra…
                  </p>
                </div>
              )}
            </div>

            <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              {detected
                ? "Vérification du billet en cours…"
                : "Maintenez le billet bien à plat, QR face à la caméra."}
            </p>

            <Button variant="outline" size="lg" onClick={onClose} className="h-12 w-full gap-2">
              <X className="size-4" aria-hidden /> Fermer la caméra
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
