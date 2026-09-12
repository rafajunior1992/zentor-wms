import type { FastifyInstance } from "fastify";
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { verifyPassword, hashPassword } from "../lib/password.js";
import { requireAuth } from "../lib/auth-guard.js";
import {
  canAccessMobile,
  canAccessWeb,
  effectivePermissions,
} from "../lib/permissions.js";
import { signSession } from "../lib/session-token.js";
import { toPublicUser } from "../lib/user-dto.js";

async function loadUserForAuth(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: {
      tenant: { select: { id: true, name: true, slug: true, cnpj: true, active: true } },
    },
  });
}

function sessionUser(user: {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  tenantId: string | null;
  isPlatformAdmin: boolean;
}) {
  const permissions = effectivePermissions(user);
  return {
    token: signSession({
      id: user.id,
      email: user.email,
      role: user.role,
      permissions,
      tenantId: user.tenantId,
      isPlatformAdmin: user.isPlatformAdmin,
    }),
    permissions,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{
    Body: { email?: string; password?: string };
  }>("/auth/login", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;

    if (!email || !password) {
      return reply.status(400).send({ error: "E-mail e senha são obrigatórios" });
    }

    const user = await loadUserForAuth(email);
    if (!user || !verifyPassword(password, user.password)) {
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    if (!user.active) {
      return reply.status(403).send({
        error: "Usuário inativo. Solicite reativação ao administrador.",
      });
    }

    if (user.tenantId && !user.tenant?.active) {
      return reply.status(403).send({ error: "Cliente inativo" });
    }

    if (!canAccessWeb(user)) {
      return reply.status(403).send({
        error: "Este usuário não tem acesso ao painel web",
      });
    }

    const { token } = sessionUser(user);

    return {
      token,
      user: toPublicUser({
        ...user,
        tenant: user.tenant,
      }),
    };
  });

  app.post<{
    Body: { email?: string; password?: string };
  }>("/auth/mobile/login", async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;

    if (!email || !password) {
      return reply.status(400).send({ error: "E-mail e senha são obrigatórios" });
    }

    const user = await loadUserForAuth(email);
    if (!user || !verifyPassword(password, user.password)) {
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    if (!user.active) {
      return reply.status(403).send({
        error: "Usuário inativo. Solicite reativação ao administrador.",
      });
    }

    if (user.isPlatformAdmin && !user.tenantId) {
      return reply.status(403).send({
        error: "Super-admin da plataforma não acessa o app mobile",
      });
    }

    if (user.tenantId && !user.tenant?.active) {
      return reply.status(403).send({ error: "Cliente inativo" });
    }

    if (!canAccessMobile(user)) {
      return reply.status(403).send({
        error: "Este usuário não tem acesso ao app mobile",
      });
    }

    const { token } = sessionUser(user);

    return {
      token,
      user: toPublicUser({
        ...user,
        tenant: user.tenant,
      }),
    };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.authUser!.id },
      include: {
        tenant: { select: { id: true, name: true, slug: true, cnpj: true } },
      },
    });
    if (!user) return { user: toPublicUser(request.authUser!) };
    return {
      user: toPublicUser({
        ...user,
        tenant: user.tenant,
      }),
    };
  });

  app.patch<{
    Body: {
      name?: string;
      email?: string;
      avatarUrl?: string | null;
      currentPassword?: string;
      newPassword?: string;
    };
  }>("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.authUser!.id },
    });
    if (!user) {
      return reply.status(404).send({ error: "Usuário não encontrado" });
    }

    const { name, email, avatarUrl, currentPassword, newPassword } =
      request.body ?? {};
    const data: {
      name?: string;
      email?: string;
      avatarUrl?: string | null;
      password?: string;
    } = {};

    if (name?.trim()) data.name = name.trim();

    if (avatarUrl !== undefined) {
      data.avatarUrl = avatarUrl?.trim() || null;
    }

    if (email?.trim()) {
      const normalized = email.trim().toLowerCase();
      const exists = await prisma.user.findFirst({
        where: { email: normalized, NOT: { id: user.id } },
      });
      if (exists) {
        return reply.status(409).send({ error: "E-mail já em uso" });
      }
      data.email = normalized;
    }

    if (newPassword) {
      if (!currentPassword || !verifyPassword(currentPassword, user.password)) {
        return reply.status(400).send({ error: "Senha atual incorreta" });
      }
      if (newPassword.length < 6) {
        return reply
          .status(400)
          .send({ error: "Nova senha deve ter ao menos 6 caracteres" });
      }
      data.password = hashPassword(newPassword);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    return {
      user: toPublicUser({
        ...updated,
        tenant: updated.tenant,
      }),
    };
  });

  app.patch<{ Body: { token?: string } }>(
    "/auth/me/olist-token",
    { preHandler: requireAuth },
    async (request, reply) => {
      const token = request.body?.token?.trim() ?? "";
      const updated = await prisma.user.update({
        where: { id: request.authUser!.id },
        data: { olistToken: token || null },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
        },
      });
      return {
        user: toPublicUser({ ...updated, tenant: updated.tenant }),
        configured: Boolean(token),
      };
    },
  );

  app.get(
    "/auth/me/olist-token",
    { preHandler: requireAuth },
    async (request) => {
      const user = await prisma.user.findUnique({
        where: { id: request.authUser!.id },
        select: { olistToken: true },
      });
      return { configured: Boolean(user?.olistToken?.trim()) };
    },
  );

  app.get("/auth/permissions/catalog", { preHandler: requireAuth }, async () => {
    return { catalog: PERMISSION_CATALOG, keys: ALL_PERMISSION_KEYS };
  });
}
