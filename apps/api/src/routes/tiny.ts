import type { FastifyInstance } from "fastify";
import {
  requireOlistConfigure,
  requireWebAccess,
} from "../lib/auth-guard.js";
import { tenantWhere } from "../lib/tenant-context.js";
import {
  cancelTinyDraft,
  createAdditionalTinyConnection,
  defaultOAuthRedirectUri,
  disconnectTinyConnection,
  getOrCreateTinyConnection,
  getTinyConnectionStatus,
  handleTinyOAuthCallback,
  listUserTinyConnections,
  oauthCallbackHtml,
  oauthCallbackJson,
  resolveOAuthRedirectUri,
  saveTinyOAuthCredentials,
  setDefaultTinyConnection,
  startTinyOAuth,
  testTinyConnection,
  TINY_OAUTH_REQUIRED_APP_PERMISSIONS,
} from "../services/tiny-oauth.js";
import { formatOAuthCallbackQueryError } from "../services/tiny-oauth-errors.js";
import { prisma } from "../lib/prisma.js";
import { TinyConnectionStatus } from "@prisma/client";
import { syncPendingOrderPrioritiesFromTiny } from "../services/tiny-integration.js";
import { syncSalesOrdersFromTiny } from "../services/sync-sales-orders-from-tiny.js";
import { syncProductsFromTiny } from "../services/sync-products-from-tiny.js";
import { getTinySyncStatus } from "../services/tiny-sync-checkpoint.js";

function wantsJson(request: {
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
}): boolean {
  const accept = String(request.headers.accept ?? "");
  if (accept.includes("application/json")) return true;
  return request.query.format === "json";
}

