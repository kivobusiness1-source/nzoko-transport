"use client";

// ============================================================
// NZOKO TRANSPORT — Rapports admin (panneau partagé)
// ============================================================

import { NzokoReportPanel } from "@/components/shared/nzoko-report-panel";

export function AdminReports({ refreshKey }: { refreshKey?: number }) {
  return <NzokoReportPanel refreshKey={refreshKey} />;
}
