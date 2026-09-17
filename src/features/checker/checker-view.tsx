"use client";

// ============================================================
// NZOKO — Scanner d'embarquement (CHECKER)
// Saisie manuelle toujours disponible + caméra si BarcodeDetector.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, MapPin, QrCode, ScanLine, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanResultPanel } from "@/features/checker/scan-result";
import { TripsBoard } from "@/features/checker/trips-board";
import { api, ApiClientError } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { formatTime } from "@/lib/format";
import type { BoardingTripDTO, ScanResultDTO } from "@/types";
import { cn } from "@/lib/utils";

// ---------- Types BarcodeDetector (API expérimentale Chrome/Android) ----------
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

interface HistoryEntry {
  id: string;
  code: string;
  result: ScanResultCodeShort;
  at: string;
}

type ScanResultCodeShort = ScanResultDTO["result"];

const HISTORY_STYLES: Record<ScanResultCodeShort, string> = {
  VALID: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300",
  ALREADY_USED: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300",
  INVALID: "bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-900 dark:text-zinc-400",
  PAYMENT_NOT_CONFIRMED: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300",
  TRIP_CANCELLED: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300",
  WRONG_AGENCY: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300",
};

const HISTORY_LABELS: Record<ScanResultCodeShort, string> = {
  VALID: "Valide",
  ALREADY_USED: "Déjà utilisé",
  INVALID: "Invalide",
  PAYMENT_NOT_CONFIRMED: "Non payé",
  TRIP_CANCELLED: "Voyage annulé",
  WRONG_AGENCY: "Autre agence",
};

export default function CheckerView() {
  const session = useApp((s) => s.session);

  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResultDTO | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [trips, setTrips] = useState<BoardingTripDTO[] | null>(null);
  const [tripsLoading, setTripsLoading] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [supportsCamera, setSupportsCamera] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Détection du support caméra (après hydration pour éviter les mismatches)
  useEffect(() => {
    setSupportsCamera(getBarcodeDetectorCtor() !== null);
  }, []);

  const loadTrips = useCallback(async () => {
    setTripsLoading(true);
    try {
      setTrips(await api.checker.trips());
    } catch {
      // 404/403 tant que le backend n'est pas prêt — silencieux, listes vides
      setTrips([]);
    } finally {
      setTripsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const handleScan = useCallback(async (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    setScanning(true);
    setResult(null);
    try {
      const res = await api.checker.scan(clean);
      setResult(res);
      setHistory((prev) =>
        [
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, code: clean, result: res.result, at: new Date().toISOString() },
          ...prev,
        ].slice(0, 20)
      );
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        toast.error("Trop de scans — patientez un instant avant de réessayer.");
      } else {
        toast.error(err instanceof ApiClientError ? err.message : "Une erreur est survenue.");
      }
    } finally {
      setScanning(false);
    }
  }, []);

  // Boucle caméra : getUserMedia + détection continue
  useEffect(() => {
    if (!cameraOpen) return;
    let stopped = false;
    const Ctor = getBarcodeDetectorCtor();

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
        const loop = async () => {
          if (stopped || !videoRef.current) return;
          if (detector) {
            try {
              const codes = await detector.detect(videoRef.current);
              const value = codes[0]?.rawValue;
              if (value) {
                setCameraOpen(false);
                void handleScan(value);
                return;
              }
            } catch {
              // frame illisible — on continue
            }
          }
          requestAnimationFrame(() => void loop());
        };
        void loop();
      } catch {
        setCameraError("Caméra refusée ou indisponible. Utilisez la saisie manuelle ci-dessous.");
      }
    })();

    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [cameraOpen, handleScan]);

  const scanNext = () => {
    setCode("");
    setResult(null);
    inputRef.current?.focus();
  };

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6" aria-label="Contrôle embarquement">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
          <ShieldCheck className="size-5 text-primary" aria-hidden /> Contrôle embarquement
        </h1>
        {session?.agencyName && (
          <span className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden /> {session.agencyName}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {session ? `${session.fullName} — ${session.roleLabel}` : "Contrôleur NZOKO"}
      </p>

      {/* ---------- Zone de scan ---------- */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="size-5 text-primary" aria-hidden /> Vérifier un billet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleScan(code);
            }}
          >
            <Label htmlFor="scan-input" className="mb-1.5 block text-sm font-medium">
              Code du billet (scan ou saisie manuelle)
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" aria-hidden />
                <Input
                  id="scan-input"
                  ref={inputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Scanner ou saisir le code / token"
                  className="h-12 pl-9 font-mono text-base tracking-wide"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <Button type="submit" size="lg" disabled={scanning || !code.trim()} className="h-12 sm:w-36">
                {scanning ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <QrCode className="size-4" aria-hidden />}
                {scanning ? "Vérif…" : "Vérifier"}
              </Button>
            </div>
          </form>

          {supportsCamera && (
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setCameraError(null);
                setCameraOpen(true);
              }}
              className="h-12 w-full gap-2"
            >
              <Camera className="size-4" aria-hidden /> Scanner avec la caméra
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            Saisie manuelle toujours disponible — Entrée pour valider.
          </p>
        </CardContent>
      </Card>

      {/* ---------- Résultat ---------- */}
      <div className="mt-4">
        {scanning && (
          <Card>
            <CardContent className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden /> Vérification du billet…
            </CardContent>
          </Card>
        )}
        {!scanning && result && <ScanResultPanel result={result} onScanNext={scanNext} />}
      </div>

      {/* ---------- Historique de session ---------- */}
      {history.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-muted-foreground" aria-hidden /> Derniers scans de la session
              <span className="ml-auto text-xs font-normal text-muted-foreground">{history.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="nzoko-scroll max-h-64 divide-y overflow-y-auto">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{h.code}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      HISTORY_STYLES[h.result]
                    )}
                  >
                    {HISTORY_LABELS[h.result]}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{formatTime(h.at)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ---------- Voyages du jour ---------- */}
      <div className="mt-4">
        <TripsBoard trips={trips} loading={tripsLoading} onRefresh={loadTrips} />
      </div>

      {/* ---------- Dialog caméra ---------- */}
      <Dialog
        open={cameraOpen}
        onOpenChange={(open) => {
          if (!open) setCameraOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="size-5 text-primary" aria-hidden /> Scan caméra
            </DialogTitle>
            <DialogDescription>Présentez le QR code du billet devant la caméra.</DialogDescription>
          </DialogHeader>
          {cameraError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {cameraError}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-zinc-900">
              <video ref={videoRef} className="aspect-video w-full object-cover" playsInline muted aria-label="Flux caméra de scan" />
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-300">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Détection du QR code en cours…
              </div>
            </div>
          )}
          <Button variant="outline" onClick={() => setCameraOpen(false)} className="w-full">
            Fermer la caméra
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
