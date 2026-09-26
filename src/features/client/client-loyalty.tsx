"use client";

// ============================================================
// Océan du Nord — Fidélité : vitrine (solde en héros gradient, paliers,
// prochaine récompense), catalogue des récompenses avec échange,
// demandes de rachat (code promo copiable) + historique points.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Gift, History, Loader2, Percent, Scale, Star, Ticket,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { NzokoCopyButton } from "@/components/shared/nzoko-copy-button";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { friendlyApiError, useApiData } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { LOYALTY, LOYALTY_REWARDS } from "@/lib/constants";
import type { RewardKey } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { formatPoints, nextRewardTarget, tierDef, tierProgress } from "@/features/client/client-utils";
import { cn } from "@/lib/utils";
import type { LoyaltyRewardDTO, LoyaltyTransactionDTO, RedemptionRequestDTO } from "@/types";

const REDEMPTION_STATUS: Record<RedemptionRequestDTO["status"], { label: string; className: string }> = {
  PENDING: { label: "En attente", className: "bg-amber-100 text-amber-800 border-amber-200" },
  APPROVED: { label: "Validée", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  REJECTED: { label: "Refusée", className: "bg-red-100 text-red-800 border-red-200" },
};

const TRANSACTION_META: Record<LoyaltyTransactionDTO["type"], { icon: LucideIcon; sign: string; className: string }> = {
  EARN: { icon: ArrowUpRight, sign: "+", className: "text-emerald-600 dark:text-emerald-400" },
  SPEND: { icon: ArrowDownLeft, sign: "−", className: "text-orange-600 dark:text-orange-400" },
  ADJUST: { icon: Scale, sign: "±", className: "text-muted-foreground" },
};

/** Icône du catalogue selon la récompense. */
function rewardIcon(key: RewardKey): LucideIcon {
  if (key === "REDUCTION_5" || key === "REDUCTION_10") return Percent;
  if (key === "FREE_TICKET") return Ticket;
  return Gift;
}

export function ClientLoyalty({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.client.loyalty(), { refreshKey });
  const [redeeming, setRedeeming] = useState<RewardKey | null>(null);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="nzoko-hero gap-0 overflow-hidden border-0 py-6">
          <div className="space-y-3 px-6">
            <Skeleton className="h-4 w-36 bg-white/25" />
            <Skeleton className="h-10 w-52 bg-white/25" />
            <Skeleton className="h-2 w-full bg-white/25" />
          </div>
        </Card>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-0 p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-4 h-9 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const tier = tierDef(data.tier);
  const progress = tierProgress(data.lifetimePoints, data.tier);
  const rewards: LoyaltyRewardDTO[] = data.rewards.length > 0 ? data.rewards : [...LOYALTY_REWARDS];
  const fallbackTarget = nextRewardTarget(data.pointsBalance, rewards);
  const nextReward = data.nextReward ?? fallbackTarget?.reward ?? null;
  const remainingToReward = nextReward ? Math.max(0, nextReward.points - data.pointsBalance) : 0;
  const remainingToTier = progress.next ? Math.max(0, progress.next.min - data.lifetimePoints) : 0;

  const redeem = async (reward: LoyaltyRewardDTO) => {
    setRedeeming(reward.key);
    try {
      await api.client.redeem(reward.key);
      toast.success("Demande envoyée ✅", {
        description:
          reward.deliverable === "CODE"
            ? "Votre code promo sera disponible ici dès validation par nos équipes."
            : "Nos équipes traitent votre demande — vous recevrez la réponse ici.",
      });
      reload();
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setRedeeming(null);
    }
  };

  const pendingFirst = [...data.redemptions].sort((a, b) => {
    const order = { PENDING: 0, APPROVED: 1, REJECTED: 2 } as const;
    const diff = order[a.status] - order[b.status];
    return diff !== 0 ? diff : b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <div className="space-y-6">
      {/* --- Héros fidélité --- */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="nzoko-hero relative overflow-hidden rounded-2xl p-5 text-white sm:p-6"
        aria-label="Votre compte fidélité"
      >
        <div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-white/10" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/85">Solde disponible</p>
            <p className="mt-1.5 text-4xl font-bold leading-none tabular-nums sm:text-5xl">
              {formatPoints(data.pointsBalance)}
              <span className="ml-2 text-base font-medium text-white/80">points</span>
            </p>
            <p className="mt-1.5 text-xs text-white/70">
              <span className="font-bold text-white/90">{formatPoints(data.lifetimePoints)}</span> points cumulés depuis votre inscription
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
            <span aria-hidden>{tier.icon}</span> {tier.label}
          </span>
        </div>

        <div className="relative mt-5">
          <Progress
            value={progress.percent}
            className="h-2 bg-white/25 [&_[data-slot=progress-indicator]]:bg-white"
            aria-label={progress.next ? `Progression vers ${progress.next.label}` : "Palier maximum atteint"}
          />
          <p className="mt-2 text-xs leading-relaxed text-white/85">
            {progress.next ? (
              <>
                Plus que <span className="font-bold text-white">{formatPoints(remainingToTier)}</span> points pour {progress.next.label}
              </>
            ) : (
              <>Palier le plus élevé — merci pour votre fidélité 💎</>
            )}
            {nextReward && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3" aria-hidden />
                  Prochaine récompense : {nextReward.label} ({formatPoints(remainingToReward)} pts restants)
                </span>
              </>
            )}
          </p>
        </div>
      </motion.section>

      {/* --- Les 4 paliers --- */}
      <section aria-label="Les paliers Océan du Nord">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Les paliers fidélité</h3>
        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
          {LOYALTY.tiers.map((t) => {
            const isCurrent = t.key === data.tier;
            const reached = data.lifetimePoints >= t.min;
            return (
              <div
                key={t.key}
                title={t.label}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2.5 text-center",
                  isCurrent
                    ? "border-primary/40 bg-primary/10 shadow-sm"
                    : reached
                      ? "border-primary/20 bg-primary/5"
                      : "border-border bg-muted/30",
                )}
              >
                <span className={cn("text-lg leading-none", !reached && "opacity-40 grayscale")} aria-hidden>
                  {t.icon}
                </span>
                <span className={cn("mt-1 truncate text-[10px] font-semibold sm:text-[11px]", isCurrent && "text-primary")}>
                  {t.label.replace("Océan du Nord ", "")}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{formatPoints(t.min)} pts</span>
                {isCurrent && (
                  <span className="mt-1 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold leading-none text-primary-foreground">
                    Actuel
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* --- Catalogue --- */}
      <section aria-label="Catalogue de récompenses">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Catalogue de récompenses
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {rewards.map((reward) => {
            const Icon = rewardIcon(reward.key);
            const affordable = data.pointsBalance >= reward.points;
            const missing = reward.points - data.pointsBalance;
            return (
              <Card key={reward.key} className="nzoko-fade-up">
                <CardContent className="flex h-full flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                        aria-hidden
                      >
                        <Icon className="size-4.5" />
                      </span>
                      <span className="truncate">{reward.label}</span>
                    </p>
                    <p className="shrink-0 text-sm font-bold tabular-nums text-primary">
                      {formatPoints(reward.points)} pts
                    </p>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{reward.description}</p>

                  {reward.deliverable === "MANUAL" && (
                    <Badge variant="outline" className="mt-2 w-fit gap-1 border-primary/30 text-[10px] text-primary">
                      <BadgeCheck className="size-3" aria-hidden /> Validé par nos équipes
                    </Badge>
                  )}

                  <div className="mt-auto pt-3">
                    <Button
                      size="sm"
                      className="h-9 w-full gap-1.5"
                      disabled={!affordable || redeeming !== null}
                      title={!affordable ? `Il vous manque ${formatPoints(missing)} points` : undefined}
                      onClick={() => redeem(reward)}
                    >
                      {redeeming === reward.key ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Gift className="size-3.5" aria-hidden />
                      )}
                      {redeeming === reward.key
                        ? "Envoi…"
                        : affordable
                          ? "Échanger"
                          : `${formatPoints(missing)} pts manquants`}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* --- Mes demandes --- */}
      <section aria-label="Mes demandes de récompense">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mes demandes</h3>
        {pendingFirst.length === 0 ? (
          <NzokoEmptyState
            icon={Gift}
            title="Aucune demande pour le moment"
            description="Échangez vos points contre une récompense — votre demande apparaîtra ici."
          />
        ) : (
          <div className="space-y-2">
            {pendingFirst.map((r) => {
              const meta = REDEMPTION_STATUS[r.status];
              return (
                <Card key={r.id} className="nzoko-fade-up">
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3.5">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {r.rewardLabel}
                        <span className="text-xs font-medium tabular-nums text-muted-foreground">
                          −{formatPoints(r.pointsSpent)} pts
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Demandée le {formatDateTime(r.createdAt)}
                        {r.note ? ` · Note : ${r.note}` : ""}
                      </p>
                      {r.promoCode && (
                        <p className="mt-1.5 flex items-center gap-1.5">
                          <span className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs font-bold tracking-wider">
                            {r.promoCode}
                          </span>
                          <NzokoCopyButton value={r.promoCode} label="Copier le code" size="sm" className="h-8" />
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className={cn("shrink-0 font-medium", meta.className)}>
                      {meta.label}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* --- Historique des transactions --- */}
      <section aria-label="Historique des points">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <History className="size-4" aria-hidden /> Historique des points
        </h3>
        {data.transactions.length === 0 ? (
          <NzokoEmptyState
            icon={History}
            title="Aucun mouvement de points"
            description="Vos points apparaîtront ici : +100 points à chaque voyage payé."
          />
        ) : (
          <div className="nzoko-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1" role="list" aria-label="Historique des points">
            {data.transactions.map((t) => {
              const meta = TRANSACTION_META[t.type];
              return (
                <div
                  key={t.id}
                  role="listitem"
                  className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.description || t.reason}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDateTime(t.createdAt)} · {t.reason}
                    </p>
                  </div>
                  <p className={cn("flex shrink-0 items-center gap-1 text-sm font-bold tabular-nums", meta.className)}>
                    <meta.icon className="size-3.5" aria-hidden />
                    {meta.sign}
                    {formatPoints(t.points)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
