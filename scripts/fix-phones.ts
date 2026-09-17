// One-shot : prépare les données existantes pour l'unicité User.phone
// + la normalisation E.164 (Passenger & User) — Task ID 10.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** E.164 digits Congo : "06 123 45 67" / "+242 06 123 45 67" → "242061234567" */
function norm(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("242")) return digits;
  if (digits.startsWith("0")) return `242${digits}`;
  if (digits.length === 8) return `2420${digits}`; // 6 123 45 67 sans le 0
  return digits.startsWith("242") ? digits : null;
}

async function main() {
  // 1) Staff : téléphones distincts (le seed mettait le même pour tous)
  const staff = await db.user.findMany({ where: { phone: { not: null } }, orderBy: { createdAt: "asc" } });
  const seen = new Set<string>();
  let i = 0;
  for (const u of staff) {
    const raw = u.phone ?? "";
    const n = norm(raw);
    if (!n) {
      i += 1;
      await db.user.update({ where: { id: u.id }, data: { phone: `24206770000${String(i).padStart(2, "0")}` } });
      console.log(`user ${u.email} → téléphone synthétique`);
      continue;
    }
    if (seen.has(n)) {
      i += 1;
      const distinct = n.slice(0, 10) + String(i).padStart(2, "0");
      await db.user.update({ where: { id: u.id }, data: { phone: distinct } });
      console.log(`user ${u.email} → dédoublonné ${distinct}`);
      seen.add(distinct);
    } else {
      seen.add(n);
      if (raw !== n) await db.user.update({ where: { id: u.id }, data: { phone: n } });
    }
  }

  // 2) Passagers : normalisation E.164
  const passengers = await db.passenger.findMany();
  for (const p of passengers) {
    const n = norm(p.phone);
    if (n && n !== p.phone) {
      await db.passenger.update({ where: { id: p.id }, data: { phone: n } });
      console.log(`passenger ${p.id} → ${n}`);
    }
  }

  console.log("✓ Données prêtes pour l'index unique User.phone");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
