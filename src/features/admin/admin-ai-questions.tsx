"use client";

// ============================================================
// NZOKO TRANSPORT — Base IA : journal des questions de
// l'assistant (qualité de service + réponse détail)
// ============================================================

import { useState } from "react";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  Eye,
  MessageSquareQuote,
  Tag,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoKpiCard } from "@/components/shared/nzoko-kpi-card";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { KNOWLEDGE_CATEGORIES } from "@/types";
import type { AIQuestionLogDTO } from "@/types";
import { KB_CATEGORY_LABELS, KB_CATEGORY_TONES } from "@/features/admin/admin-knowledge";

function formatConfidence(confidence: number | null): string {
  if (confidence === null) return "—";
  return `${Math.round(confidence * 100)} %`;
}

function confidenceTone(confidence: number | null): string {
  if (confidence === null) return "text-muted-foreground";
  if (confidence >= 0.8) return "text-emerald-600 dark:text-emerald-400";
  if (confidence >= 0.5) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function categoryLabel(category: string | null): string {
  if (!category) return "Non classée";
  return KB_CATEGORY_LABELS[category] ?? category;
}

export function AdminAIQuestions({ refreshKey }: { refreshKey?: number }) {
  const [resolvedFilter, setResolvedFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("30");
  const [selected, setSelected] = useState<AIQuestionLogDTO | null>(null);

  const days = Number(daysFilter);
  const resolvedParam = resolvedFilter === "true" || resolvedFilter === "false" ? resolvedFilter : undefined;

  const { data: stats, loading: statsLoading, error: statsError, reload: statsReload } = useApiData(
    () => api.adminV3.aiQuestionsStats(days),
    { refetchKey: [days], refreshKey },
  );

  const { data, loading, error, reload } = useApiData(
    () =>
      api.adminV3.aiQuestions({
        resolved: resolvedParam,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        days,
        take: 100,
      }),
    { refetchKey: [resolvedFilter, categoryFilter, days], refreshKey },
  );

  const items = data ?? [];
  const hasFilters = resolvedFilter !== "all" || categoryFilter !== "all";
  const resolveRate =
    stats && stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ---------- Statistiques qualité ---------- */}
      {statsError ? (
        <NzokoErrorBox error={statsError} onRetry={statsReload} />
      ) : statsLoading || !stats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-3 p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-5 w-12" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <NzokoKpiCard
            label={`Total (${days} jours)`}
            value={String(stats.total)}
            icon={MessageSquareQuote}
            tone="neutral"
          />
          <NzokoKpiCard
            label="Résolues"
            value={String(stats.resolved)}
            icon={CheckCircle2}
            tone="green"
            hint={`Taux de résolution : ${resolveRate} %`}
          />
          <NzokoKpiCard
            label="Non résolues"
            value={String(stats.unresolved)}
            icon={XCircle}
            tone="red"
            hint="À couvrir par de nouvelles FAQ"
          />
          <NzokoKpiCard
            label="7 derniers jours"
            value={String(stats.last7Days)}
            icon={CalendarClock}
            tone="orange"
            hint="Volume global glissant"
          />
        </div>
      )}

      {/* ---------- Tops (questions fréquentes / catégories) ---------- */}
      {stats && !statsError && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="gap-3 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Questions fréquentes</h3>
            </div>
            {stats.topQuestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune question enregistrée.</p>
            ) : (
              <ol className="nzoko-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {stats.topQuestions.map((t, i) => (
                  <li
                    key={t.question}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 odd:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
                        {i + 1}.
                      </span>
                      <span className="truncate text-xs" title={t.question}>
                        {t.question}
                      </span>
                    </span>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">
                      ×{t.count}
                    </Badge>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="gap-3 p-4">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Catégories les plus sollicitées</h3>
            </div>
            {stats.topCategories.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune catégorie enregistrée.</p>
            ) : (
              <ul className="nzoko-scroll max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {stats.topCategories.map((c) => (
                  <li
                    key={c.category ?? "none"}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 odd:bg-muted/50"
                  >
                    <Badge variant="outline" className={KB_CATEGORY_TONES[c.category ?? ""] ?? ""}>
                      {categoryLabel(c.category)}
                    </Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {c.count} question{c.count > 1 ? "s" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ---------- Filtres ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={resolvedFilter} onValueChange={setResolvedFilter}>
          <SelectTrigger className="h-11 w-full sm:w-44" aria-label="Filtrer par statut de résolution">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="true">Résolues</SelectItem>
            <SelectItem value="false">Non résolues</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-11 w-full sm:w-44" aria-label="Filtrer par catégorie">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {KB_CATEGORY_LABELS[c] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={daysFilter} onValueChange={setDaysFilter}>
          <SelectTrigger className="h-11 w-full sm:w-36" aria-label="Filtrer par période">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 jours</SelectItem>
            <SelectItem value="30">30 jours</SelectItem>
            <SelectItem value="90">90 jours</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ---------- Journal ---------- */}
      {loading && <NzokoListSkeleton count={4} />}
      {error && <NzokoErrorBox error={error} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <NzokoEmptyState
          icon={Bot}
          title="Aucune question enregistrée"
          description={
            hasFilters
              ? "Aucune question ne correspond à ces filtres sur la période."
              : "Les échanges avec l'assistant IA apparaîtront ici dès leur premier usage."
          }
        />
      )}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="grid gap-2 md:hidden">
            {items.map((q) => (
              <Card key={q.id} className="gap-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={
                      q.resolved
                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : "border-red-300 bg-red-100 text-red-800"
                    }
                  >
                    {q.resolved ? "Résolue" : "Non résolue"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(q.createdAt)}</span>
                </div>
                <p className="line-clamp-2 text-sm font-medium">{q.question}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {categoryLabel(q.category)} · Confiance {formatConfidence(q.confidence)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 gap-1.5"
                    onClick={() => setSelected(q)}
                    aria-label={`Voir la réponse à la question ${q.question}`}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Réponse
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden gap-0 p-0 md:block">
            <div className="nzoko-scroll max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Statut</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead className="text-right">Confiance</TableHead>
                    <TableHead className="hidden lg:table-cell">Catégorie</TableHead>
                    <TableHead className="hidden xl:table-cell">Date</TableHead>
                    <TableHead className="w-16 text-right">Détail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            q.resolved
                              ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                              : "border-red-300 bg-red-100 text-red-800"
                          }
                        >
                          {q.resolved ? "Résolue" : "Non résolue"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-96">
                        <button
                          type="button"
                          className="max-w-full truncate text-left text-sm hover:underline focus-visible:underline focus-visible:outline-none"
                          onClick={() => setSelected(q)}
                          title={q.question}
                        >
                          {q.question}
                        </button>
                      </TableCell>
                      <TableCell className={`text-right text-xs tabular-nums ${confidenceTone(q.confidence)}`}>
                        {formatConfidence(q.confidence)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge variant="outline" className={KB_CATEGORY_TONES[q.category ?? ""] ?? ""}>
                          {categoryLabel(q.category)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                        {formatDateTime(q.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9"
                          onClick={() => setSelected(q)}
                          aria-label={`Voir la réponse à la question ${q.question}`}
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <p className="text-xs text-muted-foreground" aria-live="polite">
            {items.length} question{items.length > 1 ? "s" : ""} affichée{items.length > 1 ? "s" : ""}{" "}
            sur {days} jours (100 plus récentes maximum).
          </p>
        </>
      )}

      {/* ---------- Détail question / réponse ---------- */}
      <Dialog open={selected !== null} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="nzoko-scroll max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Échange avec l’assistant</DialogTitle>
            <DialogDescription>
              {selected ? formatDateTime(selected.createdAt) : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    selected.resolved
                      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                      : "border-red-300 bg-red-100 text-red-800"
                  }
                >
                  {selected.resolved ? "Résolue" : "Non résolue"}
                </Badge>
                <Badge variant="outline" className={KB_CATEGORY_TONES[selected.category ?? ""] ?? ""}>
                  {categoryLabel(selected.category)}
                </Badge>
                <span className={`text-xs tabular-nums ${confidenceTone(selected.confidence)}`}>
                  Confiance : {formatConfidence(selected.confidence)}
                </span>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Question
                </p>
                <p className="whitespace-pre-wrap text-sm font-medium">{selected.question}</p>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Réponse de l’assistant
                </p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {selected.answer}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Session <span className="font-mono">{selected.sessionId}</span>
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
