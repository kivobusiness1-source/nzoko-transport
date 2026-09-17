// GET /api/admin/payments?status&provider&q — paiements (payment:read)
// Scope agence pour les non-globaux (via la réservation) ; q sur référence/nom/téléphone.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { queryString } from "@/lib/api-helpers";
import { PAYMENT_PROVIDERS, PAYMENT_STATUSES } from "@/lib/constants";
import { toPaymentDTO } from "@/services/payment-mappers";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const filterSchema = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  provider: z.enum(PAYMENT_PROVIDERS).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "payment:read");
    const agencyId = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"), ["ACCOUNTANT"]);

    const filters = filterSchema.parse({
      status: queryString(req.nextUrl, "status"),
      provider: queryString(req.nextUrl, "provider"),
    });
    const q = queryString(req.nextUrl, "q");

    const where: Prisma.PaymentWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(agencyId ? { booking: { agencyId } } : {}),
      ...(q
        ? {
            booking: {
              ...(agencyId ? { agencyId } : {}),
              OR: [
                { bookingReference: { contains: q } },
                {
                  passenger: {
                    OR: [
                      { firstName: { contains: q } },
                      { lastName: { contains: q } },
                      { phone: { contains: q } },
                    ],
                  },
                },
              ],
            },
          }
        : {}),
    };

    const payments = await db.payment.findMany({
      where,
      include: {
        createdBy: true,
        booking: { include: { passenger: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const data = payments.map((p) => ({
      ...toPaymentDTO(p),
      passengerName: `${p.booking.passenger.firstName} ${p.booking.passenger.lastName}`.trim(),
    }));

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/payments");
  }
}
