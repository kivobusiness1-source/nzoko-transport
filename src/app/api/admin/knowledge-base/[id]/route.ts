// PATCH  /api/admin/knowledge-base/[id] — modification (kb:manage) → version incrémentée
// DELETE /api/admin/knowledge-base/[id] — suppression physique (kb:manage)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { KNOWLEDGE_CATEGORIES } from "@/types";
import { toKnowledgeBaseDTO } from "../route";

const patchSchema = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  question: z.string().trim().min(5).max(300).optional(),
  answer: z.string().trim().min(10).max(2000).optional(),
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  keywords: z.string().trim().max(500).optional(),
  cityId: z.string().trim().length(25).nullable().optional(),
  agencyId: z.string().trim().length(25).nullable().optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

const listInclude = {
  city: { select: { name: true } },
  agency: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  updatedBy: { select: { firstName: true, lastName: true } },
} as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "kb:manage");
    const { id } = await params;
    const body = patchSchema.parse(await req.json().catch(() => null));

    const existing = await db.knowledgeBase.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "FAQ introuvable.");

    const row = await db.knowledgeBase.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.question !== undefined ? { question: body.question } : {}),
        ...(body.answer !== undefined ? { answer: body.answer } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.keywords !== undefined ? { keywords: body.keywords } : {}),
        ...(body.cityId !== undefined ? { cityId: body.cityId } : {}),
        ...(body.agencyId !== undefined ? { agencyId: body.agencyId } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedById: auth.userId,
        version: { increment: 1 }, // traçabilité des modifications
      },
      include: listInclude,
    });

    await logAudit({
      userId: auth.userId,
      action: "KB_UPDATED",
      entity: "KnowledgeBase",
      entityId: id,
      metadata: { changes: Object.keys(body), version: row.version },
      ipAddress: getClientIp(req),
    });

    return ok(toKnowledgeBaseDTO(row));
  } catch (err) {
    return routeError(err, "PATCH /api/admin/knowledge-base/[id]");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "kb:manage");
    const { id } = await params;

    const existing = await db.knowledgeBase.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "FAQ introuvable.");

    await db.knowledgeBase.delete({ where: { id } });
    await logAudit({
      userId: auth.userId,
      action: "KB_DELETED",
      entity: "KnowledgeBase",
      entityId: id,
      metadata: { title: existing.title },
      ipAddress: getClientIp(req),
    });
    return ok({ deleted: true });
  } catch (err) {
    return routeError(err, "DELETE /api/admin/knowledge-base/[id]");
  }
}
