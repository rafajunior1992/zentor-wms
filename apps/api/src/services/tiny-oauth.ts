import * as crypto from "crypto";
import { Prisma, TinyConnectionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { decrypt, encrypt } from "../lib/encryption.js";
import { getTinyApiClient, TinyApiError } from "./tiny-api-v3-client.js";
import {
  clearRateLimitMetadata,
  reconcileTinyConnectionRateLimit,
} from "./tiny-rate-limit.js";
import {
  formatOAuthErrorMessage,
  formatTinyApiValidationMessage,
} from "./tiny-oauth-errors.js";
import {
  clientIdSuffix,
  extractAuthorizedUserFromIdToken,
  logTinyOAuthAudit,
  TINY_OAUTH_REQUIRED_APP_PERMISSIONS,
} from "./tiny-oauth-log.js";

export { TINY_OAUTH_REQUIRED_APP_PERMISSIONS };

const AUTHORIZE_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth";
const TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const INFO_URL = "https://api.tiny.com.br/public-api/v3/info";

export type TinyUiStatus = "NONE" | "VALID" | "PENDING" | "INVALID" | "BLOCKED";

export interface TinyConnectionMetadata {
  razaoSocial?: string;
  cnpj?: string;
  nome?: string;
  raw?: Record<string, unknown>;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET não configurado");
  }
  return secret;
}

function backendUrl(): string {
  return (process.env.API_PUBLIC_URL ?? process.env.API_URL ?? "http://localhost:3333").replace(
    /\/$/,
    "",
  );
}

function webUrl(): string {
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function defaultOAuthRedirectUri(): string {
  return `${backendUrl()}/integrations/tiny/oauth/callback`;
}

/** Callback OAuth deve ser sempre o endpoint do backend WMS. */
export function resolveOAuthRedirectUri(override?: string | null): string {
  const expected = defaultOAuthRedirectUri();
  const custom = override?.trim();
  if (!custom) return expected;

  try {
    const url = new URL(custom);
    if (url.pathname.replace(/\/$/, "") !== "/integrations/tiny/oauth/callback") {
      return expected;
    }
    return `${url.origin}/integrations/tiny/oauth/callback`;
  } catch {
    return expected;
  }
}

export function mapTinyStatusToUi(
  status: TinyConnectionStatus | "NONE",
  isActive = true,
): TinyUiStatus {
  if (!isActive) return "INVALID";
  switch (status) {
    case TinyConnectionStatus.CONNECTED:
      return "VALID";
    case TinyConnectionStatus.PENDING:
      return "PENDING";
    case TinyConnectionStatus.BLOCKED:
      // Legado: rate limit temporário — tokens OAuth permanecem válidos.
      return "VALID";
    case TinyConnectionStatus.ERROR:
      return "INVALID";
    default:
      return "NONE";
  }
}

function signOAuthPayload(payload: string): string {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("hex");
}

export function buildOAuthState(params: {
  userId: string;
  tenantId: string;
  connectionId: string;
}): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const core = `${nonce}:${params.userId}:${params.tenantId}:${params.connectionId}`;
  const hmac = signOAuthPayload(core);
  return `${core}:${hmac}`;
}

export function parseAndVerifyOAuthState(state: string): {
  userId: string;
  tenantId: string;
  connectionId: string;
} | null {
  const parts = state.split(":");
  if (parts.length !== 5) return null;

  const [nonce, userId, tenantId, connectionId, hmac] = parts;
  if (!nonce || !userId || !tenantId || !connectionId || !hmac) return null;

  const core = `${nonce}:${userId}:${tenantId}:${connectionId}`;
  const expected = signOAuthPayload(core);
  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(hmac, "hex"),
      Buffer.from(expected, "hex"),
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  return { userId, tenantId, connectionId };
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function extractCompanyMetadata(
  infoJson: Record<string, unknown>,
): TinyConnectionMetadata {
  const empresa = asRecord(infoJson.empresa);
  return {
    nome:
      str(infoJson.nome) ??
      str(infoJson.razaoSocial) ??
      str(empresa?.nome),
    razaoSocial:
      str(infoJson.razaoSocial) ??
      str(empresa?.razaoSocial) ??
      str(empresa?.nome),
    cnpj:
      str(infoJson.cnpj) ??
      str(infoJson.cpfCnpj) ??
      str(empresa?.cnpj) ??
      str(empresa?.cpfCnpj),
    raw: infoJson,
  };
}

async function clearOAuthTokens(connectionId: string) {
  await prisma.tinyConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: null,
      refreshToken: null,
      oauthIdToken: null,
      tokenExpiresAt: null,
      lastValidatedAt: null,
    },
  });
}

