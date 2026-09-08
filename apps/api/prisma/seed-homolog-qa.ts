import { OrderStatus, type PrismaClient } from "@prisma/client";

const ERP_PREFIX = "QA-H-";
const PENDING_COUNT = 12;

type SeedProduct = { id: string; sku: string; name: string };
type SeedLocation = { id: string; barcode: string; productId: string | null };

export type SeedHomologQaInput = {
  tenantId: string;
  products: SeedProduct[];
  pickFaces: SeedLocation[];
};

function deadlineHoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function wipeQaBatch(prisma: PrismaClient, tenantId: string) {
  await prisma.orderTimeLog.deleteMany({
    where: { order: { tenantId, erpOrderId: { startsWith: ERP_PREFIX } } },
  });
  await prisma.orderStageLog.deleteMany({
    where: { tenantId, order: { erpOrderId: { startsWith: ERP_PREFIX } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { tenantId, erpOrderId: { startsWith: ERP_PREFIX } } },
  });
  await prisma.order.deleteMany({
    where: { tenantId, erpOrderId: { startsWith: ERP_PREFIX } },
  });
}

/**
 * Só pedidos PENDING (QA-H-*) para homologação:
 * aceitar → picking → packing → expedição com o fluxo real.
 */
export async function seedHomologQaBatch(
  prisma: PrismaClient,
  input: SeedHomologQaInput,
) {
  const { tenantId, products, pickFaces } = input;

  const [p0, p1, p2] = products;
  if (!p0 || !p1 || !p2) {
    throw new Error("seedHomologQaBatch: precisa de 3 produtos");
  }
  if (pickFaces.length < 3) {
    throw new Error("seedHomologQaBatch: precisa de ≥3 gôndolas");
  }

  const loc0 = pickFaces.find((l) => l.productId === p0.id) ?? pickFaces[0]!;
  const loc1 = pickFaces.find((l) => l.productId === p1.id) ?? pickFaces[1]!;
  const loc2 = pickFaces.find((l) => l.productId === p2.id) ?? pickFaces[2]!;

  await wipeQaBatch(prisma, tenantId);

  const marketplaces = [
    "MERCADO_LIVRE",
    "SHOPEE",
    "AMAZON",
    "OLIST",
    "MAGAZINE_LUIZA",
  ] as const;

  const pendingIds: string[] = [];
  for (let i = 1; i <= PENDING_COUNT; i++) {
    const erpOrderId = `${ERP_PREFIX}${String(i).padStart(2, "0")}`;
    pendingIds.push(erpOrderId);
    const mp = marketplaces[(i - 1) % marketplaces.length]!;
    await prisma.order.create({
      data: {
        tenantId,
        erpOrderId,
        status: OrderStatus.PENDING,
        customerName: `QA Homolog ${i}`,
        marketplace: mp,
        priority: 40 + i * 5,
        collectionDeadline: deadlineHoursFromNow(2 + (i % 6)),
        notes: "QA homolog — aceite → picking → packing → expedição",
        items: {
          create: [
            {
              lineNumber: 1,
              productId: p0.id,
              pickLocationId: loc0.id,
              quantityOrdered: 1 + (i % 3),
              quantityPicked: 0,
              quantityPacked: 0,
            },
            {
              lineNumber: 2,
              productId: i % 2 === 0 ? p1.id : p2.id,
              pickLocationId: i % 2 === 0 ? loc1.id : loc2.id,
              quantityOrdered: 1,
              quantityPicked: 0,
              quantityPacked: 0,
            },
          ],
        },
      },
    });
  }

  return { pendingCount: pendingIds.length, pendingIds };
}

export function printHomologQaGuide(
  result: Awaited<ReturnType<typeof seedHomologQaBatch>>,
) {
  console.log("\n=== Pedidos QA Homolog (QA-H-*) ===\n");
  console.log(`${result.pendingCount} PENDING prontos para o fluxo completo:`);
  console.log(`  ${result.pendingIds.join(", ")}`);
  console.log("");
}
