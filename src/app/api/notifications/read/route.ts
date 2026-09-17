// POST /api/notifications/read — { id } ou { all: true } → marque comme lues

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z
  .object({
    id: z.string().trim().min(1).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.id !== undefined || v.all === true, {
    message: "Fournir l'identifiant de la notification ou all=true.",
  });

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    const body = schema.parse(await req.json().catch(() => null));

    if (body.all) {
      await db.notification.updateMany({
        where: { userId: auth.userId, isRead: false },
        data: { isRead: true },
      });
    } else if (body.id) {
      // Un utilisateur ne peut marquer que SES notifications
      const result = await db.notification.updateMany({
        where: { id: body.id, userId: auth.userId },
        data: { isRead: true },
      });
      if (result.count === 0) {
        return ok(false);
      }
    }

    return ok(true);
  } catch (err) {
    return routeError(err, "POST /api/notifications/read");
  }
}
