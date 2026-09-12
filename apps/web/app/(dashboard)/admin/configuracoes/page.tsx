"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

interface Setting {
  key: string;
  value: string;
  description?: string | null;
}

const DEFAULT_KEYS = [
  {
    key: "company.name",
    label: "Nome da empresa",
    description: "Exibido no sistema",
  },
  {
    key: "company.cnpj",
    label: "CNPJ da empresa",
    description: "Cadastro Nacional da Pessoa Jurídica (ex: 00.000.000/0001-00)",
  },
  {
    key: "warehouse.label",
    label: "Centro de distribuição",
    description: "Identificação do CD",
  },
  {
    key: "wave.enabled",
    label: "Habilitar separação em onda",
    description: "true ou false — exibe fluxo de onda no mobile",
  },
  {
    key: "wave.autoRelease.enabled",
    label: "Liberação automática da onda",
    description: "true ou false — job diário no horário configurado",
  },
  {
    key: "wave.autoRelease.time",
    label: "Horário da liberação automática",
    description: "HH:mm (America/Sao_Paulo), ex: 06:30",
  },
  {
    key: "wave.autoRelease.maxOrders",
    label: "Máximo de pedidos por onda",
    description: "Número inteiro",
  },
  {
    key: "wave.onlyDeadlineToday",
    label: "Somente coleta hoje na onda",
    description: "true restringe pedidos com deadline do dia",
  },
  {
    key: "tiny.webhook.secret",
    label: "Token do webhook Tiny",
    description: "Enviado no header x-tiny-token; vazio = sem validação",
  },
];

export default function AdminConfiguracoesPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Setting[] }>("/api/admin/settings");
      const map: Record<string, string> = {};
      for (const s of data.settings) map[s.key] = s.value;
      for (const d of DEFAULT_KEYS) {
        if (!map[d.key]) map[d.key] = "";
      }
      setValues(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          settings: DEFAULT_KEYS.map((d) => ({
            key: d.key,
            value: values[d.key] ?? "",
            description: d.description,
          })),
        }),
      });
      setMessage("Configurações salvas.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Configurações do sistema
        </h1>
        <p className="text-muted-foreground">
          Dados globais do Help Route — somente administradores.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        {DEFAULT_KEYS.map((item) => (
          <div key={item.key}>
            <label className="text-sm font-medium">{item.label}</label>
            <p className="text-xs text-muted-foreground">{item.description}</p>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={values[item.key] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [item.key]: e.target.value })
              }
            />
          </div>
        ))}

        {message ? <p className="text-sm text-green-700">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-[#0d9488] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar configurações"}
        </button>
      </form>
    </div>
  );
}
