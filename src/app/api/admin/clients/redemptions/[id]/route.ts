// PATCH /api/admin/clients/redemptions/[id] — décision sur une demande
// de récompense fidélité. Accès : SUPER_ADMIN, ADMIN.
// Les points ont été DÉPENSÉS à la création de la demande :
//  - APPROVED : génération du code promo livrable (PERCENT ou FREE_TICKET)
//  - REJECTED : note obligatoire + restitution des points (ADJUST ADMIN)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { RATE_LIMITS, LOYALTY_REWARDS } from "@/lib/constants";
import { generatePromoCode } from "@/lib/security";
import { toRedemptionRequestDTO, rewardLabel } from "@/services/client-space";
import { refundPoints } from "@/services/loyalty";
import { db } from "@/lib/db";

const schema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(500, "Note trop longue (500 caractères max).").optional(),
});

/** Livrable promo selon la récompense demandée. */
function rewardPromoSpec(rewardKey: string): { type: "PERCENT" | "FREE_TICKET"; value: number } {
  switch (rewardKey) {
    case "REDUCTION_5":
      return { type: "PERCENT", value: 5 };
    case "REDUCTION_10":
      return { type: "PERCENT", value: 10 };
    case "SPECIAL":
      return { type: "PERCENT", value: 15 };
    case "FREE_TICKET":
      return { type: "FREE_TICKET", value: 0 };
    default:
      return { type: "PERCENT", value: 0 };
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    if (!["SUPER_ADMIN", "ADMIN"].includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux administrateurs.");
    }
    const { id } = await params;
    const ip = getClientIp(req);
    // File de traitement admin — cadence de lecture confortable (le rate
    // limit strict `redeem` protège le CLIENT, pas l'agent qui décide).
    enforceRateLimit(`adminRedeemDecision:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const body = schema.parse(await req.json().catch(() => null));

    if (body.decision === "REJECTED" && !body.note) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Un motif est obligatoire pour refuser une récompense.");
    }

    const redemption = await db.redemptionRequest.findUnique({ where: { id } });
    if (!redemption) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Demande introuvable.");
    if (redemption.status !== "PENDING") {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette demande a déjà été traitée.");
    }

    const reward = LOYALTY_REWARDS.find((r) => r.key === redemption.rewardKey);
    const label = reward?.label ?? rewardLabel(redemption.rewardKey);

    const updated = await db.$transaction(async (tx) => {
      // Re-vérification atomique (double décision concurrente impossible)
      const fresh = await tx.redemptionRequest.findUnique({
        where: { id: redemption.id },
        select: { status: true },
      });
      if (!fresh || fresh.status !== "PENDING") {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette demande a déjà été traitée.");
      }

      if (body.decision === "REJECTED") {
        // Restitution des points dépensés à la création (ADJUST ADMIN)
        await refundPoints(
          tx,
          redemption.userId,
          redemption.pointsSpent,
          `Restitution — demande refusée (${redemption.rewardKey})`
        );

        const rejected = await tx.redemptionRequest.update({
          where: { id: redemption.id },
          data: {
            status: "REJECTED",
            note: body.note ?? null,
            decidedById: auth.userId,
            decidedAt: new Date(),
          },
        });

        await tx.notification.create({
          data: {
            userId: redemption.userId,
            title: "Récompense refusée",
            message: `Récompense refusée : ${body.note ?? ""}`,
            type: "WARNING",
          },
        });

        return rejected;
      }

      // APPROVED → code promo livrable (usage unique, 90 jours)
      const spec = rewardPromoSpec(redemption.rewardKey);
      const code = generatePromoCode();
      const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000);

      await tx.promoCode.create({
        data: {
          code,
          type: spec.type,
          value: spec.value,
          label: `Récompense fidélité — ${label}`,
          userId: redemption.userId,
          maxUses: 1,
          usedCount: 0,
          expiresAt,
          isActive: true,
        },
      });

      const approved = await tx.redemptionRequest.update({
        where: { id: redemption.id },
        data: {
          status: "APPROVED",
          note: body.note ?? null,
          promoCode: code,
          decidedById: auth.userId,
          decidedAt: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId: redemption.userId,
          title: "✅ Récompense validée : votre code",
          message: `✅ Récompense validée : votre code ${code} — valable 90 jours sur votre prochaine réservation.`,
          type: "SUCCESS",
        },
      });

      return approved;
    });

    await logAudit({
      userId: auth.userId,
      action: `REDEMPTION_${body.decision}`,
      entity: "RedemptionRequest",
      entityId: redemption.id,
      metadata: {
        rewardKey: redemption.rewardKey,
        points: redemption.pointsSpent,
        promoCode: updated.promoCode ?? null,
      },
      ipAddress: ip,
    });

    return ok(toRedemptionRequestDTO(updated));
  } catch (err) {
    return routeError(err, "PATCH /api/admin/clients/redemptions/[id]");
  }
}
