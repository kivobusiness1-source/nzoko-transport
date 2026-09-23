// ============================================================
// NZOKO TRANSPORT — Audit & journalisation de sécurité
// ============================================================

import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/security";

interface AuditEntry {
  userId?: string | null;
  action: string; // ex: BOOKING_CREATED, PAYMENT_CONFIRMED, USER_CREATED, PRICE_CHANGED
  entity: string; // ex: "Booking", "Trip"
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] échec d'écriture", err);
  }
}

export interface SecurityEvent {
  userId?: string | null;
  email?: string | null;
  event:
    | "LOGIN_FAILED"
    | "LOGIN_SUCCESS"
    | "LOGIN_SUCCESS_OTP"
    | "REGISTER_SUCCESS"
    | "PASSWORD_CHANGED"
    | "LOGOUT"
    | "RATE_LIMITED"
    | "ACCESS_DENIED"
    | "SUSPICIOUS"
    | "VALIDATION_ERROR"
    | "WEBHOOK_REJECTED"
    | "ADMIN_ACTION";
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}

export async function logSecurity(event: SecurityEvent): Promise<void> {
  try {
    await db.securityLog.create({
      data: {
        userId: event.userId ?? null,
        email: event.email ?? null,
        event: event.event,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ? event.userAgent.slice(0, 250) : null,
        details: event.details ? JSON.stringify(event.details) : null,
      },
    });
  } catch (err) {
    console.error("[security] échec d'écriture", err);
  }
}

export function parseDetails(raw: string | null): Record<string, unknown> | null {
  return safeJsonParse<Record<string, unknown> | null>(raw, null);
}
