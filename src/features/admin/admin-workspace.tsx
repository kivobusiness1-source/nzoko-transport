"use client";

// ============================================================
// NZOKO TRANSPORT — Espace ADMIN / SUPER_ADMIN — 12 onglets
// Les onglets sont masqués selon les permissions de session ;
// le serveur revalide systématiquement les accès.
// ============================================================

import { useState } from "react";
import {
  Bot,
  BookOpenCheck,
  CreditCard,
  FileText,
  LayoutDashboard,
  MessageSquare,
  MessageSquareQuote,
  Radar,
  ScrollText,
  ShieldCheck,
  Star,
  Ticket,
  Truck,
  UserRound,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useApp } from "@/lib/store";
import { hasPerm } from "@/lib/api-client";
import type { PermissionCode } from "@/lib/constants";
import { NzokoTabs, NzokoSubTabs } from "@/components/shared/nzoko-chips";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoWorkspaceHeader } from "@/components/shared/nzoko-workspace-header";
import { AdminOverview } from "@/features/admin/admin-overview";
import { AdminBookings } from "@/features/admin/admin-bookings";
import { AdminPayments } from "@/features/admin/admin-payments";
import { AdminTrips } from "@/features/admin/admin-trips";
import { AdminFleet } from "@/features/admin/admin-fleet";
import { AdminStaff } from "@/features/admin/admin-staff";
import { AdminUsers } from "@/features/admin/admin-users";
import { AdminLogs } from "@/features/admin/admin-logs";
import { AdminReports } from "@/features/admin/admin-reports";
import { AdminComplaints } from "@/features/admin/admin-complaints";
import { AdminLoyalty } from "@/features/admin/admin-loyalty";
import { AdminTracking } from "@/features/admin/admin-tracking";
import { AdminKnowledge } from "@/features/admin/admin-knowledge";
import { AdminAIQuestions } from "@/features/admin/admin-ai-questions";

interface AdminTab {
  key: string;
  label: string;
  icon: LucideIcon;
  anyOf?: PermissionCode[];
}

const TABS: AdminTab[] = [
  { key: "overview", label: "Vue d'ensemble", icon: LayoutDashboard, anyOf: ["stats:global"] },
  { key: "bookings", label: "Réservations", icon: Ticket, anyOf: ["booking:read"] },
  { key: "payments", label: "Paiements", icon: CreditCard, anyOf: ["payment:read"] },
  // Réclamations : ouvert aux rôles lisant les réservations (SUPPORT y
  // accéderait si son espace passait par ce workspace — aujourd'hui il est
  // routé vers l'espace agence, l'autorisation reste vérifiée côté serveur).
  { key: "complaints", label: "Réclamations", icon: MessageSquare, anyOf: ["booking:read"] },
  { key: "trips", label: "Voyages", icon: Truck, anyOf: ["trip:read"] },
  {
    key: "fleet",
    label: "Parc & réseaux",
    icon: Truck,
    anyOf: ["bus:read", "route:read", "city:read", "agency:read", "seatlayout:read"],
  },
  { key: "tracking", label: "Suivi GPS", icon: Radar, anyOf: ["stats:global"] },
  { key: "staff", label: "Personnel", icon: Users, anyOf: ["driver:read"] },
  { key: "users", label: "Utilisateurs", icon: UserRound, anyOf: ["user:read"] },
  { key: "loyalty", label: "Clients & fidélité", icon: Star, anyOf: ["user:read"] },
  { key: "ai", label: "Base IA", icon: Bot, anyOf: ["kb:manage"] },
  { key: "reports", label: "Rapports", icon: FileText, anyOf: ["report:read"] },
  { key: "logs", label: "Journal", icon: ScrollText, anyOf: ["audit:read", "security:read"] },
];

export default function AdminWorkspace() {
  const { session } = useApp();
  const [tab, setTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);

  if (!session) return null;

  const visible = TABS.filter((t) => !t.anyOf || t.anyOf.some((p) => hasPerm(session, p)));
  const activeTab = visible.some((t) => t.key === tab) ? tab : visible[0]?.key;

  return (
    <section className="mx-auto max-w-6xl px-4 pb-6">
      <NzokoWorkspaceHeader
        title="Administration"
        icon={ShieldCheck}
        session={session}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />

      {visible.length === 0 ? (
        <div className="mt-4">
          <NzokoEmptyState
            icon={ShieldCheck}
            title="Aucun module accessible"
            description="Votre rôle ne donne accès à aucune section d'administration."
          />
        </div>
      ) : (
        <>
          <NzokoTabs
            tabs={visible.map(({ key, label, icon }) => ({ key, label, icon }))}
            active={activeTab ?? ""}
            onChange={setTab}
            ariaLabel="Sections de l'administration"
          />
          <div className="mt-4">
            {activeTab === "overview" && <AdminOverview refreshKey={refreshKey} />}
            {activeTab === "bookings" && <AdminBookings refreshKey={refreshKey} />}
            {activeTab === "payments" && <AdminPayments refreshKey={refreshKey} />}
            {activeTab === "complaints" && <AdminComplaints refreshKey={refreshKey} />}
            {activeTab === "trips" && <AdminTrips refreshKey={refreshKey} />}
            {activeTab === "fleet" && <AdminFleet refreshKey={refreshKey} />}
            {activeTab === "tracking" && <AdminTracking />}
            {activeTab === "staff" && <AdminStaff refreshKey={refreshKey} />}
            {activeTab === "users" && <AdminUsers refreshKey={refreshKey} />}
            {activeTab === "loyalty" && <AdminLoyalty refreshKey={refreshKey} />}
            {activeTab === "ai" && <AdminAIBase refreshKey={refreshKey} />}
            {activeTab === "reports" && <AdminReports refreshKey={refreshKey} />}
            {activeTab === "logs" && <AdminLogs refreshKey={refreshKey} />}
          </div>
        </>
      )}
    </section>
  );
}

/** Onglet « Base IA » : FAQ officielle de l'assistant + journal qualité des questions. */
function AdminAIBase({ refreshKey }: { refreshKey?: number }) {
  const [sub, setSub] = useState("faq");

  return (
    <div className="space-y-4">
      <NzokoSubTabs
        tabs={[
          { key: "faq", label: "FAQ", icon: BookOpenCheck },
          { key: "questions", label: "Questions IA", icon: MessageSquareQuote },
        ]}
        active={sub}
        onChange={setSub}
        ariaLabel="Sections de la base IA"
      />
      {sub === "faq" ? (
        <AdminKnowledge refreshKey={refreshKey} />
      ) : (
        <AdminAIQuestions refreshKey={refreshKey} />
      )}
    </div>
  );
}
