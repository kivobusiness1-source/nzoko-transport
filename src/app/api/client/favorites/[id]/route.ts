// DELETE /api/client/favorites/[id] — suppression d'un favori manuel
// (id = identifiant de la ligne FavoriteRoute ; les favoris auto-détectés
// n'ont pas de ligne en base → 404 naturel).

import { NextRequest } from "next/server";
import { ok, routeError, ApiError, ERROR_CODES, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { assertClient } from "@/services/client-space";
import { db } from "@/lib/db";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    const { id } = await params;

    const favorite = await db.favoriteRoute.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true },
    });
    if (!favorite) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Favori introuvable.");
    }

    await db.favoriteRoute.delete({ where: { id: favorite.id } });
    return ok(true);
  } catch (err) {
    return routeError(err, "DELETE /api/client/favorites/[id]");
  }
}
