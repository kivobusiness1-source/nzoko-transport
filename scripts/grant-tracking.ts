import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  // Création de la permission si absente
  const perm = await db.permission.upsert({
    where: { code: "tracking:read" },
    update: {},
    create: { code: "tracking:read", name: "Suivi GPS de la flotte" },
  });
  console.log("✓ permission", perm.code);

  // Attribution : SUPER_ADMIN, ADMIN, AGENCY_MANAGER
  const roles = await db.role.findMany({ where: { code: { in: ["SUPER_ADMIN", "ADMIN", "AGENCY_MANAGER"] } } });
  for (const role of roles) {
    const exists = await db.rolePermission.findFirst({ where: { roleId: role.id, permissionId: perm.id } });
    if (!exists) {
      await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      console.log(`✓ ${role.code} → tracking:read`);
    } else {
      console.log(`• ${role.code} possède déjà tracking:read`);
    }
  }
}
main().finally(() => db.$disconnect());
