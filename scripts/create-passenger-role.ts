// One-shot : crée le rôle PASSENGER (idempotent) — Task ID 10.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const role = await db.role.upsert({
    where: { code: "PASSENGER" },
    update: {},
    create: {
      code: "PASSENGER",
      name: "Client NZOKO",
      description: "Espace client : billets, fidélité, réclamations",
      isSystem: true,
    },
  });
  console.log("✓ Rôle PASSENGER prêt:", role.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