export async function tinyRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; format?: string };
  }>("/integrations/tiny/oauth/callback", async (request, reply) => {
    const asJson = wantsJson({
      headers: request.headers as Record<string, unknown>,
      query: request.query as Record<string, unknown>,
    });

    const fail = (message: string) => {
      const result = { success: false, message };
      if (asJson) {
        return reply.send(oauthCallbackJson(result));
      }
      return reply.type("text/html").send(oauthCallbackHtml(result));
    };

    if (request.query.error) {
      return fail(formatOAuthCallbackQueryError(String(request.query.error)));
    }

    const code = request.query.code;
    const state = request.query.state;
    if (!code || !state) {
      return fail("Código ou state OAuth ausente");
    }

    const result = await handleTinyOAuthCallback({
      code,
      state,
      logger: request.log,
    });
    if (asJson) {
      return reply.send(oauthCallbackJson(result));
    }
    return reply.type("text/html").send(oauthCallbackHtml(result));
  });

  app.register(async (secured) => {
    secured.addHook("onRequest", requireWebAccess);

    secured.get("/api/integrations/tiny/oauth/requirements", async () => {
      return {
        requiredAppPermissions: TINY_OAUTH_REQUIRED_APP_PERMISSIONS,
        authorizeWithAdmin: true,
        oauthPrompt: "login consent",
      };
    });

    secured.get(
      "/api/integrations/tiny/connection",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        const tenantId = tenantWhere(request).tenantId;
        const connectionId = (request.query as { connectionId?: string }).connectionId;
        return getTinyConnectionStatus(
          { tenantId, userId: request.authUser.id },
          connectionId,
        );
      },
    );

    secured.get(
      "/api/integrations/tiny/sync-status",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        const tenantId = tenantWhere(request).tenantId;
        const connectionId = (request.query as { connectionId?: string }).connectionId;
        return getTinySyncStatus({ tenantId, connectionId });
      },
    );

    secured.get(
      "/api/integrations/tiny/connections",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        const connections = await listUserTinyConnections({
          tenantId: tenantWhere(request).tenantId,
          userId: request.authUser.id,
        });
        return { connections };
      },
    );

    secured.get("/api/integrations/tiny/oauth/redirect-uri", async () => {
      return { redirectUri: defaultOAuthRedirectUri() };
    });

    secured.put<{
      Body: {
        clientId?: string;
        clientSecret?: string;
        redirectUri?: string;
        connectionId?: string;
      };
    }>(
      "/api/integrations/tiny/credentials",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        const tenantId = tenantWhere(request).tenantId;
        const scope = { tenantId, userId: request.authUser.id };
        const clientId = request.body?.clientId?.trim();
        const clientSecret = request.body?.clientSecret?.trim();
        const conn = await getOrCreateTinyConnection(scope, {
          connectionId: request.body?.connectionId,
        });

        if (!clientId) {
          return reply.status(400).send({ error: "clientId é obrigatório" });
        }

        if (clientSecret) {
          await saveTinyOAuthCredentials(scope, {
            clientId,
            clientSecret,
            redirectUri: resolveOAuthRedirectUri(request.body?.redirectUri),
          });
        } else if (conn.oauthClientSecret) {
          await prisma.tinyConnection.update({
            where: { id: conn.id },
            data: {
              oauthClientId: clientId,
              oauthRedirectUri: resolveOAuthRedirectUri(
                request.body?.redirectUri ?? conn.oauthRedirectUri,
              ),
              status: TinyConnectionStatus.PENDING,
            },
          });
        } else {
          return reply
            .status(400)
            .send({ error: "clientSecret é obrigatório na primeira configuração" });
        }
        return getTinyConnectionStatus(scope, conn.id);
      },
    );

    secured.post(
      "/api/integrations/tiny/connections",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        const scope = {
          tenantId: tenantWhere(request).tenantId,
          userId: request.authUser.id,
        };
        const conn = await createAdditionalTinyConnection(scope);
        return getTinyConnectionStatus(scope, conn.id);
      },
    );

    secured.post<{ Body: { connectionId?: string } }>(
      "/api/integrations/tiny/test-connection",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        const result = await testTinyConnection(
          {
            tenantId: tenantWhere(request).tenantId,
            userId: request.authUser.id,
          },
          request.body?.connectionId,
        );
        if (!result.ok) {
          return reply.status(400).send(result);
        }
        return result;
      },
    );

    secured.post<{ Body: { connectionId?: string } }>(
      "/api/integrations/tiny/disconnect",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        return disconnectTinyConnection(
          {
            tenantId: tenantWhere(request).tenantId,
            userId: request.authUser.id,
          },
          request.body?.connectionId,
        );
      },
    );

    secured.post<{ Body: { connectionId: string } }>(
      "/api/integrations/tiny/connections/default",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        const connectionId = request.body?.connectionId?.trim();
        if (!connectionId) {
          return reply.status(400).send({ error: "connectionId é obrigatório" });
        }
        try {
          return await setDefaultTinyConnection(
            {
              tenantId: tenantWhere(request).tenantId,
              userId: request.authUser.id,
            },
            connectionId,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Erro ao definir conta padrão";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.delete<{ Querystring: { connectionId?: string } }>(
      "/api/integrations/tiny/draft",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        try {
          return await cancelTinyDraft(
            {
              tenantId: tenantWhere(request).tenantId,
              userId: request.authUser.id,
            },
            request.query.connectionId,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Erro ao cancelar rascunho";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.post(
      "/api/integrations/tiny/sync-order-priorities",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        try {
          const result = await syncPendingOrderPrioritiesFromTiny(
            tenantWhere(request).tenantId,
            request.authUser.id,
          );
          return result;
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Erro ao sincronizar prioridades";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.post<{ Body: { days?: number; connectionId?: string; forceRestart?: boolean } }>(
      "/api/integrations/tiny/sync-orders",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        try {
          const days = request.body?.days;
          const result = await syncSalesOrdersFromTiny({
            tenantId: tenantWhere(request).tenantId,
            userId: request.authUser.id,
            ...(request.body?.connectionId
              ? { connectionId: request.body.connectionId }
              : {}),
            ...(days !== undefined ? { days } : {}),
            ...(request.body?.forceRestart ? { forceRestart: true } : {}),
          });
          return result;
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Erro ao sincronizar pedidos";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.post<{
      Body: {
        connectionId?: string;
        forceRestart?: boolean;
        refreshExisting?: boolean;
      };
    }>(
      "/api/integrations/tiny/sync-products",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        try {
          const result = await syncProductsFromTiny({
            tenantId: tenantWhere(request).tenantId,
            userId: request.authUser.id,
            ...(request.body?.connectionId
              ? { connectionId: request.body.connectionId }
              : {}),
            ...(request.body?.forceRestart ? { forceRestart: true } : {}),
            ...(request.body?.refreshExisting
              ? { refreshExisting: true }
              : {}),
          });
          return result;
        } catch (e) {
          const message =
            e instanceof Error ? e.message : "Erro ao sincronizar produtos";
          return reply.status(400).send({ error: message });
        }
      },
    );

    secured.post<{ Body: { connectionId?: string; forceNew?: boolean } }>(
      "/api/integrations/tiny/oauth/authorize",
      { preHandler: requireOlistConfigure },
      async (request, reply) => {
        if (!request.authUser) {
          return reply.status(401).send({ error: "Não autenticado" });
        }
        try {
          const scope = {
            tenantId: tenantWhere(request).tenantId,
            userId: request.authUser.id,
          };
          const { authUrl, state, connectionId } = await startTinyOAuth(scope, {
            connectionId: request.body?.connectionId,
            forceNew: request.body?.forceNew,
          });
          return { authUrl, state, connectionId };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Erro ao iniciar OAuth";
          return reply.status(400).send({ error: message });
        }
      },
    );
  });
}
