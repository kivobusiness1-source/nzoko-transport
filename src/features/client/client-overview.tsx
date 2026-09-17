"use client";

// ============================================================
// NZOKO — Aperçu de l'espace client : carte héros (palier, solde
// de points, progression), 4 KPI, trajet préféré + offre
// personnalisée, prochain départ avec compte à rebours.
// ============================================================

import { motion } from "framer-motion";
import {
  ArrowRight, Building2, CalendarClock, ChevronRight, Clock, MapPin, Sparkles, Star, Ticket, Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BookingStatusBadge } from "@/components/shared/nzoko-badge";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { LOYALTY_REWARDS } from "@/lib/constants";
import { formatDateTime, formatMoney, formatTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import { ClientKpiCard } from "@/features/client/client-kpi-card";
import { congoDateStr, countdownLabel, formatPoints, nextRewardTarget, tierDef, tierProgress } from "@/features/client/client-utils";
import { todayStr } from "@/lib/dates";

export function ClientOverview({ refreshKey, onTab }: { refreshKey?: number; onTab: (key: string) => void }) {
  const session = useApp((s) => s.session);
  const setView = useApp((s) => s.setView);
  const setBookingSearch = useApp((s) => s.setBookingSearch);
  const { data: stats, loading, error, reload } = useApiData(() => api.client.overview(), { refreshKey });
  const { data: trips } = useApiData(() => api.client.trips(), { refreshKey });

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="nzoko-hero gap-0 overflow-hidden border-0 py-6">
          <div className="space-y-3 px-6">
            <Skeleton className="h-4 w-44 bg-white/25" />
            <Skeleton className="h-10 w-52 bg-white/25" />
            <Skeleton className="h-2 w-full bg-white/25" />
            <Skeleton className="h-10 w-40 bg-white/25" />
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-0 p-4 py-4">
              <Skeleton className="size-10 rounded-xl" />
              <Skeleton className="mt-3 h-6 w-16" />
              <Skeleton className="mt-2 h-3 w-24" />
            </Card>
          ))}
        </div>
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;
  if (!stats) return null;

  const firstName = session?.firstName ?? "";
  const tier = tierDef(stats.tier);
  const progress = tierProgress(stats.lifetimePoints, stats.tier);
  const rewardTarget = nextRewardTarget(stats.pointsBalance, LOYALTY_REWARDS);
  const remainingToNextTier = stats.nextTier
    ? stats.nextTier.pointsRemaining
    : progress.next
      ? Math.max(0, progress.next.min - stats.lifetimePoints)
      : 0;

  // Date courante — via constructeur (cf. convention du projet : new Date()
  // en rendu, jamais Date.now() qui est signalé impur par react-hooks/purity).
  const now = new Date().getTime();
  const upcoming = (trips ?? [])
    .filter((t) => t.status === "CONFIRMED" && new Date(t.departureTime).getTime() >= now)
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
  const nextTrip = upcoming[0];

  // Prochain départ sur le trajet préféré (le cas échéant).
  const nextOnFavoriteRoute =
    stats.favoriteRoute && upcoming.length > 0
      ? upcoming.find(
          (t) =>
            t.originCityName === stats.favoriteRoute?.originCityName &&
            t.destinationCityName === stats.favoriteRoute?.destinationCityName,
        )
      : undefined;

  const hasNoTrips = stats.tripsCompleted === 0 && stats.tripsUpcoming === 0;

  const goBooking = () => {
    setView("booking");
    window.scrollTo({ top: 0 });
  };

  const bookFavoriteRoute = () => {
    if (!stats.favoriteRoute) return;
    setBookingSearch({
      from: stats.favoriteRoute.originCityId,
      to: stats.favoriteRoute.destinationCityId,
      date: nextOnFavoriteRoute ? congoDateStr(nextOnFavoriteRoute.departureTime) : todayStr(),
    });
    goBooking();
  };

  return (
    <div className="space-y-6">
      {/* --- Carte héros : salutation, palier, points, progression --- */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="nzoko-hero relative overflow-hidden rounded-2xl p-5 text-white sm:p-6"
        aria-label="Votre fidélité NZOKO"
      >
        <div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-white/10" aria-hidden />
        <div className="pointer-events-none absolute -right-2 top-20 size-20 rounded-full bg-white/5" aria-hidden />

        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/85">Bonjour {firstName} 👋</p>
            <p className="mt-2 text-4xl font-bold leading-none tabular-nums sm:text-5xl">
              {formatPoints(stats.pointsBalance)}
              <span className="ml-2 text-base font-medium text-white/80">points</span>
            </p>
            <p className="mt-1.5 text-xs text-white/70">
              {formatPoints(stats.lifetimePoints)} points cumulés depuis votre inscription
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
                Encore <span className="font-bold text-white">{formatPoints(remainingToNextTier)}</span> points pour {progress.next.label}
              </>
            ) : (
              <>Palier le plus élevé — merci pour votre fidélité 💎</>
            )}
            {rewardTarget && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3" aria-hidden />
                  Prochaine récompense : {rewardTarget.reward.label} ({formatPoints(rewardTarget.remaining)} pts restants)
                </span>
              </>
            )}
          </p>
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <Button
            onClick={goBooking}
            className="min-h-[44px] gap-1.5 bg-white text-primary hover:bg-white/90"
          >
            <Ticket className="size-4" aria-hidden /> Réserver un voyage
          </Button>
          <Button
            variant="outline"
            onClick={() => onTab("loyalty")}
            className="min-h-[44px] gap-1 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <Star className="size-4" aria-hidden /> Mes récompenses
          </Button>
        </div>
      </motion.section>

      {hasNoTrips ? (
        <NzokoEmptyState
          icon={Ticket}
          title="Réservez votre premier voyage pour démarrer"
          description="Vos billets, points de fidélité et statistiques apparaîtront ici après votre premier trajet."
          action={
            <Button onClick={goBooking} className="gap-1.5">
              <Ticket className="size-4" aria-hidden /> Réserver un voyage
            </Button>
          }
        />
      ) : (
        <>
          {/* --- 4 KPI --- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ClientKpiCard label="Voyages effectués" value={String(stats.tripsCompleted)} icon={Ticket} tone="green" />
            <ClientKpiCard label="FCFA dépensés" value={formatMoney(stats.totalSpent)} icon={Wallet} tone="orange" />
            <ClientKpiCard
              label="Heures de voyage"
              value={`${Math.round(stats.totalTravelMinutes / 60)} h`}
              icon={Clock}
              tone="amber"
            />
            <ClientKpiCard label="Agences utilisées" value={String(stats.agenciesUsed)} icon={Building2} tone="neutral" />
          </div>

          {/* --- Trajet préféré + offre personnalisée --- */}
          {(stats.favoriteRoute || stats.personalizedOffer) && (
            <div className="grid gap-3 md:grid-cols-2">
              {stats.favoriteRoute && (
                <Card className="nzoko-fade-up border-primary/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <MapPin className="size-3.5 text-primary" aria-hidden /> Mon trajet préféré
                      </p>
                      <Badge className="border-primary/20 bg-primary/10 text-primary">
                        {stats.favoriteRoute.tripsCount}× voyages
                      </Badge>
                    </div>
                    <p className="mt-2 flex min-w-0 items-center gap-1.5 text-lg font-bold">
                      <span className="truncate">{stats.favoriteRoute.originCityName}</span>
                      <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />
                      <span className="truncate">{stats.favoriteRoute.destinationCityName}</span>
                    </p>
                    {nextOnFavoriteRoute ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarClock className="size-3.5 shrink-0 text-primary" aria-hidden />
                        Prochain départ : <span className="font-semibold text-foreground">{formatDateTime(nextOnFavoriteRoute.departureTime)}</span>
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-muted-foreground">Aucun départ planifié sur ce trajet pour le moment.</p>
                    )}
                    <Button variant="outline" size="sm" className="mt-3 h-9 gap-1.5" onClick={bookFavoriteRoute}>
                      Réserver ce trajet <ArrowRight className="size-3.5" aria-hidden />
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Offre personnalisée — accent orange */}
              <Card className="nzoko-fade-up border-orange-200 bg-orange-50/70 dark:border-orange-900 dark:bg-orange-950/30">
                <CardContent className="p-4">
                  <Badge className="gap-1 border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
                    <Sparkles className="size-3" aria-hidden /> Offre personnalisée
                  </Badge>
                  {stats.personalizedOffer ? (
                    <>
                      <p className="mt-2 text-base font-bold text-orange-900 dark:text-orange-200">
                        {stats.personalizedOffer.headline}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-orange-800/85 dark:text-orange-300/85">
                        {stats.personalizedOffer.detail}
                      </p>
                      <Button
                        size="sm"
                        className="nzoko-hero-orange mt-3 h-9 gap-1.5 text-white hover:opacity-95"
                        onClick={goBooking}
                      >
                        <Sparkles className="size-3.5" aria-hidden /> Profiter de l&apos;offre
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 text-base font-bold text-orange-900 dark:text-orange-200">
                        Une offre vous attend
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-orange-800/85 dark:text-orange-300/85">
                        Réservez votre 1<sup>er</sup> voyage sur ce trajet pour débloquer une offre personnalisée.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* --- Prochain départ --- */}
          <section aria-label="Prochain départ">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <CalendarClock className="size-4 text-primary" aria-hidden /> Prochain départ
              </h3>
              <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => onTab("trips")}>
                Tout voir <ChevronRight className="size-3.5" aria-hidden />
              </Button>
            </div>
            {nextTrip ? (
              <Card className="nzoko-fade-up overflow-hidden py-0">
                <CardContent className="p-0">
                  <div className="flex items-stretch">
                    <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-0.5 border-r bg-primary/5 py-4 sm:w-28">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Départ</span>
                      <span className="text-sm font-bold text-primary">{countdownLabel(nextTrip.departureTime)}</span>
                      <span className="text-[11px] text-muted-foreground">{formatTime(nextTrip.departureTime)}</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold">
                          {nextTrip.originCityName} → {nextTrip.destinationCityName}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{formatDateTime(nextTrip.departureTime)}</span>
                          <span aria-hidden>·</span>
                          <span>Siège {nextTrip.seatNumber}</span>
                          <span aria-hidden>·</span>
                          <span className="font-semibold text-foreground">{formatMoney(nextTrip.amount)}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <BookingStatusBadge status={nextTrip.status} />
                        <Button variant="outline" size="sm" className="h-9" onClick={() => onTab("trips")}>
                          Détails
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <p className="rounded-xl border border-dashed bg-card/50 px-4 py-5 text-center text-sm text-muted-foreground">
                Aucun départ à venir.{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={goBooking}>
                  Réserver maintenant
                </button>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
