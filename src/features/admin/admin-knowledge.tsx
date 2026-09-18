"use client";

// ============================================================
// NZOKO TRANSPORT — Base IA : FAQ de l'assistant (CRUD)
// V3 — base de connaissances officielle : le LLM ne répond
// JAMAIS hors base. La FAQ directe est servie telle quelle.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { BookOpenCheck, Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { apiErrorMessage, useApiData, useDebounced } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { KNOWLEDGE_CATEGORIES } from "@/types";
import type { KnowledgeBaseDTO, KnowledgeCategory } from "@/types";

/** Libellés FR des 14 catégories (partagé avec le journal IA). */
export const KB_CATEGORY_LABELS: Record<string, string> = {
  HORAIRES: "Horaires",
  TARIFS: "Tarifs",
  AGENCES: "Agences",
  RESERVATION: "Réservation",
  PAIEMENT: "Paiement",
  BAGAGES: "Bagages",
  EMBARQUEMENT: "Embarquement",
  ANNULATION: "Annulation",
  REMBOURSEMENT: "Remboursement",
  CONTACT: "Contact",
  SERVICES: "Services",
  GPS: "GPS",
  FIDELITE: "Fidélité",
  RECLAMATIONS: "Réclamations",
};

/** Tons pastel par catégorie (jamais indigo/bleu) — partagés avec le journal IA. */
export const KB_CATEGORY_TONES: Record<string, string> = {
  HORAIRES: "border-amber-300 bg-amber-100 text-amber-800",
  TARIFS: "border-emerald-300 bg-emerald-100 text-emerald-800",
  AGENCES: "border-violet-300 bg-violet-100 text-violet-800",
  RESERVATION: "border-teal-300 bg-teal-100 text-teal-800",
  PAIEMENT: "border-orange-300 bg-orange-100 text-orange-800",
  BAGAGES: "border-stone-300 bg-stone-100 text-stone-700",
  EMBARQUEMENT: "border-rose-300 bg-rose-100 text-rose-800",
  ANNULATION: "border-red-300 bg-red-100 text-red-800",
  REMBOURSEMENT: "border-lime-400 bg-lime-100 text-lime-800",
  CONTACT: "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800",
  SERVICES: "border-green-300 bg-green-100 text-green-800",
  GPS: "border-zinc-300 bg-zinc-100 text-zinc-600",
  FIDELITE: "border-yellow-400 bg-yellow-100 text-yellow-800",
  RECLAMATIONS: "border-orange-400 bg-orange-100 text-orange-900",
} satisfies Record<KnowledgeCategory, string>;

