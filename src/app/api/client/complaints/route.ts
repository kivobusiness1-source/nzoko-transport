// GET/POST /api/client/complaints — réclamations & suggestions
// POST : référence NZK-R-AAAA-NNNNNN (séquence annuelle + retry collision),
// message initial dans le fil, notifications client + staff (ADMIN/SUPPORT).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { RATE_LIMITS, COMPLAINT_CATEGORIES } from "@/lib/constants";
import { assertClient, toComplaintDTO, toComplaintDetailDTO, myPassengerIds } from "@/services/client-space";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const messagesInclude = {
  messages: { orderBy: { createdAt: "asc" as const } },
  assignedTo: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ComplaintInclude;

export async function GET(req: NextRequest) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const complaints = await db.complaint.findMany({
      where: { userId: auth.userId },
      include: messagesInclude,
      orderBy: { createdAt: "desc" },
    });

    return ok(complaints.map(toComplaintDTO));
  } catch (err) {
    return routeError(err, "GET /api/client/complaints");
  }
}

const createSchema = z.object({
  category: z.enum(COMPLAINT_CATEGORIES),
  subject: z.string().trim().min(3, "Sujet requis (3 caractères minimum).").max(120, "Sujet trop long (120 caractères max)."),
  message: z.string().trim().min(10, "Détaillez votre message (10 caractères minimum).").max(2000, "Message trop long (2000 caractères max)."),
  bookingReference: z.string().trim().max(30).optional(),
});

/** Référence séquentielle annuelle NZK-R-AAAA-NNNNNN (retry sur collision). */
async function nextComplaintReference(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `NZK-R-${year}-`;
  const count = await tx.complaint.count({ where: { reference: { startsWith: prefix } } });
  for (let attempt = 0; attempt < 8; attempt++) {
    const reference = `${prefix}${String(count + 1 + attempt).padStart(6, "0")}`;
    const exists = await tx.complaint.findUnique({ where: { reference }, select: { id: true } });
    if (!exists) return reference;
  }
  throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de générer une référence. Réessayez.");
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    const ip = getClientIp(req);
    enforceRateLimit(`complaint:${auth.userId}`, RATE_LIMITS.complaintCreate.limit, RATE_LIMITS.complaintCreate.windowMs);

    const body = createSchema.parse(await req.json().catch(() => null));

    // Réservation liée : OPTIONNELLE — si fournie, elle doit exister ET m'appartenir
    let bookingReference: string | null = null;
    if (body.bookingReference) {
      const user = await db.user.findUnique({ where: { id: auth.userId }, select: { id: true, phone: true } });
      const passengerIds = user ? await myPassengerIds(user) : [];
      const booking = await db.booking.findFirst({
        where: { bookingReference: body.bookingReference.toUpperCase(), passengerId: { in: passengerIds } },
        select: { bookingReference: true },
      });
      if (!booking) {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Réservation introuvable.");
      }
      bookingReference = booking.bookingReference;
    }

    const complaint = await db.$transaction(async (tx) => {
      const reference = await nextComplaintReference(tx);
      const created = await tx.complaint.create({
        data: {
          reference,
          userId: auth.userId,
          category: body.category,
          subject: body.subject,
          message: body.message,
          bookingReference,
          status: "OPEN",
        },
      });

      // Message initial du fil (client)
      await tx.complaintMessage.create({
        data: {
          complaintId: created.id,
          authorId: auth.userId,
          isStaff: false,
          authorName: "Moi",
          message: body.message,
        },
      });

      // Notification client
      await tx.notification.create({
        data: {
          userId: auth.userId,
          title: `Réclamation ${reference} enregistrée`,
          message: `Réclamation ${reference} enregistrée — nous revenons vers vous rapidement.`,
          type: "INFO",
        },
      });

      // Notification staff (ADMIN + SUPPORT — c'est leur file de travail)
      const staff = await tx.user.findMany({
        where: { isActive: true, role: { code: { in: ["ADMIN", "SUPPORT"] } } },
        select: { id: true },
        take: 50,
      });
      if (staff.length > 0) {
        await tx.notification.createMany({
          data: staff.map((s) => ({
            userId: s.id,
            title: `🗣️ Nouvelle réclamation ${reference}`,
            message: `🗣️ Nouvelle réclamation ${reference} — ${body.subject}`,
            type: "WARNING",
          })),
        });
      }

      return tx.complaint.findUnique({ where: { id: created.id }, include: messagesInclude });
    });

    if (!complaint) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de finaliser la réclamation. Réessayez.");

    await logAudit({
      userId: auth.userId,
      action: "COMPLAINT_CREATED",
      entity: "Complaint",
      entityId: complaint.id,
      metadata: { reference: complaint.reference, category: body.category },
      ipAddress: ip,
    });

    return ok(toComplaintDetailDTO(complaint), 201);
  } catch (err) {
    return routeError(err, "POST /api/client/complaints");
  }
}
