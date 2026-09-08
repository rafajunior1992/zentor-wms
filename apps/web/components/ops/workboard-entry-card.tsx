"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MarketplaceBadge } from "@/components/ops/marketplace-badge";
import { OrderStatusBadge } from "@/components/ops/order-status-badge";
import { ShippingLabelBadge } from "@/components/ops/shipping-label-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  fetchOrderDetail,
  type BoardIssueDetail,
  type BoardEntry,
  type BoardOrderEntry,
} from "@/lib/api/operations";
import { fetchWaveDetail } from "@/lib/api/waves";

const ACTIVE_STATUSES = new Set([
  "PENDING",
  "PICKING",
  "PAUSED_ISSUE",
  "PICKED_AWAITING_CONFERENCE",
  "PACKING_RETURNED_TO_PICKING",
]);

export function WorkboardEntryCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: BoardEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isOrder = entry.kind === "order";
  const isActive = isOrder && ACTIVE_STATUSES.has(entry.status);
  const hasIssue = isOrder && Boolean(entry.issueSummary);

  return (
    <div
      className={cn(
        "rounded-xl border bg-white shadow-sm",
        isActive && "border-teal-200 bg-teal-50/30",
        hasIssue && "border-amber-300 bg-amber-50/40",
      )}
    >
      <div className="flex items-start gap-2 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          {isOrder ? (
            <OrderCardHeader order={entry} />
          ) : (
            <WaveCardHeader wave={entry} />
          )}
        </div>
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {expanded ? (
            isOrder ? (
              <OrderCardDetail orderId={entry.id} />
            ) : (
              <WaveCardDetail waveId={entry.id} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: "order" | "wave" }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        kind === "order"
          ? "bg-slate-100 text-slate-700"
          : "bg-violet-100 text-violet-800",
      )}
    >
      {kind === "order" ? "ERP" : "Onda"}
    </span>
  );
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  if (m < 60) return r > 0 ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function DispatchElapsedBadge({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(
    0,
    Math.floor((now - new Date(since).getTime()) / 1000),
  );
  return (
    <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">
      Expedição {formatElapsed(sec)}
    </span>
  );
}

function OrderCardHeader({ order }: { order: BoardOrderEntry }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind="order" />
          <p className="font-mono text-lg font-bold">{order.erpOrderId}</p>
          <ShippingLabelBadge available={Boolean(order.hasShippingLabel)} />
        </div>
        <p className="text-sm text-muted-foreground">
          {order.customerName ?? "—"} · Cesta {order.basketCode ?? "—"} ·{" "}
          {order.pickerName ?? "Sem separador"}
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <MarketplaceBadge value={order.marketplace} />
          <span>· Prioridade {order.priority}</span>
          {order.collectionDeadline
            ? ` · Coleta ${new Date(order.collectionDeadline).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}`
            : ""}
        </p>
        {order.issueSummary ? (
          <OrderIssueBanner
            summary={order.issueSummary}
            detail={order.issueDetail}
          />
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <OrderStatusBadge status={order.status} />
        <span className="text-sm text-muted-foreground">
          {order.qtyPicked}/{order.qtyOrdered} un.
        </span>
        {order.status === "DISPATCHING" ? (
          <DispatchElapsedBadge since={order.updatedAt} />
        ) : null}
      </div>
    </div>
  );
}

function OrderIssueBanner({
  summary,
  detail,
}: {
  summary: string;
  detail?: BoardIssueDetail | null;
}) {
  const title =
    detail?.source === "PACKING"
      ? "Motivo do retorno (separação)"
      : detail?.source === "PAUSE"
        ? "Motivo do problema (separação)"
        : "Motivo reportado";

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <p className="font-semibold">{title}</p>
      {detail?.typeLabel ? (
        <p>
          <span className="font-medium">Tipo:</span> {detail.typeLabel}
        </p>
      ) : null}
      {detail?.sku ? (
        <p>
          <span className="font-medium">SKU:</span> {detail.sku}
          {detail.productName ? ` — ${detail.productName}` : ""}
        </p>
      ) : null}
      {detail && detail.quantity > 0 ? (
        <p>
          <span className="font-medium">Quantidade:</span> {detail.quantity} un.
        </p>
      ) : null}
      <p className="font-medium">{summary}</p>
      {detail?.description &&
      detail.description !== summary &&
      !summary.includes(detail.description) ? (
        <p className="text-amber-900">{detail.description}</p>
      ) : null}
    </div>
  );
}

function WaveCardHeader({
  wave,
}: {
  wave: Extract<BoardEntry, { kind: "wave" }>;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind="wave" />
          <p className="text-lg font-bold">{wave.name}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {wave.orderCount} pedido(s) · {wave.lineCount} linha(s) na gôndola
        </p>
        {wave.releasedAt ? (
          <p className="text-xs text-muted-foreground">
            Liberada{" "}
            {new Date(wave.releasedAt).toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-800">
          {wave.status}
        </span>
        <span className="text-sm text-muted-foreground">
          {wave.qtyPicked}/{wave.qtyTotal} un.
        </span>
      </div>
    </div>
  );
}

function OrderCardDetail({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<
    Array<{
      lineNumber: number;
      quantityOrdered: number;
      quantityPicked: number;
      product: { sku: string; name: string };
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOrderDetail(orderId)
      .then((d) => {
        if (!cancelled) setItems(d.items);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar itens");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading) {
    return (
      <p className="border-t px-4 py-3 text-sm text-muted-foreground">
        Carregando itens…
      </p>
    );
  }
  if (error) {
    return <p className="border-t px-4 py-3 text-sm text-red-600">{error}</p>;
  }

  return (
    <Table className="border-t">
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Produto</TableHead>
          <TableHead>Separado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.lineNumber}>
            <TableCell>{item.lineNumber}</TableCell>
            <TableCell className="font-mono">{item.product.sku}</TableCell>
            <TableCell>{item.product.name}</TableCell>
            <TableCell>
              {item.quantityPicked}/{item.quantityOrdered}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WaveCardDetail({ waveId }: { waveId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<
    Array<{
      id: string;
      sku: string;
      productName: string;
      locationBarcode: string;
      quantityPicked: number;
      quantityTotal: number;
      sortStatus: string;
    }>
  >([]);
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      erpOrderId: string;
      customerName: string | null;
      status: string;
      hasShippingLabel?: boolean;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWaveDetail(waveId)
      .then((d) => {
        if (!cancelled) {
          setLines(d.lines);
          setOrders(d.orders);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar onda");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [waveId]);

  if (loading) {
    return (
      <p className="border-t px-4 py-3 text-sm text-muted-foreground">
        Carregando onda…
      </p>
    );
  }
  if (error) {
    return <p className="border-t px-4 py-3 text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-4 border-t p-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Linhas na gôndola</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>Separado</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-mono">{line.sku}</TableCell>
                <TableCell>{line.productName}</TableCell>
                <TableCell className="font-mono">{line.locationBarcode}</TableCell>
                <TableCell>
                  {line.quantityPicked}/{line.quantityTotal}
                </TableCell>
                <TableCell>{line.sortStatus}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {orders.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Pedidos na onda</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido ERP</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Etiqueta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono">{o.erpOrderId}</TableCell>
                  <TableCell>{o.customerName ?? "—"}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={o.status} />
                  </TableCell>
                  <TableCell>
                    {o.hasShippingLabel ? (
                      <ShippingLabelBadge available />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
