"use client";

// ============================================================
// OCÉAN DU NORD — Panneau de rapports (admin & finance)
// Type + période + totaux + lignes + export CSV
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, Download, FileSpreadsheet, Tickets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { formatMoney } from "@/lib/format";
import {
  addDaysCongoISO,
  firstOfMonthCongoISO,
  todayCongoISO,
} from "@/components/shared/nzoko-format";
import { apiErrorMessage, useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoKpiCard, type NzokoKpiTone } from "@/components/shared/nzoko-kpi-card";
import { NzokoKpiSkeletons, NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import type { ReportDTO } from "@/types";

const REPORT_TYPES: { value: ReportDTO["type"]; label: string }[] = [
  { value: "daily", label: "Journalier" },
  { value: "weekly", label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuel" },
  { value: "agency", label: "Par agence" },
  { value: "bus", label: "Par bus" },
  { value: "route", label: "Par route" },
];

function defaultPeriod(type: string): { from: string; to: string } {
  const today = todayCongoISO();
  switch (type) {
    case "daily":
      return { from: today, to: today };
    case "weekly":
      return { from: addDaysCongoISO(-6), to: today };
    case "monthly":
      return { from: firstOfMonthCongoISO(), to: today };
    default:
      return { from: addDaysCongoISO(-30), to: today };
  }
}

export function NzokoReportPanel({ refreshKey }: { refreshKey?: number }) {
  const [type, setType] = useState<ReportDTO["type"]>("daily");
  const [from, setFrom] = useState(defaultPeriod("daily").from);
  const [to, setTo] = useState(defaultPeriod("daily").to);
  const [exporting, setExporting] = useState(false);

  const { data, loading, error, reload } = useApiData(() => api.reports.get(type, from, to), {
    refetchKey: [type, from, to],
    refreshKey,
  });

  const onTypeChange = (value: string) => {
    const next = value as ReportDTO["type"];
    setType(next);
    const period = defaultPeriod(value);
    setFrom(period.from);
    setTo(period.to);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.reports.downloadCsv(type, from, to);
      toast.success("Export CSV téléchargé.");
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const netTone: NzokoKpiTone = (data?.netResult ?? 0) >= 0 ? "green" : "red";

  return (
    <div className="space-y-4">
      <Card className="gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-type">Type de rapport</Label>
            <Select value={type} onValueChange={onTypeChange}>
              <SelectTrigger id="report-type" className="h-11" aria-label="Type de rapport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-from">Du</Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-to">Au</Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-11"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button className="h-11 gap-2" onClick={() => void exportCsv()} disabled={exporting}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? "Génération…" : "Exporter CSV"}
          </Button>
        </div>
      </Card>

      {loading && (
        <div className="space-y-4">
          <NzokoKpiSkeletons count={4} />
          <NzokoListSkeleton count={3} />
        </div>
      )}
      {error && <NzokoErrorBox error={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Période : {data.period.label} (du {data.period.from} au {data.period.to})
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <NzokoKpiCard
              label="Revenus"
              value={formatMoney(data.totalRevenue)}
              icon={ArrowUpRight}
              tone="green"
            />
            <NzokoKpiCard
              label="Dépenses"
              value={formatMoney(data.totalExpenses)}
              icon={ArrowDownRight}
              tone="orange"
            />
            <NzokoKpiCard
              label="Résultat net"
              value={`${data.netResult < 0 ? "−" : ""}${formatMoney(Math.abs(data.netResult))}`}
              icon={FileSpreadsheet}
              tone={netTone}
            />
            <NzokoKpiCard
              label="Réservations"
              value={String(data.totalBookings)}
              icon={Tickets}
              tone="amber"
            />
          </div>

          {data.rows.length === 0 ? (
            <NzokoEmptyState
              icon={FileSpreadsheet}
              title="Aucune donnée sur cette période"
              description="Modifiez le type de rapport ou la période sélectionnée."
            />
          ) : (
            <>
              <div className="grid gap-2 md:hidden">
                {data.rows.map((r, i) => (
                  <Card key={`${r.label}-${i}`} className="gap-2 p-4">
                    <p className="text-sm font-semibold">{r.label}</p>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <div>
                        <p className="text-muted-foreground">Revenus</p>
                        <p className="font-semibold text-emerald-600">{formatMoney(r.revenue)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Dépenses</p>
                        <p className="font-semibold text-red-600">{formatMoney(r.expenses)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Réserv.</p>
                        <p className="font-semibold">{r.bookings}</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
              <Card className="hidden gap-0 p-0 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{type === "agency" ? "Agence" : type === "bus" ? "Bus" : type === "route" ? "Route" : "Ligne"}</TableHead>
                      <TableHead className="text-right">Réservations</TableHead>
                      <TableHead className="text-right">Revenus</TableHead>
                      <TableHead className="text-right">Dépenses</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r, i) => (
                      <TableRow key={`${r.label}-${i}`}>
                        <TableCell className="text-sm font-medium">{r.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.bookings}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {formatMoney(r.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatMoney(r.expenses)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
