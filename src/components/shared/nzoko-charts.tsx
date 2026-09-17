"use client";

// ============================================================
// NZOKO TRANSPORT — Graphiques recharts génériques (FR)
// Area / Bar, tooltip FR, axes compacts, 100% responsive.
// ============================================================

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, formatMoneyShort } from "@/lib/format";

export interface NzokoTrendPoint {
  label: string;
  value: number;
}

/** État vide compact pour emplacement de graphique. */
export function NzokoChartEmpty({ message = "Aucune donnée à afficher." }: { message?: string }) {
  return (
    <div className="flex h-[200px] w-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
      {message}
    </div>
  );
}

interface TooltipEntry {
  value?: number | string | (number | string)[];
  name?: string | number;
  dataKey?: string | number;
  color?: string;
}

interface BaseTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  formatValue: (v: number) => string;
}

export function NzokoChartTooltip({ active, label, payload, formatValue }: BaseTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const raw = payload[0]?.value;
  const num = typeof raw === "number" ? raw : Number(Array.isArray(raw) ? raw[0] : (raw ?? 0));
  return (
    <div className="rounded-lg border bg-background/95 px-3 py-1.5 text-xs shadow-md">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground">{formatValue(Number.isFinite(num) ? num : 0)}</p>
    </div>
  );
}

/** Tooltip multi-séries (barres groupées, camembert). */
export function NzokoGroupedTooltip({
  active,
  label,
  payload,
  formatValue,
  labels,
}: BaseTooltipProps & { labels?: Record<string, string> }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-background/95 px-3 py-1.5 text-xs shadow-md">
      {label !== undefined && label !== "" && <p className="font-medium text-foreground">{label}</p>}
      <div className="mt-0.5 space-y-0.5">
        {payload.map((entry, i) => (
          <p key={i} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: entry.color }} aria-hidden="true" />
            {labels?.[String(entry.dataKey)] ?? String(entry.name ?? "")} :{" "}
            <span className="font-medium text-foreground">{formatValue(Number(entry.value ?? 0))}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * Courbe de tendance : kind="area" (revenus) ou "bar" (réservations).
 * `formatValue` formate le tooltip (défaut : FCFA), `formatAxis` l'axe Y (défaut : court).
 */
export function NzokoTrendChart({
  points,
  kind = "area",
  color = "var(--chart-1)",
  formatValue = formatMoney,
  formatAxis = formatMoneyShort,
  height = 240,
}: {
  points: NzokoTrendPoint[];
  kind?: "area" | "bar";
  color?: string;
  formatValue?: (v: number) => string;
  formatAxis?: (v: number) => string;
  height?: number;
}) {
  const gradientId = `nzoko-grad-${useId().replace(/:/g, "")}`;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "area" ? (
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              minTickGap={20}
            />
            <YAxis
              width={40}
              tickFormatter={(v: number) => formatAxis(v)}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <Tooltip cursor={{ stroke: "var(--border)" }} content={<NzokoChartTooltip formatValue={formatValue} />} />
            <Area dataKey="value" type="monotone" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} />
          </AreaChart>
        ) : (
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              minTickGap={20}
            />
            <YAxis
              width={40}
              tickFormatter={(v: number) => formatAxis(v)}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              allowDecimals={false}
            />
            <Tooltip cursor={{ fill: "var(--muted)" }} content={<NzokoChartTooltip formatValue={formatValue} />} />
            <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} maxBarSize={36} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
