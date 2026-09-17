// ============================================================
// NZOKO TRANSPORT — Administration : clients & fidélité (lecture)
// Résolution complète client ↔ passagers (userId OU téléphone),
// agrégats voyages/dépenses/points par client — partagé entre
// /api/admin/clients (liste) et /api/admin/clients/stats.
// ============================================================

import { db } from "@/lib/db";
import { tierForPoints } from "@/services/loyalty";
import type { LoyaltyTier } from "@/lib/constants";

export interface AdminClientRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  tripsCompleted: number;
  totalSpent: number;
  pointsBalance: number;
  lifetimePoints: number;
  tier: LoyaltyTier;
  lastTripAt: Date | null;
  inactiveDays: number | null; // null si jamais voyagé
}

/**
 * Charge TOUTES les lignes clients (rôle PASSENGER) avec leurs agrégats.
 * Recherche optionnelle q sur nom/téléphone/email. Tri : dernier voyage
 * DESC, jamais-voyagés en fin (nulls last).
 */
export async function loadAdminClientRows(q?: string): Promise<AdminClientRow[]> {
  const trimmed = q?.trim();
  const where = trimmed
    ? {
        role: { code: "PASSENGER" as const },
        OR: [
          { firstName: { contains: trimmed } },
          { lastName: { contains: trimmed } },
          { email: { contains: trimmed } },
          { phone: { contains: trimmed.replace(/\D/g, "") || trimmed } },
        ],
      }
    : { role: { code: "PASSENGER" as const } };

  const users = await db.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      loyaltyAccount: { select: { pointsBalance: true, lifetimePoints: true } },
    },
  });
  if (users.length === 0) return [];

  // Passagers liés : userId explicite OU téléphone correspondant
  const userIds = users.map((u) => u.id);
  const phoneToUser = new Map<string, string>();
  for (const u of users) {
    if (u.phone) phoneToUser.set(u.phone, u.id);
  }
  const userPhones = [...phoneToUser.keys()];

  const passengers = await db.passenger.findMany({
    where: { OR: [{ userId: { in: userIds } }, ...(userPhones.length > 0 ? [{ phone: { in: userPhones } }] : [])] },
    select: { id: true, userId: true, phone: true },
  });

  const passengerToUser = new Map<string, string>();
  for (const p of passengers) {
    if (p.userId && userIds.includes(p.userId)) {
      passengerToUser.set(p.id, p.userId);
    } else if (p.phone) {
      const owner = phoneToUser.get(p.phone);
      if (owner) passengerToUser.set(p.id, owner);
    }
  }
  const passengerIds = [...passengerToUser.keys()];

  // Voyages effectués (payés + départ passé) — lastTripAt & compteur
  const now = Date.now();
  const completedByUser = new Map<string, { count: number; last: Date }>();
  if (passengerIds.length > 0) {
    const bookings = await db.booking.findMany({
      where: {
        passengerId: { in: passengerIds },
        status: { in: ["CONFIRMED", "COMPLETED"] },
      },
      select: { passengerId: true, trip: { select: { departureTime: true } } },
    });
    for (const b of bookings) {
      // Ne compte que les voyages réellement partis (départ passé)
      if (b.trip.departureTime.getTime() >= now) continue;
      const uid = passengerToUser.get(b.passengerId);
      if (!uid) continue;
      const entry = completedByUser.get(uid);
      if (entry) {
        entry.count += 1;
        if (b.trip.departureTime > entry.last) entry.last = b.trip.departureTime;
      } else {
        completedByUser.set(uid, { count: 1, last: b.trip.departureTime });
      }
    }
  }

  // Dépenses : paiements SUCCESS sur les réservations des passagers liés
  const spentByUser = new Map<string, number>();
  if (passengerIds.length > 0) {
    const payments = await db.payment.findMany({
      where: { status: "SUCCESS", booking: { passengerId: { in: passengerIds } } },
      select: { amount: true, booking: { select: { passengerId: true } } },
    });
    for (const p of payments) {
      const uid = passengerToUser.get(p.booking.passengerId);
      if (!uid) continue;
      spentByUser.set(uid, (spentByUser.get(uid) ?? 0) + p.amount);
    }
  }

  const rows: AdminClientRow[] = users.map((u) => {
    const completed = completedByUser.get(u.id);
    const lastTripAt = completed ? completed.last : null;
    const lifetime = u.loyaltyAccount?.lifetimePoints ?? 0;
    return {
      id: u.id,
      fullName: `${u.firstName} ${u.lastName}`,
      email: u.email,
      phone: u.phone,
      createdAt: u.createdAt,
      tripsCompleted: completed?.count ?? 0,
      totalSpent: spentByUser.get(u.id) ?? 0,
      pointsBalance: u.loyaltyAccount?.pointsBalance ?? 0,
      lifetimePoints: lifetime,
      tier: tierForPoints(lifetime),
      lastTripAt,
      inactiveDays:
        lastTripAt !== null
          ? Math.floor((now - lastTripAt.getTime()) / 86_400_000)
          : null,
    };
  });

  // Tri : dernier voyage DESC, jamais-voyagés à la fin
  rows.sort((a, b) => {
    if (a.lastTripAt === null && b.lastTripAt === null) return b.createdAt.getTime() - a.createdAt.getTime();
    if (a.lastTripAt === null) return 1;
    if (b.lastTripAt === null) return -1;
    return b.lastTripAt.getTime() - a.lastTripAt.getTime();
  });

  return rows;
}

/**
 * Segment de campagne :
 *  - INACTIVE : sans voyage depuis INACTIVE_CLIENT_DAYS jours (jamais
 *    voyagé + compte ancien inclus)
 *  - BRONZE/SILVER/GOLD/VIP : palier courant
 *  - ALL : tous les clients
 */
export async function campaignUserIds(segment: "INACTIVE" | "BRONZE" | "SILVER" | "GOLD" | "VIP" | "ALL"): Promise<string[]> {
  const rows = await loadAdminClientRows();
  if (segment === "ALL") return rows.map((r) => r.id);
  if (segment === "INACTIVE") {
    const cutoff = Date.now() - 60 * 86_400_000;
    return rows
      .filter(
        (r) =>
          (r.lastTripAt !== null && r.lastTripAt.getTime() < cutoff) ||
          (r.lastTripAt === null && r.createdAt.getTime() < cutoff)
      )
      .map((r) => r.id);
  }
  return rows.filter((r) => r.tier === segment).map((r) => r.id);
}
