"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Loader2, Printer, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import {
  fetchShippingLabelPreviewBlob,
  fetchShippingLabelText,
} from "@/lib/shipping-label-file";
import { printZplWithQz } from "@/lib/shipping-label-qz";

export type ShippingLabelApiResult = {
  status: string;
  urls: string[];
  message?: string;
  cached?: boolean;
  createdAgrupamento?: boolean;
  concludedAgrupamento?: boolean;
  labelFormat?: "zpl" | "pdf" | "unknown";
  formaEnvioNome?: string | null;
};

export type ShippingLabelPanelHandle = {
  ensureAndPrint: () => Promise<void>;
};

type Props = {
  orderId: string;
  erpOrderId: string;
  initialUrl?: string | null;
  disabled?: boolean;
  onLabelCached?: (url: string | null) => void;
};

function statusMessage(result: ShippingLabelApiResult): string {
  if (result.status === "OK") {
    const parts = [
      result.cached ? "Etiqueta em cache" : "Etiqueta obtida do Tiny",
    ];
    if (result.createdAgrupamento) parts.push("agrupamento criado");
    if (result.concludedAgrupamento) parts.push("lote concluído");
    if (result.formaEnvioNome) parts.push(result.formaEnvioNome);
    return parts.join(" · ");
  }
  return result.message ?? "Etiqueta indisponível";
}

export const ShippingLabelPanel = forwardRef<ShippingLabelPanelHandle, Props>(
  function ShippingLabelPanel(
    { orderId, erpOrderId, initialUrl, disabled = false, onLabelCached },
    ref,
  ) {
    const [labelUrls, setLabelUrls] = useState<string[]>(
      initialUrl ? [initialUrl] : [],
    );
    const [labelMessage, setLabelMessage] = useState<string | null>(null);
    const [labelLoading, setLabelLoading] = useState(false);
    const [printLoading, setPrintLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewKind, setPreviewKind] = useState<"image" | "pdf" | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const previewObjectUrlRef = useRef<string | null>(null);

    useEffect(() => {
      setLabelUrls(initialUrl ? [initialUrl] : []);
    }, [initialUrl]);

    const revokePreviewObjectUrl = useCallback(() => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    }, []);

    const clearPreview = useCallback(() => {
      revokePreviewObjectUrl();
      setPreviewUrl(null);
      setPreviewKind(null);
    }, [revokePreviewObjectUrl]);

    const loadPreview = useCallback(
      async (refresh = false) => {
        setPreviewLoading(true);
        setPreviewError(null);
        try {
          const { blob, contentType } = await fetchShippingLabelPreviewBlob(
            orderId,
            refresh,
          );
          revokePreviewObjectUrl();
          const objectUrl = URL.createObjectURL(blob);
          previewObjectUrlRef.current = objectUrl;
          setPreviewUrl(objectUrl);
          setPreviewKind(contentType.includes("pdf") ? "pdf" : "image");
        } catch (e) {
          clearPreview();
          setPreviewError(
            e instanceof Error ? e.message : "Erro ao carregar visualização",
          );
        } finally {
          setPreviewLoading(false);
        }
      },
      [orderId, clearPreview, revokePreviewObjectUrl],
    );

    useEffect(() => {
      return () => revokePreviewObjectUrl();
    }, [revokePreviewObjectUrl]);

    const handleFetch = useCallback(
      async (refresh = false) => {
        setLabelLoading(true);
        setLabelMessage(null);
        setPreviewError(null);
        try {
          const result = await apiFetch<ShippingLabelApiResult>(
            `/api/packing/orders/${orderId}/shipping-labels${refresh ? "?refresh=1" : ""}`,
            { method: "POST", body: "{}" },
          );
          if (result.status === "OK" && result.urls.length > 0) {
            setLabelUrls(result.urls);
            onLabelCached?.(result.urls[0] ?? null);
            setLabelMessage(statusMessage(result));
            await loadPreview(refresh);
            return result;
          }
          setLabelUrls([]);
          clearPreview();
          onLabelCached?.(null);
          setLabelMessage(statusMessage(result));
          throw new Error(statusMessage(result));
        } catch (e) {
          const msg =
            e instanceof Error ? e.message : "Erro ao criar etiqueta";
          setLabelMessage(msg);
          throw e instanceof Error ? e : new Error(msg);
        } finally {
          setLabelLoading(false);
        }
      },
      [orderId, onLabelCached, loadPreview, clearPreview],
    );

    useEffect(() => {
      if (initialUrl) {
        void loadPreview(false);
      }
    }, [initialUrl, loadPreview]);

    const handlePrintThermal = useCallback(async () => {
      setPrintLoading(true);
      setLabelMessage(null);
      try {
        const zpl = await fetchShippingLabelText(orderId);
        const { printer } = await printZplWithQz(zpl);
        setLabelMessage(`Enviado para impressora ${printer}`);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Erro ao imprimir na térmica";
        setLabelMessage(msg);
        throw e instanceof Error ? e : new Error(msg);
      } finally {
        setPrintLoading(false);
      }
    }, [orderId]);

    useImperativeHandle(
      ref,
      () => ({
        ensureAndPrint: async () => {
          const has =
            labelUrls.length > 0 || Boolean(initialUrl);
          if (!has) {
            await handleFetch(false);
          }
          await handlePrintThermal();
        },
      }),
      [labelUrls.length, initialUrl, handleFetch, handlePrintThermal],
    );

    const hasLabel = labelUrls.length > 0 || Boolean(initialUrl);
    const busy =
      labelLoading || printLoading || previewLoading || disabled;

    return (
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Etiqueta de envio</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {erpOrderId}
            </p>
          </div>
          <p className="max-w-[140px] text-right text-[11px] leading-snug text-muted-foreground">
            Visualização no navegador — sem instalar nada
          </p>
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border bg-slate-50">
          {previewLoading ? (
            <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Gerando preview…
            </div>
          ) : previewUrl && previewKind === "image" ? (
            <img
              src={previewUrl}
              alt={`Etiqueta ${erpOrderId}`}
              className="mx-auto max-h-96 w-full object-contain bg-white p-2"
              onError={() =>
                setPreviewError("Não foi possível exibir a imagem da etiqueta")
              }
            />
          ) : previewUrl && previewKind === "pdf" ? (
            <iframe
              src={previewUrl}
              title={`Etiqueta ${erpOrderId}`}
              className="h-96 w-full bg-white"
            />
          ) : (
            <div className="flex min-h-[160px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
              {previewError ??
                (hasLabel
                  ? "Não foi possível gerar o preview. Tente Atualizar."
                  : "Clique em Criar Etiqueta para ver aqui.")}
            </div>
          )}
        </div>

        {labelMessage ? (
          <p
            className={`mt-2 text-xs ${
              hasLabel && !labelMessage.toLowerCase().includes("erro")
                ? "text-emerald-800"
                : "text-amber-800"
            }`}
          >
            {labelMessage}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleFetch(false).catch(() => {})}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {labelLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {labelLoading ? "Criando…" : "Criar Etiqueta"}
          </button>

          {hasLabel ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePrintThermal().catch(() => {})}
                title="Opcional: requer QZ Tray instalado na estação"
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-muted-foreground disabled:opacity-50"
              >
                {printLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="h-3.5 w-3.5" />
                )}
                Imprimir térmica
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleFetch(true).catch(() => {})}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  },
);
