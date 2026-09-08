import { OrderStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const HOMOLOG_QA_ERP_PREFIX = "QA-H-";
const PENDING_COUNT = 12;

type SeedProduct = { id: string; sku: string; name: string };
type SeedLocation = { id: string; barcode: string; productId: string | null };

export type SeedHomologQaInput = {
  tenantId: string;
  products: SeedProduct[];
  pickFaces: SeedLocation[];
};

export type SeedHomologQaResult = {
  pendingCount: number;
  pendingIds: string[];
};

function deadlineHoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function wipeQaBatch(client: PrismaClient, tenantId: string) {
  await client.orderTimeLog.deleteMany({
    where: {
      order: { tenantId, erpOrderId: { startsWith: HOMOLOG_QA_ERP_PREFIX } },
    },
  });
  await client.orderStageLog.deleteMany({
    where: {
      tenantId,
      order: { erpOrderId: { startsWith: HOMOLOG_QA_ERP_PREFIX } },
    },
  });
  await client.orderItem.deleteMany({
    where: {
      order: { tenantId, erpOrderId: { startsWith: HOMOLOG_QA_ERP_PREFIX } },
    },
  });
  await client.order.deleteMany({
    where: { tenantId, erpOrderId: { startsWith: HOMOLOG_QA_ERP_PREFIX } },
  });
}

/**
 * Só pedidos PENDING (QA-H-*) para homologação:
 * aceitar → picking → packing → expedição com o fluxo real.
 */
export async function seedHomologQaBatch(
  client: PrismaClient,
  input: SeedHomologQaInput,
): Promise<SeedHomologQaResult> {
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

  await wipeQaBatch(client, tenantId);

  const marketplaces = [
    "MERCADO_LIVRE",
    "SHOPEE",
    "AMAZON",
    "OLIST",
    "MAGAZINE_LUIZA",
  ] as const;

  const pendingIds: string[] = [];
  for (let i = 1; i <= PENDING_COUNT; i++) {
    const erpOrderId = `${HOMOLOG_QA_ERP_PREFIX}${String(i).padStart(2, "0")}`;
    pendingIds.push(erpOrderId);
    const mp = marketplaces[(i - 1) % marketplaces.length]!;
    await client.order.create({
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

/** Resolve tenant default + produtos/gôndolas e recria o lote QA-H-*. */
export async function runHomologQaSeedForDefaultTenant(
  client: PrismaClient = prisma,
): Promise<SeedHomologQaResult> {
  const tenant = await client.tenant.findFirst({
    where: { slug: "default" },
  });
  if (!tenant) {
    throw new Error('Tenant "default" não encontrado — rode o seed completo antes');
  }

  const products = await client.product.findMany({
    where: { tenantId: tenant.id, active: true },
    take: 5,
    orderBy: { sku: "asc" },
    select: { id: true, sku: true, name: true },
  });
  if (products.length < 3) {
    throw new Error("Precisa de pelo menos 3 produtos ativos");
  }

  const pickFaces = await client.location.findMany({
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

  return seedHomologQaBatch(client, {
    tenantId: tenant.id,
    products,
    pickFaces,
  });
}

export function printHomologQaGuide(result: SeedHomologQaResult) {
  console.log("\n=== Pedidos QA Homolog (QA-H-*) ===\n");
  console.log(`${result.pendingCount} PENDING prontos para o fluxo completo:`);
  console.log(`  ${result.pendingIds.join(", ")}`);
  console.log("");
}
