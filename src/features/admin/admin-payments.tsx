"use client";

// ============================================================
// NZOKO TRANSPORT — Paiements admin (filtres + liste + remboursements MoMo)
// Remboursements : MTN MoMo (Refund API / transfert de fonds) ou espèces.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Banknote, Coins, CreditCard, Landmark, Loader2, RotateCcw, Search, Smartphone, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiClientError, hasPerm } from "@/lib/api-client";
import {
  PAYMENT_PROVIDERS,
  PAYMENT_PROVIDER_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/constants";
import type { PaymentProvider } from "@/lib/constants";
import type { MomoOverviewDTO, PaymentDTO, RefundPaymentInput, RefundMode } from "@/types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useApiData, useDebounced } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const PROVIDER_ICONS: Record<PaymentProvider, LucideIcon> = {
  MTN_MOMO: Smartphone,
  AIRTEL_MONEY: Smartphone,
  CASH: Banknote,
  CARD: CreditCard,
  BANK_TRANSFER: Landmark,
};

const PROVIDER_TONES: Record<PaymentProvider, string> = {
  MTN_MOMO: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  AIRTEL_MONEY: "bg-red-500/15 text-red-600 dark:text-red-400",
  CASH: "bg-primary/10 text-primary",
  CARD: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  BANK_TRANSFER: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback;
}

