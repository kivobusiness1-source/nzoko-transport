"use client";

// ============================================================
// NZOKO TRANSPORT — Espace COMPTABLE (ACCOUNTANT) — 4 onglets
// ============================================================

import { useState } from "react";
import { BarChart3, Calculator, FileText, Receipt, Wallet } from "lucide-react";
import { useApp } from "@/lib/store";
import { NzokoTabs, type NzokoTabDef } from "@/components/shared/nzoko-chips";
import { NzokoWorkspaceHeader } from "@/components/shared/nzoko-workspace-header";
import { FinanceSummary } from "@/features/finance/finance-summary";
import { FinanceTransactions } from "@/features/finance/finance-transactions";
import { FinanceExpenses } from "@/features/finance/finance-expenses";
import { NzokoReportPanel } from "@/components/shared/nzoko-report-panel";

const TABS: NzokoTabDef[] = [
  { key: "summary", label: "Synthèse", icon: BarChart3 },
  { key: "transactions", label: "Transactions", icon: Receipt },
  { key: "expenses", label: "Dépenses", icon: Wallet },
  { key: "reports", label: "Rapports", icon: FileText },
];

export default function FinanceWorkspace() {
  const { session } = useApp();
  const [tab, setTab] = useState("summary");
  const [refreshKey, setRefreshKey] = useState(0);

  if (!session) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 pb-6">
      <NzokoWorkspaceHeader
        title="Espace comptabilité"
        icon={Calculator}
        session={session}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />
      <NzokoTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Sections de l'espace comptabilité" />
      <div className="mt-4">
        {tab === "summary" && <FinanceSummary refreshKey={refreshKey} />}
        {tab === "transactions" && <FinanceTransactions refreshKey={refreshKey} />}
        {tab === "expenses" && <FinanceExpenses refreshKey={refreshKey} />}
        {tab === "reports" && <NzokoReportPanel refreshKey={refreshKey} />}
      </div>
    </section>
  );
}
