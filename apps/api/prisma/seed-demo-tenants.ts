import { PrismaClient } from "@prisma/client";
import { defaultPermissionsForRole } from "@wms/shared";
import { hashPassword } from "../src/lib/password.js";

const ADMIN_PASSWORD = "admin123";
const PICKER_PASSWORD = "dev";

export type DemoTenantSeedConfig = {
  slug: string;
  name: string;
  prefix: string;
  adminEmail: string;
  pickerEmail: string;
  cnpj?: string;
};

export const DEMO_TENANT_CONFIGS: DemoTenantSeedConfig[] = [
  {
    slug: "demo-loja-a",
    name: "Loja Demo A",
    prefix: "LOJA-A",
    adminEmail: "admin@loja-a.local",
    pickerEmail: "picker@loja-a.local",
    cnpj: "35.635.824/0001-12",
  },
  {
    slug: "demo-loja-b",
    name: "Loja Demo B",
    prefix: "LOJA-B",
    adminEmail: "admin@loja-b.local",
    pickerEmail: "picker@loja-b.local",
    cnpj: "15.436.940/0001-03",
  },
  {
    slug: "demo-loja-c",
    name: "Loja Demo C",
    prefix: "LOJA-C",
    adminEmail: "admin@loja-c.local",
    pickerEmail: "picker@loja-c.local",
    cnpj: "11.222.333/0001-44",
  },
];

export async function seedDemoTenant(
  prisma: PrismaClient,
  config: DemoTenantSeedConfig,
) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: config.slug },
    create: {
      name: config.name,
      slug: config.slug,
      cnpj: config.cnpj ?? null,
      active: true,
    },
    update: {
      name: config.name,
      cnpj: config.cnpj ?? null,
      active: true,
    },
  });
  const tenantId = tenant.id;

  const adminPerms = defaultPermissionsForRole("ADMIN");
  const pickerPerms = defaultPermissionsForRole("PICKER");

  const admin = await prisma.user.upsert({
    where: { email: config.adminEmail },
    create: {
      email: config.adminEmail,
      name: `Admin ${config.name}`,
      password: hashPassword(ADMIN_PASSWORD),
      role: "ADMIN",
      tenantId,
      isPlatformAdmin: false,
      permissions: adminPerms,
      active: true,
    },
    update: {
      password: hashPassword(ADMIN_PASSWORD),
      tenantId,
      isPlatformAdmin: false,
      permissions: adminPerms,
      active: true,
    },
  });

  const existingTiny = await prisma.tinyConnection.findFirst({
    where: { tenantId, userId: admin.id, deletedAt: null },
  });
  if (!existingTiny) {
    await prisma.tinyConnection.create({
      data: {
        tenantId,
        userId: admin.id,
        name: "Tiny ERP",
        isDefault: true,
      },
    });
  }

  const picker = await prisma.user.upsert({
    where: { email: config.pickerEmail },
    create: {
      email: config.pickerEmail,
      name: `Separador ${config.name}`,
      password: hashPassword(PICKER_PASSWORD),
      role: "PICKER",
      tenantId,
      isPlatformAdmin: false,
      permissions: pickerPerms,
      active: true,
    },
    update: {
      password: hashPassword(PICKER_PASSWORD),
      tenantId,
      isPlatformAdmin: false,
      permissions: pickerPerms,
      active: true,
    },
  });

  await prisma.systemSetting.upsert({
    where: { tenantId_key: { tenantId, key: "company.name" } },
    create: {
      tenantId,
      key: "company.name",
      value: config.name,
      description: "Nome exibido no sistema",
    },
    update: { value: config.name },
  });

  const sku1 = `${config.prefix}-SKU-01`;
  const sku2 = `${config.prefix}-SKU-02`;
  const imageUrl1 = `https://picsum.photos/seed/wms-${encodeURIComponent(sku1)}/400/400`;
  const imageUrl2 = `https://picsum.photos/seed/wms-${encodeURIComponent(sku2)}/400/400`;

  const product = await prisma.product.upsert({
    where: { tenantId_sku: { tenantId, sku: sku1 } },
    create: {
      tenantId,
      sku: sku1,
      name: `Produto 01 — ${config.name}`,
      barcode: `${config.prefix}0001`,
      imageUrl: imageUrl1,
    },
    update: { imageUrl: imageUrl1 },
  });

  const product2 = await prisma.product.upsert({
    where: { tenantId_sku: { tenantId, sku: sku2 } },
    create: {
      tenantId,
      sku: sku2,
      name: `Produto 02 — ${config.name}`,
      barcode: `${config.prefix}0002`,
      imageUrl: imageUrl2,
    },
    update: { imageUrl: imageUrl2 },
  });

  const loc = await prisma.location.upsert({
    where: {
      tenantId_barcode: { tenantId, barcode: `${config.prefix}-GON-01` },
    },
    create: {
      tenantId,
      corridor: "A",
      row: "01",
      barcode: `${config.prefix}-GON-01`,
      type: "PICK_FACE",
      productId: product.id,
      currentQuantity: 50,
      capacity: 100,
      minThreshold: 10,
    },
    update: { productId: product.id, currentQuantity: 50 },
  });

  await prisma.location.upsert({
    where: {
      tenantId_barcode: { tenantId, barcode: `${config.prefix}-GON-02` },
    },
    create: {
      tenantId,
      corridor: "A",
      row: "02",
      barcode: `${config.prefix}-GON-02`,
      type: "PICK_FACE",
      productId: product2.id,
      currentQuantity: 30,
      capacity: 80,
      minThreshold: 8,
    },
    update: { productId: product2.id, currentQuantity: 30 },
  });

  await prisma.location.upsert({
    where: {
      tenantId_barcode: { tenantId, barcode: `${config.prefix}-PUL-01` },
    },
    create: {
      tenantId,
      corridor: "P",
      row: "01",
      barcode: `${config.prefix}-PUL-01`,
      type: "PULMAO",
      productId: product.id,
      currentQuantity: 200,
      capacity: 500,
      minThreshold: 0,
    },
    update: { productId: product.id, currentQuantity: 200 },
  });

  await prisma.basket.upsert({
    where: { tenantId_code: { tenantId, code: `${config.prefix}-CESTA` } },
    create: {
      tenantId,
      code: `${config.prefix}-CESTA`,
      barcode: `${config.prefix}BASKET`,
    },
    update: {},
  });

  return { tenant, admin, picker };
}

export function printTestUsersGuide() {
  console.log("\n=== Credenciais de teste (detalhes em docs/usuarios-teste.md) ===\n");
  console.log("Plataforma (só painel Clientes):");
  console.log("  admin@wms.local / admin123\n");
  console.log("Tenant default (dados completos):");
  console.log("  admin via plataforma ou operador@wms.local / operador123");
  console.log("  operador2@wms.local / operador123");
  console.log("  picker@wms.local / dev\n");
  for (const c of DEMO_TENANT_CONFIGS) {
    console.log(`${c.name} (${c.slug}):`);
    console.log(`  ${c.adminEmail} / ${ADMIN_PASSWORD}  (web — admin)`);
    console.log(`  ${c.pickerEmail} / ${PICKER_PASSWORD}  (mobile — picker)\n`);
  }
}
