"use client";

// ============================================================
// Océan du Nord — Admin : Clients & fidélité (3 sous-sections)
// 1. Statistiques (clients, points, évaluations, paliers)
// 2. Clients (recherche, activité, paliers)
// 3. Récompenses & campagnes (rachats à valider + réactivation)
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import {
  BarChart3, Check, Loader2, Megaphone, MessageSquare, Percent, Search, Star, ThumbsDown, ThumbsUp,
  Users, UserCheck, UserX, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { NzokoSubTabs } from "@/components/shared/nzoko-chips";
import { NzokoCopyButton } from "@/components/shared/nzoko-copy-button";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoKpiCard } from "@/components/shared/nzoko-kpi-card";
import { NzokoKpiSkeletons, NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { friendlyApiError, useApiData, useDebounced } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { INACTIVE_CLIENT_DAYS, LOYALTY, LOYALTY_TIER_LABELS } from "@/lib/constants";
import type { LoyaltyTier } from "@/lib/constants";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { formatPoints, tierDef } from "@/features/client/client-utils";
import { cn } from "@/lib/utils";
import type { AdminClientDTO, CampaignInput, RedemptionRequestDTO } from "@/types";

const SUB_TABS = [
  { key: "stats", label: "Statistiques", icon: BarChart3 },
  { key: "clients", label: "Clients", icon: Users },
  { key: "rewards", label: "Récompenses & campagnes", icon: Star },
];

const SEGMENTS: { value: CampaignInput["segment"]; label: string }[] = [
  { value: "INACTIVE", label: `Inactifs ${INACTIVE_CLIENT_DAYS} jours` },
  { value: "BRONZE", label: LOYALTY_TIER_LABELS.BRONZE },
  { value: "SILVER", label: LOYALTY_TIER_LABELS.SILVER },
  { value: "GOLD", label: LOYALTY_TIER_LABELS.GOLD },
  { value: "VIP", label: LOYALTY_TIER_LABELS.VIP },
  { value: "ALL", label: "Tous les clients" },
];

const REDEMPTION_STATUS: Record<RedemptionRequestDTO["status"], { label: string; className: string }> = {
  PENDING: { label: "En attente", className: "bg-amber-100 text-amber-800 border-amber-200" },
  APPROVED: { label: "Validée", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  REJECTED: { label: "Refusée", className: "bg-red-100 text-red-800 border-red-200" },
};

export function AdminLoyalty({ refreshKey }: { refreshKey?: number }) {
  const [section, setSection] = useState("stats");

  return (
    <div className="space-y-4">
      <NzokoSubTabs
        tabs={SUB_TABS}
        active={section}
        onChange={setSection}
        ariaLabel="Sous-sections clients & fidélité"
      />
      {section === "stats" && <LoyaltyStats refreshKey={refreshKey} />}
      {section === "clients" && <LoyaltyClients refreshKey={refreshKey} />}
      {section === "rewards" && <LoyaltyRewards refreshKey={refreshKey} />}
    </div>
  );
}

// ============================================================
// 1. Statistiques
// ============================================================

function LoyaltyStats({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.clientAdmin.stats(), { refreshKey });

  if (loading) return <NzokoKpiSkeletons count={6} />;
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const ratingValue =
    data.averageRating === null ? "—" : `${data.averageRating.toFixed(1).replace(".", ",")} / 5`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <NzokoKpiCard label="Total clients" value={String(data.totalClients)} icon={Users} tone="neutral" />
        <NzokoKpiCard label="Clients actifs" value={String(data.activeClients)} icon={UserCheck} tone="green" />
        <NzokoKpiCard label="Clients inactifs" value={String(data.inactiveClients)} icon={UserX} tone="amber" />
        <NzokoKpiCard label="Points en circulation" value={formatPoints(data.pointsOutstanding)} icon={Star} tone="orange" />
        <NzokoKpiCard
          label="Moyenne évaluations"
          value={ratingValue}
          icon={Percent}
          tone="green"
          hint={data.ratingCount > 0 ? `${data.ratingCount} évaluation${data.ratingCount > 1 ? "s" : ""}` : "Aucune évaluation"}
        />
        <NzokoKpiCard label="Réclamations ouvertes" value={String(data.openComplaints)} icon={MessageSquare} tone="amber" />
      </div>

      {/* Répartition paliers */}
      <section aria-label="Répartition par palier">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Paliers fidélité</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {LOYALTY.tiers.map((tier) => {
            const def = tierDef(tier.key);
            const count = data.tierCounts[tier.key] ?? 0;
            return (
              <Card key={tier.key}>
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="text-3xl leading-none" aria-hidden="true">{def.icon}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{def.label}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-bold tabular-nums text-foreground">{count}</span> client{count > 1 ? "s" : ""}
                      {" · "}
                      {formatPoints(def.min)}+ pts
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Top routes notées */}
      <section aria-label="Trajets les mieux notés">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Évaluations par trajet</h2>
        {data.ratingsByRoute.length === 0 ? (
          <NzokoEmptyState
            icon={Star}
            title="Aucune évaluation pour le moment"
            description="Les évaluations post-voyage des clients apparaîtront ici."
          />
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {data.ratingsByRoute.map((r) => (
                <div key={r.routeId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="min-w-0 truncate text-sm font-medium">{r.routeLabel}</p>
                  <p className="flex shrink-0 items-center gap-1.5 text-sm">
                    <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
                    <span className="font-bold tabular-nums">{r.average.toFixed(1).replace(".", ",")}</span>
                    <span className="text-xs text-muted-foreground">/ 5 · {r.count} avis</span>
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

// ============================================================
// 2. Clients
// ============================================================

function LoyaltyClients({ refreshKey }: { refreshKey?: number }) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 400);
  const { data, loading, error, reload } = useApiData(
    () => api.clientAdmin.clients(debouncedQ.trim() || undefined),
    { refreshKey, refetchKey: [debouncedQ] },
  );

  const clients = data ?? [];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 pl-9"
          placeholder="Rechercher un client (nom, téléphone, e-mail…)"
          aria-label="Rechercher un client"
        />
      </div>

      {loading ? (
        <NzokoListSkeleton count={5} />
      ) : error ? (
        <NzokoErrorBox error={error} onRetry={reload} />
      ) : clients.length === 0 ? (
        <NzokoEmptyState
          icon={Users}
          title="Aucun client trouvé"
          description={debouncedQ.trim() ? "Aucun client ne correspond à cette recherche." : "Aucun compte client n'a encore été créé."}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {clients.map((c) => (
            <ClientCard key={c.id} client={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClientCard({ client }: { client: AdminClientDTO }) {
  const tier = tierDef(client.tier);
  const inactive = client.inactiveDays !== null && client.inactiveDays >= INACTIVE_CLIENT_DAYS;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{client.fullName}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{formatPhone(client.phone)}</p>
            <p className="truncate text-xs text-muted-foreground">{client.email}</p>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1">
            <span aria-hidden="true">{tier.icon}</span> {LOYALTY_TIER_LABELS[client.tier as LoyaltyTier]}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-center">
          <div>
            <p className="text-sm font-bold tabular-nums">{client.tripsCompleted}</p>
            <p className="text-[10px] text-muted-foreground">voyages</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">{formatMoney(client.totalSpent)}</p>
            <p className="text-[10px] text-muted-foreground">dépensés</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums text-primary">{formatPoints(client.pointsBalance)}</p>
            <p className="text-[10px] text-muted-foreground">points</p>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Dernier voyage :{" "}
            <span className="font-semibold text-foreground">
              {client.lastTripAt ? formatDate(client.lastTripAt) : "jamais"}
            </span>
          </span>
          {inactive && (
            <Badge variant="outline" className="border-amber-200 bg-amber-100 text-[10px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              Inactif · {client.inactiveDays} j sans voyager
            </Badge>
          )}
          {client.lastTripAt === null && (
            <Badge variant="outline" className="text-[10px] font-semibold text-muted-foreground">
              N&apos;a jamais voyagé
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 3. Récompenses & campagnes
// ============================================================

function LoyaltyRewards({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.clientAdmin.redemptions(), {
    refreshKey,
    autoRefreshMs: 60_000,
  });

  const [deciding, setDeciding] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RedemptionRequestDTO | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const approve = async (r: RedemptionRequestDTO) => {
    setDeciding(r.id);
    try {
      const updated = await api.clientAdmin.decideRedemption(r.id, "APPROVED");
      toast.success("Demande validée ✅", {
        description: updated.promoCode ? `Code promo généré : ${updated.promoCode}` : "La récompense est validée.",
      });
      reload();
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setDeciding(null);
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    setDeciding(rejectTarget.id);
    try {
      await api.clientAdmin.decideRedemption(rejectTarget.id, "REJECTED", rejectNote.trim() || undefined);
      toast.success("Demande refusée — le client est notifié.");
      setRejectTarget(null);
      setRejectNote("");
      reload();
    } catch (err) {
      toast.error(friendlyApiError(err).message);
    } finally {
      setDeciding(null);
    }
  };

  const redemptions = [...(data ?? [])].sort((a, b) => {
    const order = { PENDING: 0, APPROVED: 1, REJECTED: 2 } as const;
    const diff = order[a.status] - order[b.status];
    return diff !== 0 ? diff : b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <div className="space-y-6">
      {/* Demandes de rachat */}
      <section aria-label="Demandes de rachat de points">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Demandes de rachat
        </h2>
        {loading ? (
          <NzokoListSkeleton count={3} />
        ) : error ? (
          <NzokoErrorBox error={error} onRetry={reload} />
        ) : redemptions.length === 0 ? (
          <NzokoEmptyState
            icon={Star}
            title="Aucune demande de rachat"
            description="Les demandes d'échange de points des clients apparaîtront ici."
          />
        ) : (
          <div className="space-y-2">
            {redemptions.map((r) => {
              const meta = REDEMPTION_STATUS[r.status];
              return (
                <Card key={r.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {r.rewardLabel}{" "}
                        <span className="text-xs font-medium tabular-nums text-muted-foreground">
                          · {formatPoints(r.pointsSpent)} points
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Demandée le {formatDateTime(r.createdAt)}
                        {r.decidedAt ? ` · décision le ${formatDateTime(r.decidedAt)}` : ""}
                        {r.note ? ` · note : ${r.note}` : ""}
                      </p>
                      {r.promoCode && (
                        <p className="mt-1.5 flex items-center gap-1.5">
                          <span className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs font-bold tracking-wider">
                            {r.promoCode}
                          </span>
                          <NzokoCopyButton value={r.promoCode} label="Copier" size="sm" className="h-8" />
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("font-medium", meta.className)}>
                        {meta.label}
                      </Badge>
                      {r.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            className="h-9 gap-1.5"
                            disabled={deciding !== null}
                            onClick={() => approve(r)}
                          >
                            {deciding === r.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                            Valider
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 gap-1.5"
                            disabled={deciding !== null}
                            onClick={() => {
                              setRejectTarget(r);
                              setRejectNote("");
                            }}
                          >
                            <X className="size-3.5" aria-hidden /> Refuser
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Campagne de réactivation */}
      <CampaignCard />

      {/* Dialog refus */}
      <Dialog open={rejectTarget !== null} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ThumbsDown className="size-5 text-red-600" aria-hidden /> Refuser la demande
            </DialogTitle>
            <DialogDescription>
              {rejectTarget
                ? `${rejectTarget.rewardLabel} · ${formatPoints(rejectTarget.pointsSpent)} points`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reject-note" className="mb-1.5">
              Motif communiqué au client <span className="font-normal text-muted-foreground">(optionnel)</span>
            </Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value.slice(0, 300))}
              rows={3}
              maxLength={300}
              placeholder="Ex : solde de points insuffisant au moment du traitement."
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button variant="destructive" onClick={reject} disabled={deciding !== null} className="h-11 w-full gap-1.5">
              {deciding !== null ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ThumbsDown className="size-4" aria-hidden />}
              {deciding !== null ? "Refus en cours…" : "Confirmer le refus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CampaignCard() {
  const [segment, setSegment] = useState<CampaignInput["segment"]>("INACTIVE");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const send = async () => {
    setFormError(null);
    if (title.trim().length < 3) {
      setFormError("Le titre est requis (3 caractères minimum).");
      return;
    }
    if (message.trim().length < 10) {
      setFormError("Le message est requis (10 caractères minimum).");
      return;
    }
    setSending(true);
    try {
      const result = await api.clientAdmin.campaign({
        segment,
        title: title.trim(),
        message: message.trim(),
      });
      toast.success(`${result.notified} client${result.notified > 1 ? "s" : ""} notifié${result.notified > 1 ? "s" : ""} 📣`);
      setTitle("");
      setMessage("");
    } catch (err) {
      const msg = friendlyApiError(err).message;
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Megaphone className="size-4 text-primary" aria-hidden /> Campagne de réactivation
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Envoyez une notification à un segment de clients fidèles ou inactifs.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="mb-1.5">Segment ciblé</Label>
          <Select value={segment} onValueChange={(v) => setSegment(v as CampaignInput["segment"])}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEGMENTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="campaign-title" className="mb-1.5">Titre</Label>
          <Input
            id="campaign-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 90))}
            maxLength={90}
            className="h-11"
            placeholder="Ex : On vous a manqué ? −10 % ce week-end"
          />
          <p className="mt-1 text-right text-[11px] text-muted-foreground">{title.length}/90</p>
        </div>

        <div>
          <Label htmlFor="campaign-message" className="mb-1.5">Message</Label>
          <Textarea
            id="campaign-message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 300))}
            rows={4}
            maxLength={300}
            placeholder="Ex : Revenez voyager avec Océan du Nord : vos 100 points vous attendent…"
          />
          <p className="mt-1 text-right text-[11px] text-muted-foreground">{message.length}/300</p>
        </div>

        {formError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {formError}
          </p>
        )}

        <Button onClick={send} disabled={sending} className="h-11 w-full gap-1.5">
          {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ThumbsUp className="size-4" aria-hidden />}
          {sending ? "Envoi…" : "Envoyer la campagne"}
        </Button>
      </CardContent>
    </Card>
  );
}
