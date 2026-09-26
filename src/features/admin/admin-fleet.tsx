"use client";

// ============================================================
// OCÉAN DU NORD — Parc & réseaux (sous-sections)
// Bus / Configurations sièges / Routes / Villes / Quartiers / Agences
// ============================================================

import { useState } from "react";
import { Building2, Bus, LayoutGrid, MapPin, MapPinned, Route as RouteIcon } from "lucide-react";
import { NzokoSubTabs, type NzokoTabDef } from "@/components/shared/nzoko-chips";
import { AdminFleetBuses } from "@/features/admin/admin-fleet-buses";
import { AdminFleetLayouts } from "@/features/admin/admin-fleet-layouts";
import { AdminFleetRoutes } from "@/features/admin/admin-fleet-routes";
import { AdminFleetCities } from "@/features/admin/admin-fleet-cities";
import { AdminNeighborhoods } from "@/features/admin/admin-neighborhoods";
import { AdminFleetAgencies } from "@/features/admin/admin-fleet-agencies";

const SUBTABS: NzokoTabDef[] = [
  { key: "buses", label: "Bus", icon: Bus },
  { key: "layouts", label: "Configurations sièges", icon: LayoutGrid },
  { key: "routes", label: "Routes", icon: RouteIcon },
  { key: "cities", label: "Villes", icon: MapPin },
  { key: "neighborhoods", label: "Quartiers", icon: MapPinned },
  { key: "agencies", label: "Agences", icon: Building2 },
];

export function AdminFleet({ refreshKey }: { refreshKey?: number }) {
  const [sub, setSub] = useState("buses");

  return (
    <div className="space-y-4">
      <NzokoSubTabs
        tabs={SUBTABS}
        active={sub}
        onChange={setSub}
        ariaLabel="Sous-sections du parc et des réseaux"
      />
      {sub === "buses" && <AdminFleetBuses refreshKey={refreshKey} />}
      {sub === "layouts" && <AdminFleetLayouts refreshKey={refreshKey} />}
      {sub === "routes" && <AdminFleetRoutes refreshKey={refreshKey} />}
      {sub === "cities" && <AdminFleetCities refreshKey={refreshKey} />}
      {sub === "neighborhoods" && <AdminNeighborhoods refreshKey={refreshKey} />}
      {sub === "agencies" && <AdminFleetAgencies refreshKey={refreshKey} />}
    </div>
  );
}
