// POST /api/admin/complaints/[id]/messages — réponse staff dans le fil
// Accès : SUPER_ADMIN, ADMIN, SUPPORT. Passe automatiquement OPEN→
// IN_PROGRESS (première réponse = prise en charge) et notifie le client.

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

const schema = z.object({
  message: z.string().trim().min(1, "Message requis.").max(2000, "Message trop long (2000 caractères max)."),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    if (!ALLOWED_ROLES.includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé au support et à l'administration.");
    }
    const { id } = await params;
    const ip = getClientIp(req);
    enforceRateLimit(`adminComplaintMsg:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const body = schema.parse(await req.json().catch(() => null));

    const complaint = await db.complaint.findUnique({ where: { id } });
    if (!complaint) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réclamation introuvable.");
    if (complaint.status === "RESOLVED" || complaint.status === "CLOSED") {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette réclamation est clôturée.");
    }

    const updated = await db.$transaction(async (tx) => {
      await tx.complaintMessage.create({
        data: {
          complaintId: complaint.id,
          authorId: auth.userId,
          isStaff: true,
          authorName: `${auth.sessionUser.firstName} (NZOKO)`,
          message: body.message,
        },
      });

      // Première réponse = prise en charge automatique
      let patch: { status?: string; assignedToId?: string } = {};
      if (complaint.status === "OPEN") {
        patch = { status: "IN_PROGRESS" };
      }
      // Le répondant devient référent s'il n'y a pas encore d'assigné
      if (!complaint.assignedToId) {
        patch = { ...patch, assignedToId: auth.userId };
      }
      if (Object.keys(patch).length > 0) {
        await tx.complaint.update({ where: { id: complaint.id }, data: patch });
      }

      await tx.notification.create({
        data: {
          userId: complaint.userId,
          title: `💬 Réponse à votre réclamation ${complaint.reference}`,
          message: `${auth.sessionUser.firstName} (NZOKO) : ${body.message.slice(0, 160)}${body.message.length > 160 ? "…" : ""}`,
          type: "INFO",
        },
      });

      return tx.complaint.findUnique({ where: { id: complaint.id }, include: adminComplaintInclude });
    });

    if (!updated) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible d'envoyer le message.");

    await logAudit({
      userId: auth.userId,
      action: "COMPLAINT_REPLIED",
      entity: "Complaint",
      entityId: complaint.id,
      metadata: { reference: complaint.reference },
      ipAddress: ip,
    });

    return ok(toAdminComplaintDTO(updated), 201);
  } catch (err) {
    return routeError(err, "POST /api/admin/complaints/[id]/messages");
  }
}
