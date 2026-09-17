"use client";

// ============================================================
// NZOKO — Résultat d'un scan d'embarquement (plein cadre coloré)
// ============================================================

import { AlertTriangle, Ban, CheckCircle2, Clock, CreditCard, MapPin, Repeat, User, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatTime } from "@/lib/format";
import type { ScanResultCode, ScanResultDTO } from "@/types";
import { cn } from "@/lib/utils";

const RESULT_STYLES: Record<ScanResultCode, { bg: string; icon: typeof CheckCircle2; title: string }> = {
  VALID: { bg: "bg-emerald-600 text-white", icon: CheckCircle2, title: "EMBARQUEMENT VALIDÉ" },
  ALREADY_USED: { bg: "bg-red-600 text-white", icon: Repeat, title: "BILLET DÉJÀ UTILISÉ" },
  INVALID: { bg: "bg-zinc-800 text-white", icon: XCircle, title: "BILLET INVALIDE" },
  PAYMENT_NOT_CONFIRMED: { bg: "bg-amber-500 text-amber-950", icon: CreditCard, title: "PAIEMENT NON CONFIRMÉ" },
  TRIP_CANCELLED: { bg: "bg-red-700 text-white", icon: Ban, title: "VOYAGE ANNULÉ" },
  WRONG_AGENCY: { bg: "bg-red-700 text-white", icon: MapPin, title: "AUTRE AGENCE" },
};

interface ScanResultPanelProps {
  result: ScanResultDTO;
  onScanNext: () => void;
}

export function ScanResultPanel({ result, onScanNext }: ScanResultPanelProps) {
  const style = RESULT_STYLES[result.result] ?? RESULT_STYLES.INVALID;
  const t = result.ticket;
  const now = new Date();

  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn("nzoko-fade-up overflow-hidden rounded-2xl shadow-lg", style.bg)}
    >
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <style.icon className="size-16" strokeWidth={1.5} aria-hidden />
        <div>
          <p className="text-xl font-bold tracking-wide sm:text-2xl">{style.title}</p>
          <p className="mt-1 text-sm opacity-90">{result.message}</p>
        </div>

        {result.result === "VALID" && (
          <p className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
            <Clock className="size-3.5" aria-hidden /> {formatTime(now)}
          </p>
        )}
        {result.result === "ALREADY_USED" && t?.checkedAt && (
          <p className="flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-xs font-semibold">
            <Clock className="size-3.5" aria-hidden /> Premier scan : {formatDateTime(t.checkedAt)}
          </p>
        )}
        {result.result === "PAYMENT_NOT_CONFIRMED" && (
          <p className="flex items-center gap-1.5 rounded-full bg-black/15 px-3 py-1 text-xs font-semibold">
            <AlertTriangle className="size-3.5" aria-hidden /> Faites régler la réservation au guichet
          </p>
        )}
      </div>

      {t && (
        <div className="border-t border-white/20 bg-black/10 px-5 py-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
                <User className="size-3" aria-hidden /> Passager
              </p>
              <p className="truncate font-semibold">{t.passengerName}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-80">Siège</p>
              <p className="font-semibold">
                {t.seatNumber} {t.seatType === "VIP" ? "· VIP" : ""}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-80">Trajet</p>
              <p className="truncate font-semibold">
                {t.originCityName} → {t.destinationCityName}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-80">Départ</p>
              <p className="font-semibold">{formatTime(t.departureTime)}</p>
            </div>
          </div>
          <p className="mt-2 font-mono text-[11px] opacity-80">
            {t.reference} · {t.tripCode} · {t.busRegistration}
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
