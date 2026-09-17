// GET/PATCH /api/client/profile — profil du client connecté (rôle PASSENGER)
// PATCH : firstName/lastName/email uniquement — le téléphone NE SE CHANGE
// PAS ici (clé d'identité : OTP, rétro-liage des billets).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient } from "@/services/client-space";
import { db } from "@/lib/db";
import type { ClientProfileDTO } from "@/types";

function toProfileDTO(u: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: Date;
}): ClientProfileDTO {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone ?? "",
    emailIsSynthetic: u.email.endsWith("@phone.nzoko.cg"),
    createdAt: u.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const user = await db.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Compte introuvable.");
    return ok(toProfileDTO(user));
  } catch (err) {
    return routeError(err, "GET /api/client/profile");
  }
}

const updateSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis.").max(60).optional(),
  lastName: z.string().trim().min(1, "Nom requis.").max(60).optional(),
  email: z.email("Adresse e-mail invalide.").transform((v) => v.trim().toLowerCase()).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    const body = updateSchema.parse(await req.json().catch(() => null));

    if (body.email) {
      const taken = await db.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (taken && taken.id !== auth.userId) {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette adresse e-mail est déjà utilisée.");
      }
    }

    const updated = await db.user.update({
      where: { id: auth.userId },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
      },
    });
    return ok(toProfileDTO(updated));
  } catch (err) {
    return routeError(err, "PATCH /api/client/profile");
  }
}
