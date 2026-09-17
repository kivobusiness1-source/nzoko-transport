// POST /api/client/loyalty/redeem — demande de récompense fidélité
// Les points sont DÉPENSÉS immédiatement (transaction SPEND atomique avec
// la création de la demande PENDING). Un refus admin les restitue.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, LOYALTY_REWARDS } from "@/lib/constants";
import { assertClient, toRedemptionRequestDTO, rewardLabel } from "@/services/client-space";
import { ensureLoyaltyAccount, spendPoints } from "@/services/loyalty";
import { db } from "@/lib/db";

const schema = z.object({
  rewardKey: z.enum(["REDUCTION_5", "REDUCTION_10", "SPECIAL", "FREE_TICKET"]),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`redeem:${auth.userId}`, RATE_LIMITS.redeem.limit, RATE_LIMITS.redeem.windowMs);

    const body = schema.parse(await req.json().catch(() => null));
    const reward = LOYALTY_REWARDS.find((r) => r.key === body.rewardKey);
    if (!reward) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Récompense inconnue.");
    }

    // Pré-contrôle du solde (message précis) — spendPoints re-vérifie
    // de façon atomique dans la transaction ci-dessous.
    const account = await ensureLoyaltyAccount(auth.userId);
    if (account.pointsBalance < reward.points) {
      throw new ApiError(
        409,
        ERROR_CODES.CONFLICT,
        `Solde insuffisant : il vous manque ${reward.points - account.pointsBalance} points.`
      );
    }

    const redemption = await db.$transaction(async (tx) => {
      await spendPoints(tx, auth.userId, reward.points, reward.key, `Récompense : ${reward.label}`);

      const created = await tx.redemptionRequest.create({
        data: {
          userId: auth.userId,
          rewardKey: reward.key,
          pointsSpent: reward.points,
          status: "PENDING",
        },
      });

      await tx.notification.create({
        data: {
          userId: auth.userId,
          title: "🎁 Demande de récompense envoyée",
          message: `Votre demande « ${reward.label} » (${reward.points} points) a bien été enregistrée. Nos équipes la traitent rapidement.`,
          type: "INFO",
        },
      });

      return created;
    });

    const data = {
      ...toRedemptionRequestDTO(redemption),
      rewardLabel: rewardLabel(redemption.rewardKey),
    };
    return ok(data, 201);
  } catch (err) {
    return routeError(err, "POST /api/client/loyalty/redeem");
  }
}
