// GET  /api/admin/knowledge-base?category&cityId&active&q — FAQ de l'assistant (kb:manage)
// POST /api/admin/knowledge-base — création (kb:manage)
// V3 — la base de connaissances officielle : le LLM ne répond JAMAIS hors base.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { KNOWLEDGE_CATEGORIES, type KnowledgeBaseDTO } from "@/types";

const listInclude = {
  city: { select: { name: true } },
  agency: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  updatedBy: { select: { firstName: true, lastName: true } },
} as const;

type Row = Awaited<ReturnType<typeof db.knowledgeBase.findFirst<{ include: typeof listInclude }>>>;

export function toKnowledgeBaseDTO(row: NonNullable<Row>): KnowledgeBaseDTO {
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    answer: row.answer,
    category: row.category,
    keywords: row.keywords,
    cityId: row.cityId,
    cityName: row.city?.name ?? null,
    agencyId: row.agencyId,
    agencyName: row.agency?.name ?? null,
    isActive: row.isActive,
    priority: row.priority,
    version: row.version,
    createdByName: row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : null,
    updatedByName: row.updatedBy ? `${row.updatedBy.firstName} ${row.updatedBy.lastName}` : null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "kb:manage");
    const category = req.nextUrl.searchParams.get("category");
    const cityId = req.nextUrl.searchParams.get("cityId");
    const agencyId = req.nextUrl.searchParams.get("agencyId");
    const active = req.nextUrl.searchParams.get("active");
    const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase();

    const rows = await db.knowledgeBase.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(cityId ? { cityId } : {}),
        ...(agencyId ? { agencyId } : {}),
        ...(active === "true" || active === "false" ? { isActive: active === "true" } : {}),
        ...(q ? { OR: [{ title: { contains: q } }, { question: { contains: q } }, { answer: { contains: q } }, { keywords: { contains: q } }] } : {}),
      },
      include: listInclude,
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });
    return ok(rows.map(toKnowledgeBaseDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/knowledge-base");
  }
}

const createSchema = z.object({
  title: z.string().trim().min(3, "Titre requis.").max(120),
  question: z.string().trim().min(5, "Question requise.").max(300),
  answer: z.string().trim().min(10, "Réponse requise.").max(2000),
  category: z.enum(KNOWLEDGE_CATEGORIES),
  keywords: z.string().trim().max(500).optional(),
  cityId: z.string().trim().length(25).nullable().optional(),
  agencyId: z.string().trim().length(25).nullable().optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "kb:manage");
    const body = createSchema.parse(await req.json().catch(() => null));

    if (body.cityId) {
      const city = await db.city.findUnique({ where: { id: body.cityId } });
      if (!city) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Ville introuvable.");
    }
    if (body.agencyId) {
      const agency = await db.agency.findUnique({ where: { id: body.agencyId } });
      if (!agency) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Agence introuvable.");
    }

    const row = await db.knowledgeBase.create({
      data: {
        title: body.title,
        question: body.question,
        answer: body.answer,
        category: body.category,
        keywords: body.keywords ?? "",
        cityId: body.cityId ?? null,
        agencyId: body.agencyId ?? null,
        priority: body.priority ?? 0,
        isActive: body.isActive ?? true,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
      include: listInclude,
    });

    await logAudit({
      userId: auth.userId,
      action: "KB_CREATED",
      entity: "KnowledgeBase",
      entityId: row.id,
      metadata: { title: row.title, category: row.category },
      ipAddress: getClientIp(req),
    });

    return ok(toKnowledgeBaseDTO(row), 201);
  } catch (err) {
    return routeError(err, "POST /api/admin/knowledge-base");
  }
}
