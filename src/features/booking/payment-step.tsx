"use client";

// ============================================================
// Océan du Nord — Étape 5 : récap + paiement (MTN MoMo, espèces, carte/virement)
// Gère : encaissement espèces agent, expiration du verrou, suivi MoMo réel.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle, Banknote, BellRing, CheckCircle2, CreditCard, Landmark, Loader2, Lock, ShieldAlert,
  Smartphone, Tag, User,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NzokoCountdown } from "@/components/shared/nzoko-countdown";
import { api, ApiClientError, hasPerm } from "@/lib/api-client";
import { PAYMENT_PROVIDER_LABELS } from "@/lib/constants";
import type { PaymentProvider } from "@/lib/constants";
import { useApp } from "@/lib/store";
import { formatMoney, formatTime } from "@/lib/format";
import type { BookingDTO, BookingDetailDTO, PaymentDTO, PromoCodeValidationDTO } from "@/types";
import { cn } from "@/lib/utils";

interface PaymentStepProps {
  channel: "WEB" | "AGENT";
  booking: BookingDTO;
  onPaid: (detail: BookingDetailDTO) => void;
  // L'expiration du verrou est gérée EN LOCAL par le panneau d'expiration
  // (compte à rebours → message + redémarrage) : pas de callback parent.
}

// Validation souple : séparateurs (espaces/points/tirets) tolérés, comme la
// normalisation serveur toMomoMsisdn — le format du placeholder est accepté.
const PHONE_RE = /^(\+?242)?0?\d{8,9}$/;
const phoneValid = (raw: string) => PHONE_RE.test(raw.trim().replace(/[\s.\-()]/g, ""));

// Suivi MoMo réel : polling toutes les 5 s pendant 3 min max (36 essais).
const MOMO_POLL_INTERVAL_MS = 5_000;
const MOMO_POLL_MAX_ATTEMPTS = 36;

interface ProviderOption {
  value: PaymentProvider;
  icon: typeof Smartphone;
  description: string;
  agentHint?: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    value: "MTN_MOMO",
    icon: Smartphone,
    description: "Payez depuis votre compte MTN Mobile Money.",
  },
  {
    value: "CASH",
    icon: Banknote,
    description: "À régler au guichet sous 10 minutes.",
    agentHint: "Encaissement direct au guichet.",
  },
  {
    value: "CARD",
    icon: CreditCard,
    description: "Carte bancaire — instructions après validation.",
  },
  {
    value: "BANK_TRANSFER",
    icon: Landmark,
    description: "Virement — référence à communiquer à la banque.",
  },
];

function apiError(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback;
}

