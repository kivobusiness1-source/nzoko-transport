// GET /api/client/loyalty — compte fidélité complet du client
// Solde/palier/prochain palier, prochaine récompense atteignable,
// 50 dernières transactions, catalogue des récompenses, demandes.

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, LOYALTY_REWARDS } from "@/lib/constants";
import { assertClient, toRedemptionRequestDTO } from "@/services/client-space";
import { ensureLoyaltyAccount, tierForPoints, nextTierForPoints, tierLabel } from "@/services/loyalty";
import { db } from "@/lib/db";
import type { LoyaltyDTO, LoyaltyRewardDTO } from "@/types";

function rewardDTO(r: (typeof LOYALTY_REWARDS)[number]): LoyaltyRewardDTO {
  return {
    key: r.key,
    label: r.label,
    description: r.description,
    points: r.points,
    deliverable: r.deliverable,
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const account = await ensureLoyaltyAccount(auth.userId);

    const [transactions, redemptions] = await Promise.all([
      db.loyaltyTransaction.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      db.redemptionRequest.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const tier = tierForPoints(account.lifetimePoints);

    // Prochaine récompense atteignable : la moins chère au-dessus du solde
    const nextReward =
      [...LOYALTY_REWARDS]
        .filter((r) => r.points > account.pointsBalance)
        .sort((a, b) => a.points - b.points)[0] ?? null;

    const data: LoyaltyDTO = {
      pointsBalance: account.pointsBalance,
      lifetimePoints: account.lifetimePoints,
      tier,
      tierLabel: tierLabel(tier),
      nextTier: nextTierForPoints(account.lifetimePoints),
      nextReward: nextReward ? rewardDTO(nextReward) : null,
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type as LoyaltyDTO["transactions"][number]["type"],
        points: t.points,
        reason: t.reason,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      })),
      rewards: LOYALTY_REWARDS.map(rewardDTO),
      redemptions: redemptions.map(toRedemptionRequestDTO),
    };
    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/client/loyalty");
  }
}
