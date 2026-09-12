import { Prisma } from "@prisma/client";
import { defaultPermissionsForRole, Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";

export class TenantServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "TenantServiceError";
  }
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function listTenants(opts?: { q?: string; page?: number; pageSize?: number }) {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 50;
  const skip = (page - 1) * pageSize;
  const where: Prisma.TenantWhereInput = opts?.q
    ? {
        OR: [
          { name: { contains: opts.q, mode: "insensitive" } },
          { slug: { contains: opts.q, mode: "insensitive" } },
          { cnpj: { contains: opts.q, mode: "insensitive" } },
        ],
      }
    : {};

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: pageSize,
      include: {
        _count: { select: { users: true, orders: true } },
        tinyConnections: {
          where: { isDefault: true, deletedAt: null },
          take: 1,
          select: { status: true, companyName: true, metadata: true },
        },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    tenants: tenants.map((t) => {
      const meta = t.tinyConnections[0]?.metadata as { cnpj?: string } | null;
      const effectiveCnpj = t.cnpj || meta?.cnpj || null;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        cnpj: effectiveCnpj,
        active: t.active,
        userCount: t._count.users,
        orderCount: t._count.orders,
        tinyStatus: t.tinyConnections[0]?.status ?? null,
        tinyCompanyName: t.tinyConnections[0]?.companyName ?? null,
        createdAt: t.createdAt.toISOString(),
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function createTenant(params: { name: string; slug?: string; cnpj?: string }) {
  const name = params.name.trim();
  if (!name) throw new TenantServiceError("Nome do cliente é obrigatório");

  const slug = slugify(params.slug?.trim() || name);
  if (!slug) throw new TenantServiceError("Slug inválido");

  const exists = await prisma.tenant.findUnique({ where: { slug } });
  if (exists) throw new TenantServiceError("Slug já em uso", 409);

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: {
        name,
        slug,
        cnpj: params.cnpj?.trim() || null,
        active: true,
      },
    });
    return t;
  });

  return tenant;
}

export async function updateTenant(
  id: string,
  data: { name?: string; active?: boolean; cnpj?: string },
) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new TenantServiceError("Cliente não encontrado", 404);

  return prisma.tenant.update({
    where: { id },
    data: {
      ...(data.name?.trim() ? { name: data.name.trim() } : {}),
      ...(typeof data.active === "boolean" ? { active: data.active } : {}),
      ...(typeof data.cnpj === "string" ? { cnpj: data.cnpj.trim() || null } : {}),
    },
  });
}

const TENANT_ADMIN_DEFAULT_PERMISSIONS = defaultPermissionsForRole("ADMIN");

export async function createTenantAdminUser(
  tenantId: string,
  params: {
    email: string;
    name: string;
    password: string;
    permissions?: string[];
  },
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new TenantServiceError("Cliente não encontrado", 404);

  const email = params.email.trim().toLowerCase();
  const name = params.name.trim();
  if (!email || !name || !params.password) {
    throw new TenantServiceError("E-mail, nome e senha são obrigatórios");
  }
  if (params.password.length < 6) {
    throw new TenantServiceError("Senha deve ter ao menos 6 caracteres");
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new TenantServiceError("E-mail já cadastrado", 409);

  const permissions =
    params.permissions?.length && params.permissions.length > 0
      ? params.permissions
      : TENANT_ADMIN_DEFAULT_PERMISSIONS;

  if (permissions.includes(Permission.TENANTS_MANAGE)) {
    throw new TenantServiceError("Admin do cliente não pode gerenciar a plataforma");
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: hashPassword(params.password),
      role: "ADMIN",
      tenantId,
      isPlatformAdmin: false,
      permissions,
      active: true,
    },
  });

  return user;
}

export async function listTenantUsers(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, cnpj: true },
  });
  if (!tenant) throw new TenantServiceError("Cliente não encontrado", 404);

  const users = await prisma.user.findMany({
    where: { tenantId, isPlatformAdmin: false },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });

  return {
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, cnpj: tenant.cnpj },
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}

export async function ensureDefaultTenant() {
  return prisma.tenant.upsert({
    where: { slug: "default" },
    create: { name: "Default", slug: "default", active: true },
    update: {},
  });
}
