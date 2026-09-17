// GET /api/admin/tracking — vue flotte GPS temps réel (ADMIN / SUPER_ADMIN /
// permission stats:global). Sans paramètre : sessions ACTIVE + PAUSED avec
// dernier point + compteur. ?sessionId= : trail (≤ TRACKING.trailMaxPoints).

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, TRACKING } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { toTrackingSessionDTO, issueSocketToken, TRACKING_SOCKET_URL } from "@/services/tracking";

const sessionInclude = {
  driver: true,
  agency: true,
  trip: { include: { route: { include: { originCity: true, destinationCity: true } } } },
  bus: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    if (!auth.permissions.includes("stats:global")) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Vous n'avez pas accès au suivi GPS de la flotte.");
    }

    const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";

    if (sessionId) {
      // Trail d'une session précise (carte admin).
      const session = await db.trackingSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
      if (!session) {
        throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
      }
      const [points, pointsCount] = await Promise.all([
        db.gpsPoint.findMany({
          where: { sessionId },
          orderBy: { recordedAt: "asc" },
          take: TRACKING.trailMaxPoints,
          select: { latitude: true, longitude: true, speed: true, heading: true, accuracy: true, recordedAt: true },
        }),
        db.gpsPoint.count({ where: { sessionId } }),
      ]);
      const last = points[points.length - 1] ?? null;
      const dto = toTrackingSessionDTO(session, last as never, pointsCount);
      return ok({ sessions: [dto], trail: points, generatedAt: new Date().toISOString(), socketUrl: TRACKING_SOCKET_URL, socketToken: "" });
    }

    // Vue flotte : sessions vivantes (ACTIVE | PAUSED).
    const sessions = await db.trackingSession.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED"] } },
      include: sessionInclude,
      orderBy: { startedAt: "asc" },
    });

    const dtos = await Promise.all(
      sessions.map(async (s) => {
        const [lastPoint, pointsCount] = await Promise.all([
          db.gpsPoint.findFirst({ where: { sessionId: s.id }, orderBy: { recordedAt: "desc" } }),
          db.gpsPoint.count({ where: { sessionId: s.id } }),
        ]);
        return toTrackingSessionDTO(s, lastPoint, pointsCount);
      })
    );

    return ok({
      sessions: dtos,
      generatedAt: new Date().toISOString(),
      socketUrl: TRACKING_SOCKET_URL,
      socketToken: issueSocketToken(auth.userId),
    });
  } catch (err) {
    return routeError(err, "Erreur vue flotte GPS");
  }
}
