"use client";

// ============================================================
// NZOKO — Espace contrôleur (CHECKER) · V3
// Scan QR caméra (jsQR) + saisie manuelle (token / référence /
// numéro d'embarquement NZK-XXXXXX) + panneau résultat pro +
// historique de session + mode hors-ligne dégradé (voyages du
// jour en cache local 12 h, validation BLOQUÉE hors-ligne).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  Bus,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  Loader2,
  MapPin,
  QrCode,
  RefreshCw,
  Repeat,
  ScanLine,
  ShieldCheck,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrScanner } from "@/features/checker/qr-scanner";
import { TripsBoard } from "@/features/checker/trips-board";
import { api, ApiClientError } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { formatDateTime, formatTime } from "@/lib/format";
import type { BoardingTripDTO, ScanResultCode, ScanResultDTO } from "@/types";
import { cn } from "@/lib/utils";

// ---------- Cache hors-ligne des voyages du jour (localStorage, TTL 12 h) ----------

const TRIPS_CACHE_KEY = "nzoko-checker-trips-v3";
const TRIPS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORY_MAX = 20;

interface TripsCacheEntry {
  savedAt: number;
  agencyName: string | null;
  trips: BoardingTripDTO[];
}

function readTripsCache(agencyName: string | null): TripsCacheEntry | null {
  try {
    const raw = window.localStorage.getItem(TRIPS_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const entry = parsed as TripsCacheEntry;
    if (typeof entry.savedAt !== "number" || !Array.isArray(entry.trips)) return null;
    if (Date.now() - entry.savedAt > TRIPS_CACHE_TTL_MS) return null;
    if (entry.agencyName && agencyName && entry.agencyName !== agencyName) return null; // cache d'une autre agence
    return entry;
  } catch {
    return null; // JSON corrompu ou stockage indisponible
  }
}

function writeTripsCache(trips: BoardingTripDTO[], agencyName: string | null): void {
  try {
    const entry: TripsCacheEntry = { savedAt: Date.now(), agencyName, trips };
    window.localStorage.setItem(TRIPS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Quota dépassé / navigation privée : le cache reste best-effort.
  }
}

// ---------- Métadonnées d'affichage des résultats de scan ----------

interface ResultMeta {
  title: string;
  hint: string;
  icon: LucideIcon;
}

const RESULT_META: Record<ScanResultCode, ResultMeta> = {
  VALID: { title: "EMBARQUEMENT VALIDÉ", hint: "Le passager peut monter à bord.", icon: CheckCircle2 },
  ALREADY_USED: { title: "BILLET DÉJÀ UTILISÉ", hint: "Ce billet a déjà été scanné auparavant.", icon: Repeat },
  INVALID: { title: "BILLET INVALIDE", hint: "Ce code ne correspond à aucun billet émis.", icon: XCircle },
  PAYMENT_NOT_CONFIRMED: { title: "PAIEMENT NON CONFIRMÉ", hint: "Le règlement doit être fait avant l'embarquement.", icon: CreditCard },
  TRIP_CANCELLED: { title: "VOYAGE ANNULÉ", hint: "Orientez le passager vers le guichet.", icon: Ban },
  WRONG_AGENCY: { title: "MAUVAISE AGENCE", hint: "Billet valable au départ d'une autre agence.", icon: MapPin },
};

const RESULT_BG: Record<ScanResultCode, string> = {
  VALID: "bg-emerald-600 text-white",
  ALREADY_USED: "bg-red-600 text-white",
  INVALID: "bg-zinc-800 text-white",
  PAYMENT_NOT_CONFIRMED: "bg-amber-500 text-amber-950",
  TRIP_CANCELLED: "bg-red-700 text-white",
  WRONG_AGENCY: "bg-red-700 text-white",
};

interface HistoryEntry {
  id: string;
  code: string;
  label: string; // numéro d'embarquement si connu, sinon code scanné
  result: ScanResultCode;
  at: string;
}

const HISTORY_STYLES: Record<ScanResultCode, string> = {
  VALID: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300",
  ALREADY_USED: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300",
  INVALID: "bg-zinc-200 text-zinc-700 border-zinc-300 dark:bg-zinc-900 dark:text-zinc-400",
  PAYMENT_NOT_CONFIRMED: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300",
  TRIP_CANCELLED: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300",
  WRONG_AGENCY: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300",
};

const HISTORY_LABELS: Record<ScanResultCode, string> = {
  VALID: "Valide",
  ALREADY_USED: "Déjà utilisé",
  INVALID: "Invalide",
  PAYMENT_NOT_CONFIRMED: "Non payé",
  TRIP_CANCELLED: "Voyage annulé",
  WRONG_AGENCY: "Autre agence",
};

// Animations locales (vibration visuelle succès / refus)
const CHECKER_CSS = `
@keyframes nzoko-result-glow {
  0% { box-shadow: 0 0 0 0 rgb(5 150 105 / 0.6); }
  100% { box-shadow: 0 0 0 28px rgb(5 150 105 / 0); }
}
.nzoko-result-glow { animation: nzoko-result-glow 0.9s ease-out 2; }
@keyframes nzoko-result-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-7px); }
  40% { transform: translateX(7px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
.nzoko-result-shake { animation: nzoko-result-shake 0.5s ease-in-out 1; }
`;

// ---------- Panneau résultat (plein cadre, contraste élevé usage extérieur) ----------

interface ResultPanelProps {
  result: ScanResultDTO;
  onScanNext: () => void;
}

function ResultPanel({ result, onScanNext }: ResultPanelProps) {
  const meta = RESULT_META[result.result] ?? RESULT_META.INVALID;
  const t = result.ticket;

  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        "nzoko-fade-up overflow-hidden rounded-2xl shadow-lg",
        RESULT_BG[result.result] ?? RESULT_BG.INVALID,
        result.result === "VALID" && "nzoko-result-glow",
        result.result === "ALREADY_USED" && "nzoko-result-shake"
      )}
    >
      {/* Bandeau statut */}
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
          <meta.icon
            className={cn("size-8", result.result === "VALID" && "animate-pulse")}
            strokeWidth={1.75}
            aria-hidden
          />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight tracking-wide sm:text-xl">{meta.title}</p>
          <p className="mt-0.5 text-sm opacity-90">{result.message}</p>
        </div>
      </div>

      {/* Messages contextuels */}
      {result.result === "ALREADY_USED" && t?.checkedAt && (
        <p className="border-t border-white/20 bg-black/20 px-4 py-2.5 text-center text-sm font-semibold sm:px-5">
          Billet DÉJÀ UTILISÉ le {formatDateTime(t.checkedAt)} par {t.checkedByName ?? "un contrôleur"}
        </p>
      )}
      {result.result === "PAYMENT_NOT_CONFIRMED" && (
        <p className="border-t border-black/10 bg-black/10 px-4 py-2.5 text-center text-sm font-semibold sm:px-5">
          Faites régler la réservation au guichet avant d&apos;embarquer le passager.
        </p>
      )}
      {result.result === "WRONG_AGENCY" && t && (
        <p className="border-t border-white/20 bg-black/20 px-4 py-2.5 text-center text-sm font-semibold sm:px-5">
          Billet valable au départ de&nbsp;: {t.agencyName}
          {t.agencyAddress ? ` — ${t.agencyAddress}` : ""}
        </p>
      )}

      {/* Détails du billet */}
      {t && (
        <div className="space-y-4 border-t border-white/20 bg-black/10 p-4 sm:p-5">
          {t.boardingNumber && (
            <div className="rounded-xl bg-emerald-500 px-4 py-3 text-center shadow-md">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-950/80">
                Numéro d&apos;embarquement
              </p>
              <p className="font-mono text-2xl font-bold tracking-[0.15em] text-white sm:text-3xl">
                {t.boardingNumber}
              </p>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
                <User className="size-3" aria-hidden /> Passager
              </dt>
              <dd className="truncate font-semibold" title={t.passengerName}>
                {t.passengerName}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider opacity-80">Trajet</dt>
              <dd className="truncate font-semibold">
                {t.originCityName} → {t.destinationCityName}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
                <Clock className="size-3" aria-hidden /> Départ
              </dt>
              <dd className="font-semibold">{formatDateTime(t.departureTime)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
                <Bus className="size-3" aria-hidden /> Bus
              </dt>
              <dd className="truncate font-semibold">{t.busRegistration}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider opacity-80">Siège</dt>
              <dd className="font-semibold">
                {t.seatNumber}
                {t.seatType === "VIP" ? " · VIP" : ""}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
                <MapPin className="size-3" aria-hidden /> Agence
              </dt>
              <dd className="truncate font-semibold" title={t.agencyAddress ?? t.agencyName}>
                {t.agencyName}
              </dd>
              {t.agencyAddress && (
                <dd className="truncate text-xs font-normal opacity-80" title={t.agencyAddress}>
                  {t.agencyAddress}
                </dd>
              )}
            </div>
          </dl>

          <p className="border-t border-white/15 pt-2.5 font-mono text-[11px] opacity-80">
            {t.reference} · voyage {t.tripCode}
          </p>
        </div>
      )}

      <div className="border-t border-white/20 p-4">
        <Button
          onClick={onScanNext}
          variant="secondary"
          size="lg"
          className="h-12 w-full bg-white text-foreground hover:bg-white/90"
        >
          Scanner suivant
        </Button>
      </div>
    </div>
  );
}

// ---------- Vue principale ----------

export default function CheckerView() {
  const session = useApp((s) => s.session);
  const sessionReady = useApp((s) => s.sessionReady);
  const agencyName = session?.agencyName ?? null;

  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResultDTO | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [trips, setTrips] = useState<BoardingTripDTO[] | null>(null);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripsFromCacheAt, setTripsFromCacheAt] = useState<number | null>(null);

  const [online, setOnline] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultAnchorRef = useRef<HTMLDivElement>(null);

  // ---------- Voyages du jour : réseau si possible, cache local si hors-ligne ----------

  const loadTrips = useCallback(async (): Promise<void> => {
    setTripsLoading(true);
    try {
      if (!navigator.onLine) {
        const entry = readTripsCache(agencyName);
        if (entry) {
          setTrips(entry.trips);
          setTripsFromCacheAt(entry.savedAt);
        } else {
          setTrips((prev) => prev ?? []);
        }
        return;
      }
      const data = await api.checker.trips();
      setTrips(data);
      setTripsFromCacheAt(null);
      writeTripsCache(data, agencyName); // fraîchissement du cache hors-ligne
    } catch {
      // Réseau indisponible : repli sur le cache local s'il est encore frais
      const entry = readTripsCache(agencyName);
      if (entry) {
        setTrips(entry.trips);
        setTripsFromCacheAt(entry.savedAt);
      } else {
        setTrips((prev) => prev ?? []);
      }
    } finally {
      setTripsLoading(false);
    }
  }, [agencyName]);

  useEffect(() => {
    if (sessionReady) void loadTrips();
  }, [sessionReady, loadTrips]);

  // ---------- Mode hors-ligne : détection + bandeau + retour automatique ----------

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => {
      setOnline(true);
      toast.success("Connexion rétablie — vous pouvez de nouveau valider les embarquements.");
      void loadTrips();
    };
    const handleOffline = () => {
      setOnline(false);
      toast.warning("Mode hors-ligne — la validation d'embarquement est bloquée.");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadTrips]);

  const reloadCache = useCallback(() => {
    const entry = readTripsCache(agencyName);
    if (entry) {
      setTrips(entry.trips);
      setTripsFromCacheAt(entry.savedAt);
      toast.success(`Cache rechargé — voyages enregistrés à ${formatTime(new Date(entry.savedAt))}.`);
    } else {
      toast.error("Aucun cache valide (expiré après 12 h ou indisponible). La connexion est nécessaire.");
    }
  }, [agencyName]);

  // ---------- Validation d'un billet (BLOQUÉE hors-ligne, jamais sur donnée locale) ----------

  const handleScan = useCallback(
    async (raw: string) => {
      const clean = raw.trim();
      if (!clean) return;
      if (!online) {
        toast.error(
          "Mode hors-ligne : la validation d'embarquement est bloquée jusqu'au retour de la connexion."
        );
        return;
      }
      setScanning(true);
      setResult(null);
      try {
        const res = await api.checker.scan(clean);
        setResult(res);
        setHistory((prev) =>
          [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              code: clean,
              label: res.ticket?.boardingNumber ?? clean,
              result: res.result,
              at: new Date().toISOString(),
            },
            ...prev,
          ].slice(0, HISTORY_MAX)
        );
        if (res.result === "VALID") {
          toast.success(`Embarquement validé — ${res.ticket?.passengerName ?? "passager"} à bord.`);
        } else if (res.result === "ALREADY_USED") {
          toast.error("Billet déjà utilisé — embarquement refusé.");
        }
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 429) {
          toast.error("Trop de scans — patientez un instant avant de réessayer.");
        } else {
          toast.error(err instanceof ApiClientError ? err.message : "Une erreur est survenue.");
        }
      } finally {
        setScanning(false);
      }
    },
    [online]
  );

  const handleQrCode = useCallback(
    (qrValue: string) => {
      setScannerOpen(false);
      void handleScan(qrValue);
    },
    [handleScan]
  );

  // Le résultat apparaît : on l'amène doucement à l'écran (usage debout, extérieur)
  useEffect(() => {
    if (result) resultAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [result]);

  const scanNext = useCallback(() => {
    setCode("");
    setResult(null);
    inputRef.current?.focus();
  }, []);

  // ---------- Rendu ----------

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6" aria-label="Contrôle embarquement">
      <style>{CHECKER_CSS}</style>

      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
          <ShieldCheck className="size-5 text-primary" aria-hidden /> Contrôle embarquement
        </h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {session?.agencyName && (
            <span className="flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden /> {session.agencyName}
            </span>
          )}
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
              online
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
            )}
          >
            {online ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
            {online ? "En ligne" : "Hors-ligne"}
            <span className="sr-only"> — connexion internet {online ? "active" : "perdue"}</span>
          </span>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {session ? `${session.fullName} — ${session.roleLabel}` : "Contrôleur NZOKO"}
      </p>

      {/* Bandeau hors-ligne (mode dégradé : lecture seule) */}
      {!online && (
        <div
          role="alert"
          className="mt-4 flex flex-col gap-3 rounded-2xl border-2 border-amber-400 bg-amber-100 p-4 text-amber-950 sm:flex-row sm:items-center dark:border-amber-600 dark:bg-amber-950/70 dark:text-amber-200"
        >
          <WifiOff className="size-6 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-wide">Mode hors-ligne</p>
            <p className="mt-0.5 text-sm leading-relaxed">
              Les voyages du jour sont affichés depuis le cache — la validation d&apos;embarquement est
              <strong> bloquée</strong> jusqu&apos;au retour de la connexion.
            </p>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={reloadCache}
            className="h-11 shrink-0 gap-2 border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-200 dark:border-amber-500 dark:bg-amber-900/50 dark:text-amber-200 dark:hover:bg-amber-900"
          >
            <RefreshCw className="size-4" aria-hidden /> Recharger le cache
          </Button>
        </div>
      )}

      {/* ---------- Zone de scan ---------- */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="size-5 text-primary" aria-hidden /> Vérifier un billet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            size="lg"
            onClick={() => setScannerOpen(true)}
            disabled={!online}
            title={online ? undefined : "Indisponible en mode hors-ligne"}
            className="h-14 w-full gap-2.5 text-base font-bold"
          >
            <span aria-hidden>📷</span> Scanner le QR
          </Button>

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              ou saisie manuelle
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleScan(code);
            }}
          >
            <Label htmlFor="scan-input" className="mb-1.5 block text-sm font-medium">
              Code du billet
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" aria-hidden />
                <Input
                  id="scan-input"
                  ref={inputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Token, référence (NZK-2026-…) ou numéro d'embarquement (NZK-XXXXXX)"
                  className="h-12 pl-9 font-mono text-base tracking-wide"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  aria-describedby="scan-help"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={scanning || !online || !code.trim()}
                className="h-12 sm:w-36"
              >
                {scanning ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <QrCode className="size-4" aria-hidden />}
                {scanning ? "Vérif…" : "Vérifier"}
              </Button>
            </div>
            <p id="scan-help" className="mt-2 text-[11px] text-muted-foreground">
              Le numéro d&apos;embarquement est imprimé en gros sur le billet — Entrée pour valider.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* ---------- Résultat ---------- */}
      <div ref={resultAnchorRef} className="mt-4">
        {scanning && (
          <Card>
            <CardContent className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" aria-hidden /> Vérification du billet…
            </CardContent>
          </Card>
        )}
        {!scanning && result && <ResultPanel result={result} onScanNext={scanNext} />}
      </div>

      {/* ---------- Historique de session ---------- */}
      {history.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-muted-foreground" aria-hidden /> Derniers scans de la session
              <span className="ml-auto text-xs font-normal text-muted-foreground">{history.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="nzoko-scroll max-h-64 divide-y overflow-y-auto">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={h.code}>
                    {h.label}
                  </span>
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
        {tripsFromCacheAt !== null && (
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Voyages du jour issus du cache local — enregistrés à {formatTime(new Date(tripsFromCacheAt))}.
          </p>
        )}
        <TripsBoard trips={trips} loading={tripsLoading} onRefresh={() => void loadTrips()} />
      </div>

      {/* ---------- Scanner caméra ---------- */}
      {scannerOpen && <QrScanner onCode={handleQrCode} onClose={() => setScannerOpen(false)} />}
    </section>
  );
}
