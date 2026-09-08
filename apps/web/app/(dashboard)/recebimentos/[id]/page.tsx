"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ProductImageZoom } from "@/components/ops/product-image-zoom";
import { PageHeader } from "@/components/ops/page-header";
import { PurchaseReceiptStatusBadge } from "@/components/ops/purchase-receipt-status-badge";
import { DataState } from "@/components/ops/data-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  completePurchaseReceipt,
  completeReturnReceipt,
  confirmPurchaseReceiptItem,
  fetchPurchaseReceiptDetail,
  markPurchaseReceiptConferenceStart,
  scanPurchaseReceiptItem,
  scanReturnReceiptItem,
  type PurchaseReceiptDetail,
} from "@/lib/api/operations";
import { RECEIPT_KIND_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

export default function PurchaseReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params.id;

  const [detail, setDetail] = useState<PurchaseReceiptDetail | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanQty, setScanQty] = useState("1");
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [pulmaoBarcode, setPulmaoBarcode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const isReturn = detail?.kind === "RETURN";
  const isCompleted = detail?.status === "COMPLETED";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPurchaseReceiptDetail(sessionId);
      setDetail(data);
    } catch (e) {
      setDetail(null);
      const msg = e instanceof Error ? e.message : "Erro ao carregar";
      if (msg.includes("404") || /não encontrad/i.test(msg)) {
        router.replace("/recebimentos");
        return;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [sessionId, router]);

  useEffect(() => {
    void markPurchaseReceiptConferenceStart(sessionId).catch(() => {});
    load();
  }, [load, sessionId]);

  const backHref = () => {
    const tab = searchParams.get("tab");
    return tab ? `/recebimentos?tab=${tab}` : "/recebimentos";
  };

  const applyDetail = (d: PurchaseReceiptDetail) => {
    setDetail(d);
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !scanCode.trim() || isCompleted) return;
    setSaving(true);
    setMessage(null);
    try {
      const qty = Number(scanQty) || 1;
      const res = isReturn
        ? await scanReturnReceiptItem(sessionId, scanCode.trim(), qty)
        : await scanPurchaseReceiptItem(sessionId, scanCode.trim(), qty);
      applyDetail(res.detail);
      setScanCode("");
      setScanQty("1");
      setMessage("Produto registrado");
      scanInputRef.current?.focus();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro no bip");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmLine = async (itemId: string, max: number) => {
    if (!detail || isReturn || isCompleted) return;
    const qty = Math.min(
      max,
      Math.max(1, Math.floor(Number(lineQty[itemId] ?? max))),
    );
    setSaving(true);
    setMessage(null);
    try {
      const res = await confirmPurchaseReceiptItem(sessionId, itemId, qty);
      applyDetail(res.detail);
      setLineQty((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setMessage(`${qty} un. conferida(s)`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao confirmar");
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!detail) return;
    setSaving(true);
    setMessage(null);
    try {
      if (isReturn) {
        if (!pulmaoBarcode.trim()) {
          setMessage("Informe o código do local de pulmão");
          setSaving(false);
          return;
        }
        const res = await completeReturnReceipt(
          sessionId,
          pulmaoBarcode.trim(),
        );
        applyDetail(res.detail);
      } else {
        const res = await completePurchaseReceipt(sessionId);
        applyDetail(res.detail);
      }
      setMessage("Conferência finalizada");
      setTimeout(() => router.push(backHref()), 800);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro ao finalizar");
    } finally {
      setSaving(false);
    }
  };

  const title =
    detail?.invoiceNumber ??
    detail?.reference ??
    (detail?.tinyNotaId ? `NF ${detail.tinyNotaId}` : "Recebimento");

  const itemsChecked = detail?.items.filter((i) => i.completed).length ?? 0;
  const itemTotal = detail?.items.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={title}
          description={
            detail
              ? `${RECEIPT_KIND_LABEL[detail.kind] ?? detail.kind} · ${detail.supplierName ?? "—"}`
              : "Conferência de compra"
          }
        />
        <button
          type="button"
          onClick={() => router.push(backHref())}
          className="rounded-lg border px-3 py-2 text-sm font-medium"
        >
          Voltar
        </button>
      </div>

      <DataState loading={loading} error={error} empty={false}>
        {detail ? (
          <>
            {message ? (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">{message}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
              <PurchaseReceiptStatusBadge status={detail.status} />
              <span className="text-sm text-muted-foreground">
                Operador: {detail.operatorName}
              </span>
              <span className="text-sm font-medium">
                Itens {itemsChecked}/{itemTotal}
              </span>
              {detail.accessKey ? (
                <span className="font-mono text-xs text-muted-foreground">
                  Chave: {detail.accessKey.slice(0, 8)}…
                </span>
              ) : null}
            </div>

            {!isCompleted ? (
              <form
                onSubmit={handleScan}
                className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4 shadow-sm"
              >
                <div className="min-w-[200px] flex-1">
                  <label className="text-xs font-medium" htmlFor="scan">
                    {isReturn ? "Bip produto" : "Bip produto / código"}
                  </label>
                  <input
                    id="scan"
                    ref={scanInputRef}
                    className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    placeholder="Código de barras ou SKU"
                    autoFocus
                    disabled={saving}
                  />
                </div>
                <div className="w-24">
                  <label className="text-xs font-medium" htmlFor="qty">
                    Qtd
                  </label>
                  <input
                    id="qty"
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={scanQty}
                    onChange={(e) => setScanQty(e.target.value)}
                    disabled={saving}
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
            ) : null}

            {isReturn && !isCompleted && detail.items.length > 0 ? (
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <label className="text-sm font-medium" htmlFor="pulmao">
                  Local de pulmão (código)
                </label>
                <input
                  id="pulmao"
                  className="mt-1 w-full max-w-xs rounded-lg border px-3 py-2 font-mono text-sm"
                  value={pulmaoBarcode}
                  onChange={(e) => setPulmaoBarcode(e.target.value)}
                  placeholder="Ex: PUL-01-A"
                />
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Foto</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>SKU interno</TableHead>
                    <TableHead>SKU fornecedor</TableHead>
                    <TableHead>EAN</TableHead>
                    <TableHead>Local</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Conferido</TableHead>
                    {!isReturn && !isCompleted ? (
                      <TableHead className="w-28">Ação</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item) => {
                    const isNext = detail.nextItem?.id === item.id;
                    const remaining =
                      item.quantityExpected - item.quantityChecked;
                    const location =
                      item.putawayLocation ??
                      item.suggestedLocation ??
                      "—";
                    return (
                      <TableRow
                        key={item.id}
                        className={cn(
                          item.completed && "bg-emerald-50/50",
                          isNext && !item.completed && "bg-cyan-50/50",
                        )}
                      >
                        <TableCell>
                          <ProductImageZoom
                            src={item.imageUrl}
                            alt={item.description ?? item.sku ?? ""}
                            className="relative h-24 w-24 shrink-0 overflow-visible sm:h-32 sm:w-32"
                            sizes="128px"
                          />
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="line-clamp-2 text-sm">
                            {item.description ?? "—"}
                          </p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.sku ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.supplierSku ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.barcode ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {location}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.quantityExpected}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {item.quantityChecked}
                        </TableCell>
                        {!isReturn && !isCompleted ? (
                          <TableCell>
                            {remaining > 0 ? (
                              <div className="flex gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  max={remaining}
                                  className="w-14 rounded border px-1 py-0.5 text-xs"
                                  value={lineQty[item.id] ?? String(remaining)}
                                  onChange={(e) =>
                                    setLineQty((prev) => ({
                                      ...prev,
                                      [item.id]: e.target.value,
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() =>
                                    handleConfirmLine(item.id, remaining)
                                  }
                                  className="rounded bg-[#0d9488] px-2 py-0.5 text-xs font-medium text-white"
                                >
                                  OK
                                </button>
                              </div>
                            ) : (
                              <span className="text-emerald-600">✓</span>
                            )}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {detail.putaway ? (
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <h3 className="font-semibold">Armazenagem</h3>
                <p className="text-sm text-muted-foreground">
                  Status: {detail.putaway.status}
                  {detail.putaway.operatorName
                    ? ` · ${detail.putaway.operatorName}`
                    : ""}
                </p>
              </div>
            ) : isCompleted && !isReturn ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
                Armazenagem no pulmão: conclua no app mobile (Putaway ou
                Armazenagem pulmão).
              </div>
            ) : null}

            {!isCompleted ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={
                    saving ||
                    (isReturn
                      ? detail.items.length === 0
                      : !detail.allChecked)
                  }
                  onClick={() => void handleComplete()}
                  className="rounded-lg bg-[#0d9488] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {isReturn ? "Finalizar devolução" : "Finalizar conferência"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </DataState>
    </div>
  );
}
