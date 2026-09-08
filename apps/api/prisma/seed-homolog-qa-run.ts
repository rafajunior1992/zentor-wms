/**
 * Recria só pedidos QA-H-* (não limpa o tenant).
 *   pnpm --filter @wms/api seed:homolog-qa
 */
import { PrismaClient } from "@prisma/client";
import {
  printHomologQaGuide,
  runHomologQaSeedForDefaultTenant,
} from "../src/services/homolog-qa-seed.js";

const prisma = new PrismaClient();

async function main() {
  const result = await runHomologQaSeedForDefaultTenant(prisma);
  printHomologQaGuide(result);
  console.log("OK — pedidos QA-H-* recriados.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
