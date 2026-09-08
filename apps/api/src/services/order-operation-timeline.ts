import { OrderTimeLogEvent } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { PACKING_ISSUE_TYPE_LABEL, type PackingIssueType } from "./order-packing.js";
import { marketplaceDisplayLabel } from "./marketplace-priority.js";
import { marketplaceWhereClause } from "./marketplace-filter.js";
import {
  activePickingDurationMs,
  activePackingDurationMs,
  activeDispatchDurationMs,
  msToSeconds,
} from "./operation-duration.js";
import type { ReportColumn, ReportResult } from "./report-types.js";
import { fmtDateBr } from "./report-types.js";

type TimeLog = {
  event: OrderTimeLogEvent;
  createdAt: Date;
  reason: string | null;
  user: { name: string } | null;
};

export interface OrderTimelineMetrics {
  pickingSec: number;
  packingWrongSec: number | null;
  issueLabel: string | null;
  correctionPickingSec: number | null;
  packingFinalSec: number | null;
  dispatchSec: number | null;
  totalSec: number;
  pickerName: string | null;
}

const PICK_EVENTS = new Set<OrderTimeLogEvent>([
  OrderTimeLogEvent.START,
  OrderTimeLogEvent.PAUSE,
  OrderTimeLogEvent.RESUME,
  OrderTimeLogEvent.END,
]);

function parseIssueLabel(reason: string | null): string | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason) as { type?: PackingIssueType };
    if (parsed.type && parsed.type in PACKING_ISSUE_TYPE_LABEL) {
      return PACKING_ISSUE_TYPE_LABEL[parsed.type];
    }
  } catch {
    return reason;
  }
  return null;
}

function pickingActiveSec(logs: TimeLog[]): number {
  const pickLogs = logs.filter((l) => PICK_EVENTS.has(l.event));
  if (pickLogs.length === 0) return 0;
  return msToSeconds(activePickingDurationMs(pickLogs));
}

const PACK_EVENTS = new Set<OrderTimeLogEvent>([
  OrderTimeLogEvent.PACK_START,
  OrderTimeLogEvent.PACK_END,
  OrderTimeLogEvent.PACK_CANCEL,
]);

const DISPATCH_EVENTS = new Set<OrderTimeLogEvent>([
  OrderTimeLogEvent.DISPATCH_START,
  OrderTimeLogEvent.DISPATCH_END,
]);

function packingActiveSec(logs: TimeLog[]): number {
  const packLogs = logs.filter((l) => PACK_EVENTS.has(l.event));
  if (packLogs.length === 0) return 0;
  return msToSeconds(activePackingDurationMs(packLogs));
}

function dispatchActiveSec(logs: TimeLog[]): number {
  const dispatchLogs = logs.filter((l) => DISPATCH_EVENTS.has(l.event));
  if (dispatchLogs.length === 0) return 0;
  return msToSeconds(activeDispatchDurationMs(dispatchLogs));
}

function wallPackingUntilIssueSec(logs: TimeLog[]): number | null {
  const packStart = logs.find((l) => l.event === OrderTimeLogEvent.PACK_START);
  const issue = logs.find((l) => l.event === OrderTimeLogEvent.PACK_REPORT_ISSUE);
  if (!packStart || !issue) return null;
  return msToSeconds(issue.createdAt.getTime() - packStart.createdAt.getTime());
}

function firstPickerName(logs: TimeLog[]): string | null {
  const start = logs.find((l) => l.event === OrderTimeLogEvent.START);
  return start?.user?.name ?? null;
}

