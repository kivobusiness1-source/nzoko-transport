// GET /api/admin/ai-questions?resolved&category&days — journal des questions IA (kb:manage)
// ?stats=true → agrégats (fréquentes, non résolues, catégories) pour piloter la FAQ.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import type { AIQuestionLogDTO, AIQuestionsStatsDTO } from "@/types";

const querySchema = z.object({
  resolved: z.enum(["true", "false"]).optional(),
  category: z.string().trim().max(30).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  stats: z.enum(["true", "false"]).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

function toDTO(row: {
  id: string; sessionId: string; question: string; answer: string;
  confidence: number | null; resolved: boolean; category: string | null; createdAt: Date;
}): AIQuestionLogDTO {
  return {
    id: row.id,
    sessionId: row.sessionId,
    question: row.question,
    answer: row.answer,
    confidence: row.confidence,
    resolved: row.resolved,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "kb:manage");
    const q = querySchema.parse({
      resolved: (req.nextUrl.searchParams.get("resolved") as "true" | "false" | null) ?? undefined,
      category: req.nextUrl.searchParams.get("category") ?? undefined,
      days: req.nextUrl.searchParams.get("days") ?? undefined,
      stats: (req.nextUrl.searchParams.get("stats") as "true" | "false" | null) ?? undefined,
      take: req.nextUrl.searchParams.get("take") ?? undefined,
    });

    const since = q.days ? new Date(Date.now() - q.days * 24 * 3600 * 1000) : null;
    const where = {
      ...(q.resolved ? { resolved: q.resolved === "true" } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    };

    // ---------- Agrégats qualité ----------
    if (q.stats === "true") {
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const [total, resolved, last7Days, topQuestions, topCategories] = await Promise.all([
        db.aiQuestionLog.count({ where }),
        db.aiQuestionLog.count({ where: { ...where, resolved: true } }),
        db.aiQuestionLog.count({ where: { createdAt: { gte: weekAgo } } }),
        db.aiQuestionLog.groupBy({
          by: ["question"],
          where,
          _count: { question: true },
          orderBy: { _count: { question: "desc" } },
          take: 10,
        }),
        db.aiQuestionLog.groupBy({
          by: ["category"],
          where,
          _count: { category: true },
          orderBy: { _count: { category: "desc" } },
          take: 14,
        }),
      ]);
      const stats: AIQuestionsStatsDTO = {
        total,
        resolved,
        unresolved: total - resolved,
        last7Days,
        topQuestions: topQuestions.map((t) => ({ question: t.question, count: t._count.question })),
        topCategories: topCategories.map((c) => ({ category: c.category, count: c._count.category })),
      };
      return ok(stats);
    }

    const rows = await db.aiQuestionLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: q.take ?? 50,
    });
    return ok(rows.map(toDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/ai-questions");
  }
}
