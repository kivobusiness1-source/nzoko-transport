"use client";

// ============================================================
// OCÉAN DU NORD — Transactions financières (paginées)
// ============================================================

import { useState } from "react";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS } from "@/lib/constants";
import type { TransactionType } from "@/lib/constants";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoListSkeleton } from "@/components/shared/nzoko-skeletons";
import { NzokoPagination } from "@/components/shared/nzoko-pagination";
import type { TransactionDTO } from "@/types";
import { cn } from "@/lib/utils";

const TX_BADGES: Record<TransactionType, string> = {
  INCOME: "bg-emerald-100 text-emerald-800 border-emerald-200",
  EXPENSE: "bg-red-100 text-red-800 border-red-200",
  REFUND: "bg-violet-100 text-violet-800 border-violet-200",
  ADJUSTMENT: "bg-zinc-100 text-zinc-600 border-zinc-300",
};

function amountLabel(t: TransactionDTO): { text: string; className: string } {
  switch (t.type) {
    case "INCOME":
      return { text: `+${formatMoney(t.amount)}`, className: "text-emerald-600" };
    case "EXPENSE":
    case "REFUND":
      return { text: `−${formatMoney(t.amount)}`, className: "text-red-600" };
    default:
      return { text: formatMoney(t.amount), className: "" };
  }
}

export function FinanceTransactions({ refreshKey }: { refreshKey?: number }) {
  const [type, setType] = useState("ALL");
  const [page, setPage] = useState(1);

  // Retour en page 1 quand le filtre change (ajustement pendant le rendu).
  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setPage(1);
  }

  const { data, loading, error, reload } = useApiData(
    () =>
      api.finance.transactions({
        type: type === "ALL" ? undefined : type,
        page,
      }),
    { refetchKey: [type, page], refreshKey },
  );

  const items = data?.items ?? [];

  return (
    <div>
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="h-11 w-full sm:w-56" aria-label="Filtrer par type de transaction">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Tous les types</SelectItem>
          {TRANSACTION_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {TRANSACTION_TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="mt-4">
        {loading && <NzokoListSkeleton count={4} />}
        {error && <NzokoErrorBox error={error} onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <NzokoEmptyState
            icon={Receipt}
            title="Aucune transaction"
            description="Aucune transaction ne correspond à ce filtre."
          />
        )}
        {!loading && !error && items.length > 0 && (
          <>
            <div className="grid gap-3 md:hidden">
              {items.map((t) => {
                const amount = amountLabel(t);
                return (
                  <Card key={t.id} className="gap-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className={TX_BADGES[t.type]}>
                        {TRANSACTION_TYPE_LABELS[t.type]}
                      </Badge>
                      <span className={cn("text-sm font-bold tabular-nums", amount.className)}>
                        {amount.text}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{t.description}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {t.reference ?? "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.agencyName ?? "Siège"}
                      {t.createdByName ? ` · ${t.createdByName}` : ""} · {formatDateTime(t.createdAt)}
                    </p>
                  </Card>
                );
              })}
            </div>

            <Card className="hidden gap-0 p-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Référence</TableHead>
                    <TableHead>Agence</TableHead>
                    <TableHead>Auteur</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((t) => {
                    const amount = amountLabel(t);
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <Badge variant="outline" className={TX_BADGES[t.type]}>
                            {TRANSACTION_TYPE_LABELS[t.type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-xs">{t.description}</TableCell>
                        <TableCell className="font-mono text-[11px]">{t.reference ?? "—"}</TableCell>
                        <TableCell className="text-xs">{t.agencyName ?? "Siège"}</TableCell>
                        <TableCell className="text-xs">{t.createdByName ?? "—"}</TableCell>
                        <TableCell className="text-xs">{formatDateTime(t.createdAt)}</TableCell>
                        <TableCell
                          className={cn("text-right text-sm font-semibold tabular-nums", amount.className)}
                        >
                          {amount.text}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            <NzokoPagination
              page={data?.page ?? 1}
              totalPages={data?.totalPages ?? 1}
              total={data?.total ?? 0}
              onPageChange={setPage}
              unit="transactions"
            />
          </>
        )}
      </div>
    </div>
  );
}
