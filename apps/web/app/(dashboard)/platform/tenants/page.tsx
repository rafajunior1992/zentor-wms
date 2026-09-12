"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, UserPlus } from "lucide-react";
import { defaultPermissionsForRole, UserRole } from "@wms/shared";
import { apiFetch } from "@/lib/api/client";

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  cnpj?: string | null;
  active: boolean;
  userCount?: number;
  tinyStatus?: string | null;
};

type CreateTenantForm = { name: string; slug: string; cnpj: string };
type AdminForm = {
  tenantId: string;
  tenantName: string;
  email: string;
  name: string;
  password: string;
};

type TenantUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
};

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateTenantForm | null>(null);
  const [adminForm, setAdminForm] = useState<AdminForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);
  const [tenantUsers, setTenantUsers] = useState<Record<string, TenantUserRow[]>>({});
  const [usersLoadingId, setUsersLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ tenants: TenantRow[] }>(
        "/api/platform/tenants",
      );
      setTenants(data.tenants);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar clientes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveTenant = async () => {
    if (!createForm?.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/platform/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          slug: createForm.slug.trim() || undefined,
          cnpj: createForm.cnpj.trim() || undefined,
        }),
      });
      setCreateForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar cliente");
    } finally {
      setSaving(false);
    }
  };

  const saveAdmin = async () => {
    if (!adminForm) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/platform/tenants/${adminForm.tenantId}/admin-user`, {
        method: "POST",
        body: JSON.stringify({
          email: adminForm.email.trim(),
          name: adminForm.name.trim(),
          password: adminForm.password,
          permissions: defaultPermissionsForRole(UserRole.ADMIN),
        }),
      });
      setAdminForm(null);
      setTenantUsers((prev) => {
        const next = { ...prev };
        delete next[adminForm.tenantId];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar administrador");
    } finally {
      setSaving(false);
    }
  };

  const toggleUsers = async (tenantId: string) => {
    if (expandedTenantId === tenantId) {
      setExpandedTenantId(null);
      return;
    }
    setExpandedTenantId(tenantId);
    if (tenantUsers[tenantId]) return;
    setUsersLoadingId(tenantId);
    setError(null);
    try {
      const data = await apiFetch<{ users: TenantUserRow[] }>(
        `/api/platform/tenants/${tenantId}/users`,
      );
      setTenantUsers((prev) => ({ ...prev, [tenantId]: data.users }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar usuários");
    } finally {
      setUsersLoadingId(null);
    }
  };

  const toggleActive = async (t: TenantRow) => {
    setError(null);
    try {
      await apiFetch(`/api/platform/tenants/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !t.active }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar cliente");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">
            Gerencie tenants da plataforma e crie o administrador mestre de cada
            cliente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateForm({ name: "", slug: "", cnpj: "" })}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          Novo cliente
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">CNPJ</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Usuários</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Tiny</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const expanded = expandedTenantId === t.id;
                const users = tenantUsers[t.id];
                return (
                  <Fragment key={t.id}>
                    <tr className="border-t">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleUsers(t.id)}
                          className="inline-flex items-center gap-1 font-medium hover:text-[#0d9488]"
                          title="Ver usuários"
                        >
                          {expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          {t.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {t.cnpj || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{t.slug}</td>
                      <td className="px-4 py-3">{t.userCount ?? 0}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleActive(t)}
                          className={
                            t.active
                              ? "text-emerald-700 hover:underline"
                              : "text-muted-foreground hover:underline"
                          }
                        >
                          {t.active ? "Ativo" : "Inativo"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {t.tinyStatus === "CONNECTED" ? "Conectado" : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setAdminForm({
                              tenantId: t.id,
                              tenantName: t.name,
                              email: "",
                              name: "",
                              password: "",
                            })
                          }
                          className="inline-flex items-center gap-1 font-medium text-[#0d9488] hover:underline"
                        >
                          <UserPlus className="h-4 w-4" />
                          Admin do cliente
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr key={`${t.id}-users`} className="border-t bg-muted/20">
                        <td colSpan={6} className="px-4 py-3">
                          {usersLoadingId === t.id ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Carregando usuários…
                            </div>
                          ) : users && users.length > 0 ? (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="pb-2 pr-4 font-medium">Nome</th>
                                  <th className="pb-2 pr-4 font-medium">E-mail</th>
                                  <th className="pb-2 pr-4 font-medium">Papel</th>
                                  <th className="pb-2 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {users.map((u) => (
                                  <tr key={u.id}>
                                    <td className="py-1 pr-4">{u.name}</td>
                                    <td className="py-1 pr-4 font-mono">{u.email}</td>
                                    <td className="py-1 pr-4">{u.role}</td>
                                    <td className="py-1">
                                      {u.active ? "Ativo" : "Inativo"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Nenhum usuário neste cliente.
                            </p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">Novo cliente</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-medium">Nome</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, name: e.target.value })
                  }
                  placeholder="Loja ABC"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Slug (opcional)</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
                  value={createForm.slug}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, slug: e.target.value })
                  }
                  placeholder="loja-abc"
                />
              </div>
              <div>
                <label className="text-sm font-medium">CNPJ (opcional)</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
                  value={createForm.cnpj}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, cnpj: e.target.value })
                  }
                  placeholder="00.000.000/0001-00"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateForm(null)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveTenant}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Criar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {adminForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">
              Administrador — {adminForm.tenantName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Usuário ADMIN com permissões padrão do tenant (sem gestão de
              plataforma).
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="text-sm font-medium">Nome</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={adminForm.name}
                  onChange={(e) =>
                    setAdminForm({ ...adminForm, name: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">E-mail</label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={adminForm.email}
                  onChange={(e) =>
                    setAdminForm({ ...adminForm, email: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">Senha</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={adminForm.password}
                  onChange={(e) =>
                    setAdminForm({ ...adminForm, password: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdminForm(null)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveAdmin}
                className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Criar admin"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
