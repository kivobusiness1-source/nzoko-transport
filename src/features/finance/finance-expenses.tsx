"use client";

// ============================================================
// OCÉAN DU NORD — Dépenses (comptable, filtre agence)
// ============================================================

import { useApp } from "@/lib/store";
import { hasPerm } from "@/lib/api-client";
import { NzokoExpensesManager } from "@/components/shared/nzoko-expenses-manager";

export function FinanceExpenses({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();

  if (!session) return null;

  return (
    <NzokoExpensesManager
      allowAgencyFilter={hasPerm(session, "agency:read")}
      canManage={hasPerm(session, "expense:manage")}
      refreshKey={refreshKey}
    />
  );
}
