// PATCH /api/admin/cancellations/contacts/[id] — marquer un client payeur
// comme informé (ou annuler le marquage) après contact WhatsApp / appel.
// booking:manage ; scope agence vérifié côté serveur.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { toCancellationContactDTO } from "@/services/cancellations";

const CONTACT_CHANNELS = ["WHATSAPP", "CALL", "SMS", "AUTRE"] as const;

const patchSchema = z
  .object({
    notified: z.boolean(),
    channel: z.enum(CONTACT_CHANNELS).optional(),
  })
  .refine((v) => v.notified || v.channel === undefined, {
    message: "Un canal ne peut être précisé que pour un contact informé.",
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "booking:manage");
    const body = patchSchema.parse(await req.json().catch(() => null));

    const contact = await db.cancellationContact.findUnique({
      where: { id },
      include: { cancellation: true },
    });
    if (!contact) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Contact introuvable.");

    // Scope agence : un non-global ne gère que son agence
    resolveAgencyScope(auth, contact.cancellation.agencyId);

    const updated = await db.cancellationContact.update({
      where: { id },
      data: {
        notifiedAt: body.notified ? new Date() : null,
        notifiedById: body.notified ? auth.userId : null,
        channel: body.notified ? (body.channel ?? contact.channel ?? "AUTRE") : null,
      },
    });

    await logAudit({
      userId: auth.userId,
      action: body.notified ? "CANCELLATION_CONTACT_NOTIFIED" : "CANCELLATION_CONTACT_UNNOTIFIED",
      entity: "CancellationContact",
      entityId: id,
      metadata: {
        bookingRef: contact.bookingRef,
        channel: updated.channel,
        cancellationId: contact.cancellationId,
      },
    });

    return ok(toCancellationContactDTO(updated));
  } catch (err) {
    return routeError(err, "PATCH /api/admin/cancellations/contacts/[id]");
  }
}