export function PaymentStep({ channel, booking, onPaid }: PaymentStepProps) {
  const session = useApp((s) => s.session);
  const canCollectCash = channel === "AGENT" && hasPerm(session, "payment:cash-collect");

  const [provider, setProvider] = useState<PaymentProvider>(channel === "AGENT" ? "CASH" : "MTN_MOMO");
  const [momoPhone, setMomoPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [polling, setPolling] = useState(false); // polling MoMo réel en cours
  const [payment, setPayment] = useState<PaymentDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // ---- Code promo / fidélité (validation, affichage de la remise) ----
  // NB : le code est appliqué côté serveur À LA CRÉATION de la réservation.
  // Cette réservation a été créée sans code → la remise validée ici s'applique
  // à la prochaine réservation (montants réels figés dans booking.amount).
  const [promoCode, setPromoCode] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoInfo, setPromoInfo] = useState<PromoCodeValidationDTO | null>(null);

  const applyPromo = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setPromoChecking(true);
    setPromoInfo(null);
    try {
      const validation = await api.bookings.validatePromo(code, booking.trip.id);
      setPromoInfo(validation);
      toast.success(`Code « ${validation.code} » valide — remise appliquée à votre prochaine réservation.`);
    } catch (err) {
      toast.error(apiError(err, "Code invalide ou non applicable à ce voyage."));
    } finally {
      setPromoChecking(false);
    }
  };

  const needsPhone = provider === "MTN_MOMO";

  const loadDetail = useCallback(async () => {
    try {
      const detail = await api.bookings.get(booking.bookingReference);
      onPaid(detail);
    } catch (err) {
      setError(apiError(err, "Impossible de récupérer le billet."));
    }
  }, [booking.bookingReference, onPaid]);

  const createPayment = async () => {
    setError(null);
    if (needsPhone && !phoneValid(momoPhone)) {
      setError("Renseignez un numéro Mobile Money valide (ex : 06 123 45 67).");
      return;
    }
    setCreating(true);
    try {
      const created = await api.payments.create({
        bookingId: booking.id,
        provider,
        ...(needsPhone ? { momoPhone: momoPhone.replace(/[\s.-]/g, "") } : {}),
      });
      setPayment(created);
      if (created.status === "SUCCESS") {
        await loadDetail();
      }
    } catch (err) {
      setError(apiError(err, "Impossible de démarrer le paiement."));
    } finally {
      setCreating(false);
    }
  };

  // ---- Suivi automatique du paiement MTN MoMo réel (Request to Pay) ----
  // Le statut est re-vérifié côté serveur auprès de MTN à chaque requête.
  const momoPollActive =
    payment !== null &&
    payment.provider === "MTN_MOMO" &&
    payment.status === "PROCESSING";

  const checkNow = async (manual = false) => {
    if (!payment || payment.status !== "PROCESSING") return;
    try {
      const updated = await api.payments.momoStatus(payment.id);
      setPayment(updated);
      if (updated.status === "SUCCESS") {
        setPolling(false);
        await loadDetail();
      } else if (updated.status === "FAILED") {
        setPolling(false);
        setError(updated.failureReason ?? "Le paiement Mobile Money a échoué.");
      } else if (manual) {
        setError(null); // vérification manuelle → toujours en attente côté MTN
      }
    } catch (err) {
      setPolling(false);
      setError(apiError(err, "Impossible de vérifier le paiement. Réessayez."));
    }
  };

    // Id dérivé : l'effet ne dépend plus de l'objet payment entier
  // (nullable) mais d'une identité stable — redémarre seulement au
  // changement de paiement ou d'état de polling.
  const pollPaymentId = momoPollActive && payment ? payment.id : null;

  useEffect(() => {
    if (!pollPaymentId) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setPolling(true);

    const tick = async () => {
      attempts += 1;
      if (attempts > MOMO_POLL_MAX_ATTEMPTS) {
        setPolling(false);
        setError("Délai dépassé — si vous avez approuvé le paiement, vérifiez à nouveau ci-dessous.");
        return;
      }
      try {
        const updated = await api.payments.momoStatus(pollPaymentId);
        setPayment(updated);
        if (updated.status === "SUCCESS") {
          setPolling(false);
          await loadDetail();
          return;
        }
        if (updated.status === "FAILED") {
          setPolling(false);
          setError(updated.failureReason ?? "Le paiement Mobile Money a échoué.");
          return;
        }
      } catch {
        // erreur réseau ponctuelle → on continue de patienter
      }
      timer = setTimeout(tick, MOMO_POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, 1_500); // premier contrôle rapide
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pollPaymentId, loadDetail]);

  const confirm = async () => {
    if (!payment) return;
    setConfirming(true);
    setError(null);
    try {
      const updated = await api.payments.confirmCash(payment.id);
      setPayment(updated);
      if (updated.status === "SUCCESS") {
        await loadDetail();
      } else if (updated.status === "FAILED") {
        setError("Le paiement a échoué. Réessayez ou choisissez un autre moyen.");
      }
    } catch (err) {
      setError(apiError(err, "Impossible de confirmer le paiement."));
    } finally {
      setConfirming(false);
    }
  };

  const resetPayment = () => {
    setPayment(null);
    setError(null);
    setPolling(false);
  };

  if (expired) {
    return (
      <Alert variant="destructive" role="alert">
        <ShieldAlert className="h-5 w-5" aria-hidden />
        <AlertTitle>Réservation expirée</AlertTitle>
        <AlertDescription>
          Le délai de 10 minutes est écoulé, le siège a été libéré. Vous pouvez relancer une réservation depuis le début.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      {/* Compte à rebours du verrou */}
      {booking.expiresAt && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            <Lock className="size-4 shrink-0" aria-hidden /> Finalisez le paiement :
          </p>
          <NzokoCountdown expiresAt={booking.expiresAt} onExpire={() => setExpired(true)} />
        </div>
      )}

      {/* Récapitulatif */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Récapitulatif</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-semibold">
              {booking.trip.originCityName} → {booking.trip.destinationCityName}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">Réf. {booking.bookingReference}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Départ</p>
              <p className="font-semibold">{formatTime(booking.trip.departureTime)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Bus</p>
              <p className="truncate font-semibold">{booking.trip.busRegistration}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">
                {booking.seats.length > 1 ? "Places" : "Siège"}
              </p>
              <p className="font-semibold">
                {booking.seats.map((s) => s.seatNumber).join(", ")}
                {booking.seat.type === "VIP" && <span className="ml-1 text-[10px] font-bold uppercase text-orange-600">VIP</span>}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Passager</p>
              <p className="flex items-center gap-1 truncate font-semibold">
                <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {booking.passenger.firstName} {booking.passenger.lastName}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2.5">
            <span className="text-sm font-medium">Montant à payer</span>
            <span className="text-lg font-bold text-primary">{formatMoney(booking.amount)}</span>
          </div>
          {promoInfo && (
            <p className="text-right text-xs text-muted-foreground" role="status">
              Après code promo « {promoInfo.code} » : {formatMoney(promoInfo.discountedAmount)} — applicable à votre prochaine réservation.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Paiement en cours de finalisation */}
      {payment ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Paiement {PAYMENT_PROVIDER_LABELS[payment.provider]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Statut</span>
              <span className="font-semibold">
                {payment.status === "SUCCESS"
                  ? "Réussi"
                  : payment.status === "FAILED"
                    ? "Échoué"
                    : payment.status === "PROCESSING"
                      ? "En cours"
                      : "En attente"}
              </span>
            </div>

            {/* MTN MoMo réel : attente d'approbation sur le téléphone du client */}
            {momoPollActive && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4" role="status" aria-live="polite">
                <div className="flex items-start gap-3">
                  <span className="relative mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <BellRing className="h-5 w-5" aria-hidden />
                    {polling && (
                      <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center">
                        <span className="absolute size-4 animate-ping rounded-full bg-primary/50" />
                        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-sm font-semibold">Approuvez le paiement sur votre téléphone</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Une demande de {formatMoney(payment.amount)} a été envoyée au numéro{" "}
                      <span className="font-mono font-semibold text-foreground">{momoPhone.trim()}</span>.
                      Validez-la depuis votre application MTN MoMo ou le menu MoMo de votre SIM — le
                      billet est émis automatiquement dès l&apos;approbation.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => checkNow(true)}
                      disabled={polling}
                    >
                      {polling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                      Vérifier maintenant
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {payment.instructions && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instructions</p>
                <p className="leading-relaxed">{payment.instructions}</p>
              </div>
            )}

            {payment.status === "PENDING" && (
              <div className="flex flex-col gap-2">
                {payment.provider === "CASH" && canCollectCash && (
                  <Button size="lg" onClick={confirm} disabled={confirming} className="h-12">
                    {confirming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Banknote className="h-4 w-4" aria-hidden />}
                    Encaisser et émettre le billet
                  </Button>
                )}
                {payment.provider === "CASH" && !canCollectCash && (
                  <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                    Présentez la référence <span className="font-mono font-semibold text-foreground">{booking.bookingReference}</span> au
                    guichet {booking.agencyName ?? ""} pour régler en espèces avant l&apos;expiration du délai.
                  </p>
                )}
                <Button variant="ghost" onClick={resetPayment} disabled={confirming || polling}>
                  Choisir un autre moyen de paiement
                </Button>
              </div>
            )}

            {payment.status === "PROCESSING" && (
              <div className="flex flex-col gap-2">
                <Button variant="ghost" onClick={resetPayment} disabled={confirming || polling}>
                  Annuler et choisir un autre moyen
                </Button>
              </div>
            )}

            {payment.status === "FAILED" && (
              <div className="space-y-2">
                {payment.failureReason && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
                    {payment.failureReason}
                  </p>
                )}
                <Button size="lg" onClick={resetPayment} variant="outline" className="h-12">
                  Réessayer un autre moyen de paiement
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Choix du moyen de paiement */
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Moyen de paiement</CardTitle>
            <p className="text-sm text-muted-foreground">
              {channel === "AGENT" ? "Encaissez au nom du passager." : "Choisissez comment régler votre billet."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Code promo / fidélité — validé pour information, appliqué à la
                création de la réservation côté serveur. */}
            <div className="space-y-2 rounded-xl border p-3">
              <Label htmlFor="promo-code" className="text-sm">
                Code promo / fidélité{" "}
                <span className="font-normal text-muted-foreground">(optionnel)</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="promo-code"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    className="h-11 pl-9 font-mono"
                    placeholder="Ex : ONC-FID-XXXX"
                    disabled={promoChecking}
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0 px-4"
                  onClick={applyPromo}
                  disabled={promoChecking || !promoCode.trim()}
                >
                  {promoChecking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Tag className="size-4" aria-hidden />}
                  Appliquer
                </Button>
              </div>
              {promoInfo && (
                <div
                  role="status"
                  className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <p className="font-semibold">
                    ✅ {promoInfo.label} :{" "}
                    {promoInfo.type === "FREE_TICKET" ? "billet offert" : `−${promoInfo.value} %`}
                  </p>
                  <p className="mt-1 text-xs">Montant après remise : {formatMoney(promoInfo.discountedAmount)}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-700/80 dark:text-emerald-300/80">
                    Le code s’applique à la prochaine réservation — cette réservation a déjà été créée sans code.
                  </p>
                </div>
              )}
            </div>

            <RadioGroup value={provider} onValueChange={(v) => setProvider(v as PaymentProvider)} className="gap-3">
              {PROVIDER_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                    provider === opt.value ? "border-primary bg-primary/5" : "hover:border-primary/30"
                  )}
                >
                  <RadioGroupItem value={opt.value} className="mt-1" aria-label={PAYMENT_PROVIDER_LABELS[opt.value]} />
                  <span className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg",
                        opt.value === "CASH" ? "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300" : "bg-primary/10 text-primary"
                      )}
                    >
                      <opt.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{PAYMENT_PROVIDER_LABELS[opt.value]}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">
                        {channel === "AGENT" && opt.agentHint ? opt.agentHint : opt.description}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>

            {needsPhone && (
              <div>
                <Label htmlFor="momo-phone" className="mb-1.5 block text-sm font-medium">
                  Numéro MTN Mobile Money
                </Label>
                <div className="relative">
                  <Smartphone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="momo-phone"
                    type="tel"
                    inputMode="tel"
                    value={momoPhone}
                    onChange={(e) => setMomoPhone(e.target.value)}
                    className="h-11 pl-9"
                    placeholder="06 123 45 67 ou +242 06 123 45 67"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Le compte qui recevra la demande de paiement (celui du passager).
                </p>
              </div>
            )}

            <Button size="lg" onClick={createPayment} disabled={creating} className="h-12 w-full text-base">
              {creating ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
              Payer {formatMoney(booking.amount)}
            </Button>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
