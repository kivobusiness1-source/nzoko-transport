"use client";

// ============================================================
// OCÉAN DU NORD — Parc : configurations de sièges
// Mini-visualisation + création (rows/columns/couloir/VIP)
// ============================================================

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Armchair, LayoutGrid, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import type { SeatLayoutDTO } from "@/types";
import { cn } from "@/lib/utils";

export function AdminFleetLayouts({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.admin.seatLayouts(), { refreshKey });
  const [formOpen, setFormOpen] = useState(false);

  const layouts = data ?? [];

  return (
    <div>
      <div className="flex justify-end">
        <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Nouvelle configuration
        </Button>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={3} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && layouts.length === 0 && (
          <NzokoEmptyState
            icon={LayoutGrid}
            title="Aucune configuration"
            description="Créez une configuration pour générer les sièges des bus."
          />
        )}
        {!loading && !error && layouts.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {layouts.map((l) => (
              <Card key={l.id} className="gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">{l.name}</p>
                  <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    <Armchair className="h-3 w-3" aria-hidden="true" />
                    {l.seatCount ?? l.rows * l.columns} places
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs text-muted-foreground">
                    <p>
                      {l.rows} rangées × {l.columns} colonnes
                    </p>
                    <p>Couloir après {l.aisleAfter} colonne{l.aisleAfter > 1 ? "s" : ""}</p>
                    {l.description && <p className="mt-1 italic">{l.description}</p>}
                  </div>
                  <LayoutPreview rows={l.rows} columns={l.columns} aisleAfter={l.aisleAfter} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {formOpen && <AdminLayoutForm onClose={() => setFormOpen(false)} onCreated={reload} />}
    </div>
  );
}

function LayoutPreview({ rows, columns, aisleAfter }: { rows: number; columns: number; aisleAfter: number }) {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-1">
          {Array.from({ length: columns }).map((_, c) => (
            <Fragment key={c}>
              <span className="h-2.5 w-2.5 rounded-[3px] bg-primary/55" />
              {c + 1 === aisleAfter && <span className="w-1.5" />}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}

function AdminLayoutForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState("10");
  const [columns, setColumns] = useState("4");
  const [aisleAfter, setAisleAfter] = useState("2");
  const [vipRows, setVipRows] = useState<number[]>([]);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const rowsCount = Math.max(1, Math.min(30, Number(rows) || 1));

  const toggleVipRow = (row: number) => {
    setVipRows((prev) => (prev.includes(row) ? prev.filter((r) => r !== row) : [...prev, row]));
  };

  const submit = async () => {
    if (name.trim().length < 3) {
      toast.error("Donnez un nom à la configuration (3 caractères minimum).");
      return;
    }
    const rowsValue = Number(rows);
    const columnsValue = Number(columns);
    const aisleValue = Number(aisleAfter);
    if (
      !Number.isFinite(rowsValue) || rowsValue < 1 || rowsValue > 30 ||
      !Number.isFinite(columnsValue) || columnsValue < 1 || columnsValue > 8 ||
      !Number.isFinite(aisleValue) || aisleValue < 0 || aisleValue >= columnsValue
    ) {
      toast.error("Vérifiez les dimensions (1-30 rangées, 1-8 colonnes, couloir avant la dernière colonne).");
      return;
    }
    setSubmitting(true);
    try {
      const layout: SeatLayoutDTO = await api.admin.createSeatLayout({
        name: name.trim(),
        rows: rowsValue,
        columns: columnsValue,
        aisleAfter: aisleValue,
        vipRows: [...vipRows].sort((a, b) => a - b),
        description: description.trim() || undefined,
      });
      toast.success(`Configuration « ${layout.name} » créée.`);
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
          <DialogTitle>Nouvelle configuration de sièges</DialogTitle>
          <DialogDescription>
            Les sièges sont générés automatiquement (rangées numérotées, colonnes A, B, C…).
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
            <Label htmlFor="layout-name">Nom</Label>
            <Input
              id="layout-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Standard 2+2 (40 places)"
              className="h-11"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="layout-rows">Rangées</Label>
              <Input
                id="layout-rows"
                type="number"
                min={1}
                max={30}
                value={rows}
                onChange={(e) => setRows(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="layout-columns">Colonnes</Label>
              <Input
                id="layout-columns"
                type="number"
                min={1}
                max={8}
                value={columns}
                onChange={(e) => setColumns(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="layout-aisle">Couloir après</Label>
              <Input
                id="layout-aisle"
                type="number"
                min={0}
                max={7}
                value={aisleAfter}
                onChange={(e) => setAisleAfter(e.target.value)}
                className="h-11"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Rangées VIP (orange)</Label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: rowsCount }).map((_, i) => {
                const row = i + 1;
                const isVip = vipRows.includes(row);
                return (
                  <button
                    key={row}
                    type="button"
                    onClick={() => toggleVipRow(row)}
                    aria-pressed={isVip}
                    aria-label={`Rangée ${row} VIP`}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-semibold transition-colors",
                      isVip
                        ? "border-orange-300 bg-orange-100 text-orange-700"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {row}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="layout-desc">Description (optionnel)</Label>
            <Textarea
              id="layout-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Créer la configuration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
