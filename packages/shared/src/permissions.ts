import type { UserRole } from "./types/prisma.js";

/** Chaves de permissão do Help Route WMS */
export const Permission = {
  MOBILE_ACCESS: "mobile.access",
  WEB_ACCESS: "web.access",
  DASHBOARD_VIEW: "dashboard.view",
  SEARCH_USE: "search.use",
  REGISTERS_VIEW: "registers.view",
  PRODUCTS_MANAGE: "products.manage",
  SALES_VIEW: "sales.view",
  RECEIPTS_VIEW: "receipts.view",
  STOCK_VIEW: "stock.view",
  SHIPPING_VIEW: "shipping.view",
  REPORTS_VIEW: "reports.view",
  SYSTEM_VIEW: "system.view",
  USERS_MANAGE: "users.manage",
  TENANTS_MANAGE: "tenants.manage",
  SETTINGS_MANAGE: "settings.manage",
  OLIST_CONFIGURE: "olist.configure",
  NOTIFICATIONS_VIEW: "notifications.view",
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionMeta[] = [
  { key: Permission.MOBILE_ACCESS, label: "Acesso ao app mobile", group: "Geral" },
  { key: Permission.WEB_ACCESS, label: "Acesso ao painel web", group: "Geral" },
  { key: Permission.DASHBOARD_VIEW, label: "Dashboard", group: "Operação" },
  { key: Permission.REGISTERS_VIEW, label: "Cadastros", group: "Operação" },
  { key: Permission.SALES_VIEW, label: "Pedidos", group: "Operação" },
  { key: Permission.RECEIPTS_VIEW, label: "Recebimentos", group: "Operação" },
  { key: Permission.STOCK_VIEW, label: "Estoque", group: "Operação" },
  { key: Permission.SHIPPING_VIEW, label: "Expedição", group: "Operação" },
  { key: Permission.REPORTS_VIEW, label: "Relatórios", group: "Admin" },
  { key: Permission.SYSTEM_VIEW, label: "Sistema", group: "Sistema" },
  { key: Permission.USERS_MANAGE, label: "Gerenciar usuários", group: "Admin" },
  {
    key: Permission.TENANTS_MANAGE,
    label: "Gerenciar clientes (plataforma)",
    group: "Plataforma",
  },
  {
    key: Permission.SETTINGS_MANAGE,
    label: "Configurações do sistema",
    group: "Admin",
  },
  {
    key: Permission.OLIST_CONFIGURE,
    label: "Integração Olist",
    group: "Integrações",
  },
  {
    key: Permission.NOTIFICATIONS_VIEW,
    label: "Notificações",
    group: "Geral",
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);

/** Super-admin da plataforma (sem tenant) — apenas gestão de clientes e acesso web */
export const PLATFORM_ADMIN_PERMISSIONS: PermissionKey[] = [
  Permission.WEB_ACCESS,
  Permission.TENANTS_MANAGE,
  Permission.NOTIFICATIONS_VIEW,
];

export function isPlatformOnlyAdmin(user: {
  isPlatformAdmin?: boolean;
  tenantId?: string | null;
}): boolean {
  return Boolean(user.isPlatformAdmin && !user.tenantId);
}

const TENANT_ADMIN_PERMISSIONS = ALL_PERMISSION_KEYS.filter(
  (k) => k !== Permission.TENANTS_MANAGE,
);

const ROLE_DEFAULTS: Record<UserRole, PermissionKey[]> = {
  ADMIN: [...TENANT_ADMIN_PERMISSIONS],
  EXPEDITER: [
    Permission.WEB_ACCESS,
    Permission.DASHBOARD_VIEW,
    Permission.REGISTERS_VIEW,
    Permission.PRODUCTS_MANAGE,
    Permission.SALES_VIEW,
    Permission.RECEIPTS_VIEW,
    Permission.STOCK_VIEW,
    Permission.SHIPPING_VIEW,
    Permission.NOTIFICATIONS_VIEW,
  ],
  REPLENISHER: [
    Permission.MOBILE_ACCESS,
    Permission.WEB_ACCESS,
    Permission.STOCK_VIEW,
    Permission.NOTIFICATIONS_VIEW,
  ],
  PICKER: [Permission.MOBILE_ACCESS, Permission.NOTIFICATIONS_VIEW],
};

export function defaultPermissionsForRole(role: UserRole): PermissionKey[] {
  return [...ROLE_DEFAULTS[role]];
}

export function hasPermission(
  user: { role: string; permissions: string[]; isPlatformAdmin?: boolean },
  permission: PermissionKey,
): boolean {
  if (user.isPlatformAdmin) {
    return PLATFORM_ADMIN_PERMISSIONS.includes(permission);
  }
  if (user.role === "ADMIN") {
    return permission !== Permission.TENANTS_MANAGE;
  }
  const perms =
    user.permissions.length > 0
      ? user.permissions
      : defaultPermissionsForRole(user.role as UserRole);
  return perms.includes(permission);
}

export function canAccessWeb(user: {
  role: string;
  permissions: string[];
}): boolean {
  return hasPermission(user, Permission.WEB_ACCESS);
}

const MOBILE_ROLES = new Set(["PICKER", "REPLENISHER"]);

export function canAccessMobile(user: {
  role: string;
  permissions: string[];
  isPlatformAdmin?: boolean;
}): boolean {
  if (user.isPlatformAdmin) return false;
  if (user.role === "ADMIN") return true;
  if (user.permissions && user.permissions.length > 0) {
    return user.permissions.includes(Permission.MOBILE_ACCESS);
  }
  return MOBILE_ROLES.has(user.role);
}