export type TinyConnectionScope = {
  tenantId: string;
  userId: string;
};

async function getSharedOAuthCredentials(tenantId: string) {
  return prisma.tinyConnection.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      oauthClientId: { not: null },
      oauthClientSecret: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      oauthClientId: true,
      oauthClientSecret: true,
      oauthRedirectUri: true,
    },
  });
}

async function countUserConnections(scope: TinyConnectionScope) {
  return prisma.tinyConnection.count({
    where: { tenantId: scope.tenantId, userId: scope.userId, deletedAt: null },
  });
}

export async function findUserTinyConnection(
  scope: TinyConnectionScope,
  connectionId?: string,
) {
  if (connectionId) {
    return prisma.tinyConnection.findFirst({
      where: {
        id: connectionId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
    });
  }

  const userConn = await prisma.tinyConnection.findFirst({
    where: {
      tenantId: scope.tenantId,
      userId: scope.userId,
      deletedAt: null,
      isActive: true,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (userConn) return userConn;

  return prisma.tinyConnection.findFirst({
    where: {
      tenantId: scope.tenantId,
      deletedAt: null,
      isActive: true,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
}

export async function getOrCreateTinyConnection(
  scope: TinyConnectionScope,
  options?: { connectionId?: string; forceNew?: boolean },
) {
  if (options?.connectionId) {
    const existing = await findUserTinyConnection(scope, options.connectionId);
    if (!existing) {
      throw new Error("Conexão Tiny não encontrada para este usuário");
    }
    return existing;
  }

  if (!options?.forceNew) {
    const draft = await prisma.tinyConnection.findFirst({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        deletedAt: null,
        status: TinyConnectionStatus.PENDING,
        accessToken: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (draft) return draft;
  }

  const shared = await getSharedOAuthCredentials(scope.tenantId);
  const total = await countUserConnections(scope);
  return prisma.tinyConnection.create({
    data: {
      tenantId: scope.tenantId,
      userId: scope.userId,
      name: total === 0 ? "Tiny ERP" : `Tiny ERP ${total + 1}`,
      apiVersion: "v3",
      status: TinyConnectionStatus.PENDING,
      isActive: true,
      isDefault: total === 0,
      oauthClientId: shared?.oauthClientId ?? null,
      oauthClientSecret: shared?.oauthClientSecret ?? null,
      oauthRedirectUri: shared?.oauthRedirectUri ?? null,
    },
  });
}

export async function createAdditionalTinyConnection(scope: TinyConnectionScope) {
  return getOrCreateTinyConnection(scope, { forceNew: true });
}

export async function saveTinyOAuthCredentials(
  scope: TinyConnectionScope,
  params: {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
  },
) {
  const conn = await getOrCreateTinyConnection(scope);
  const redirectUri = resolveOAuthRedirectUri(params.redirectUri);
  const credentialData = {
    oauthClientId: params.clientId.trim(),
    oauthClientSecret: encrypt(params.clientSecret.trim()),
    oauthRedirectUri: redirectUri,
    status: TinyConnectionStatus.PENDING,
    lastError: null,
    isActive: true,
    deletedAt: null,
  };

  await prisma.$transaction([
    prisma.tinyConnection.update({
      where: { id: conn.id },
      data: credentialData,
    }),
    prisma.tinyConnection.updateMany({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        deletedAt: null,
        id: { not: conn.id },
        accessToken: null,
      },
      data: {
        oauthClientId: credentialData.oauthClientId,
        oauthClientSecret: credentialData.oauthClientSecret,
        oauthRedirectUri: credentialData.oauthRedirectUri,
      },
    }),
  ]);

  return prisma.tinyConnection.findUniqueOrThrow({ where: { id: conn.id } });
}

export async function startTinyOAuth(
  scope: TinyConnectionScope,
  options?: { connectionId?: string; forceNew?: boolean },
): Promise<{
  authUrl: string;
  state: string;
  connectionId: string;
}> {
  const conn = await getOrCreateTinyConnection(scope, options);
  if (!conn.oauthClientId || !conn.oauthClientSecret) {
    throw new Error(
      "Configure Client ID, Client Secret e Redirect URI antes de conectar.",
    );
  }

  const redirectUri = resolveOAuthRedirectUri(conn.oauthRedirectUri);
  if (redirectUri !== conn.oauthRedirectUri) {
    await prisma.tinyConnection.update({
      where: { id: conn.id },
      data: { oauthRedirectUri: redirectUri },
    });
  }

  const state = buildOAuthState({
    userId: scope.userId,
    tenantId: scope.tenantId,
    connectionId: conn.id,
  });

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", conn.oauthClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "login consent");

  return { authUrl: authUrl.toString(), state, connectionId: conn.id };
}

type OAuthLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
};

async function smokeTestWithAccessToken(accessToken: string): Promise<{
  ok: boolean;
  metadata?: TinyConnectionMetadata;
  message?: string;
  httpStatus?: number;
  apiMessage?: string;
  endpoint?: string;
}> {
  try {
    const res = await fetch(INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const apiMessage = str(errBody.mensagem);
      return {
        ok: false,
        message: formatTinyApiValidationMessage(res.status, errBody),
        httpStatus: res.status,
        apiMessage,
        endpoint: "GET /info",
      };
    }
    const infoJson = (await res.json()) as Record<string, unknown>;
    return { ok: true, metadata: extractCompanyMetadata(infoJson) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha ao validar token na API v3",
    };
  }
}

export async function handleTinyOAuthCallback(params: {
  code: string;
  state: string;
  logger?: OAuthLogger;
}): Promise<{ success: boolean; message: string; connectionId?: string }> {
  const parsed = parseAndVerifyOAuthState(params.state);
  if (!parsed) {
    return { success: false, message: "State OAuth inválido ou adulterado" };
  }

  const { connectionId, tenantId, userId } = parsed;
  const conn = await prisma.tinyConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.tenantId !== tenantId || conn.userId !== userId) {
    await logTinyOAuthAudit({
      step: "OAUTH_CONNECTION_NOT_FOUND",
      tenantId,
      connectionId,
      userId,
      logger: params.logger,
    });
    return { success: false, message: "Conexão OAuth não encontrada" };
  }
  if (!conn.oauthClientId || !conn.oauthClientSecret) {
    await logTinyOAuthAudit({
      step: "OAUTH_CREDENTIALS_MISSING",
      tenantId,
      connectionId,
      userId,
      clientIdSuffix: clientIdSuffix(conn.oauthClientId),
      logger: params.logger,
    });
    return { success: false, message: "Credenciais OAuth não encontradas" };
  }

  await logTinyOAuthAudit({
    step: "OAUTH_CALLBACK_STARTED",
    tenantId,
    connectionId,
    userId,
    clientIdSuffix: clientIdSuffix(conn.oauthClientId),
    logger: params.logger,
  });

  const redirectUri = resolveOAuthRedirectUri(conn.oauthRedirectUri);
  const clientSecret = decrypt(conn.oauthClientSecret);

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: redirectUri,
      client_id: conn.oauthClientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!tokenRes.ok) {
    const err = (await tokenRes.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const message = formatOAuthErrorMessage(err);
    await logTinyOAuthAudit({
      step: "OAUTH_TOKEN_EXCHANGE_FAILED",
      tenantId,
      connectionId,
      userId,
      httpStatus: tokenRes.status,
      oauthError: err.error ?? err.error_description ?? message,
      clientIdSuffix: clientIdSuffix(conn.oauthClientId),
      logger: params.logger,
    });
    await prisma.tinyConnection.update({
      where: { id: connectionId },
      data: {
        status: TinyConnectionStatus.ERROR,
        lastError: message,
      },
    });
    return { success: false, message, connectionId };
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  if (!tokenData.access_token) {
    await logTinyOAuthAudit({
      step: "OAUTH_TOKEN_MISSING",
      tenantId,
      connectionId,
      userId,
      clientIdSuffix: clientIdSuffix(conn.oauthClientId),
      logger: params.logger,
    });
    await clearOAuthTokens(connectionId);
    await prisma.tinyConnection.update({
      where: { id: connectionId },
      data: {
        status: TinyConnectionStatus.ERROR,
        lastError: "access_token não retornado pelo Olist",
      },
    });
    return { success: false, message: "access_token não retornado pelo Olist", connectionId };
  }

  const authorizedUser = extractAuthorizedUserFromIdToken(tokenData.id_token);
  const smoke = await smokeTestWithAccessToken(tokenData.access_token);
  if (!smoke.ok) {
    await logTinyOAuthAudit({
      step: "OAUTH_API_VALIDATION_FAILED",
      tenantId,
      connectionId,
      userId,
      httpStatus: smoke.httpStatus,
      endpoint: smoke.endpoint,
      apiMessage: smoke.apiMessage,
      authorizedUser,
      clientIdSuffix: clientIdSuffix(conn.oauthClientId),
      logger: params.logger,
    });
    await clearOAuthTokens(connectionId);
    await prisma.tinyConnection.update({
      where: { id: connectionId },
      data: {
        status: TinyConnectionStatus.PENDING,
        lastError: smoke.message ?? "Token inválido na API v3",
      },
    });
    return {
      success: false,
      message: smoke.message ?? "Token inválido na API v3",
      connectionId,
    };
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;
  const metadata = smoke.metadata;
  const companyName = metadata?.razaoSocial ?? metadata?.nome ?? null;
  const now = new Date();

  const hasDefault = await prisma.tinyConnection.count({
    where: {
      tenantId,
      userId,
      deletedAt: null,
      isDefault: true,
      id: { not: connectionId },
      status: TinyConnectionStatus.CONNECTED,
    },
  });

  await prisma.tinyConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: encrypt(tokenData.access_token),
      refreshToken: tokenData.refresh_token
        ? encrypt(tokenData.refresh_token)
        : conn.refreshToken,
      oauthIdToken: tokenData.id_token ? encrypt(tokenData.id_token) : null,
      tokenExpiresAt: expiresAt,
      status: TinyConnectionStatus.CONNECTED,
      companyName,
      metadata: metadata as unknown as Prisma.InputJsonValue,
      lastValidatedAt: now,
      lastError: null,
      isActive: true,
      deletedAt: null,
      isDefault: hasDefault === 0 ? true : conn.isDefault,
    },
  });

  await logTinyOAuthAudit({
    step: "OAUTH_CONNECTED",
    tenantId,
    connectionId,
    userId,
    authorizedUser,
    clientIdSuffix: clientIdSuffix(conn.oauthClientId),
    logger: params.logger,
  });

  return {
    success: true,
    message: companyName
      ? `Conectado: ${companyName}`
      : "Olist ERP conectado com sucesso",
    connectionId,
  };
}

export function oauthCallbackHtml(result: {
  success: boolean;
  message: string;
}): string {
  const payload = JSON.stringify({
    type: "tiny-oauth-callback",
    success: result.success,
    error: result.success ? null : result.message,
  });
  const erpAlias = JSON.stringify({
    type: "erp-oauth-callback",
    success: result.success,
    error: result.success ? null : result.message,
  });
  const origin = JSON.stringify(webUrl());
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Tiny OAuth</title></head>
<body>
<script>
  const data = ${payload};
  const erpData = ${erpAlias};
  const target = ${origin};
  if (window.opener) {
    window.opener.postMessage(data, target);
    window.opener.postMessage(erpData, target);
    setTimeout(() => window.close(), 400);
  } else {
    window.location.href = target + '/integracoes/tiny?oauth=' + (data.success ? 'ok' : 'error');
  }
</script>
<p>${result.success ? "Conectado. Fechando…" : "Erro. Fechando…"}</p>
</body></html>`;
}

export function oauthCallbackJson(result: {
  success: boolean;
  message: string;
  connectionId?: string;
}) {
  return {
    type: "tiny-oauth-callback",
    success: result.success,
    error: result.success ? null : result.message,
    message: result.message,
    connectionId: result.connectionId ?? null,
  };
}

function formatTinyConnectionStatus(conn: {
  id: string;
  name: string;
  status: TinyConnectionStatus;
  isActive: boolean;
  isDefault: boolean;
  accessToken: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthRedirectUri: string | null;
  companyName: string | null;
  metadata: unknown;
  lastError: string | null;
  tokenExpiresAt: Date | null;
  lastValidatedAt: Date | null;
}) {
  const metadata = conn.metadata as TinyConnectionMetadata | null;
  const redirectUri = resolveOAuthRedirectUri(conn.oauthRedirectUri);

  return {
    connected:
      conn.isActive &&
      Boolean(conn.accessToken) &&
      (conn.status === TinyConnectionStatus.CONNECTED ||
        conn.status === TinyConnectionStatus.BLOCKED),
    status: conn.status,
    uiStatus: mapTinyStatusToUi(conn.status, conn.isActive),
    name: conn.name,
    companyName: conn.companyName,
    metadata,
    hasCredentials: Boolean(conn.oauthClientId && conn.oauthClientSecret),
    oauthClientId: conn.oauthClientId,
    redirectUri,
    expectedRedirectUri: defaultOAuthRedirectUri(),
    redirectUriMismatch:
      Boolean(conn.oauthRedirectUri) &&
      conn.oauthRedirectUri !== redirectUri,
    lastError: conn.lastError,
    tokenExpiresAt: conn.tokenExpiresAt?.toISOString() ?? null,
    lastValidatedAt: conn.lastValidatedAt?.toISOString() ?? null,
    isActive: conn.isActive,
    isDefault: conn.isDefault,
    connectionId: conn.id,
    isDraft: conn.status === TinyConnectionStatus.PENDING && !conn.accessToken,
  };
}

export async function listUserTinyConnections(scope: TinyConnectionScope) {
  const connections = await prisma.tinyConnection.findMany({
    where: {
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  const reconciled = await Promise.all(
    connections.map((conn) => reconcileTinyConnectionRateLimit(conn)),
  );
  return reconciled.map(formatTinyConnectionStatus);
}

export async function getTinyConnectionStatus(
  scope: TinyConnectionScope,
  connectionId?: string,
) {
  const conn = await findUserTinyConnection(scope, connectionId);
  if (!conn) {
    return {
      connected: false,
      status: "NONE" as const,
      uiStatus: "NONE" as TinyUiStatus,
      redirectUri: defaultOAuthRedirectUri(),
      connections: await listUserTinyConnections(scope),
    };
  }

  const fresh = await reconcileTinyConnectionRateLimit(conn);

  return {
    ...formatTinyConnectionStatus(fresh),
    connections: await listUserTinyConnections(scope),
  };
}

export async function setDefaultTinyConnection(
  scope: TinyConnectionScope,
  connectionId: string,
) {
  const conn = await findUserTinyConnection(scope, connectionId);
  if (!conn) {
    throw new Error("Conexão Tiny não encontrada para este usuário");
  }

  await prisma.$transaction([
    prisma.tinyConnection.updateMany({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        deletedAt: null,
      },
      data: { isDefault: false },
    }),
    prisma.tinyConnection.update({
      where: { id: connectionId },
      data: { isDefault: true },
    }),
  ]);

  return getTinyConnectionStatus(scope, connectionId);
}

export async function testTinyConnection(
  scope: TinyConnectionScope,
  connectionId?: string,
): Promise<{
  ok: boolean;
  companyName?: string | null;
  metadata?: TinyConnectionMetadata | null;
  tokenExpiresAt?: string | null;
  message?: string;
}> {
  const conn = await findUserTinyConnection(scope, connectionId);
  if (!conn) {
    return { ok: false, message: "Nenhuma conta Tiny configurada para este usuário" };
  }

  try {
    const client = await getTinyApiClient({
      tenantId: scope.tenantId,
      userId: scope.userId,
      connectionId: conn.id,
    });
    const info = await client.getInfo();
    const metadata = extractCompanyMetadata(info);
    const companyName = metadata.razaoSocial ?? metadata.nome ?? null;
    const now = new Date();

    await prisma.tinyConnection.update({
      where: { id: conn.id },
      data: {
        companyName,
        metadata: {
          ...(clearRateLimitMetadata(conn.metadata) ?? {}),
          ...metadata,
        } as Prisma.InputJsonValue,
        lastValidatedAt: now,
        lastError: null,
        status: TinyConnectionStatus.CONNECTED,
      },
    });

    if (metadata.cnpj) {
      await prisma.tenant.updateMany({
        where: { id: scope.tenantId, cnpj: null },
        data: { cnpj: metadata.cnpj },
      });
    }

    const updated = await prisma.tinyConnection.findUnique({ where: { id: conn.id } });
    return {
      ok: true,
      companyName,
      metadata,
      tokenExpiresAt: updated?.tokenExpiresAt?.toISOString() ?? null,
    };
  } catch (e) {
    const message =
      e instanceof TinyApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Falha ao testar conexão";

    const status =
      e instanceof TinyApiError && e.statusCode === 429
        ? TinyConnectionStatus.CONNECTED
        : TinyConnectionStatus.ERROR;
    await prisma.tinyConnection.update({
      where: { id: conn.id },
      data: { lastError: message, status },
    });

    return { ok: false, message };
  }
}

export async function disconnectTinyConnection(
  scope: TinyConnectionScope,
  connectionId?: string,
) {
  const conn = await findUserTinyConnection(scope, connectionId);
  if (!conn) {
    return { ok: true };
  }

  await prisma.tinyConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: null,
      refreshToken: null,
      oauthIdToken: null,
      tokenExpiresAt: null,
      lastValidatedAt: null,
      status: TinyConnectionStatus.PENDING,
      lastError: null,
      isActive: false,
      isDefault: false,
    },
  });

  if (conn.isDefault) {
    const next = await prisma.tinyConnection.findFirst({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        deletedAt: null,
        isActive: true,
        status: TinyConnectionStatus.CONNECTED,
        id: { not: conn.id },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (next) {
      await prisma.tinyConnection.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  return { ok: true };
}

export async function cancelTinyDraft(
  scope: TinyConnectionScope,
  connectionId?: string,
) {
  const conn = await findUserTinyConnection(scope, connectionId);
  if (!conn) {
    return { ok: true };
  }

  if (conn.accessToken) {
    throw new Error("Não é possível cancelar: conexão já possui token OAuth");
  }

  await prisma.tinyConnection.update({
    where: { id: conn.id },
    data: {
      oauthClientId: null,
      oauthClientSecret: null,
      oauthRedirectUri: null,
      status: TinyConnectionStatus.PENDING,
      lastError: null,
      isActive: false,
      isDefault: false,
      deletedAt: new Date(),
    },
  });

  if (conn.isDefault) {
    const next = await prisma.tinyConnection.findFirst({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        deletedAt: null,
        isActive: true,
        id: { not: conn.id },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (next) {
      await prisma.tinyConnection.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  return { ok: true };
}

export async function listConnectionsForRefresh() {
  return prisma.tinyConnection.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      status: TinyConnectionStatus.CONNECTED,
      accessToken: { not: null },
      refreshToken: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      tokenExpiresAt: true,
      updatedAt: true,
    },
  });
}
