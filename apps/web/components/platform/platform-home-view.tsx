import Link from "next/link";
import { Building2 } from "lucide-react";

export function PlatformHomeView() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plataforma Help Route</h1>
        <p className="mt-2 text-muted-foreground">
          Você está logado como super-admin da plataforma. Aqui você gerencia
          clientes (tenants) e cria o administrador inicial de cada um.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-foreground">O que você pode fazer</h2>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-muted-foreground">
          <li>Listar, criar e ativar/desativar clientes</li>
          <li>Criar usuário administrador por cliente</li>
          <li>Ver usuários cadastrados em cada tenant</li>
        </ul>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
        <p className="font-semibold">Pedidos, ondas e estoque</p>
        <p className="mt-2">
          Essas operações pertencem a cada cliente. Para testar pedidos e ondas,
          faça login com o admin do tenant (ex.:{" "}
          <code className="rounded bg-amber-100 px-1">adm@wms.local</code> ou{" "}
          <code className="rounded bg-amber-100 px-1">admin@loja-a.local</code>
          ). Consulte{" "}
          <code className="rounded bg-amber-100 px-1">docs/usuarios-teste.md</code>{" "}
          no repositório.
        </p>
      </div>

      <Link
        href="/platform/tenants"
        className="inline-flex items-center gap-2 rounded-lg bg-[#0d9488] px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
      >
        <Building2 className="h-5 w-5" />
        Ir para Clientes
      </Link>
    </div>
  );
}
