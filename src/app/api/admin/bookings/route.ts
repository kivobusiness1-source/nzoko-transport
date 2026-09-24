// GET /api/admin/bookings?page&status&q&agencyId — toutes réservations (booking:read, scope)
// Paginé (20/page), filtres statut + q (référence / nom / téléphone).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { buildPaginated, parsePagination, queryString } from "@/lib/api-helpers";
import { BOOKING_STATUSES } from "@/lib/constants";
import { toBookingDTO } from "@/services/booking";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const statusSchema = z.enum(BOOKING_STATUSES).optional();

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "booking:read");
    const agencyId = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"));

    const { page, pageSize } = parsePagination(req.nextUrl, 20);
    const status = statusSchema.parse(queryString(req.nextUrl, "status"));
    const q = queryString(req.nextUrl, "q");

    const where: Prisma.BookingWhereInput = {
      ...(agencyId ? { agencyId } : {}),
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { bookingReference: { contains: q.toUpperCase() } },
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
          }
        : {}),
    };

    const [total, bookings] = await Promise.all([
      db.booking.count({ where }),
      db.booking.findMany({
        where,
        include: {
          trip: { include: { route: { include: { originCity: true, destinationCity: true } }, bus: true, agency: true } },
          seat: true,
          passenger: true,
          agency: true,
          createdBy: true,
          dropOffNeighborhood: { select: { id: true, name: true, city: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return ok(buildPaginated(bookings.map(toBookingDTO), total, page, pageSize));
  } catch (err) {
    return routeError(err, "GET /api/admin/bookings");
  }
}
