"use client";

// ============================================================
// NZOKO TRANSPORT — Parc : Bus (liste + statut + création)
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Bus as BusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { BUS_STATUSES, BUS_STATUS_COLORS, BUS_STATUS_LABELS } from "@/lib/constants";
import type { BusStatus } from "@/lib/constants";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { AdminBusForm } from "@/features/admin/admin-fleet-bus-form";
import type { BusDTO } from "@/types";

export function AdminFleetBuses({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, reload } = useApiData(() => api.admin.buses(), { refreshKey });
  const [formOpen, setFormOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const buses = data ?? [];

  const updateStatus = async (bus: BusDTO, status: BusStatus) => {
    setBusyId(bus.id);
    try {
      await api.admin.updateBus(bus.id, { status });
      toast.success(`Bus ${bus.registrationNumber} : ${BUS_STATUS_LABELS[status]}.`);
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
          <Plus className="h-4 w-4" aria-hidden="true" /> Nouveau bus
        </Button>
      </div>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && buses.length === 0 && (
          <NzokoEmptyState icon={BusIcon} title="Aucun bus" description="Enregistrez le premier bus du parc." />
        )}
        {!loading && !error && buses.length > 0 && (
          <>
            <div className="grid gap-3 md:hidden">
              {buses.map((b) => (
                <Card key={b.id} className="gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold">{b.registrationNumber}</span>
                    <Badge variant="outline" className={BUS_STATUS_COLORS[b.status]}>
                      {BUS_STATUS_LABELS[b.status]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {b.brand} {b.model}
                    {b.year ? ` · ${b.year}` : ""} · {b.capacity} places
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b.agencyName ?? "—"} · {b.seatLayoutName ?? "layout inconnu"}
                  </p>
                  <Select
                    value={b.status}
                    onValueChange={(v) => void updateStatus(b, v as BusStatus)}
                    disabled={busyId === b.id}
                  >
                    <SelectTrigger
                      className="h-10 text-xs"
                      aria-label={`Changer le statut du bus ${b.registrationNumber}`}
                    >
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
                </Card>
              ))}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Immatriculation</TableHead>
                    <TableHead>Véhicule</TableHead>
                    <TableHead>Capacité</TableHead>
                    <TableHead>Agence</TableHead>
                    <TableHead>Configuration</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buses.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs font-bold">{b.registrationNumber}</TableCell>
                      <TableCell className="text-xs">
                        {b.brand} {b.model}
                        {b.year ? ` · ${b.year}` : ""}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{b.capacity} places</TableCell>
                      <TableCell className="text-xs">{b.agencyName ?? "—"}</TableCell>
                      <TableCell className="text-xs">{b.seatLayoutName ?? "—"}</TableCell>
                      <TableCell>
                        <Select
                          value={b.status}
                          onValueChange={(v) => void updateStatus(b, v as BusStatus)}
                          disabled={busyId === b.id}
                        >
                          <SelectTrigger className="h-9 w-40 text-xs" aria-label={`Statut du bus ${b.registrationNumber}`}>
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </div>

      {formOpen && <AdminBusForm onClose={() => setFormOpen(false)} onCreated={reload} />}
    </div>
  );
}
