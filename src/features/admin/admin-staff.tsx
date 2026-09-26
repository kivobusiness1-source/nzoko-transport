"use client";

// ============================================================
// OCÉAN DU NORD — Personnel : chauffeurs
// Liste + création + changement de statut
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { IdCard, Phone, Plus, Users } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { DRIVER_STATUSES, DRIVER_STATUS_LABELS } from "@/lib/constants";
import type { DriverStatus } from "@/lib/constants";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import type { AgencyDTO, DriverDTO } from "@/types";

const DRIVER_STATUS_COLORS: Record<DriverStatus, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  ON_TRIP: "bg-orange-100 text-orange-800 border-orange-200",
  OFF_DUTY: "bg-zinc-200 text-zinc-600 border-zinc-300",
};

export function AdminStaff({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.admin.drivers(), { refreshKey });
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const drivers = data ?? [];

  const updateStatus = async (driver: DriverDTO, status: DriverStatus) => {
    setBusyId(driver.id);
    try {
      await api.admin.updateDriver(driver.id, { status });
      toast.success(`${driver.fullName} : ${DRIVER_STATUS_LABELS[status]}.`);
      reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-end">
        <Button className="h-11 gap-2" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Nouveau chauffeur
        </Button>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && drivers.length === 0 && (
          <NzokoEmptyState icon={Users} title="Aucun chauffeur" description="Recrutez le premier chauffeur." />
        )}
        {!loading && !error && drivers.length > 0 && (
          <>
            <div className="grid gap-3 md:hidden">
              {drivers.map((d) => (
                <Card key={d.id} className="gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold">{d.fullName}</p>
                    <Badge variant="outline" className={DRIVER_STATUS_COLORS[d.status]}>
                      {DRIVER_STATUS_LABELS[d.status]}
                    </Badge>
                  </div>
                  {d.phone && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {d.phone}
                    </p>
                  )}
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IdCard className="h-3.5 w-3.5" aria-hidden="true" /> Permis {d.licenseNumber}
                  </p>
                  <p className="text-xs text-muted-foreground">{d.agencyName ?? d.agencyId}</p>
                  <Select
                    value={d.status}
                    onValueChange={(v) => void updateStatus(d, v as DriverStatus)}
                    disabled={busyId === d.id}
                  >
                    <SelectTrigger
                      className="h-10 text-xs"
                      aria-label={`Changer le statut de ${d.fullName}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DRIVER_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {DRIVER_STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Card>
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chauffeur</TableHead>
                    <TableHead>Téléphone</TableHead>
                    <TableHead>Permis</TableHead>
                    <TableHead>Agence</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drivers.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm font-medium">{d.fullName}</TableCell>
                      <TableCell className="text-xs">{d.phone ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[11px]">{d.licenseNumber}</TableCell>
                      <TableCell className="text-xs">{d.agencyName ?? d.agencyId}</TableCell>
                      <TableCell>
                        <Select
                          value={d.status}
                          onValueChange={(v) => void updateStatus(d, v as DriverStatus)}
                          disabled={busyId === d.id}
                        >
                          <SelectTrigger
                            className="h-9 w-40 text-xs"
                            aria-label={`Statut de ${d.fullName}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DRIVER_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {DRIVER_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </div>

      {formOpen && <AdminDriverForm onClose={() => setFormOpen(false)} onCreated={reload} />}
    </div>
  );
}

function AdminDriverForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: agencies } = useApiData(() => api.admin.agencies(), {});

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [agencyId, setAgencyId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      toast.error("Renseignez le prénom et le nom du chauffeur.");
      return;
    }
    if (licenseNumber.trim().length < 3) {
      toast.error("Renseignez le numéro de permis.");
      return;
    }
    if (!agencyId) {
      toast.error("Sélectionnez l'agence de rattachement.");
      return;
    }
    setSubmitting(true);
    try {
      await api.admin.createDriver({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        licenseNumber: licenseNumber.trim().toUpperCase(),
        agencyId,
      });
      toast.success(`Chauffeur ${firstName.trim()} ${lastName.trim()} enregistré.`);
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
          <DialogTitle>Nouveau chauffeur</DialogTitle>
          <DialogDescription>
            Un compte utilisateur pourra être associé au chauffeur ultérieurement.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="driver-first">Prénom</Label>
              <Input
                id="driver-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-last">Nom</Label>
              <Input
                id="driver-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-11"
                required
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="driver-phone">Téléphone (optionnel)</Label>
              <Input
                id="driver-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+242 06 000 0000"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="driver-license">N° de permis</Label>
              <Input
                id="driver-license"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="PC-2019-4521"
                className="h-11"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="driver-agency">Agence</Label>
            <Select value={agencyId} onValueChange={setAgencyId}>
              <SelectTrigger id="driver-agency" className="h-11" aria-label="Agence du chauffeur">
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
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" className="h-11" disabled={submitting}>
              {submitting ? "Création…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
