import { Permission, type PermissionKey } from "@wms/shared";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Box,
  Building2,
  Warehouse,
  ClipboardList,
  LayoutDashboard,
  Layers,
  Link2,
  Settings,
  Shield,
  ShoppingCart,
  Users,
  Package,
  RotateCcw,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionKey;
  badge?: string;
}

export const MAIN_NAV: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: Permission.DASHBOARD_VIEW,
  },
  {
    href: "/cadastros",
    label: "Cadastros",
    icon: ClipboardList,
    permission: Permission.REGISTERS_VIEW,
  },
  {
    href: "/gestao-barracao",
    label: "Layout do galpão",
    icon: Warehouse,
    permission: Permission.REGISTERS_VIEW,
  },
  {
    href: "/pedidos",
    label: "Pedidos",
    icon: ShoppingCart,
    permission: Permission.SALES_VIEW,
  },
  {
    href: "/ondas",
    label: "Ondas",
    icon: Layers,
    permission: Permission.SALES_VIEW,
  },
  {
    href: "/recebimentos",
    label: "Recebimentos",
    icon: Box,
    permission: Permission.RECEIPTS_VIEW,
  },
  {
    href: "/estoque",
    label: "Estoque",
    icon: RotateCcw,
    permission: Permission.STOCK_VIEW,
  },
  {
    href: "/packing",
    label: "Packing",
    icon: Package,
    permission: Permission.SHIPPING_VIEW,
  },
  {
    href: "/sistema",
    label: "Sistema",
    icon: Settings,
    permission: Permission.SYSTEM_VIEW,
  },
  {
    href: "/integracoes/tiny",
    label: "Tiny ERP",
    icon: Link2,
    permission: Permission.OLIST_CONFIGURE,
  },
];

export const PLATFORM_ONLY_NAV: NavItem[] = [
  {
    href: "/",
    label: "Início",
    icon: LayoutDashboard,
    permission: Permission.WEB_ACCESS,
  },
  {
    href: "/platform/tenants",
    label: "Clientes (Empresas)",
    icon: Building2,
    permission: Permission.TENANTS_MANAGE,
  },
  {
    href: "/platform/usuarios",
    label: "Usuários do WMS",
    icon: Users,
    permission: Permission.TENANTS_MANAGE,
  },
];

export const PLATFORM_NAV: NavItem[] = [
  {
    href: "/platform/tenants",
    label: "Clientes (Empresas)",
    icon: Building2,
    permission: Permission.TENANTS_MANAGE,
  },
  {
    href: "/platform/usuarios",
    label: "Usuários do WMS",
    icon: Users,
    permission: Permission.TENANTS_MANAGE,
  },
];

export const ADMIN_NAV: NavItem[] = [
  {
    href: "/relatorios",
    label: "Relatórios",
    icon: BarChart3,
    permission: Permission.REPORTS_VIEW,
  },
  {
    href: "/admin/usuarios",
    label: "Usuários e permissões",
    icon: Users,
    permission: Permission.USERS_MANAGE,
  },
  {
    href: "/admin/configuracoes",
    label: "Configurações",
    icon: Shield,
    permission: Permission.SETTINGS_MANAGE,
  },
];
