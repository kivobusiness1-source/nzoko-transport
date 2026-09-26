"use client";

// ============================================================
// OCÉAN DU NORD — Espace RESPONSABLE D'AGENCE (chef d'agence)
// (AGENCY_MANAGER / SUPPORT) — Tableau de bord, Départs, Réservations,
// Bus (ajout/suppression par le chef, SON agence uniquement), Dépenses.
// ============================================================

import { useState } from "react";
import { Building2, Bus, CalendarClock, LayoutDashboard, Ticket, Wallet } from "lucide-react";
import { useApp } from "@/lib/store";
import { hasPerm } from "@/lib/api-client";
import { NzokoTabs, type NzokoTabDef } from "@/components/shared/nzoko-chips";
import { NzokoWorkspaceHeader } from "@/components/shared/nzoko-workspace-header";
import { AgencyDashboard } from "@/features/agency/agency-dashboard";
import { AgencyDepartures } from "@/features/agency/agency-departures";
import { AgencyBookings } from "@/features/agency/agency-bookings";
import { AgencyExpenses } from "@/features/agency/agency-expenses";
import { AdminFleetBuses } from "@/features/admin/admin-fleet-buses";

const TABS: NzokoTabDef[] = [
  { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { key: "departures", label: "Départs du jour", icon: CalendarClock },
  { key: "bookings", label: "Réservations", icon: Ticket },
  { key: "buses", label: "Bus", icon: Bus },
  { key: "expenses", label: "Dépenses", icon: Wallet },
];

export default function AgencyWorkspace() {
  const { session } = useApp();
  const [tab, setTab] = useState("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);

  if (!session) return null;

  // Onglet Bus réservé au chef d'agence (bus:manage) — l'agent de support
  // n'y a pas accès ; les données sont de toute façon scopées côté serveur.
  const visibleTabs = TABS.filter((t) => t.key !== "buses" || hasPerm(session, "bus:manage"));

  return (
    <section className="mx-auto max-w-6xl px-4 pb-6">
      <NzokoWorkspaceHeader
        title="Espace agence"
        icon={Building2}
        session={session}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />
      <NzokoTabs tabs={visibleTabs} active={tab} onChange={setTab} ariaLabel="Sections de l'espace agence" />
      <div className="mt-4">
        {tab === "dashboard" && <AgencyDashboard refreshKey={refreshKey} />}
        {tab === "departures" && <AgencyDepartures refreshKey={refreshKey} />}
        {tab === "bookings" && <AgencyBookings refreshKey={refreshKey} />}
        {tab === "buses" && hasPerm(session, "bus:manage") && <AdminFleetBuses refreshKey={refreshKey} />}
        {tab === "expenses" && <AgencyExpenses refreshKey={refreshKey} />}
      </div>
    </section>
  );
}