export function AdminKnowledge({ refreshKey }: { refreshKey?: number }) {
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounced(rawQuery);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");

  const { data, loading, error, reload } = useApiData(
    () =>
      api.adminV3.knowledgeBase({
        q: query.trim() || undefined,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        active: activeFilter === "all" ? undefined : activeFilter,
      }),
    { refetchKey: [query, categoryFilter, activeFilter], refreshKey },
  );
  const { data: cities } = useApiData(() => api.admin.cities(), { refreshKey });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBaseDTO | null>(null);
  const [toDelete, setToDelete] = useState<KnowledgeBaseDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = data ?? [];

  const toggleActive = async (k: KnowledgeBaseDTO, isActive: boolean) => {
    setBusyId(k.id);
    try {
      await api.adminV3.updateKnowledge(k.id, { isActive });
      toast.success(`FAQ « ${k.title} » ${isActive ? "activée" : "désactivée"}.`);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.adminV3.deleteKnowledge(toDelete.id);
      toast.success(`FAQ « ${toDelete.title} » supprimée.`);
      setToDelete(null);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder="Rechercher une FAQ…"
              className="h-11 pl-9"
              aria-label="Rechercher dans la base de connaissances"
            />
          </div>
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
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="h-11 w-full sm:w-36" aria-label="Filtrer par statut">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous statuts</SelectItem>
              <SelectItem value="true">Actives</SelectItem>
              <SelectItem value="false">Inactives</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label="À propos de la base de connaissances"
              >
                <Info className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-64">
              Ces réponses sont utilisées par l’assistant IA — modifiez-les avec soin. La FAQ
              directe est servie telle quelle.
            </TooltipContent>
          </Tooltip>
          <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle FAQ
          </Button>
        </div>
      </div>

      {!loading && !error && items.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          {items.length} FAQ {items.length > 1 ? "affichées" : "affichée"}
        </p>
      )}

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <NzokoEmptyState
            icon={BookOpenCheck}
            title="Aucune FAQ"
            description="Créez les réponses officielles servies par l'assistant IA."
            action={
              <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle FAQ
              </Button>
            }
          />
        )}
        {!loading && !error && items.length > 0 && (
          <>
            <div className="grid gap-2 md:hidden">
              {items.map((k) => (
                <Card key={k.id} className="gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{k.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{k.question}</p>
                    </div>
                    <Badge variant="outline" className={KB_CATEGORY_TONES[k.category] ?? ""}>
                      {KB_CATEGORY_LABELS[k.category] ?? k.category}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Priorité {k.priority} · v{k.version} ·{" "}
                    {k.agencyName ?? k.cityName ?? "Toutes villes"} · MAJ {formatDate(k.updatedAt)}
                    {k.updatedByName ? ` par ${k.updatedByName}` : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5"
                      onClick={() => setEditing(k)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Modifier
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 text-red-600 hover:text-red-700"
                      onClick={() => setToDelete(k)}
                      aria-label={`Supprimer la FAQ ${k.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Supprimer
                    </Button>
                    <Switch
                      checked={k.isActive}
                      disabled={busyId === k.id}
                      onCheckedChange={(v) => void toggleActive(k, v)}
                      aria-label={`Activer la FAQ ${k.title}`}
                    />
                  </div>
                </Card>
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <div className="nzoko-scroll max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>FAQ</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead className="hidden lg:table-cell">Portée</TableHead>
                      <TableHead className="text-right">Priorité</TableHead>
                      <TableHead className="hidden xl:table-cell">Version</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="hidden lg:table-cell">MAJ</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="max-w-80">
                          <p className="truncate text-sm font-semibold">{k.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{k.question}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={KB_CATEGORY_TONES[k.category] ?? ""}>
                            {KB_CATEGORY_LABELS[k.category] ?? k.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                          {k.agencyName ?? k.cityName ?? "Toutes villes"}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{k.priority}</TableCell>
                        <TableCell className="hidden text-xs tabular-nums text-muted-foreground xl:table-cell">
                          v{k.version}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={k.isActive}
                            disabled={busyId === k.id}
                            onCheckedChange={(v) => void toggleActive(k, v)}
                            aria-label={`Activer la FAQ ${k.title}`}
                          />
                        </TableCell>
                        <TableCell className="hidden text-xs lg:table-cell">
                          <p className="truncate">{k.updatedByName ?? "—"}</p>
                          <p className="text-[11px] text-muted-foreground">{formatDate(k.updatedAt)}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9"
                              onClick={() => setEditing(k)}
                              aria-label={`Modifier la FAQ ${k.title}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-9 text-red-600 hover:text-red-700"
                              onClick={() => setToDelete(k)}
                              aria-label={`Supprimer la FAQ ${k.title}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </>
        )}
      </div>

      {(formOpen || editing) && (
        <KnowledgeForm
          cities={cities ?? []}
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={reload}
        />
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette FAQ ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `« ${toDelete.title} » sera définitivement supprimée de la base de connaissances de l'assistant IA.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Retour</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================
// Formulaire création / édition
// ============================================================

interface KnowledgeFormValues {
  title: string;
  question: string;
  answer: string;
  category: string;
  keywords: string;
  cityId: string;
  priority: string;
  isActive: boolean;
}

function KnowledgeForm({
  cities,
  initial,
  onClose,
  onSaved,
}: {
  cities: { id: string; name: string }[];
  initial: KnowledgeBaseDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<KnowledgeFormValues>({
    title: initial?.title ?? "",
    question: initial?.question ?? "",
    answer: initial?.answer ?? "",
    category: initial?.category ?? "HORAIRES",
    keywords: initial?.keywords ?? "",
    cityId: initial?.cityId ?? "",
    priority: initial ? String(initial.priority) : "0",
    isActive: initial?.isActive ?? true,
  });
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof KnowledgeFormValues>(key: K, value: KnowledgeFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const submit = async () => {
    const title = values.title.trim();
    const question = values.question.trim();
    const answer = values.answer.trim();
    if (title.length < 3 || title.length > 120) {
      toast.error("Le titre doit contenir entre 3 et 120 caractères.");
      return;
    }
    if (question.length < 5 || question.length > 300) {
      toast.error("La question doit contenir entre 5 et 300 caractères.");
      return;
    }
    if (answer.length < 10 || answer.length > 2000) {
      toast.error("La réponse doit contenir entre 10 et 2 000 caractères.");
      return;
    }
    const priority = Number(values.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
      toast.error("La priorité doit être un entier entre 0 et 1000.");
      return;
    }

    setSubmitting(true);
    try {
      if (initial) {
        await api.adminV3.updateKnowledge(initial.id, {
          title,
          question,
          answer,
          category: values.category,
          keywords: values.keywords.trim(),
          cityId: values.cityId || null,
          priority,
          isActive: values.isActive,
        });
        toast.success(`FAQ « ${title} » mise à jour (version +1).`);
      } else {
        await api.adminV3.createKnowledge({
          title,
          question,
          answer,
          category: values.category,
          keywords: values.keywords.trim(),
          cityId: values.cityId || null,
          priority,
        });
        toast.success(`FAQ « ${title} » créée.`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="nzoko-scroll max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Modifier la FAQ" : "Nouvelle FAQ"}</DialogTitle>
          <DialogDescription>
            Ces réponses sont utilisées par l’assistant IA — modifiez-les avec soin. La FAQ directe
            est servie telle quelle.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="kb-title">Titre</Label>
            <Input
              id="kb-title"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Ex. Horaires d'ouverture des agences"
              className="h-11"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-question">Question</Label>
            <Input
              id="kb-question"
              value={values.question}
              onChange={(e) => set("question", e.target.value)}
              placeholder="Ex. À quelle heure ouvre l'agence de Tié-Tié ?"
              className="h-11"
              maxLength={300}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-answer">Réponse</Label>
            <Textarea
              id="kb-answer"
              value={values.answer}
              onChange={(e) => set("answer", e.target.value)}
              placeholder="Réponse officielle servie par l'assistant IA."
              rows={6}
              maxLength={2000}
              required
            />
            <p className="text-[11px] text-muted-foreground">
              {values.answer.trim().length}/2 000 caractères.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kb-category">Catégorie</Label>
              <Select value={values.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger id="kb-category" className="h-11" aria-label="Catégorie de la FAQ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KNOWLEDGE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {KB_CATEGORY_LABELS[c] ?? c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-city">Ville (optionnel)</Label>
              <Select value={values.cityId || "all"} onValueChange={(v) => set("cityId", v === "all" ? "" : v)}>
                <SelectTrigger id="kb-city" className="h-11" aria-label="Portée ville de la FAQ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les villes</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-keywords">Mots-clés (optionnel)</Label>
            <Input
              id="kb-keywords"
              value={values.keywords}
              onChange={(e) => set("keywords", e.target.value)}
              placeholder="Ex. heure, ouverture, agence, matin"
              className="h-11"
              maxLength={500}
            />
            <p className="text-[11px] text-muted-foreground">
              Séparés par des virgules — améliorent la détection des questions.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-priority">Priorité</Label>
            <Input
              id="kb-priority"
              type="number"
              min={0}
              max={1000}
              step={10}
              inputMode="numeric"
              value={values.priority}
              onChange={(e) => set("priority", e.target.value)}
              className="h-11"
              required
            />
            <p className="text-[11px] text-muted-foreground">
              De 0 à 1000 — les priorités hautes remontent en premier dans l’assistant.
            </p>
          </div>
          {initial && (
            <div className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <p className="text-sm font-medium">FAQ active</p>
                <p className="text-[11px] text-muted-foreground">
                  Une FAQ inactive n’est plus servie par l’assistant IA.
                </p>
              </div>
              <Switch
                checked={values.isActive}
                onCheckedChange={(v) => set("isActive", v)}
                aria-label="Activer la FAQ"
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting
                ? "Enregistrement…"
                : initial
                  ? "Enregistrer"
                  : "Créer la FAQ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
