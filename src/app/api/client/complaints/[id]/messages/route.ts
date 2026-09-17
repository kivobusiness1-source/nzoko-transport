// POST /api/client/complaints/[id]/messages — réponse client dans le fil
// Réclamation RESOLVED/CLOSED → 409 (clôturée). Notifie le staff.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient, toComplaintDetailDTO } from "@/services/client-space";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const messagesInclude = {
  messages: { orderBy: { createdAt: "asc" as const } },
  assignedTo: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ComplaintInclude;

const schema = z.object({
  message: z.string().trim().min(1, "Message requis.").max(2000, "Message trop long (2000 caractères max)."),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    const { id } = await params;
    enforceRateLimit(`complaintmsg:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const body = schema.parse(await req.json().catch(() => null));

    const updated = await db.$transaction(async (tx) => {
      const complaint = await tx.complaint.findFirst({ where: { id, userId: auth.userId } });
      if (!complaint) {
        throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réclamation introuvable.");
      }
      if (complaint.status === "RESOLVED" || complaint.status === "CLOSED") {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette réclamation est clôturée.");
      }

      await tx.complaintMessage.create({
        data: {
          complaintId: complaint.id,
          authorId: auth.userId,
          isStaff: false,
          authorName: "Moi",
          message: body.message,
        },
      });

      // Notifie le staff assigné, sinon les ADMIN/SUPPORT
      const recipients = complaint.assignedToId
        ? [{ id: complaint.assignedToId }]
        : await tx.user.findMany({
            where: { isActive: true, role: { code: { in: ["ADMIN", "SUPPORT"] } } },
            select: { id: true },
            take: 50,
          });
      if (recipients.length > 0) {
        await tx.notification.createMany({
          data: recipients.map((r) => ({
            userId: r.id,
            title: `💬 Nouveau message — ${complaint.reference}`,
            message: `Le client a répondu sur la réclamation ${complaint.reference}.`,
            type: "INFO",
          })),
        });
      }

      return tx.complaint.findUnique({ where: { id: complaint.id }, include: messagesInclude });
    });

    if (!updated) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible d'envoyer le message. Réessayez.");
    return ok(toComplaintDetailDTO(updated), 201);
  } catch (err) {
    return routeError(err, "POST /api/client/complaints/[id]/messages");
  }
}
