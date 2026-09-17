// GET /api/notifications — les 30 dernières notifications de l'utilisateur connecté

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));

    const notifications = await db.notification.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const data = notifications.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    }));

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/notifications");
  }
}
