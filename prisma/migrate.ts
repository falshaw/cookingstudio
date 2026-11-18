// Applies prisma/migrations with the OWNER url (the runtime role has no DDL). Runs in the one-shot init
// container before the seed, or on the host:
//   DATABASE_URL=postgresql://kitchen:…@127.0.0.1:15432/kitchen npx tsx prisma/migrate.ts
// A database created before migrations existed (schema from `prisma db push`, no _prisma_migrations table)
// is baselined first: 0_init (that schema) is marked as applied, then the newer migrations run on it.
// Later migrations that a db-push database may already contain are written idempotently (see 20261118000000_spending).
import "dotenv/config";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const [row] = await prisma.$queryRawUnsafe<{ tables: boolean; history: boolean }[]>(
    `SELECT to_regclass('public."User"') IS NOT NULL AS tables, to_regclass('public."_prisma_migrations"') IS NOT NULL AS history`,
  );
  await prisma.$disconnect();
  if (row.tables && !row.history) {
    console.log("migrate: existing schema without migration history, baselining 0_init");
    execSync("npx prisma migrate resolve --applied 0_init", { stdio: "inherit" });
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
