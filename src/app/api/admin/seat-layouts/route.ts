// GET  /api/admin/seat-layouts — configurations avec nombre de sièges → SeatLayoutDTO[]
// POST /api/admin/seat-layouts — création + GÉNÉRATION des sièges (transaction)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const SEAT_LETTERS = "ABCDEFGH";

const createSchema = z
  .object({
    name: z.string().trim().min(3, "Nom de configuration requis.").max(60),
    rows: z.number().int().min(1, "Minimum 1 rangée.").max(15, "Maximum 15 rangées."),
    columns: z.number().int().min(2, "Minimum 2 colonnes.").max(6, "Maximum 6 colonnes."),
    aisleAfter: z.number().int().min(1).max(5),
    vipRows: z.array(z.number().int().min(1)).max(15).optional().default([]),
    description: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.aisleAfter <= v.columns - 1, {
    message: "Le couloir doit être placé entre les colonnes (1 à columns-1).",
    path: ["aisleAfter"],
  })
  .refine((v) => v.vipRows.every((r) => r >= 1 && r <= v.rows), {
    message: "Les rangées VIP doivent exister (1 à rows).",
    path: ["vipRows"],
  });

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "seatlayout:read");

    const layouts = await db.seatLayout.findMany({
      include: { _count: { select: { seats: true, buses: true } } },
      orderBy: { name: "asc" },
    });

    const data = layouts.map((l) => ({
      id: l.id,
      name: l.name,
      rows: l.rows,
      columns: l.columns,
      aisleAfter: l.aisleAfter,
      description: l.description,
      seatCount: l._count.seats,
    }));

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/seat-layouts");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "seatlayout:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const letters = SEAT_LETTERS.slice(0, body.columns).split("");
    const vipRows = new Set(body.vipRows);
    const seatCount = body.rows * body.columns;

    const layout = await db.$transaction(async (tx) => {
      const created = await tx.seatLayout.create({
        data: {
          name: body.name,
          rows: body.rows,
          columns: body.columns,
          aisleAfter: body.aisleAfter,
          description: body.description ?? null,
        },
      });

      // Numérotation séquentielle paddée « 01 ».., colonnes A,B,C…
      const seats: { seatLayoutId: string; seatNumber: string; row: number; column: string; type: string }[] = [];
      let num = 1;
      for (let r = 1; r <= body.rows; r++) {
        for (let c = 0; c < body.columns; c++) {
          seats.push({
            seatLayoutId: created.id,
            seatNumber: String(num).padStart(2, "0"),
            row: r,
            column: letters[c],
            type: vipRows.has(r) ? "VIP" : "STANDARD",
          });
          num++;
        }
      }
      await tx.seat.createMany({ data: seats });
      return created;
    });

    await logAudit({
      userId: auth.userId,
      action: "SEAT_LAYOUT_CREATED",
      entity: "SeatLayout",
      entityId: layout.id,
      metadata: {
        name: layout.name,
        rows: layout.rows,
        columns: layout.columns,
        seatCount,
        vipRows: body.vipRows,
      },
      ipAddress: ip,
    });

    return ok(
      {
        id: layout.id,
        name: layout.name,
        rows: layout.rows,
        columns: layout.columns,
        aisleAfter: layout.aisleAfter,
        description: layout.description,
        seatCount,
      },
      201
    );
  } catch (err) {
    return routeError(err, "POST /api/admin/seat-layouts");
  }
}
