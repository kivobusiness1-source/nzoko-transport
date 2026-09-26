"use client";

// ============================================================
// Océan du Nord — Étape 6 : billet électronique (QR, référence, impression)
// ============================================================

import { motion } from "framer-motion";
import { toast } from "sonner";
import { Bus, Calendar, Clock, FileDown, MapPin, Printer, QrCode, TicketCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NzokoCopyButton } from "@/components/shared/nzoko-copy-button";
import { NzokoQr } from "@/components/shared/nzoko-qr";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import type { BookingDetailDTO } from "@/types";

/** Clé sessionStorage pour pré-remplir la vue suivi avec une référence */
export const TRACK_REF_KEY = "nzoko-track-ref";

interface TicketCardProps {
  detail: BookingDetailDTO;
  channel: "WEB" | "AGENT";
  onNewBooking: () => void;
}

export function TicketCard({ detail, channel, onNewBooking }: TicketCardProps) {
  const setView = useApp((s) => s.setView);
  const ticket = detail.ticket;

  const handlePrint = async () => {
    if (!ticket) return;
    let qrDataUrl = "";
    try {
      qrDataUrl = (await api.tickets.qr(ticket.token)).dataUrl;
    } catch {
      // impression sans QR si indisponible
    }
    const w = window.open("", "_blank", "width=440,height=700");
    if (!w) {
      toast.error("Autorisez les fenêtres surgissantes pour imprimer le billet.");
      return;
    }
    w.document.write(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Billet ${detail.bookingReference} — Océan du Nord</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a2e1a;background:#fff;padding:16px}
  .ticket{max-width:400px;margin:0 auto;border:2px solid #14532d;border-radius:12px;overflow:hidden}
  .head{background:#14532d;color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}
  .head .brand{font-weight:bold;font-size:16px}
  .head .sub{font-size:9px;letter-spacing:2px;text-transform:uppercase;opacity:.8}
  .body{padding:16px}
  .route{font-size:20px;font-weight:bold;text-align:center;margin:6px 0 2px}
  .route span{color:#c2703d}
  .row{display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px dashed #d9e5d9}
  .row b{font-size:13px}
  .seat{font-size:30px;font-weight:bold;color:#14532d;text-align:center;padding:10px}
  .qr{text-align:center;padding:10px;background:#f4f8f4;margin:10px;border-radius:8px}
  .qr img{width:150px;height:150px}
  .ref{font-family:monospace;font-size:14px;text-align:center;font-weight:bold;margin:8px 0}
  .boarding{font-family:monospace;font-size:13px;text-align:center;font-weight:bold;color:#14532d;margin:0 0 8px}
  .foot{font-size:10px;text-align:center;color:#4b6b4b;padding:10px}
</style></head><body>
  <div class="ticket">
    <div class="head"><div><div class="brand">OCÉAN DU NORD</div><div class="sub">Billet électronique</div></div></div>
    <div class="body">
      <div class="route">${detail.trip.originCityName} <span>→</span> ${detail.trip.destinationCityName}</div>
      <div class="row"><span>Départ</span><b>${formatDate(detail.trip.departureTime)} · ${formatTime(detail.trip.departureTime)}</b></div>
      <div class="row"><span>Arrivée estimée</span><b>${formatTime(detail.trip.estimatedArrivalTime)}</b></div>
      <div class="row"><span>Bus</span><b>${detail.trip.busRegistration} · ${detail.trip.agencyName}</b></div>
      <div class="row"><span>Passager</span><b>${detail.passenger.firstName} ${detail.passenger.lastName}</b></div>
      ${detail.dropOffNeighborhood ? `<div class="row"><span>Arrêt demandé</span><b>${detail.dropOffNeighborhood.name} (${detail.trip.destinationCityName})</b></div>` : ""}
      <div class="seat">${detail.seats.length > 1 ? "PLACES " : "SIÈGE "}${detail.seats.map((s) => s.seatNumber).join(" · ")}${detail.seat.type === "VIP" ? " · VIP" : ""}</div>
      ${qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}" alt="QR"></div>` : ""}
      <div class="ref">${detail.bookingReference}</div>
      ${ticket.boardingNumber ? `<div class="boarding">N° d'embarquement : ${ticket.boardingNumber}</div>` : ""}
      <div class="foot">Présentez ce QR code au contrôleur à l'embarquement.<br>Montant : ${formatMoney(detail.amount)} · ${detail.channel === "AGENT" ? "Vente guichet" : "Réservation en ligne"}</div>
    </div>
  </div>
</body></html>`);
    w.document.close();
    w.focus();
    // Impression déclenchée depuis la fenêtre parente : la fenêtre
    // about:blank HÉRITE de la CSP de l'ouvreur — un <script> inline y
    // serait bloqué par la CSP à nonces. Aucun script dans le billet.
    setTimeout(() => {
      try {
        w.print();
      } catch {
        // impression automatique refusée → Ctrl+P reste disponible
      }
    }, 250);
  };

  const handleTrack = () => {
    try {
      window.sessionStorage.setItem(TRACK_REF_KEY, detail.bookingReference);
    } catch {
      // suivi manuel si storage indisponible
    }
    setView("tracking");
  };

  // Billet officiel A4 (V3) : logo, QR, n° d'embarquement — généré serveur.
  const handleDownloadPdf = () => {
    if (!ticket) return;
    const win = window.open(api.tickets.pdfUrl(ticket.token), "_blank");
    if (!win) {
      toast.error("Autorisez les fenêtres surgissantes pour télécharger le billet PDF.");
    }
  };

  if (!ticket) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Le billet n&apos;est pas encore émis pour cette réservation.
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="space-y-4">
      <Card className="overflow-hidden border-primary/20 shadow-lg shadow-primary/10">
        {/* Bandeau Océan du Nord */}
        <div className="nzoko-hero flex items-center justify-between px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/15">
              <Bus className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-bold leading-tight">OCÉAN DU NORD</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/80">Billet électronique</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[11px] font-semibold">
            <TicketCheck className="size-3.5" aria-hidden />
            {ticket.status === "VALID" ? "Valide" : ticket.status === "USED" ? "Utilisé" : "Annulé"}
          </span>
        </div>

        <CardContent className="space-y-4 p-5">
          {/* Trajet */}
          <div className="text-center">
            <p className="text-xl font-bold tracking-tight sm:text-2xl">
              <span className="truncate">{detail.trip.originCityName}</span>
              <span className="mx-2 text-primary" aria-hidden>→</span>
              <span className="truncate">{detail.trip.destinationCityName}</span>
            </p>
            <p className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5" aria-hidden /> {formatDate(detail.trip.departureTime)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden /> {formatTime(detail.trip.departureTime)} → {formatTime(detail.trip.estimatedArrivalTime)}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {detail.trip.busRegistration}
              </span>
            </p>
            {/* Quartier d'arrêt choisi à la réservation (optionnel) */}
            {detail.dropOffNeighborhood && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <MapPin className="size-3.5" aria-hidden />
                Arrêt : {detail.dropOffNeighborhood.name}
              </p>
            )}
          </div>

          {/* Passager + siège */}
          <div className="flex items-center justify-between rounded-xl border border-dashed p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <User className="size-3.5" aria-hidden /> Passager
              </p>
              <p className="truncate text-base font-bold">
                {detail.passenger.firstName} {detail.passenger.lastName}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{detail.trip.agencyName} · {formatMoney(detail.amount)}</p>
            </div>
            <div className="shrink-0 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {detail.seats.length > 1 ? "Places" : "Siège"}
              </p>
              <p className={cn("font-bold text-primary", detail.seats.length > 1 ? "text-xl" : "text-3xl")}>
                {detail.seats.map((s) => s.seatNumber).join(", ")}
                {detail.seat.type === "VIP" && <span className="ml-1 align-middle text-[10px] font-bold uppercase text-orange-600">VIP</span>}
              </p>
            </div>
          </div>

          {/* Référence + n° d'embarquement + QR */}
          <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/40 p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold tracking-wider">{detail.bookingReference}</span>
              <NzokoCopyButton value={detail.bookingReference} size="icon" />
            </div>
            {ticket.boardingNumber && (
              <div className="flex w-full flex-col items-center gap-1 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  N° d&apos;embarquement
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-base font-bold tracking-[0.2em] text-primary">
                    {ticket.boardingNumber}
                  </span>
                  <NzokoCopyButton value={ticket.boardingNumber} size="icon" label="le numéro d'embarquement" />
                </span>
                <span className="text-center text-[11px] leading-snug text-muted-foreground">
                  À présenter au contrôleur si votre téléphone est déchargé.
                </span>
              </div>
            )}
            {ticket.status === "VALID" ? (
              <NzokoQr token={ticket.token} size={168} />
            ) : (
              <div className="flex h-[184px] w-[184px] items-center justify-center rounded-lg bg-white p-2 text-center text-xs text-muted-foreground">
                QR indisponible
              </div>
            )}
            <p className="flex items-center gap-1.5 text-center text-xs font-medium text-muted-foreground">
              <QrCode className="size-4 shrink-0 text-primary" aria-hidden />
              Présentez ce QR code au contrôleur à l&apos;embarquement.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button size="lg" onClick={handleDownloadPdf} className="h-12 sm:col-span-2">
          <FileDown className="h-4 w-4" aria-hidden /> Télécharger le billet PDF
        </Button>
        <Button size="lg" variant="outline" onClick={handlePrint} className="h-12">
          <Printer className="h-4 w-4" aria-hidden /> Imprimer le reçu
        </Button>
        {channel === "AGENT" ? (
          <Button size="lg" variant="outline" onClick={() => setView("workspace")} className="h-12">
            <Bus className="h-4 w-4" aria-hidden /> Retour au guichet
          </Button>
        ) : (
          <Button size="lg" variant="outline" onClick={handleTrack} className="h-12">
            <MapPin className="h-4 w-4" aria-hidden /> Suivre ce billet
          </Button>
        )}
        <Button size="lg" variant="secondary" onClick={onNewBooking} className="h-12 sm:col-span-2">
          Nouvelle réservation
        </Button>
      </div>
    </motion.div>
  );
}