/** Extrai tempos por etapa a partir dos logs cronológicos de um pedido. */
export function buildOrderTimelineMetrics(logs: TimeLog[]): OrderTimelineMetrics {
  const sorted = [...logs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const issueIdx = sorted.findIndex(
    (l) => l.event === OrderTimeLogEvent.PACK_REPORT_ISSUE,
  );

  if (issueIdx === -1) {
    const firstPackIdx = sorted.findIndex(
      (l) => l.event === OrderTimeLogEvent.PACK_START,
    );
    const beforePack =
      firstPackIdx === -1 ? sorted : sorted.slice(0, firstPackIdx);
    const packLogs =
      firstPackIdx === -1 ? [] : sorted.slice(firstPackIdx);

    const pickingSec = pickingActiveSec(beforePack);
    const packingFinalSec = packingActiveSec(packLogs) || null;
    const dispatchSec = dispatchActiveSec(sorted) || null;
    const totalSec =
      pickingSec + (packingFinalSec ?? 0) + (dispatchSec ?? 0);

    return {
      pickingSec,
      packingWrongSec: null,
      issueLabel: null,
      correctionPickingSec: null,
      packingFinalSec,
      dispatchSec,
      totalSec,
      pickerName: firstPickerName(sorted),
    };
  }

  const beforeIssue = sorted.slice(0, issueIdx + 1);
  const afterIssue = sorted.slice(issueIdx + 1);
  const issueLog = sorted[issueIdx]!;

  const firstPackIdx = beforeIssue.findIndex(
    (l) => l.event === OrderTimeLogEvent.PACK_START,
  );
  const beforeFirstPack =
    firstPackIdx === -1 ? beforeIssue : beforeIssue.slice(0, firstPackIdx);
  const firstPackAttempt =
    firstPackIdx === -1 ? [] : beforeIssue.slice(firstPackIdx);

  const rePackStartIdx = afterIssue.findIndex(
    (l) => l.event === OrderTimeLogEvent.PACK_START,
  );
  const correctionLogs =
    rePackStartIdx === -1 ? afterIssue : afterIssue.slice(0, rePackStartIdx);
  const finalPackLogs =
    rePackStartIdx === -1 ? [] : afterIssue.slice(rePackStartIdx);

  const pickingSec = pickingActiveSec(beforeFirstPack);
  const packingWrongSec =
    wallPackingUntilIssueSec(firstPackAttempt) ??
    (packingActiveSec(firstPackAttempt) || null);
  const correctionPickingSec =
    pickingActiveSec(correctionLogs) || null;
  const packingFinalSec = packingActiveSec(finalPackLogs) || null;
  const dispatchSec = dispatchActiveSec(sorted) || null;
  const totalSec =
    pickingSec +
    (packingWrongSec ?? 0) +
    (correctionPickingSec ?? 0) +
    (packingFinalSec ?? 0) +
    (dispatchSec ?? 0);

  return {
    pickingSec,
    packingWrongSec,
    issueLabel: parseIssueLabel(issueLog.reason),
    correctionPickingSec,
    packingFinalSec,
    dispatchSec,
    totalSec,
    pickerName: firstPickerName(sorted),
  };
}

const TIMELINE_COLUMNS: ReportColumn[] = [
  { key: "pedidoErp", header: "Pedido ERP" },
  { key: "marketplace", header: "Marketplace" },
  { key: "separador", header: "Separador" },
  { key: "separacaoSeg", header: "Separação (s)" },
  { key: "embalagemErroSeg", header: "Embalagem até erro (s)" },
  { key: "motivoErro", header: "Motivo do erro" },
  { key: "correcaoSeg", header: "Correção / re-separação (s)" },
  { key: "embalagemFinalSeg", header: "Embalagem final (s)" },
  { key: "expedicaoSeg", header: "Expedição (s)" },
  { key: "totalSeg", header: "Total (s)" },
  { key: "ultimaAtividade", header: "Última atividade" },
];

export async function buildOrderOperationTimelineReport(
  tenantId: string,
  from: Date,
  to: Date,
  marketplace?: string,
): Promise<ReportResult> {
  const mp = marketplaceWhereClause(marketplace);
  const allLogs = await prisma.orderTimeLog.findMany({
    where: {
      order: { tenantId, ...(mp ?? {}) },
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { name: true } },
      order: {
        select: { id: true, erpOrderId: true, marketplace: true },
      },
    },
  });

  const byOrder = new Map<string, typeof allLogs>();
  for (const log of allLogs) {
    const list = byOrder.get(log.orderId) ?? [];
    list.push(log);
    byOrder.set(log.orderId, list);
  }

  const rows: Record<string, string | number | null>[] = [];

  for (const [, orderLogs] of byOrder) {
    const order = orderLogs[0]?.order;
    if (!order) continue;

    const hasActivityInPeriod = orderLogs.some(
      (l) => l.createdAt >= from && l.createdAt <= to,
    );
    if (!hasActivityInPeriod) continue;

    const metrics = buildOrderTimelineMetrics(orderLogs);
    const mpLabel = marketplaceDisplayLabel(order.marketplace);
    const lastLog = orderLogs[orderLogs.length - 1]!;

    rows.push({
      pedidoErp: order.erpOrderId,
      marketplace: mpLabel,
      separador: metrics.pickerName,
      separacaoSeg: metrics.pickingSec,
      embalagemErroSeg: metrics.packingWrongSec,
      motivoErro: metrics.issueLabel,
      correcaoSeg: metrics.correctionPickingSec,
      embalagemFinalSeg: metrics.packingFinalSec,
      expedicaoSeg: metrics.dispatchSec,
      totalSeg: metrics.totalSec,
      ultimaAtividade: fmtDateBr(lastLog.createdAt),
    });
  }

  rows.sort((a, b) =>
    String(a.pedidoErp ?? "").localeCompare(String(b.pedidoErp ?? "")),
  );

  return {
    report: "order_operation_timeline",
    title: "Tempos por etapa do pedido (segundos)",
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    columns: TIMELINE_COLUMNS,
    rows,
    totalRows: rows.length,
  };
}