export function AdminPayments({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();
  const canRefund = session ? hasPerm(session, "payment:manage") : false;

  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q);
  const [status, setStatus] = useState("ALL");
  const [provider, setProvider] = useState("ALL");
  const [refundTarget, setRefundTarget] = useState<PaymentDTO | null>(null);

  const { data, loading, error, reload } = useApiData(
    () =>
      api.admin.payments({
        status: status === "ALL" ? undefined : status,
        provider: provider === "ALL" ? undefined : provider,
        q: debouncedQ || undefined,
      }),
    { refetchKey: [status, provider, debouncedQ], refreshKey },
  );

  const payments = data ?? [];

  return (
    <div>
      <MomoOverviewCard />

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] lg:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher (référence, passager…)"
            className="h-11 pl-9"
            aria-label="Rechercher un paiement"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 w-full sm:w-44" aria-label="Filtrer par statut de paiement">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous statuts</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="h-11 w-full sm:w-52" aria-label="Filtrer par moyen de paiement">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les moyens</SelectItem>
            {PAYMENT_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {PAYMENT_PROVIDER_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={5} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && payments.length === 0 && (
          <NzokoEmptyState
            icon={CreditCard}
            title="Aucun paiement"
            description="Aucun paiement ne correspond à ces critères."
          />
        )}
        {!loading && !error && payments.length > 0 && (
          <>
            <div className="nzoko-scroll grid max-h-[70vh] gap-3 overflow-y-auto pr-1 md:hidden">
              {payments.map((p) => (
                <PaymentCard key={p.id} payment={p} canRefund={canRefund} onRefund={() => setRefundTarget(p)} onUpdated={reload} />
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Moyen</TableHead>
                    <TableHead>Réservation</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Collecteur</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    {canRefund && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.slice(0, 100).map((p) => {
                    const Icon = PROVIDER_ICONS[p.provider];
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className={`flex h-7 w-7 items-center justify-center rounded-lg ${PROVIDER_TONES[p.provider]}`}
                              aria-hidden="true"
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-xs">{PAYMENT_PROVIDER_LABELS[p.provider]}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {p.bookingReference ?? p.bookingId}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className={PAYMENT_STATUS_COLORS[p.status]}>
                              {PAYMENT_STATUS_LABELS[p.status]}
                            </Badge>
                            {p.refund?.status === "PROCESSING" && (
                              <Badge variant="outline" className="border-violet-300 bg-violet-100 text-violet-800">
                                Remboursement en cours
                              </Badge>
                            )}
                            {p.refund?.status === "SUCCESSFUL" && (
                              <Badge variant="outline" className="border-teal-300 bg-teal-100 text-teal-800">
                                Fonds remboursés
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{p.collectedByName ?? "—"}</TableCell>
                        <TableCell className="text-xs">{formatDateTime(p.createdAt)}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {formatMoney(p.amount)}
                        </TableCell>
                        {canRefund && (
                          <TableCell className="text-right">
                            <RefundCell payment={p} onRefund={() => setRefundTarget(p)} />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
            {payments.length > 100 && (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                100 paiements affichés sur {payments.length} — affinez la recherche.
              </p>
            )}
          </>
        )}
      </div>

      {/* Dialog d'initiation de remboursement */}
      {refundTarget && (
        <RefundDialog
          payment={refundTarget}
          onClose={() => setRefundTarget(null)}
          onDone={() => {
            setRefundTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Cellule d'action remboursement (tableau desktop)
// ------------------------------------------------------------
function RefundCell({ payment: p, onRefund }: { payment: PaymentDTO; onRefund: () => void }) {
  const [checking, setChecking] = useState(false);

  const poll = async () => {
    setChecking(true);
    try {
      const updated = await api.admin.refundStatus(p.id);
      if (updated.refund?.status === "SUCCESSFUL") {
        toast.success(`Remboursement confirmé — ${formatMoney(updated.refund.amount)} envoyés.`);
      } else if (updated.refund?.status === "FAILED") {
        toast.error(updated.refund.reason ?? "Le remboursement a échoué chez MTN.");
      } else {
        toast.info("Remboursement toujours en cours côté MTN…");
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, "Impossible de vérifier le remboursement."));
    } finally {
      setChecking(false);
    }
  };

  if (p.status === "SUCCESS" && !p.refund) {
    return (
      <Button size="sm" variant="outline" className="h-8" onClick={onRefund}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Rembourser
      </Button>
    );
  }
  if (p.refund?.status === "PROCESSING") {
    return (
      <Button size="sm" variant="ghost" className="h-8" onClick={poll} disabled={checking}>
        {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Loader2 className="h-3.5 w-3.5" aria-hidden />}
        Vérifier
      </Button>
    );
  }
  if (p.refund?.status === "FAILED" && p.status === "SUCCESS") {
    return (
      <Button size="sm" variant="outline" className="h-8" onClick={onRefund}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Réessayer
      </Button>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

// ------------------------------------------------------------
// Carte vue d'ensemble MTN MoMo (environnement + soldes)
// ------------------------------------------------------------
function MomoOverviewCard() {
  const [overview, setOverview] = useState<MomoOverviewDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.admin
      .momoOverview()
      .then((o) => {
        if (!cancelled) setOverview(o);
      })
      .catch(() => {
        /* sans finance:read ou non configuré → carte discrètement masquée */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !overview) return null;
  if (!overview.collection.configured && !overview.disbursement.configured) return null;

  return (
    <Card className="border-orange-200/60 bg-gradient-to-br from-orange-50/80 to-white dark:border-orange-900/40 dark:from-orange-950/20 dark:to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="flex size-8 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400" aria-hidden>
            <Wallet className="h-4 w-4" />
          </span>
          MTN Mobile Money — comptes marchands
          <Badge variant="outline" className="ml-1 border-orange-300 bg-orange-100 text-orange-800">
            {overview.environment === "sandbox" ? "SANDBOX" : "PRODUCTION"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <MomoProductBalance
          title="Collecte (Request to Pay)"
          icon={Coins}
          configured={overview.collection.configured}
          balance={overview.collection.balance}
          error={overview.collection.error}
          currency={overview.currency}
        />
        <MomoProductBalance
          title="Envoi de fonds (remboursements)"
          icon={RotateCcw}
          configured={overview.disbursement.configured}
          balance={overview.disbursement.balance}
          error={overview.disbursement.error}
          currency={overview.currency}
        />
      </CardContent>
    </Card>
  );
}

function MomoProductBalance({
  title,
  icon: Icon,
  configured,
  balance,
  error,
  currency,
}: {
  title: string;
  icon: LucideIcon;
  configured: boolean;
  balance: { availableBalance: string; currency: string } | null;
  error: string | null;
  currency: string;
}) {
  return (
    <div className="rounded-lg border bg-white/70 p-3 dark:bg-card/60">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </p>
      {!configured ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Clés non configurées (.env MOMO_*)</p>
      ) : error ? (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : balance ? (
        <p className="mt-1.5 text-lg font-bold tabular-nums text-primary">
          {balance.availableBalance} {balance.currency}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">Devise : {currency} · solde indisponible</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Dialog de remboursement
// ------------------------------------------------------------
const REFUND_POLL_INTERVAL_MS = 5_000;
const REFUND_POLL_MAX = 12;

function RefundDialog({ payment, onClose, onDone }: { payment: PaymentDTO; onClose: () => void; onDone: () => void }) {
  // MoMo réel + paiement MoMo d'origine → remboursement automatique proposé en premier
  const defaultMode: RefundMode = payment.provider === "MTN_MOMO" && payment.providerTransactionId ? "MOMO_REFUND" : "MOMO_TRANSFER";
  const [mode, setMode] = useState<RefundMode>(defaultMode);
  const [msisdn, setMsisdn] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PaymentDTO | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Suivi automatique du remboursement MoMo (asynchrone 202)
  useEffect(() => {
    if (!result?.refund || result.refund.status !== "PROCESSING" || mode === "CASH") return;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      if (attempts > REFUND_POLL_MAX) return;
      try {
        const updated = await api.admin.refundStatus(payment.id);
        if (updated.refund?.status === "SUCCESSFUL") {
          toast.success(`Remboursement confirmé — ${formatMoney(updated.refund.amount)} envoyés au client.`);
          onDone();
          return;
        }
        if (updated.refund?.status === "FAILED") {
          toast.error(updated.refund.reason ?? "Le remboursement a échoué chez MTN.");
          setResult(updated);
          return;
        }
        setResult(updated);
      } catch {
        /* transitoire */
      }
      timerRef.current = setTimeout(tick, REFUND_POLL_INTERVAL_MS);
    };

    timerRef.current = setTimeout(tick, REFUND_POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- polling délibérément stable : réagir à onDone/mode non stabilisés réinitialiserait le compteur de tentatives en boucle
  }, [result?.refund?.status]);

  const submit = async () => {
    setBusy(true);
    try {
      const input: RefundPaymentInput = { mode };
      if (mode === "MOMO_TRANSFER" && msisdn.trim()) input.msisdn = msisdn.replace(/[\s.-]/g, "");
      const updated = await api.admin.initiateRefund(payment.id, input);
      setResult(updated);
      if (mode === "CASH" || updated.refund?.status === "SUCCESSFUL") {
        toast.success(`Remboursement enregistré — ${formatMoney(updated.refund?.amount ?? payment.amount)}.`);
        onDone();
      } else {
        toast.info("Demande envoyée à MTN MoMo — suivi automatique en cours.");
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, "Impossible d'initier le remboursement."));
    } finally {
      setBusy(false);
    }
  };

  const processing = result?.refund?.status === "PROCESSING";

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rembourser le paiement</DialogTitle>
          <DialogDescription>
            Réservation <span className="font-mono font-semibold">{payment.bookingReference ?? payment.bookingId}</span> ·{" "}
            {PAYMENT_PROVIDER_LABELS[payment.provider]} · {formatMoney(payment.amount)}
          </DialogDescription>
        </DialogHeader>

        {processing ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/40">
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-violet-600 dark:text-violet-400" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-violet-900 dark:text-violet-200">Envoi de fonds en cours côté MTN…</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {result?.refund?.mode === "MOMO_TRANSFER" && result?.refund?.msisdn
                    ? `Transfert vers ${result.refund.msisdn}`
                    : "Remboursement automatique de la transaction d'origine"}{" "}
                  · vérification automatique toutes les 5 s.
                </p>
              </div>
            </div>
            <Button variant="ghost" className="w-full" onClick={onClose} disabled={busy}>
              Fermer — suivre depuis la liste
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as RefundMode)} className="gap-3">
              {payment.provider === "MTN_MOMO" && payment.providerTransactionId && (
                <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", mode === "MOMO_REFUND" ? "border-primary bg-primary/5" : "hover:border-primary/30")}>
                  <RadioGroupItem value="MOMO_REFUND" className="mt-1" aria-label="Remboursement automatique MTN MoMo" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      <Smartphone className="size-3.5 text-orange-600" aria-hidden />
                      MTN MoMo — remboursement automatique
                    </span>
                    <span className="block text-xs leading-snug text-muted-foreground">
                      MTN renvoie les fonds au compte ayant payé (Refund API) — recommandé.
                    </span>
                  </span>
                </label>
              )}
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", mode === "MOMO_TRANSFER" ? "border-primary bg-primary/5" : "hover:border-primary/30")}>
                <RadioGroupItem value="MOMO_TRANSFER" className="mt-1" aria-label="Envoi de fonds MTN MoMo vers un numéro" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Coins className="size-3.5 text-orange-600" aria-hidden />
                    MTN MoMo — envoi de fonds vers un numéro
                  </span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    Transfert du montant vers le Mobile Money d&apos;un bénéficiaire.
                  </span>
                  {mode === "MOMO_TRANSFER" && (
                    <span className="mt-2 block">
                      <Label htmlFor="refund-msisdn" className="mb-1 block text-xs font-medium">
                        Numéro bénéficiaire
                      </Label>
                      <Input
                        id="refund-msisdn"
                        type="tel"
                        inputMode="tel"
                        value={msisdn}
                        onChange={(e) => setMsisdn(e.target.value)}
                        placeholder="06 123 45 67 ou +242 06 123 45 67"
                        className="h-10"
                      />
                    </span>
                  )}
                </span>
              </label>
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", mode === "CASH" ? "border-primary bg-primary/5" : "hover:border-primary/30")}>
                <RadioGroupItem value="CASH" className="mt-1" aria-label="Espèces rendues au guichet" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <Banknote className="size-3.5" aria-hidden />
                    Espèces (guichet)
                  </span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    Fonds rendus en main propre — enregistrement immédiat.
                  </span>
                </span>
              </label>
            </RadioGroup>

            {result?.refund?.status === "FAILED" && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
                {result.refund.reason ?? "Le remboursement a échoué chez MTN."} — vous pouvez réessayer.
              </p>
            )}

            <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
              <p className="flex items-center justify-between">
                <span className="text-muted-foreground">Montant remboursé</span>
                <span className="font-bold text-primary">{formatMoney(payment.amount)}</span>
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Annuler
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                Rembourser {formatMoney(payment.amount)}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Carte paiement mobile
// ------------------------------------------------------------
function PaymentCard({
  payment: p,
  canRefund,
  onRefund,
  onUpdated,
}: {
  payment: PaymentDTO;
  canRefund: boolean;
  onRefund: () => void;
  onUpdated: () => void;
}) {
  const Icon = PROVIDER_ICONS[p.provider];
  const [checking, setChecking] = useState(false);

  const poll = async () => {
    setChecking(true);
    try {
      const updated = await api.admin.refundStatus(p.id);
      if (updated.refund?.status === "SUCCESSFUL") {
        toast.success(`Remboursement confirmé — ${formatMoney(updated.refund.amount)} envoyés.`);
        onUpdated();
      } else if (updated.refund?.status === "FAILED") {
        toast.error(updated.refund.reason ?? "Le remboursement a échoué chez MTN.");
      } else {
        toast.info("Remboursement toujours en cours côté MTN…");
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, "Impossible de vérifier le remboursement."));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card className="gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${PROVIDER_TONES[p.provider]}`}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{PAYMENT_PROVIDER_LABELS[p.provider]}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {p.bookingReference ?? p.bookingId}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums">{formatMoney(p.amount)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={PAYMENT_STATUS_COLORS[p.status]}>
          {PAYMENT_STATUS_LABELS[p.status]}
        </Badge>
        {p.refund?.status === "PROCESSING" && (
          <Badge variant="outline" className="border-violet-300 bg-violet-100 text-violet-800">
            Remboursement en cours
          </Badge>
        )}
        {p.refund?.status === "SUCCESSFUL" && (
          <Badge variant="outline" className="border-teal-300 bg-teal-100 text-teal-800">
            Fonds remboursés
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {formatDateTime(p.createdAt)}
          {p.collectedByName ? ` · ${p.collectedByName}` : ""}
        </span>
      </div>
      {canRefund && p.status === "SUCCESS" && !p.refund && (
        <Button size="sm" variant="outline" className="h-9" onClick={onRefund}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Rembourser
        </Button>
      )}
      {canRefund && p.refund?.status === "PROCESSING" && (
        <Button size="sm" variant="ghost" className="h-9" onClick={poll} disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Loader2 className="h-3.5 w-3.5" aria-hidden />}
          Vérifier le remboursement
        </Button>
      )}
    </Card>
  );
}
