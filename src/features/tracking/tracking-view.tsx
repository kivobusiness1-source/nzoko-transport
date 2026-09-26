"use client";

// ============================================================
// Océan du Nord — Suivi de billet par référence (public)
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Banknote, FileDown, Loader2, Search, Ticket, XCircle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { NzokoBookingDetail } from "@/components/shared/nzoko-booking-detail";
import { NzokoCopyButton } from "@/components/shared/nzoko-copy-button";
import { TRACK_REF_KEY } from "@/features/booking/ticket-card";
import { api, ApiClientError } from "@/lib/api-client";
import type { BookingDetailDTO } from "@/types";

export default function TrackingView() {
  const [reference, setReference] = useState("");
  const [detail, setDetail] = useState<BookingDetailDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchedRef = useRef<string | null>(null);

  const search = useCallback(async (ref: string) => {
    const clean = ref.trim();
    if (!clean) {
      toast.error("Saisissez la référence de votre réservation (NZK-…).");
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setNotFound(false);
    setError(null);
    setDetail(null);
    searchedRef.current = clean;
    try {
      const result = await api.bookings.get(clean);
      setDetail(result);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiClientError ? err.message : "Une erreur est survenue.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Pré-remplissage depuis le billet (« Suivre ce billet »)
  useEffect(() => {
    let preset: string | null = null;
    try {
      preset = window.sessionStorage.getItem(TRACK_REF_KEY);
      window.sessionStorage.removeItem(TRACK_REF_KEY);
    } catch {
      preset = null;
    }
    if (preset) {
      setReference(preset);
      search(preset);
    } else {
      inputRef.current?.focus();
    }
  }, [search]);

  const doCancel = async () => {
    if (!detail) return;
    setCancelling(true);
    try {
      const updated = await api.bookings.cancel(detail.bookingReference);
      setDetail(updated);
      toast.success("Réservation annulée.");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Impossible d'annuler cette réservation.");
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
    }
  };

  const pending = detail?.status === "PENDING";
  // Billet actif (un billet annulé ne propose plus le PDF A4, cohérent avec le QR masqué).
  const ticket = detail?.ticket ?? null;
  const ticketToken = ticket && ticket.status !== "CANCELLED" ? ticket.token : null;

  // Billet officiel A4 (V3) : logo, QR, n° d'embarquement — généré serveur.
  const handleDownloadPdf = () => {
    if (!ticketToken) return;
    const win = window.open(api.tickets.pdfUrl(ticketToken), "_blank");
    if (!win) {
      toast.error("Autorisez les fenêtres surgissantes pour télécharger le billet PDF.");
    }
  };

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6" aria-label="Suivi de billet">
      <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
        <Ticket className="size-5 text-primary" aria-hidden /> Suivi de billet
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Consultez l&apos;état de votre réservation avec sa référence (reçue après la réservation).
      </p>

      {/* Formulaire de recherche */}
      <Card className="mt-4">
        <CardContent className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(reference);
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="track-ref" className="mb-1.5 block text-sm font-medium">
                Référence de réservation
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="track-ref"
                    ref={inputRef}
                    value={reference}
                    onChange={(e) => setReference(e.target.value.toUpperCase())}
                    placeholder="NZK-2026-XXXXXX"
                    className="h-11 pl-9 font-mono tracking-wider"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button type="submit" size="lg" disabled={loading} className="h-11 sm:w-36">
                  {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
                  {loading ? "Recherche…" : "Rechercher"}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Résultats */}
      <div className="mt-4 space-y-4">
        {loading && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </CardContent>
          </Card>
        )}

        {notFound && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <Search className="size-8 text-muted-foreground" aria-hidden />
              <p className="font-medium">Aucune réservation trouvée pour cette référence.</p>
              <p className="text-sm text-muted-foreground">
                Vérifiez la référence (NZK-2026-XXXXXX) figurant sur votre confirmation.
              </p>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card>
            <CardContent className="flex items-start gap-2 p-4 text-sm text-red-700 dark:text-red-300">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
            </CardContent>
          </Card>
        )}

        {detail && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <Card>
              <CardContent className="p-4 sm:p-6">
                <NzokoBookingDetail detail={detail} onCancel={() => setConfirmCancel(true)} cancelLoading={cancelling} />

                {/* N° d'embarquement + billet PDF (V3) */}
                {ticketToken && (
                  <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-primary/20 bg-muted/30 p-4">
                    {detail.ticket?.boardingNumber && (
                      <div className="flex w-full flex-col items-center gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                          N° d&apos;embarquement
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-lg font-bold tracking-[0.2em] text-primary">
                            {detail.ticket.boardingNumber}
                          </span>
                          <NzokoCopyButton value={detail.ticket.boardingNumber} size="icon" label="le numéro d'embarquement" />
                        </span>
                        <span className="text-center text-[11px] leading-snug text-muted-foreground">
                          Indiquez ce numéro au contrôleur si votre téléphone est déchargé.
                        </span>
                      </div>
                    )}
                    <Button size="lg" onClick={handleDownloadPdf} className="h-12 w-full gap-2">
                      <FileDown className="h-4 w-4" aria-hidden /> Télécharger le billet PDF
                    </Button>
                  </div>
                )}

                {pending && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                      <Banknote className="size-4 shrink-0" aria-hidden /> Paiement en attente
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-amber-800 dark:text-amber-300">
                      Votre siège est bloqué jusqu&apos;à expiration du délai. Finalisez le paiement au guichet
                      {detail.agencyName ? ` ${detail.agencyName}` : " Océan du Nord"} avec cette référence, ou via Mobile Money
                      depuis votre confirmation.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Confirmation d'annulation */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler cette réservation ?</AlertDialogTitle>
            <AlertDialogDescription>
              La réservation {detail?.bookingReference} sera annulée et le siège libéré. Cette action est définitive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver</AlertDialogCancel>
            <AlertDialogAction
              onClick={doCancel}
              disabled={cancelling}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {cancelling ? "Annulation…" : "Oui, annuler"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
