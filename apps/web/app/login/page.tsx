"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isPlatformOnlyAdmin } from "@wms/shared";
import { login, type AuthUser } from "@/lib/auth";

function loginRedirect(user: AuthUser, from: string): string {
  if (isPlatformOnlyAdmin(user)) {
    return "/platform/tenants";
  }
  return from.startsWith("/") ? from : "/";
}

const QUICK_USERS = [
  {
    role: "Admin da Conta",
    email: "adm@wms.local",
    password: "admin123",
    description: "Gestão total da conta: pedidos, estoque, usuários e configurações",
    badge: "Recomendado",
  },
  {
    role: "Operador",
    email: "operador@wms.local",
    password: "operador123",
    description: "Operação do CD: pedidos, separação, packing e estoque",
  },
  {
    role: "Super-admin Plataforma",
    email: "admin@wms.local",
    password: "admin123",
    description: "Gestão de múltiplos clientes/tenants (sem operação do CD)",
  },
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";

  const [email, setEmail] = useState("adm@wms.local");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectQuickUser = (u: (typeof QUICK_USERS)[number]) => {
    setEmail(u.email);
    setPassword(u.password);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      const target = loginRedirect(user, from);
      router.replace(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao entrar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-black text-primary-foreground">
            W
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Zentor WMS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Help Route · gestão de armazém, picking, packing e expedição integrada ao Tiny ERP
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium"
            >
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Entrar
          </button>
        </form>

        <div className="mt-6 border-t pt-4">
          <p className="mb-2.5 text-center text-xs font-medium text-muted-foreground">
            Acesso rápido para testes e homologação:
          </p>
          <div className="space-y-1.5">
            {QUICK_USERS.map((u) => {
              const selected = email === u.email;
              return (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => selectQuickUser(u)}
                  className={`w-full rounded-lg border p-2.5 text-left transition ${
                    selected
                      ? "border-[#0d9488] bg-teal-50/60 ring-1 ring-[#0d9488]"
                      : "border-border hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      {u.role}
                    </span>
                    {u.badge ? (
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">
                        {u.badge}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="font-mono">{u.email}</span>
                    <span className="font-mono text-slate-400">{u.password}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 text-center">
            <a
              href="/docs/usuarios-teste"
              className="inline-block text-xs font-medium text-[#0d9488] hover:underline"
            >
              Consultar documentação completa de usuários
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
