import * as SecureStore from "expo-secure-store";
import { getApiBaseUrl } from "./api-config";

const TOKEN_KEY = "help_route_mobile_token";

export interface MobileUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  avatarUrl?: string | null;
  olistConfigured?: boolean;
}

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearStoredToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

function networkLoginError(): Error {
  const base = getApiBaseUrl();
  return new Error(
    `Não foi possível conectar à API (${base}). Homolog: pnpm dev:mobile:homolog (ou :tunnel). Local: EXPO_PUBLIC_API_URL=http://SEU_IP:3333`,
  );
}

export async function loginMobile(
  email: string,
  password: string,
): Promise<{ token: string; user: MobileUser }> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/auth/mobile/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw networkLoginError();
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
    user?: MobileUser;
  };

  if (!res.ok) {
    throw new Error(body.error ?? "Falha no login");
  }
  if (!body.token || !body.user) {
    throw new Error("Resposta de login inválida");
  }

  await setStoredToken(body.token);
  return { token: body.token, user: body.user };
}

export async function fetchMe(token: string): Promise<MobileUser> {
  const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    user?: MobileUser | null;
  };

  if (!res.ok) {
    throw new Error(body.error ?? "Sessão inválida");
  }
  if (!body.user) {
    throw new Error("Usuário não encontrado");
  }
  return body.user;
}

export async function logoutMobile(): Promise<void> {
  await clearStoredToken();
}
