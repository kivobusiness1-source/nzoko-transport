"use client";

// ============================================================
// NZOKO TRANSPORT — Synthèse financière
// Période + KPIs + barres mensuelles + agences + routes + catégories
// ============================================================

import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  Route as RouteIcon,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import type { ExpenseCategory } from "@/lib/constants";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import {
  addDaysCongoISO,
  firstOfMonthCongoISO,
  monthShortLabel,
  todayCongoISO,
} from "@/components/shared/nzoko-format";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoKpiCard, type NzokoKpiTone } from "@/components/shared/nzoko-kpi-card";
import { NzokoChartSkeleton, NzokoKpiSkeletons, NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoGroupedTooltip, NzokoChartEmpty } from "@/components/shared/nzoko-charts";

const PERIODS = [
  { key: "7d", label: "7 derniers jours" },
  { key: "30d", label: "30 derniers jours" },
  { key: "month", label: "Ce mois" },
  { key: "90d", label: "3 derniers mois" },
];

const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--primary)"];

function periodRange(key: string): { from: string; to: string } {
  const today = todayCongoISO();
  switch (key) {
    case "7d":
      return { from: addDaysCongoISO(-7), to: today };
    case "month":
      return { from: firstOfMonthCongoISO(), to: today };
    case "90d":
      return { from: addDaysCongoISO(-90), to: today };
    default:
      return { from: addDaysCongoISO(-30), to: today };
  }
}

export function FinanceSummary({ refreshKey }: { refreshKey?: number }) {
  const [period, setPeriod] = useState("30d");
  const { from, to } = useMemo(() => periodRange(period), [period]);

  const { data, loading, error, reload } = useApiData(() => api.finance.summary(from, to), {
    refetchKey: [from, to],
    autoRefreshMs: 60_000,
    refreshKey,
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <NzokoKpiSkeletons count={3} />
        <Card className="gap-3 p-4">
          <p className="text-sm font-semibold">Revenus vs dépenses par mois</p>
          <NzokoChartSkeleton height={260} />
        </Card>
        <NzokoListSkeleton count={3} />
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const monthly = data.byMonth.map((m) => ({
    label: monthShortLabel(m.month),
    income: m.income,
    expenses: m.expenses,
  }));
  const categories = data.byCategory.map((c) => ({
    label: EXPENSE_CATEGORY_LABELS[c.category as ExpenseCategory] ?? c.category,
    value: c.amount,
  }));
  const netTone: NzokoKpiTone = data.net >= 0 ? "green" : "red";

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-11 w-full sm:w-56" aria-label="Période d'analyse">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NzokoKpiCard
          label="Revenus"
          value={formatMoney(data.income)}
          icon={ArrowUpRight}
          tone="green"
          hint="Encaissements sur la période"
        />
        <NzokoKpiCard
          label="Dépenses"
          value={formatMoney(data.expenses)}
          icon={ArrowDownRight}
          tone="red"
          hint="Sorties d'argent sur la période"
        />
        <NzokoKpiCard
          label="Résultat net"
          value={`${data.net < 0 ? "−" : ""}${formatMoney(Math.abs(data.net))}`}
          icon={data.net >= 0 ? TrendingUp : TrendingDown}
          tone={netTone}
          hint={data.net >= 0 ? "Bénéfice" : "Perte"}
        />
      </div>

      <Card className="gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" />
          Revenus vs dépenses par mois
        </p>
        {monthly.length === 0 ? (
          <NzokoChartEmpty />
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis
                  width={40}
                  tickFormatter={(v: number) => formatMoneyShort(v)}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  content={
                    <NzokoGroupedTooltip
                      formatValue={formatMoney}
                      labels={{ income: "Revenus", expenses: "Dépenses" }}
                    />
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Revenus" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="expenses" name="Dépenses" fill="var(--chart-5)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Répartition par agence">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-4 w-4" aria-hidden="true" /> Par agence
          </h2>
          {data.byAgency.length === 0 ? (
            <NzokoChartEmpty />
          ) : (
            <div className="nzoko-scroll grid max-h-96 gap-3 overflow-y-auto pr-1">
              {data.byAgency.map((a) => (
                <Card key={a.agencyName} className="grid grid-cols-3 gap-2 p-4">
                  <p className="col-span-3 text-sm font-semibold">{a.agencyName}</p>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Revenus</p>
                    <p className="text-sm font-semibold text-emerald-600">{formatMoney(a.income)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Dépenses</p>
                    <p className="text-sm font-semibold text-red-600">{formatMoney(a.expenses)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Net</p>
                    <p className={`text-sm font-semibold ${a.income - a.expenses >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatMoney(a.income - a.expenses)}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Top routes">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <RouteIcon className="h-4 w-4" aria-hidden="true" /> Top 5 routes
          </h2>
          {data.byRoute.length === 0 ? (
            <NzokoChartEmpty />
          ) : (
            <Card className="gap-0 p-0">
              <ul className="divide-y">
                {data.byRoute.slice(0, 5).map((r, i) => (
                  <li key={r.routeName} className="flex items-center justify-between gap-2 p-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                        {i + 1}
                      </span>
                      <p className="truncate text-sm font-medium">{r.routeName}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {r.bookings} réserv.
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums">{formatMoney(r.income)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>

      <Card className="gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="h-4 w-4 text-primary" aria-hidden="true" /> Dépenses par catégorie
        </p>
        {categories.length === 0 ? (
          <NzokoChartEmpty />
        ) : (
          <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-2">
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categories} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                    {categories.map((c, i) => (
                      <Cell key={c.label} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<NzokoGroupedTooltip formatValue={formatMoney} labels={{ value: "Montant" }} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="grid gap-2">
              {categories.map((c, i) => (
                <li key={c.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-[3px]"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      aria-hidden="true"
                    />
                    {c.label}
                  </span>
                  <span className="font-semibold tabular-nums">{formatMoney(c.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
