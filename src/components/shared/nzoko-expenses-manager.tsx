"use client";

// ============================================================
// OCÉAN DU NORD — Gestion des dépenses (agence & finance)
// Liste + création + suppression (permission expense:manage)
// ============================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Fuel,
  Hammer,
  Package,
  Receipt,
  Users,
  Wrench,
} from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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
import { api } from "@/lib/api-client";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import type { ExpenseCategory } from "@/lib/constants";
import { formatDate, formatMoney } from "@/lib/format";
import { todayCongoISO } from "@/components/shared/nzoko-format";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import type { AgencyDTO, ExpenseDTO } from "@/types";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
  FUEL: Fuel,
  MAINTENANCE: Wrench,
  SALARY: Users,
  REPAIR: Hammer,
  SUPPLIES: Package,
  OTHER: Receipt,
};

const CATEGORY_TONES: Record<ExpenseCategory, string> = {
  FUEL: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  MAINTENANCE: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  SALARY: "bg-primary/10 text-primary",
  REPAIR: "bg-red-500/15 text-red-600 dark:text-red-400",
  SUPPLIES: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  OTHER: "bg-muted text-muted-foreground",
};

export function NzokoExpensesManager({
  defaultAgencyId,
  allowAgencyFilter = false,
  canManage = false,
  refreshKey,
}: {
  defaultAgencyId?: string | null;
  allowAgencyFilter?: boolean;
  canManage?: boolean;
  refreshKey?: number;
}) {
  const [agencyFilter, setAgencyFilter] = useState("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ExpenseDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  const effectiveAgencyId = allowAgencyFilter
    ? agencyFilter === "ALL"
      ? undefined
      : agencyFilter
    : defaultAgencyId ?? undefined;

  const { data: agencies } = useApiData(
    () => (allowAgencyFilter ? api.admin.agencies() : Promise.resolve([] as AgencyDTO[])),
    { refetchKey: [allowAgencyFilter] },
  );

  const { data, loading, error, reload } = useApiData(
    () => api.finance.expenses({ agencyId: effectiveAgencyId }),
    { refetchKey: [effectiveAgencyId], refreshKey },
  );

  const expenses = useMemo(() => data ?? [], [data]);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  const deleteExpense = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.finance.deleteExpense(toDelete.id);
      toast.success("Dépense supprimée.");
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Card className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400" aria-hidden="true">
            <Banknote className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Total des dépenses listées</p>
            <p className="text-lg font-bold tabular-nums">{formatMoney(total)}</p>
          </div>
        </Card>
        <div className="flex flex-wrap items-center gap-3">
          {allowAgencyFilter && (
            <Select value={agencyFilter} onValueChange={setAgencyFilter}>
              <SelectTrigger className="h-11 w-full sm:w-48" aria-label="Filtrer par agence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Toutes agences</SelectItem>
                {(agencies ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canManage && (
            <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle dépense
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && expenses.length === 0 && (
          <NzokoEmptyState
            icon={Wallet}
            title="Aucune dépense"
            description={
              canManage
                ? "Aucune dépense enregistrée pour ces critères. Créez la première."
                : "Aucune dépense enregistrée pour ces critères."
            }
            action={
              canManage ? (
                <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle dépense
                </Button>
              ) : undefined
            }
          />
        )}
        {!loading && !error && expenses.length > 0 && (
          <>
            <div className="grid gap-3 md:hidden">
              {expenses.map((e) => {
                const Icon = CATEGORY_ICONS[e.category];
                return (
                  <Card key={e.id} className="gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                            CATEGORY_TONES[e.category],
                          )}
                          aria-hidden="true"
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {EXPENSE_CATEGORY_LABELS[e.category]}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(e.date)} · {e.agencyName ?? "Siège"}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums">
                        {formatMoney(e.amount)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{e.description}</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[11px] text-muted-foreground">
                        {e.createdByName ?? "—"}
                      </p>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 text-red-600"
                          onClick={() => setToDelete(e)}
                          aria-label={`Supprimer la dépense ${EXPENSE_CATEGORY_LABELS[e.category]} du ${formatDate(e.date)}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Catégorie</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Agence</TableHead>
                    <TableHead>Auteur</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    {canManage && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg",
                              CATEGORY_TONES[e.category],
                            )}
                            aria-hidden="true"
                          >
                            {(() => {
                              const Icon = CATEGORY_ICONS[e.category];
                              return <Icon className="h-3.5 w-3.5" />;
                            })()}
                          </span>
                          <span className="text-sm">{EXPENSE_CATEGORY_LABELS[e.category]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                        {e.description}
                      </TableCell>
                      <TableCell className="text-xs">{e.agencyName ?? "Siège"}</TableCell>
                      <TableCell className="text-xs">{e.createdByName ?? "—"}</TableCell>
                      <TableCell className="text-xs">{formatDate(e.date)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {formatMoney(e.amount)}
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 text-red-600"
                            onClick={() => setToDelete(e)}
                            aria-label={`Supprimer la dépense du ${formatDate(e.date)}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </div>

      {formOpen && (
        <NzokoExpenseForm
          defaultAgencyId={defaultAgencyId ?? null}
          agencies={agencies ?? []}
          showAgencySelect={allowAgencyFilter}
          onClose={() => setFormOpen(false)}
          onCreated={reload}
        />
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette dépense ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `${EXPENSE_CATEGORY_LABELS[toDelete.category]} — ${formatMoney(toDelete.amount)} (${formatDate(toDelete.date)}). La transaction liée sera annulée si elle existe.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Retour</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                void deleteExpense();
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

function NzokoExpenseForm({
  defaultAgencyId,
  agencies,
  showAgencySelect,
  onClose,
  onCreated,
}: {
  defaultAgencyId: string | null;
  agencies: AgencyDTO[];
  showAgencySelect: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>("FUEL");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayCongoISO());
  const [agencyId, setAgencyId] = useState<string>(defaultAgencyId ?? "");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Saisissez un montant valide (supérieur à 0).");
      return;
    }
    if (description.trim().length < 3) {
      toast.error("Ajoutez une description (3 caractères minimum).");
      return;
    }
    setSubmitting(true);
    try {
      await api.finance.createExpense({
        category,
        amount: Math.round(value),
        description: description.trim(),
        date,
        agencyId: agencyId || null,
      });
      toast.success("Dépense enregistrée.");
      onCreated();
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvelle dépense</DialogTitle>
          <DialogDescription>
            Enregistrée dans les transactions de l&apos;agence sélectionnée.
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
            <Label htmlFor="expense-category">Catégorie</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger id="expense-category" className="h-11" aria-label="Catégorie de dépense">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {EXPENSE_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-amount">Montant (FCFA)</Label>
            <Input
              id="expense-amount"
              type="number"
              min={1}
              step={100}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expense-desc">Description</Label>
            <Textarea
              id="expense-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex. Plein de gasoil bus AB-123-CD"
              rows={2}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-11"
                required
              />
            </div>
            {showAgencySelect && (
              <div className="space-y-1.5">
                <Label htmlFor="expense-agency">Agence</Label>
                <Select
                  value={agencyId || "NONE"}
                  onValueChange={(v) => setAgencyId(v === "NONE" ? "" : v)}
                >
                  <SelectTrigger id="expense-agency" className="h-11" aria-label="Agence">
                    <SelectValue placeholder="Siège (aucune)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Siège (aucune)</SelectItem>
                    {agencies.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
