/**
 * Recria só pedidos QA-H-* (não limpa o tenant).
 *   pnpm --filter @wms/api seed:homolog-qa
 */
import { PrismaClient } from "@prisma/client";
import {
  printHomologQaGuide,
  seedHomologQaBatch,
} from "./seed-homolog-qa.js";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: "default" },
  });
  if (!tenant) {
    throw new Error('Tenant "default" não encontrado — rode o seed completo antes');
  }

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id, active: true },
    take: 5,
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, name: true },
  });
  if (products.length < 3) {
    throw new Error("Precisa de pelo menos 3 produtos ativos");
  }

  const pickFaces = await prisma.location.findMany({
    where: {
      tenantId: tenant.id,
      type: "PICK_FACE",
      productId: { not: null },
    },
    take: 10,
    select: { id: true, barcode: true, productId: true },
  });
  if (pickFaces.length < 3) {
    throw new Error("Precisa de pelo menos 3 gôndolas PICK_FACE com produto");
  }

  const result = await seedHomologQaBatch(prisma, {
    tenantId: tenant.id,
    products,
    pickFaces,
  });

  printHomologQaGuide(result);
  console.log("OK — pedidos QA-H-* recriados.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
