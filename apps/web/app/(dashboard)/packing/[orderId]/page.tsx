"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/ops/page-header";
import { CollectionDeadlineIndicator } from "@/components/ops/collection-deadline-indicator";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { DataState } from "@/components/ops/data-state";
import { PackingIssueModal } from "@/components/ops/packing-issue-modal";
import {
  ShippingLabelPanel,
  type ShippingLabelPanelHandle,
} from "@/components/ops/shipping-label-panel";
import { ProductImageZoom } from "@/components/ops/product-image-zoom";
import { apiFetch } from "@/lib/api/client";
import {
  confirmPackingItem,
  fetchPackingSession,
  type PackingOrder,
} from "@/lib/api/operations";

export default function PackingOrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;

  const [order, setOrder] = useState<PackingOrder | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const packedProgressRef = useRef(false);
  const reportedRef = useRef(false);
  const labelPanelRef = useRef<ShippingLabelPanelHandle>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/api/packing/orders/${orderId}/start`, {
        method: "POST",
        body: "{}",
      });
      const session = await fetchPackingSession(orderId);
      setOrder(session);
      packedProgressRef.current = session.items.some((i) => i.quantityPacked > 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar pedido");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (!packedProgressRef.current && !reportedRef.current) {
        void apiFetch(`/api/packing/orders/${orderId}/cancel`, {
          method: "POST",
          body: "{}",
        }).catch(() => {});
      }
    };
  }, [orderId]);

  const handleBack = async () => {
    if (!packedProgressRef.current && !reportedRef.current) {
      try {
        await apiFetch(`/api/packing/orders/${orderId}/cancel`, {
          method: "POST",
          body: "{}",
        });
      } catch {
        /* ignore */
      }
    }
    router.push("/packing");
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !scanCode.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiFetch<PackingOrder>(
        `/api/packing/orders/${order.id}/scan`,
        {
          method: "POST",
          body: JSON.stringify({
            barcode: scanCode.trim(),
            quantity: 1,
          }),
        },
      );
      setOrder(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setScanCode("");
      setMessage("Produto conferido");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Erro no bip — use o código de barras do produto",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmLine = async (itemId: string, max: number) => {
    if (!order) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await confirmPackingItem(order.id, itemId, max);
      setOrder(updated);
      packedProgressRef.current = updated.items.some((i) => i.quantityPacked > 0);
      setMessage(`${max} un. conferida(s)`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erro ao confirmar");
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!order) return;
    setSaving(true);
    setMessage(null);
    try {
      await labelPanelRef.current?.ensureAndPrint();
      await apiFetch(`/api/packing/orders/${order.id}/complete`, {
        method: "POST",
        body: "{}",
      });
      router.push("/packing");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Erro ao imprimir/finalizar — verifique QZ Tray e tente novamente",
      );
    } finally {
      setSaving(false);
    }
  };

  const pickedItems = order?.items.filter((i) => i.quantityPicked > 0) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={order?.erpOrderId ?? "Packing"}
          description="Conferência por código de barras do produto."
        />
        <div className="flex gap-2">
          {order ? (
            <button
              type="button"
              onClick={() => setIssueModalOpen(true)}
              disabled={saving}
              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Relatar problema
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleBack()}
            className="rounded-lg border px-3 py-2 text-sm font-medium"
          >
            Voltar
          </button>
        </div>
      </div>

      {order && issueModalOpen ? (
        <PackingIssueModal
          order={order}
          onClose={() => setIssueModalOpen(false)}
          onSubmitted={() => {
            reportedRef.current = true;
            setIssueModalOpen(false);
            router.push("/packing");
          }}
        />
      ) : null}

      <DataState loading={loading} error={error} empty={false}>
        {order ? (
          <>
            {message ? (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
            ) : null}

            <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
              <div className="order-2 flex min-w-0 flex-1 flex-col gap-3 xl:order-1">
                <form
                  onSubmit={handleScan}
                  className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4 shadow-sm"
                >
                  <div className="min-w-[200px] flex-1">
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Bipar produto
                    </label>
                    <input
                      autoFocus
                      className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
                      placeholder="Código de barras"
                      value={scanCode}
                      onChange={(e) => setScanCode(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving || !scanCode.trim()}
                    className="rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Bipar
                  </button>
                </form>

                <div className="grid gap-4 sm:grid-cols-2">
                  {pickedItems.map((item) => (
                    <div
                      key={item.id}
                      className={`flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row ${
                        item.remaining === 0
                          ? "border-emerald-300 bg-emerald-50"
                          : ""
                      }`}
                    >
                      <ProductImageZoom
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        placeholder={item.product.sku}
                        className="relative aspect-square w-full shrink-0 overflow-visible sm:w-64"
                        sizes="256px"
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p
                          className="truncate font-mono text-base font-bold"
                          title={item.product.sku}
                        >
                          {item.product.sku}
                        </p>
                        <p
                          className="mt-1 line-clamp-3 text-sm leading-snug"
                          title={item.product.name}
                        >
                          {item.product.name}
                        </p>
                        {item.multiGondolaHint ? (
                          <p
                            className="mt-2 truncate rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                            title={item.multiGondolaHint}
                          >
                            {item.multiGondolaHint}
                          </p>
                        ) : null}
                        <p className="mt-3 text-base font-semibold">
                          Conferido {item.quantityPacked}/{item.quantityPicked}
                        </p>
                        {item.remaining > 0 ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              handleConfirmLine(item.id, item.remaining)
                            }
                            className="mt-auto self-start rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white"
                          >
                            OK · {item.remaining} un.
                          </button>
                        ) : (
                          <p className="mt-auto text-sm font-medium text-emerald-800">
                            Item completo
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="order-1 flex w-full flex-col gap-3 xl:order-2 xl:sticky xl:top-4 xl:w-96 xl:shrink-0">
                <div className="rounded-xl border bg-white p-4 shadow-sm">
                  <p className="font-mono text-2xl font-bold">
                    {order.erpOrderId}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cesta {order.basket?.code ?? "—"}
                  </p>
                  {order.assignedPicker?.name ? (
                    <p className="text-sm text-muted-foreground">
                      Separador {order.assignedPicker.name}
                    </p>
                  ) : null}
                  {order.routeLabel ? (
                    <p className="text-sm text-muted-foreground">
                      {order.routeLabel}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {order.customerName ? (
                      <p className="text-sm">{order.customerName}</p>
                    ) : null}
                    <MarketplaceBadge value={order.marketplace} />
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {order.packingInProgress ? (
                      <span className="self-start rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-900">
                        Em conferência
                        {order.packingOperatorName
                          ? ` · ${order.packingOperatorName}`
                          : ""}
                      </span>
                    ) : null}
                    <CollectionDeadlineIndicator
                      deadline={order.collectionDeadline}
                      variant="detail"
                    />
                    {order.allPacked ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleComplete()}
                        className="mt-1 rounded-lg bg-[#0d9488] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {saving
                          ? "Imprimindo e finalizando…"
                          : "Finalizar packing"}
                      </button>
                    ) : null}
                    {order.allPacked ? (
                      <p className="text-[11px] text-muted-foreground">
                        Ao finalizar, a etiqueta é impressa automaticamente (QZ
                        Tray).
                      </p>
                    ) : null}
                  </div>
                </div>

                <ShippingLabelPanel
                  ref={labelPanelRef}
                  orderId={order.id}
                  erpOrderId={order.erpOrderId}
                  initialUrl={order.shippingLabel}
                  disabled={saving}
                  onLabelCached={(url) =>
                    setOrder((prev) =>
                      prev ? { ...prev, shippingLabel: url } : prev,
                    )
                  }
                />
              </aside>
            </div>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
