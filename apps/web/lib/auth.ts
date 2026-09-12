const TOKEN_COOKIE = "wms_token";
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  cnpj?: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  active?: boolean;
  avatarUrl?: string | null;
  olistConfigured?: boolean;
  tenantId?: string | null;
  isPlatformAdmin?: boolean;
  tenant?: AuthTenant | null;
}

export function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function setAuthToken(token: string) {
  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function clearAuthToken() {
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0`;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthUser> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error(
      `Não foi possível conectar à API (${API_BASE}). Rode pnpm dev:api em outro terminal.`,
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
    user?: AuthUser;
  };

  if (!res.ok) {
    throw new Error(body.error ?? "Falha no login");
  }

  if (!body.token || !body.user) {
    throw new Error("Resposta de login inválida");
  }

  setAuthToken(body.token);
  return body.user;
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function logout() {
  clearAuthToken();
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}
