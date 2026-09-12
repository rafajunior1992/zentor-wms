import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import {
  ALL_PERMISSION_KEYS,
  defaultPermissionsForRole,
  type UserRole,
} from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";
import { requirePlatformAdmin } from "../lib/platform-guard.js";
import { toPublicUser } from "../lib/user-dto.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";
import {
  createTenant,
  createTenantAdminUser,
  listTenants,
  listTenantUsers,
  TenantServiceError,
  updateTenant,
} from "../services/tenants.js";

const VALID_ROLES: UserRole[] = ["ADMIN", "EXPEDITER", "REPLENISHER", "PICKER"];

export async function platformRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Tenants (Clientes / Empresas)
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>(
    "/api/platform/tenants",
    { preHandler: requirePlatformAdmin },
    async (request) => {
      const page = request.query.page ? Number(request.query.page) : 1;
      const pageSize = request.query.pageSize ? Number(request.query.pageSize) : 50;
      return listTenants({
        q: request.query.q?.trim(),
        page: Number.isFinite(page) ? page : 1,
        pageSize: Number.isFinite(pageSize) ? pageSize : 50,
      });
    },
  );

  app.post<{ Body: { name?: string; slug?: string; cnpj?: string } }>(
    "/api/platform/tenants",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        const tenant = await createTenant({
          name: request.body?.name ?? "",
          slug: request.body?.slug,
          cnpj: request.body?.cnpj,
        });
        return reply.status(201).send({
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            cnpj: tenant.cnpj,
            active: tenant.active,
          },
        });
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; active?: boolean; cnpj?: string };
  }>(
    "/api/platform/tenants/:id",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        const tenant = await updateTenant(request.params.id, request.body ?? {});
        return {
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            cnpj: tenant.cnpj,
            active: tenant.active,
          },
        };
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/platform/tenants/:id/users",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        return await listTenantUsers(request.params.id);
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      email?: string;
      name?: string;
      password?: string;
      permissions?: string[];
    };
  }>(
    "/api/platform/tenants/:id/admin-user",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      try {
        const permissions = request.body?.permissions?.filter((p) =>
          ALL_PERMISSION_KEYS.includes(p as never),
        );
        const user = await createTenantAdminUser(request.params.id, {
          email: request.body?.email ?? "",
          name: request.body?.name ?? "",
          password: request.body?.password ?? "",
          permissions,
        });
        return reply.status(201).send({ user: toPublicUser(user) });
      } catch (e) {
        if (e instanceof TenantServiceError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Admin WMS — Gestão Global de Usuários de Todo o Sistema
  // ---------------------------------------------------------------------------

  app.get<{
    Querystring: {
      q?: string;
      tenantId?: string;
      role?: string;
      active?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/api/platform/users", { preHandler: requirePlatformAdmin }, async (request) => {
    const q = request.query.q?.trim();
    const tenantId = request.query.tenantId?.trim();
    const role = request.query.role?.trim();
    const active = request.query.active?.trim();
    const { page, pageSize, skip, take } = parsePagination(request.query);

    const where: Prisma.UserWhereInput = {};

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    if (tenantId) {
      if (tenantId === "platform") {
        where.isPlatformAdmin = true;
      } else {
        where.tenantId = tenantId;
      }
    }

    if (role && VALID_ROLES.includes(role as UserRole)) {
      where.role = role as UserRole;
    }

    if (active === "true") where.active = true;
    if (active === "false") where.active = false;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ isPlatformAdmin: "desc" }, { createdAt: "desc" }],
        skip,
        take,
        include: {
          tenant: { select: { id: true, name: true, slug: true, cnpj: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u) => toPublicUser(u)),
      pagination: buildPaginationMeta(total, page, pageSize),
    };
  });

  app.post<{
    Body: {
      email?: string;
      name?: string;
      password?: string;
      role?: string;
      tenantId?: string | null;
      isPlatformAdmin?: boolean;
      permissions?: string[];
      active?: boolean;
    };
  }>("/api/platform/users", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const name = request.body?.name?.trim();
    const password = request.body?.password;
    const isPlatformAdmin = Boolean(request.body?.isPlatformAdmin);
    const tenantId = isPlatformAdmin ? null : request.body?.tenantId?.trim();
    const role = (request.body?.role ?? (isPlatformAdmin ? "ADMIN" : "EXPEDITER")) as UserRole;

    if (!email || !name || !password) {
      return reply
        .status(400)
        .send({ error: "E-mail, nome e senha são obrigatórios" });
    }
    if (password.length < 6) {
      return reply
        .status(400)
        .send({ error: "Senha deve ter ao menos 6 caracteres" });
    }
    if (!VALID_ROLES.includes(role)) {
      return reply.status(400).send({ error: "Papel de usuário inválido" });
    }
    if (!isPlatformAdmin && !tenantId) {
      return reply
        .status(400)
        .send({ error: "Selecione a empresa / cliente para o colaborador" });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return reply.status(409).send({ error: "E-mail já cadastrado" });
    }

    if (tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        return reply.status(404).send({ error: "Cliente / Tenant não encontrado" });
      }
    }

    let permissions =
      request.body?.permissions?.filter((p) =>
        ALL_PERMISSION_KEYS.includes(p as never),
      ) ?? defaultPermissionsForRole(role);

    if (!isPlatformAdmin) {
      permissions = permissions.filter((p) => p !== "tenants.manage");
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashPassword(password),
        role,
        permissions,
        active: request.body?.active ?? true,
        isPlatformAdmin,
        tenantId,
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true, cnpj: true } },
      },
    });

    return reply.status(201).send({ user: toPublicUser(user) });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      email?: string;
      name?: string;
      password?: string;
      role?: string;
      tenantId?: string | null;
      isPlatformAdmin?: boolean;
      permissions?: string[];
      active?: boolean;
    };
  }>("/api/platform/users/:id", { preHandler: requirePlatformAdmin }, async (request, reply) => {
    const existing = await prisma.user.findUnique({
      where: { id: request.params.id },
      include: { tenant: { select: { id: true, name: true, slug: true, cnpj: true } } },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Usuário não encontrado" });
    }

    const data: Prisma.UserUpdateInput = {};

    if (request.body?.name?.trim()) {
      data.name = request.body.name.trim();
    }

    if (request.body?.email?.trim()) {
      const email = request.body.email.trim().toLowerCase();
      const clash = await prisma.user.findFirst({
        where: { email, NOT: { id: existing.id } },
      });
      if (clash) {
        return reply.status(409).send({ error: "E-mail já em uso" });
      }
      data.email = email;
    }

    if (request.body?.password) {
      if (request.body.password.length < 6) {
        return reply
          .status(400)
          .send({ error: "Senha deve ter ao menos 6 caracteres" });
      }
      data.password = hashPassword(request.body.password);
    }

    if (request.body?.role) {
      if (!VALID_ROLES.includes(request.body.role as UserRole)) {
        return reply.status(400).send({ error: "Papel inválido" });
      }
      data.role = request.body.role as UserRole;
    }

    if (typeof request.body?.active === "boolean") {
      data.active = request.body.active;
    }

    if (typeof request.body?.isPlatformAdmin === "boolean") {
      data.isPlatformAdmin = request.body.isPlatformAdmin;
      if (request.body.isPlatformAdmin) {
        data.tenant = { disconnect: true };
      }
    }

    if (request.body?.tenantId !== undefined && !data.isPlatformAdmin) {
      if (request.body.tenantId === null) {
        data.tenant = { disconnect: true };
      } else {
        const tenant = await prisma.tenant.findUnique({
          where: { id: request.body.tenantId },
        });
        if (!tenant) {
          return reply.status(404).send({ error: "Cliente não encontrado" });
        }
        data.tenant = { connect: { id: tenant.id } };
      }
    }

    if (request.body?.permissions) {
      data.permissions = request.body.permissions.filter((p) =>
        ALL_PERMISSION_KEYS.includes(p as never),
      );
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data,
      include: {
        tenant: { select: { id: true, name: true, slug: true, cnpj: true } },
      },
    });

    return { user: toPublicUser(updated) };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/platform/users/:id",
    { preHandler: requirePlatformAdmin },
    async (request, reply) => {
      if (request.params.id === request.authUser?.id) {
        return reply
          .status(400)
          .send({ error: "Você não pode excluir seu próprio usuário" });
      }

      const existing = await prisma.user.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Usuário não encontrado" });
      }

      try {
        await prisma.user.delete({ where: { id: existing.id } });
        return { ok: true, deleted: true };
      } catch {
        // Se houver vínculos de auditoria/histórico, desativa o usuário
        await prisma.user.update({
          where: { id: existing.id },
          data: { active: false },
        });
        return { ok: true, deactivated: true };
      }
    },
  );
}
