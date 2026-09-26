"use client";

// ============================================================
// OCÉAN DU NORD — Dépenses agence (CRUD si expense:manage)
// ============================================================

import { useApp } from "@/lib/store";
import { hasPerm } from "@/lib/api-client";
import { NzokoExpensesManager } from "@/components/shared/nzoko-expenses-manager";

export function AgencyExpenses({ refreshKey }: { refreshKey?: number }) {
  const { session } = useApp();

  if (!session) return null;

  return (
    <NzokoExpensesManager
      defaultAgencyId={session.agencyId}
      canManage={hasPerm(session, "expense:manage")}
      refreshKey={refreshKey}
    />
  );
}
