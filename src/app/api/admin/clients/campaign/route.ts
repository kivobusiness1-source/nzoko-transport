// POST /api/admin/clients/campaign — notification de masse ciblée
// Segments : INACTIVE (sans voyage depuis INACTIVE_CLIENT_DAYS), paliers
// fidélité, ALL. Accès : SUPER_ADMIN, ADMIN. Max 2000 notifications,
// journalisation d'audit (données personnelles de masse).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { campaignUserIds } from "@/services/admin-clients";
import { db } from "@/lib/db";

const schema = z.object({
  segment: z.enum(["INACTIVE", "BRONZE", "SILVER", "GOLD", "VIP", "ALL"]),
  title: z.string().trim().min(3, "Titre requis (3 caractères minimum).").max(90, "Titre trop long (90 caractères max)."),
  message: z.string().trim().min(10, "Message requis (10 caractères minimum).").max(300, "Message trop long (300 caractères max)."),
});

const MAX_NOTIFICATIONS = 2000;

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    if (!["SUPER_ADMIN", "ADMIN"].includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux administrateurs.");
    }
    const ip = getClientIp(req);
    enforceRateLimit(`campaign:${auth.userId}`, RATE_LIMITS.complaintCreate.limit, RATE_LIMITS.complaintCreate.windowMs);

    const body = schema.parse(await req.json().catch(() => null));

    const userIds = await campaignUserIds(body.segment);
    const targets = userIds.slice(0, MAX_NOTIFICATIONS);

    if (targets.length > 0) {
      await db.notification.createMany({
        data: targets.map((userId) => ({
          userId,
          title: body.title,
          message: body.message,
          type: "INFO",
        })),
      });
    }

    await logAudit({
      userId: auth.userId,
      action: "CAMPAIGN_SENT",
      entity: "Notification",
      metadata: { segment: body.segment, notified: targets.length, truncated: userIds.length > targets.length },
      ipAddress: ip,
    });

    return ok({ notified: targets.length });
  } catch (err) {
    return routeError(err, "POST /api/admin/clients/campaign");
  }
}
