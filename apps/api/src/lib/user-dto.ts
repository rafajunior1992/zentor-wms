import { effectivePermissions } from "./permissions.js";

export function toPublicUser(
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    permissions: string[];
    active?: boolean;
    avatarUrl?: string | null;
    olistToken?: string | null;
    tenantId?: string | null;
    isPlatformAdmin?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    tenant?: { id: string; name: string; slug: string; cnpj?: string | null } | null;
  },
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: effectivePermissions(user),
    active: user.active ?? true,
    avatarUrl: user.avatarUrl ?? null,
    olistConfigured: Boolean(user.olistToken?.trim()),
    tenantId: user.tenantId ?? null,
    isPlatformAdmin: user.isPlatformAdmin ?? false,
    tenant: user.tenant
      ? {
          id: user.tenant.id,
          name: user.tenant.name,
          slug: user.tenant.slug,
          cnpj: user.tenant.cnpj ?? null,
        }
      : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
