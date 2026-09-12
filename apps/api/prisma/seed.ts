import {
  InventoryMovementType,
  PrismaClient,
} from "@prisma/client";
import {
  ALL_PERMISSION_KEYS,
  defaultPermissionsForRole,
  Permission,
} from "@wms/shared";
import { hashPassword } from "../src/lib/password.js";
import { cleanupSeedDemoTenantData } from "../src/services/demo-tenant-cleanup.js";
import {
  DEMO_TENANT_CONFIGS,
  printTestUsersGuide,
  seedDemoTenant,
} from "./seed-demo-tenants.js";
import { seedPurchaseReceiptDemos } from "./seed-purchase-receipts.js";
import {
  printFlowStagesGuide,
  seedFlowStageDemos,
  seedFlowStages,
} from "./seed-flow-stages.js";
import {
  printHomologQaGuide,
  seedHomologQaBatch,
} from "./seed-homolog-qa.js";
import {
  printWarehouseDemoGuide,
  seedWarehouseDemo,
} from "./seed-warehouse-demo.js";

const prisma = new PrismaClient();

function atToday(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** URLs estáveis (picsum por SKU) para validar zoom no packing. */
function demoProductImageUrl(sku: string): string {
  return `https://picsum.photos/seed/wms-${encodeURIComponent(sku)}/400/400`;
}

async function main() {
  await cleanupSeedDemoTenantData();

  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: "default" },
    create: { name: "Default", slug: "default", active: true },
    update: { active: true },
  });
  const TENANT_ID = defaultTenant.id;

  // --- Usuários ---
  const admin = await prisma.user.upsert({
    where: { email: "admin@wms.local" },
    create: {
      email: "admin@wms.local",
      name: "Administrador Help Route",
      password: hashPassword("admin123"),
      role: "ADMIN",
      isPlatformAdmin: true,
      tenantId: null,
      permissions: [...ALL_PERMISSION_KEYS],
    },
    update: {
      password: hashPassword("admin123"),
      role: "ADMIN",
      active: true,
      isPlatformAdmin: true,
      tenantId: null,
      permissions: [...ALL_PERMISSION_KEYS],
    },
  });

  const tenantAdminPermissions = defaultPermissionsForRole("ADMIN");

  const admConta = await prisma.user.upsert({
    where: { email: "adm@wms.local" },
    create: {
      email: "adm@wms.local",
      name: "Administrador da Conta",
      password: hashPassword("admin123"),
      role: "ADMIN",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: tenantAdminPermissions,
      active: true,
    },
    update: {
      password: hashPassword("admin123"),
      name: "Administrador da Conta",
      role: "ADMIN",
      active: true,
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: tenantAdminPermissions,
    },
  });

  const adminDefault = await prisma.user.upsert({
    where: { email: "admin@default.local" },
    create: {
      email: "admin@default.local",
      name: "Admin Default",
      password: hashPassword("admin123"),
      role: "ADMIN",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: tenantAdminPermissions,
      active: true,
    },
    update: {
      password: hashPassword("admin123"),
      name: "Admin Default",
      role: "ADMIN",
      active: true,
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: tenantAdminPermissions,
    },
  });

  const felipePermissions = [
    ...new Set([
      ...defaultPermissionsForRole("EXPEDITER"),
      Permission.REGISTERS_VIEW,
      Permission.PRODUCTS_MANAGE,
      Permission.REPORTS_VIEW,
    ]),
  ];

  const operador = await prisma.user.upsert({
    where: { email: "operador@wms.local" },
    create: {
      email: "operador@wms.local",
      name: "Felipe Figueiredo",
      password: hashPassword("operador123"),
      role: "EXPEDITER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
    },
    update: {
      password: hashPassword("operador123"),
      name: "Felipe Figueiredo",
      active: true,
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
    },
  });

  for (const u of [admConta, operador]) {
    const existing = await prisma.tinyConnection.findFirst({
      where: { tenantId: TENANT_ID, userId: u.id, deletedAt: null },
    });
    if (!existing) {
      await prisma.tinyConnection.create({
        data: {
          tenantId: TENANT_ID,
          userId: u.id,
          name: "Tiny ERP",
          isDefault: true,
        },
      });
    }
  }

  const operador2 = await prisma.user.upsert({
    where: { email: "operador2@wms.local" },
    create: {
      email: "operador2@wms.local",
      name: "Ana Operadora",
      password: hashPassword("operador123"),
      role: "EXPEDITER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
    },
    update: {
      password: hashPassword("operador123"),
      name: "Ana Operadora",
      active: true,
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
    },
  });

  const pickerPerms = defaultPermissionsForRole("PICKER");

  const pickerJoao = await prisma.user.upsert({
    where: { email: "picker@wms.local" },
    create: {
      email: "picker@wms.local",
      name: "João Separador",
      password: hashPassword("dev"),
      role: "PICKER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: pickerPerms,
    },
    update: {
      password: hashPassword("dev"),
      tenantId: TENANT_ID,
      permissions: pickerPerms,
    },
  });

  const pickerMaria = await prisma.user.upsert({
    where: { email: "maria@wms.local" },
    create: {
      email: "maria@wms.local",
      name: "Maria Silva",
      password: hashPassword("dev"),
      role: "PICKER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: pickerPerms,
    },
    update: {
      password: hashPassword("dev"),
      tenantId: TENANT_ID,
      permissions: pickerPerms,
    },
  });

  const pickerCarlos = await prisma.user.upsert({
    where: { email: "carlos@wms.local" },
    create: {
      email: "carlos@wms.local",
      name: "Carlos Mendes",
      password: hashPassword("dev"),
      role: "PICKER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: pickerPerms,
    },
    update: {
      password: hashPassword("dev"),
      tenantId: TENANT_ID,
      permissions: pickerPerms,
    },
  });

  const pickers = [pickerJoao, pickerMaria, pickerCarlos];

  // --- Configurações ---
  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId: TENANT_ID, key: "company.name" } },
    create: {
      tenantId: TENANT_ID,
      key: "company.name",
      value: "Help Route",
      description: "Nome exibido no sistema",
    },
    update: { value: "Help Route" },
  });

  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId: TENANT_ID, key: "warehouse.label" } },
    create: {
      tenantId: TENANT_ID,
      key: "warehouse.label",
      value: "CD Brasil · São Paulo",
      description: "Identificação do centro de distribuição",
    },
    update: { value: "CD Brasil · São Paulo" },
  });

  for (const row of [
    { key: "wave.enabled", value: "true", description: "Habilitar onda no mobile" },
    {
      key: "wave.autoRelease.enabled",
      value: "false",
      description: "Liberação automática diária",
    },
    {
      key: "wave.autoRelease.time",
      value: "06:30",
      description: "Horário liberação automática",
    },
    {
      key: "wave.autoRelease.maxOrders",
      value: "50",
      description: "Máximo pedidos por onda",
    },
    {
      key: "wave.onlyDeadlineToday",
      value: "false",
      description: "Somente pedidos com coleta hoje",
    },
    {
      key: "tiny.webhook.secret",
      value: "",
      description: "Token header x-tiny-token",
    },
  ]) {
    await prisma.systemSetting.upsert({
      where: { tenantId_key: { tenantId: TENANT_ID, key: row.key } },
      create: { tenantId: TENANT_ID, ...row },
      update: { value: row.value, description: row.description },
    });
  }

  // --- Produtos ---
  const products = await Promise.all([
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "PAR-6X40" } },
      create: {
        tenantId: TENANT_ID,
        sku: "PAR-6X40",
        name: "Parafuso 6x40 (caixa)",
        requiresItemScan: false,
        barcode: "7891000000001",
        imageUrl: demoProductImageUrl("PAR-6X40"),
      },
      update: { imageUrl: demoProductImageUrl("PAR-6X40") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "MOT-220V" } },
      create: {
        tenantId: TENANT_ID,
        sku: "MOT-220V",
        name: "Motor 220V",
        requiresItemScan: true,
        barcode: "7891000000002",
        imageUrl: demoProductImageUrl("MOT-220V"),
      },
      update: { imageUrl: demoProductImageUrl("MOT-220V") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "CAB-2M" } },
      create: {
        tenantId: TENANT_ID,
        sku: "CAB-2M",
        name: "Cabo elétrico 2m",
        requiresItemScan: false,
        barcode: "7891000000003",
        imageUrl: demoProductImageUrl("CAB-2M"),
      },
      update: { imageUrl: demoProductImageUrl("CAB-2M") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "VAL-1/2" } },
      create: {
        tenantId: TENANT_ID,
        sku: "VAL-1/2",
        name: "Válvula 1/2 pol",
        requiresItemScan: true,
        barcode: "7891000000004",
        imageUrl: demoProductImageUrl("VAL-1/2"),
      },
      update: { imageUrl: demoProductImageUrl("VAL-1/2") },
    }),
    prisma.product.upsert({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: "FUN-150" } },
      create: {
        tenantId: TENANT_ID,
        sku: "FUN-150",
        name: "Filtro UV 150W",
        requiresItemScan: false,
        barcode: "7891000000005",
        imageUrl: demoProductImageUrl("FUN-150"),
      },
      update: { imageUrl: demoProductImageUrl("FUN-150") },
    }),
  ]);

  const [screw, motor, cable] = products;

  const warehouse = await seedWarehouseDemo(prisma, {
    tenantId: TENANT_ID,
    products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
  });

  const pickFaces = warehouse.pickFaces;
  const locCycle = pickFaces;
  const prodCycle = [screw, motor, cable];

  const basketDefs = [
    { code: "CESTA-001", barcode: "BASKET001" },
    { code: "CESTA-002", barcode: "BASKET002" },
    { code: "CESTA-003", barcode: "BASKET003" },
    { code: "CESTA-004", barcode: "BASKET004" },
  ] as const;
  const baskets = await Promise.all(
    basketDefs.map((b) =>
      prisma.basket.upsert({
        where: { tenantId_code: { tenantId: TENANT_ID, code: b.code } },
        create: {
          tenantId: TENANT_ID,
          code: b.code,
          barcode: b.barcode,
        },
        update: {},
      }),
    ),
  );

  const flowStages = await seedFlowStages(prisma, {
    tenantId: TENANT_ID,
    pickerId: pickerJoao.id,
    operadorId: operador.id,
    products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
    pickFaces: pickFaces.map((l) => ({
      id: l.id,
      barcode: l.barcode,
      productId: l.productId,
    })),
    baskets: baskets.map((b) => ({ id: b.id, code: b.code })),
    productWithoutPickFace: {
      id: warehouse.productWithoutPickFace.id,
      sku: warehouse.productWithoutPickFace.sku,
      name: warehouse.productWithoutPickFace.name,
    },
  });

  await seedPurchaseReceiptDemos(prisma, {
    tenantId: TENANT_ID,
    startedById: operador.id,
    products: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      barcode: p.barcode,
    })),
  });

  // Movimentações de pick hoje → gráfico por hora + ranking
  const hourlyPlan: Array<{ hour: number; pickerIdx: number; qty: number }> = [
    { hour: 7, pickerIdx: 0, qty: 42 },
    { hour: 8, pickerIdx: 0, qty: 88 },
    { hour: 8, pickerIdx: 1, qty: 52 },
    { hour: 9, pickerIdx: 0, qty: 120 },
    { hour: 9, pickerIdx: 1, qty: 95 },
    { hour: 9, pickerIdx: 2, qty: 78 },
    { hour: 10, pickerIdx: 0, qty: 156 },
    { hour: 10, pickerIdx: 1, qty: 134 },
    { hour: 10, pickerIdx: 2, qty: 112 },
    { hour: 11, pickerIdx: 1, qty: 198 },
    { hour: 11, pickerIdx: 2, qty: 165 },
    { hour: 12, pickerIdx: 0, qty: 90 },
    { hour: 13, pickerIdx: 1, qty: 210 },
    { hour: 13, pickerIdx: 2, qty: 187 },
    { hour: 14, pickerIdx: 0, qty: 245 },
    { hour: 14, pickerIdx: 1, qty: 220 },
    { hour: 15, pickerIdx: 2, qty: 178 },
    { hour: 16, pickerIdx: 0, qty: 132 },
    { hour: 16, pickerIdx: 1, qty: 98 },
  ];

  await prisma.inventoryMovement.deleteMany({
    where: { reference: "seed-demo" },
  });

  for (const slot of hourlyPlan) {
    const picker = pickers[slot.pickerIdx]!;
    const prod = prodCycle[slot.pickerIdx % prodCycle.length]!;
    const loc = locCycle[slot.pickerIdx % locCycle.length]!;
    await prisma.inventoryMovement.create({
      data: {
        tenantId: TENANT_ID,
        type: InventoryMovementType.PICK_ALLOCATION,
        quantity: slot.qty,
        userId: picker.id,
        productId: prod.id,
        fromLocationId: loc.id,
        reference: "seed-demo",
        createdAt: atToday(slot.hour, 30),
      },
    });
  }

  await seedFlowStageDemos(prisma, {
    tenantId: TENANT_ID,
    userId: operador.id,
    productId: screw.id,
    pickLocationId: locA.id,
    basketId: basket1.id,
  });

  const homologQa = await seedHomologQaBatch(prisma, {
    tenantId: TENANT_ID,
    products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
    pickFaces: pickFaces.map((l) => ({
      id: l.id,
      barcode: l.barcode,
      productId: l.productId,
    })),
  });

  for (const config of DEMO_TENANT_CONFIGS) {
    await seedDemoTenant(prisma, config);
  }

  const notifyUsers = [admin, operador, operador2, ...pickers];
  for (const u of notifyUsers) {
    await prisma.notification.createMany({
      data: [
        {
          userId: u.id,
          title: "Bem-vindo ao Help Route",
          body: "Suas notificações operacionais aparecerão aqui.",
          category: "SYSTEM",
        },
        {
          userId: u.id,
          title: "Gôndolas em alerta",
          body: "4 localizações estão abaixo do estoque mínimo.",
          category: "STOCK",
        },
      ],
    });
  }

  console.log("\n=== Help Route — tenant default (dados completos) ===\n");
  console.log("Dashboard / abas (seed local):");
  console.log("  PENDING + onda: DEMO-PENDING-01, DEMO-WAVE-ORDER-01");
  console.log("  PICKING: DEMO-PICKING-01");
  console.log("  PAUSED: DEMO-PAUSED-01 (SKU), DEMO-PAUSED-NO-FACE-01 (sem giro)");
  console.log("  Packing: DEMO-PACKING-01, TINY-862886936 (com etiqueta ZPL)");
  console.log("  DISPATCHING / DISPATCHED: DEMO-DISPATCHING-01 / DEMO-DISPATCHED-01");
  console.log("  Layout: Gestão Barracão → BAURU (giro + pulmão)\n");
  printWarehouseDemoGuide(warehouse);
  printFlowStagesGuide(flowStages);
  printHomologQaGuide(homologQa);
  printTestUsersGuide();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
