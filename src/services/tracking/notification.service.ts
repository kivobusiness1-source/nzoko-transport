// ============================================================
// NZOKO TRANSPORT — NotificationService du module tracking GPS
// Architecture EXTENSIBLE (brief §37) : les canaux SMS/WhatsApp ne
// sont pas implémentés en V1 — points d'extension documentés.
// Canal V1 : notifications in-app (table Notification) ciblant les
// utilisateurs staff de l'agence concernée + journal TrackingEvent.
// ============================================================

import { db } from "@/lib/db";
import { logger } from "@/services/tracking/tracking-logger";
import type { Prisma } from "@prisma/client";

export interface TrackingNotification {
  agencyId: string;
  title: string;
  message: string;
  type: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  /** Rôles staff destinataires au sein de l'agence (notification in-app). */
  recipientRoles: ("AGENCY_MANAGER" | "ADMIN" | "SUPER_ADMIN" | "SUPPORT")[];
  metadata?: Record<string, unknown>;
}

/**
 * Envoie une notification de suivi. In-app immédiat ; les canaux
 * externes (SMS/WhatsApp) s'ajouteront ici sans changer les appelants.
 */
export async function sendTrackingNotification(n: TrackingNotification): Promise<void> {
  try {
    // Destinataires : staff de l'agence + rôles globaux
    const recipients = await db.user.findMany({
      where: {
        isActive: true,
        role: { code: { in: [...n.recipientRoles, "SUPER_ADMIN"] } },
        OR: [{ agencyId: n.agencyId }, { agencyId: null, role: { code: { in: ["SUPER_ADMIN", "ADMIN", "SUPPORT"] } } }],
      },
      select: { id: true },
    });
    // Déduplication (un SUPER_ADMIN avec agencyId null peut matcher deux branches)
    const seen = new Set<string>();
    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const r of recipients) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push({
        userId: r.id,
        title: n.title,
        message: n.message,
        type: n.type,
      });
    }
    if (rows.length > 0) {
      await db.notification.createMany({ data: rows });
    }
    logger.info("notification", `« ${n.title} » → ${rows.length} destinataire(s)`, { agencyId: n.agencyId });
    // ── Point d'extension SMS (passerelle Congo : Mas Orange/MTN/Airtel) ──
    // TODO production : await smsGateway.send(toAgencyManagers, n.message)
    // ── Point d'extension WhatsApp Business API ──
    // TODO production : await whatsappGateway.send(...)
  } catch (err) {
    logger.error("notification", "échec d'envoi", { message: err instanceof Error ? err.message : "erreur" });
  }
}
