"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Edit2,
  KeyRound,
  Loader2,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { PaginationMeta } from "@/lib/pagination";

type TenantOption = {
  id: string;
  name: string;
  slug: string;
  cnpj?: string | null;
};

type PlatformUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  active: boolean;
  isPlatformAdmin: boolean;
  tenantId: string | null;
  tenant?: {
    id: string;
    name: string;
    slug: string;
    cnpj?: string | null;
  } | null;
  createdAt?: string;
};

type CreateUserModalState = {
  name: string;
  email: string;
  password: string;
  role: string;
  tenantId: string;
  isPlatformAdmin: boolean;
};

type EditUserModalState = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
  tenantId: string;
  isPlatformAdmin: boolean;
  active: boolean;
};

const ROLES = [
  { value: "ADMIN", label: "Administrador (ADMIN)" },
  { value: "EXPEDITER", label: "Expedidor / Operador (EXPEDITER)" },
  { value: "PICKER", label: "Separador Coletor (PICKER)" },
  { value: "REPLENISHER", label: "Reabastecedor (REPLENISHER)" },
];

export default function PlatformUsersPage() {
  const [users, setUsers] = useState<PlatformUserRow[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [selectedTenant, setSelectedTenant] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [selectedActive, setSelectedActive] = useState("");
  const [page, setPage] = useState(1);

  // Modais
  const [createModal, setCreateModal] = useState<CreateUserModalState | null>(null);
  const [editModal, setEditModal] = useState<EditUserModalState | null>(null);
  const [saving, setSaving] = useState(false);

  // Carregar lista de tenants para os selects
  useEffect(() => {
    apiFetch<{ tenants: TenantOption[] }>("/api/platform/tenants?pageSize=100")
      .then((data) => setTenants(data.tenants))
      .catch(() => {});
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("page", String(page));
      sp.set("pageSize", "25");
      if (search.trim()) sp.set("q", search.trim());
      if (selectedTenant) sp.set("tenantId", selectedTenant);
      if (selectedRole) sp.set("role", selectedRole);
      if (selectedActive) sp.set("active", selectedActive);

      const data = await apiFetch<{
        users: PlatformUserRow[];
        pagination: PaginationMeta;
      }>(`/api/platform/users?${sp}`);
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }, [page, search, selectedTenant, selectedRole, selectedActive]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const toggleUserActive = async (u: PlatformUserRow) => {
    try {
      await apiFetch(`/api/platform/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !u.active }),
      });
      await loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao alterar status");
    }
  };

  const deleteUser = async (u: PlatformUserRow) => {
    if (!confirm(`Deseja realmente desativar/excluir o usuário "${u.name}" (${u.email})?`)) {
      return;
    }
    try {
      await apiFetch(`/api/platform/users/${u.id}`, { method: "DELETE" });
      await loadUsers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao excluir");
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createModal) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/platform/users", {
        method: "POST",
        body: JSON.stringify({
          name: createModal.name.trim(),
          email: createModal.email.trim(),
          password: createModal.password,
          role: createModal.role,
          isPlatformAdmin: createModal.isPlatformAdmin,
          tenantId: createModal.isPlatformAdmin ? undefined : createModal.tenantId || undefined,
        }),
      });
      setCreateModal(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar usuário");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: editModal.name.trim(),
        email: editModal.email.trim(),
        role: editModal.role,
        active: editModal.active,
        isPlatformAdmin: editModal.isPlatformAdmin,
        tenantId: editModal.isPlatformAdmin ? null : editModal.tenantId || null,
      };
      if (editModal.password.trim()) {
        body.password = editModal.password.trim();
      }
      await apiFetch(`/api/platform/users/${editModal.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setEditModal(null);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar usuário");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuários do WMS</h1>
          <p className="text-muted-foreground">
            Gerenciamento global de todos os usuários, administradores e operadores da plataforma.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setCreateModal({
              name: "",
              email: "",
              password: "",
              role: "ADMIN",
              tenantId: tenants[0]?.id ?? "",
              isPlatformAdmin: false,
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Novo usuário
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-[#0d9488]"
          />
        </div>

        <select
          value={selectedTenant}
          onChange={(e) => {
            setSelectedTenant(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
        >
          <option value="">Todas as empresas</option>
          <option value="platform">👑 Super-admins Plataforma</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              🏢 {t.name} ({t.slug})
            </option>
          ))}
        </select>

        <select
          value={selectedRole}
          onChange={(e) => {
            setSelectedRole(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
        >
          <option value="">Todos os papéis</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          value={selectedActive}
          onChange={(e) => {
            setSelectedActive(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
        >
          <option value="">Todos os status</option>
          <option value="true">Apenas ativos</option>
          <option value="false">Apenas inativos</option>
        </select>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Tabela de Usuários */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nome & E-mail</th>
                <th className="px-4 py-3 font-medium">Empresa / Tenant</th>
                <th className="px-4 py-3 font-medium">Papel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const isPlatform = u.isPlatformAdmin || !u.tenantId;
                return (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">{u.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {isPlatform ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          <Shield className="h-3 w-3" />
                          Plataforma WMS
                        </span>
                      ) : u.tenant ? (
                        <div>
                          <span className="inline-flex items-center gap-1 font-medium text-foreground">
                            <Building2 className="h-3.5 w-3.5 text-slate-400" />
                            {u.tenant.name}
                          </span>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {u.tenant.cnpj ? `CNPJ: ${u.tenant.cnpj}` : `slug: ${u.tenant.slug}`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${
                          u.role === "ADMIN"
                            ? "bg-purple-100 text-purple-900"
                            : u.role === "EXPEDITER"
                              ? "bg-blue-100 text-blue-900"
                              : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleUserActive(u)}
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          u.active
                            ? "text-emerald-700 hover:text-emerald-800"
                            : "text-slate-400 hover:text-slate-600"
                        }`}
                      >
                        {u.active ? (
                          <>
                            <UserCheck className="h-3.5 w-3.5" /> Ativo
                          </>
                        ) : (
                          <>
                            <UserX className="h-3.5 w-3.5" /> Inativo
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setEditModal({
                              id: u.id,
                              name: u.name,
                              email: u.email,
                              password: "",
                              role: u.role,
                              tenantId: u.tenantId ?? "",
                              isPlatformAdmin: Boolean(u.isPlatformAdmin),
                              active: u.active,
                            })
                          }
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-[#0d9488]"
                          title="Editar usuário"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteUser(u)}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-destructive"
                          title="Desativar ou excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum usuário encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {/* Paginação */}
          {pagination && pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <div>
                Página {pagination.page} de {pagination.totalPages} ({pagination.total} usuários)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border px-2.5 py-1 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border px-2.5 py-1 disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Modal: Novo Usuário */}
      {createModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">Novo Usuário no WMS</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Cadastre um novo colaborador ou administrador para qualquer empresa do sistema.
            </p>

            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground">Tipo de Usuário</label>
                <div className="mt-1 flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="userType"
                      checked={!createModal.isPlatformAdmin}
                      onChange={() =>
                        setCreateModal({ ...createModal, isPlatformAdmin: false })
                      }
                    />
                    Colaborador de Empresa / Tenant
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="userType"
                      checked={createModal.isPlatformAdmin}
                      onChange={() =>
                        setCreateModal({
                          ...createModal,
                          isPlatformAdmin: true,
                          role: "ADMIN",
                        })
                      }
                    />
                    Super-admin da Plataforma
                  </label>
                </div>
              </div>

              {!createModal.isPlatformAdmin ? (
                <div>
                  <label className="text-xs font-semibold text-foreground">
                    Empresa / Cliente (Tenant) *
                  </label>
                  <select
                    required
                    value={createModal.tenantId}
                    onChange={(e) =>
                      setCreateModal({ ...createModal, tenantId: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  >
                    <option value="">Selecione uma empresa...</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.slug}) {t.cnpj ? `— CNPJ: ${t.cnpj}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground">Nome completo *</label>
                  <input
                    required
                    value={createModal.name}
                    onChange={(e) =>
                      setCreateModal({ ...createModal, name: e.target.value })
                    }
                    placeholder="João da Silva"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground">E-mail *</label>
                  <input
                    required
                    type="email"
                    value={createModal.email}
                    onChange={(e) =>
                      setCreateModal({ ...createModal, email: e.target.value })
                    }
                    placeholder="joao@empresa.com"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground">Senha inicial *</label>
                  <input
                    required
                    type="password"
                    value={createModal.password}
                    onChange={(e) =>
                      setCreateModal({ ...createModal, password: e.target.value })
                    }
                    placeholder="Mínimo 6 dígitos"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground">Papel (Função) *</label>
                  <select
                    disabled={createModal.isPlatformAdmin}
                    value={createModal.role}
                    onChange={(e) =>
                      setCreateModal({ ...createModal, role: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setCreateModal(null)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Criar Usuário"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Editar Usuário */}
      {editModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">Editar Usuário</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Altere dados cadastrais, redefina a senha ou transfira de empresa.
            </p>

            <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground">Nome completo *</label>
                  <input
                    required
                    value={editModal.name}
                    onChange={(e) =>
                      setEditModal({ ...editModal, name: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground">E-mail *</label>
                  <input
                    required
                    type="email"
                    value={editModal.email}
                    onChange={(e) =>
                      setEditModal({ ...editModal, email: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground">
                    Nova Senha (deixe vazio para manter)
                  </label>
                  <div className="relative mt-1">
                    <KeyRound className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="password"
                      placeholder="Redefinir senha..."
                      value={editModal.password}
                      onChange={(e) =>
                        setEditModal({ ...editModal, password: e.target.value })
                      }
                      className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none focus:border-[#0d9488]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground">Papel (Função)</label>
                  <select
                    value={editModal.role}
                    onChange={(e) =>
                      setEditModal({ ...editModal, role: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!editModal.isPlatformAdmin ? (
                <div>
                  <label className="text-xs font-semibold text-foreground">
                    Empresa / Cliente (Tenant)
                  </label>
                  <select
                    value={editModal.tenantId}
                    onChange={(e) =>
                      setEditModal({ ...editModal, tenantId: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-[#0d9488]"
                  >
                    <option value="">Sem empresa</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.slug}) {t.cnpj ? `— CNPJ: ${t.cnpj}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="userActiveCheck"
                  checked={editModal.active}
                  onChange={(e) =>
                    setEditModal({ ...editModal, active: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-gray-300 text-[#0d9488]"
                />
                <label htmlFor="userActiveCheck" className="text-sm font-medium">
                  Usuário Ativo (permite login)
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
