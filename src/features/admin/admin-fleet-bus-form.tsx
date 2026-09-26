"use client";

// ============================================================
// OCÉAN DU NORD — Parc : formulaire création bus
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { api } from "@/lib/api-client";
import { BUS_STATUSES, BUS_STATUS_LABELS } from "@/lib/constants";
import type { BusStatus } from "@/lib/constants";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import type { AgencyDTO, SeatLayoutDTO } from "@/types";

export function AdminBusForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: agencies } = useApiData(() => api.admin.agencies(), {});
  const { data: layouts } = useApiData(() => api.admin.seatLayouts(), {});

  const [registrationNumber, setRegistrationNumber] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [status, setStatus] = useState<BusStatus>("ACTIVE");
  const [agencyId, setAgencyId] = useState("");
  const [seatLayoutId, setSeatLayoutId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!registrationNumber.trim() || !brand.trim() || !model.trim()) {
      toast.error("Renseignez l'immatriculation, la marque et le modèle.");
      return;
    }
    if (!agencyId || !seatLayoutId) {
      toast.error("Sélectionnez une agence et une configuration de sièges.");
      return;
    }
    setSubmitting(true);
    try {
      const bus = await api.admin.createBus({
        registrationNumber: registrationNumber.trim().toUpperCase(),
        brand: brand.trim(),
        model: model.trim(),
        year: year ? Number(year) : undefined,
        status,
        agencyId,
        seatLayoutId,
      });
      toast.success(`Bus ${bus.registrationNumber} ajouté (${bus.capacity} places).`);
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
          <DialogTitle>Nouveau bus</DialogTitle>
          <DialogDescription>
            La capacité est déduite de la configuration de sièges choisie.
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
            <Label htmlFor="bus-reg">Immatriculation</Label>
            <Input
              id="bus-reg"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              placeholder="AB-123-CD"
              className="h-11"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="bus-brand">Marque</Label>
              <Input
                id="bus-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Toyota"
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bus-model">Modèle</Label>
              <Input
                id="bus-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Coaster"
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bus-year">Année</Label>
              <Input
                id="bus-year"
                type="number"
                min={1990}
                max={2100}
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bus-agency">Agence</Label>
              <Select value={agencyId} onValueChange={setAgencyId}>
                <SelectTrigger id="bus-agency" className="h-11" aria-label="Agence du bus">
                  <SelectValue placeholder="Choisir" />
                </SelectTrigger>
                <SelectContent>
                  {(agencies ?? []).map((a: AgencyDTO) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bus-layout">Configuration</Label>
              <Select value={seatLayoutId} onValueChange={setSeatLayoutId}>
                <SelectTrigger id="bus-layout" className="h-11" aria-label="Configuration de sièges">
                  <SelectValue placeholder="Choisir" />
                </SelectTrigger>
                <SelectContent>
                  {(layouts ?? []).map((l: SeatLayoutDTO) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} · {l.seatCount ?? `${l.rows * l.columns}`} pl.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bus-status">Statut initial</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as BusStatus)}>
              <SelectTrigger id="bus-status" className="h-11" aria-label="Statut du bus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUS_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {BUS_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Ajouter le bus"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
