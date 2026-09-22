"use client";

// ============================================================
// NZOKO TRANSPORT — Section « Suivi GPS » de l'espace admin
// Sous-onglets : En direct (FleetView — carte + flotte + journal)
// et Historique (FleetHistoryView — parcours GPS des voyages).
// Vues chargées à la demande (lazy) pour ne pas peser sur le
// premier rendu de l'espace administration.
// ============================================================

import { lazy, Suspense, useState } from "react";
import { History as HistoryIcon, Loader2, Radar } from "lucide-react";
import { NzokoSubTabs, type NzokoTabDef } from "@/components/shared/nzoko-chips";

const FleetView = lazy(() => import("./fleet-view"));
const FleetHistoryView = lazy(() => import("./fleet-history-view"));

const SUBTABS: NzokoTabDef[] = [
  { key: "live", label: "En direct", icon: Radar },
  { key: "history", label: "Historique", icon: HistoryIcon },
];

function SectionLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Chargement du suivi GPS…">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
    </div>
  );
}

export function FleetTrackingSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [sub, setSub] = useState("live");

  return (
    <div className="space-y-4">
      <NzokoSubTabs tabs={SUBTABS} active={sub} onChange={setSub} ariaLabel="Sous-sections du suivi GPS" />
      <Suspense fallback={<SectionLoader />}>
        {sub === "live" && <FleetView refreshKey={refreshKey} />}
        {sub === "history" && <FleetHistoryView refreshKey={refreshKey} />}
      </Suspense>
    </div>
  );
}
