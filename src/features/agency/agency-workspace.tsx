"use client";

// ============================================================
// NZOKO TRANSPORT — Espace RESPONSABLE D'AGENCE
// (AGENCY_MANAGER / SUPPORT) — 4 onglets
// ============================================================

import { useState } from "react";
import { Building2, CalendarClock, LayoutDashboard, Ticket, Wallet } from "lucide-react";
import { useApp } from "@/lib/store";
import { NzokoTabs, type NzokoTabDef } from "@/components/shared/nzoko-chips";
import { NzokoWorkspaceHeader } from "@/components/shared/nzoko-workspace-header";
import { AgencyDashboard } from "@/features/agency/agency-dashboard";
import { AgencyDepartures } from "@/features/agency/agency-departures";
import { AgencyBookings } from "@/features/agency/agency-bookings";
import { AgencyExpenses } from "@/features/agency/agency-expenses";

const TABS: NzokoTabDef[] = [
  { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { key: "departures", label: "Départs du jour", icon: CalendarClock },
  { key: "bookings", label: "Réservations", icon: Ticket },
  { key: "expenses", label: "Dépenses", icon: Wallet },
];

export default function AgencyWorkspace() {
  const { session } = useApp();
  const [tab, setTab] = useState("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);

  if (!session) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 pb-6">
      <NzokoWorkspaceHeader
        title="Espace agence"
        icon={Building2}
        session={session}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />
      <NzokoTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Sections de l'espace agence" />
      <div className="mt-4">
        {tab === "dashboard" && <AgencyDashboard refreshKey={refreshKey} />}
        {tab === "departures" && <AgencyDepartures refreshKey={refreshKey} />}
        {tab === "bookings" && <AgencyBookings refreshKey={refreshKey} />}
        {tab === "expenses" && <AgencyExpenses refreshKey={refreshKey} />}
      </div>
    </section>
  );
}
