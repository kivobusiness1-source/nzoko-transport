// GET/PATCH /api/admin/complaints/[id] — traitement d'une réclamation
// Accès : SUPER_ADMIN, ADMIN, SUPPORT.
// PATCH : transitions AVANT uniquement (OPEN→IN_PROGRESS→RESOLVED→CLOSED,
// RESOLVED→CLOSED ; jamais de retour, réouverture interdite) +
// assignation à soi-même. À RESOLVED : date + notification client.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { toAdminComplaintDTO, adminComplaintInclude } from "@/services/client-space";
import { db } from "@/lib/db";

const ALLOWED_ROLES = ["SUPER_ADMIN", "ADMIN", "SUPPORT"];

// Transitions autorisées — STRICTEMENT vers l'avant
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    if (!ALLOWED_ROLES.includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé au support et à l'administration.");
    }
    enforceRateLimit(`adminRead:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const { id } = await params;
    const complaint = await db.complaint.findUnique({ where: { id }, include: adminComplaintInclude });
    if (!complaint) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réclamation introuvable.");
    return ok(toAdminComplaintDTO(complaint));
  } catch (err) {
    return routeError(err, "GET /api/admin/complaints/[id]");
  }
}

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  assignToSelf: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    if (!ALLOWED_ROLES.includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé au support et à l'administration.");
    }
    const { id } = await params;
    const ip = getClientIp(req);
    enforceRateLimit(`adminComplaint:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const body = patchSchema.parse(await req.json().catch(() => null));
    if (!body.status && body.assignToSelf === undefined) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Rien à mettre à jour (statut ou assignation requis).");
    }

    const complaint = await db.complaint.findUnique({ where: { id } });
    if (!complaint) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réclamation introuvable.");

    if (body.status && body.status !== complaint.status) {
      const allowed = TRANSITIONS[complaint.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(
          409,
          ERROR_CODES.CONFLICT,
          "Transition interdite : le statut ne peut pas revenir en arrière."
        );
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const fresh = await tx.complaint.findUnique({ where: { id: complaint.id }, select: { status: true } });
      if (!fresh || fresh.status !== complaint.status) {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "La réclamation a changé d'état concurrentiellement.");
      }

      const result = await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
          ...(body.assignToSelf ? { assignedToId: auth.userId } : {}),
        },
      });

      if (body.status === "RESOLVED") {
        await tx.notification.create({
          data: {
            userId: complaint.userId,
            title: `🟢 Votre réclamation ${complaint.reference} est résolue`,
            message: `🟢 Votre réclamation ${complaint.reference} est résolue. Merci de votre confiance.`,
            type: "SUCCESS",
          },
        });
      }

      return tx.complaint.findUnique({ where: { id: result.id }, include: adminComplaintInclude });
    });

    if (!updated) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de mettre à jour la réclamation.");

    await logAudit({
      userId: auth.userId,
      action: "COMPLAINT_UPDATED",
      entity: "Complaint",
      entityId: complaint.id,
      metadata: {
        reference: complaint.reference,
        status: body.status ?? complaint.status,
        assignedToSelf: body.assignToSelf ?? false,
      },
      ipAddress: ip,
    });

    return ok(toAdminComplaintDTO(updated));
  } catch (err) {
    return routeError(err, "PATCH /api/admin/complaints/[id]");
  }
}
