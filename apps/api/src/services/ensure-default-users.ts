import type { PrismaClient } from "@prisma/client";
import {
  ALL_PERMISSION_KEYS,
  defaultPermissionsForRole,
  Permission,
} from "@wms/shared";
import { hashPassword } from "../lib/password.js";

export type EnsureDefaultUsersResult = {
  defaultTenantId: string;
  platformAdminEmail: string;
  tenantAdminEmail: string;
  tenantAdminAliasEmail: string;
  operadorEmail: string;
};

/**
 * Garante a hierarquia padrão de usuários no tenant principal (`default`):
 * 1. Super-Admin da Plataforma (`admin@wms.local` / `admin123`) -> gestão de clientes, isPlatformAdmin: true, tenantId: null
 * 2. Admin da Conta (`adm@wms.local` / `admin123`) -> gestão total da conta/tenant Default, role: ADMIN, tenantId: default
 * 3. Admin da Conta Alias (`admin@default.local` / `admin123`) -> mesmo papel e tenant
 * 4. Operador / Expedidor (`operador@wms.local` / `operador123`) -> role: EXPEDITER, tenantId: default
 * 5. Garante conexão Tiny cadastrada para o admin e operador
 */
export async function ensureDefaultUsers(
  client: PrismaClient,
): Promise<EnsureDefaultUsersResult> {
  const defaultTenant = await client.tenant.upsert({
    where: { slug: "default" },
    create: { name: "Default", slug: "default", active: true },
    update: { active: true },
  });
  const TENANT_ID = defaultTenant.id;

  // 1. Super-Admin da Plataforma
  await client.user.upsert({
    where: { email: "admin@wms.local" },
    create: {
      email: "admin@wms.local",
      name: "Administrador Help Route",
      password: hashPassword("admin123"),
      role: "ADMIN",
      isPlatformAdmin: true,
      tenantId: null,
      permissions: [...ALL_PERMISSION_KEYS],
      active: true,
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

  // 2. Administrador da Conta (Tenant Admin)
  const tenantAdminPermissions = defaultPermissionsForRole("ADMIN");

  const admConta = await client.user.upsert({
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

  // 3. Admin da Conta Alias
  await client.user.upsert({
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

  // 4. Operador / Expedidor da Conta
  const felipePermissions = [
    ...new Set([
      ...defaultPermissionsForRole("EXPEDITER"),
      Permission.REGISTERS_VIEW,
      Permission.PRODUCTS_MANAGE,
      Permission.REPORTS_VIEW,
    ]),
  ];

  const operador = await client.user.upsert({
    where: { email: "operador@wms.local" },
    create: {
      email: "operador@wms.local",
      name: "Felipe Figueiredo",
      password: hashPassword("operador123"),
      role: "EXPEDITER",
      tenantId: TENANT_ID,
      isPlatformAdmin: false,
      permissions: felipePermissions,
      active: true,
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

  // 5. Tiny connection padrão para os usuários se não existir
  for (const user of [admConta, operador]) {
    const existingTiny = await client.tinyConnection.findFirst({
      where: { tenantId: TENANT_ID, userId: user.id, deletedAt: null },
    });
    if (!existingTiny) {
      await client.tinyConnection.create({
        data: {
          tenantId: TENANT_ID,
          userId: user.id,
          name: "Tiny ERP",
          isDefault: true,
        },
      });
    }
  }

  return {
    defaultTenantId: TENANT_ID,
    platformAdminEmail: "admin@wms.local",
    tenantAdminEmail: "adm@wms.local",
    tenantAdminAliasEmail: "admin@default.local",
    operadorEmail: "operador@wms.local",
  };
}
