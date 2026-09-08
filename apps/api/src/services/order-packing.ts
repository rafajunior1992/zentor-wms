import {
  OrderStatus,
  OrderTimeLogEvent,
  PickWaveLineSortStatus,
  PickWaveStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { notifyUsersWithPermission } from "./notifications.js";
import { Permission } from "@wms/shared";
import { getWaveLineDetail } from "./pick-wave.js";
import { confirmSortAllocation } from "./pick-wave-sort.js";
import {
  allocateQuantityAcrossPickFaces,
  buildMultiGondolaHint,
  type PickSegment,
} from "./pick-allocation.js";
import {
  aggregateWaveUrgency,
  formatRouteLabel,
  orderRouteAnchor,
  scorePackingUrgency,
  sortPackingOrders,
  sortWavePackingLines,
} from "./packing-queue-sort.js";
import { listReplenishmentNeeds } from "./replenishment-queue.js";
import { recordOrderStageChange } from "./order-stage-log.js";

export class PackingSessionError extends Error {
  constructor(
    message: string,
    public statusCode = 422,
  ) {
    super(message);
    this.name = "PackingSessionError";
  }
}

async function orderHasPackedProgress(orderId: string): Promise<boolean> {
  const agg = await prisma.orderItem.aggregate({
    where: { orderId },
    _sum: { quantityPacked: true },
  });
  return (agg._sum.quantityPacked ?? 0) > 0;
}

async function getPackingOperationalState(orderId: string) {
  const logs = await prisma.orderTimeLog.findMany({
    where: {
      orderId,
      event: {
        in: [
          OrderTimeLogEvent.PACK_START,
          OrderTimeLogEvent.PACK_END,
          OrderTimeLogEvent.PACK_CANCEL,
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });

  let activeStart: (typeof logs)[0] | null = null;
  for (const log of logs) {
    if (log.event === OrderTimeLogEvent.PACK_START) {
      activeStart = log;
    } else if (
      log.event === OrderTimeLogEvent.PACK_END ||
      log.event === OrderTimeLogEvent.PACK_CANCEL
    ) {
      activeStart = null;
    }
  }

  const hasPackedProgress = await orderHasPackedProgress(orderId);

  return {
    packingInProgress: activeStart != null,
    packingOperatorId: activeStart?.userId ?? null,
    packingOperatorName: activeStart?.user.name ?? null,
    hasPackedProgress,
  };
}

const orderInclude = {
  basket: { select: { id: true, code: true, barcode: true } },
  assignedPicker: { select: { name: true } },
  items: {
    orderBy: { lineNumber: "asc" as const },
    include: {
      pickLocation: {
        select: { id: true, corridor: true, row: true, barcode: true },
      },
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          barcode: true,
          imageUrl: true,
          unit: true,
          weight: true,
        },
      },
    },
  },
} as const;

type OrderRow = {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  shippingLabel: string | null;
  status: OrderStatus;
  priority: number;
  collectionDeadline: Date | null;
  marketplace: string | null;
  tenantId: string;
  basket: { id: string; code: string; barcode: string } | null;
  assignedPicker: { name: string } | null;
  items: Array<{
    id: string;
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    quantityPacked: number;
    productId: string | null;
    pickLocation: {
      id: string;
      corridor: string;
      row: string;
      barcode: string;
    } | null;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
      imageUrl: string | null;
      unit: string | null;
      weight: unknown;
    } | null;
  }>;
};

async function resolvePickSegmentsForItem(
  item: OrderRow["items"][number],
  tenantId: string,
): Promise<PickSegment[]> {
  const qty = item.quantityPicked > 0 ? item.quantityPicked : item.quantityOrdered;
  if (qty <= 0) return [];

  if (item.pickLocation) {
    return [
      {
        locationId: item.pickLocation.id,
        barcode: item.pickLocation.barcode,
        corridor: item.pickLocation.corridor,
        row: item.pickLocation.row,
        quantity: qty,
        label: formatRouteLabel(item.pickLocation),
      },
    ];
  }

  if (!item.productId) return [];

  try {
    const { segments } = await allocateQuantityAcrossPickFaces(
      item.productId,
      tenantId,
      qty,
    );
    return segments;
  } catch {
    return [];
  }
}

async function mapPackingOrder(
  order: OrderRow,
  packingState?: Awaited<ReturnType<typeof getPackingOperationalState>>,
) {
  const state = packingState ?? (await getPackingOperationalState(order.id));
  const allPacked = order.items.every(
    (i) => i.quantityPacked >= i.quantityPicked && i.quantityPicked > 0,
  );
  const anchor = orderRouteAnchor(
    order.items.map((i) => ({
      quantityPicked: i.quantityPicked,
      pickLocation: i.pickLocation,
    })),
  );

  const items = await Promise.all(
    order.items.map(async (i) => {
      const pickSegments = await resolvePickSegmentsForItem(i, order.tenantId);
      return {
        id: i.id,
        lineNumber: i.lineNumber,
        quantityOrdered: i.quantityOrdered,
        quantityPicked: i.quantityPicked,
        quantityPacked: i.quantityPacked,
        remaining: Math.max(0, i.quantityPicked - i.quantityPacked),
        product: i.product,
        pickLocation: i.pickLocation,
        pickSegments,
        multiGondolaHint: buildMultiGondolaHint(pickSegments),
      };
    }),
  );

  return {
    id: order.id,
    erpOrderId: order.erpOrderId,
    customerName: order.customerName,
    shippingLabel: order.shippingLabel,
    status: order.status,
    priority: order.priority,
    collectionDeadline: order.collectionDeadline?.toISOString() ?? null,
    packingUrgency: scorePackingUrgency(order),
    routeLabel: anchor?.label ?? null,
    basket: order.basket,
    assignedPicker: order.assignedPicker,
    allPacked,
    packingInProgress: state.packingInProgress,
    packingOperatorName: state.packingOperatorName,
    items,
  };
}

export async function listPackingQueue(tenantId: string) {
  const orders = await prisma.order.findMany({
    where: { tenantId, status: OrderStatus.PICKED_AWAITING_CONFERENCE },
    take: 100,
    include: orderInclude,
  });

  const sorted = sortPackingOrders(
    orders.map((o) => ({
      id: o.id,
      erpOrderId: o.erpOrderId,
      priority: o.priority,
      collectionDeadline: o.collectionDeadline,
      marketplace: o.marketplace,
      items: o.items.map((i) => ({
        quantityPicked: i.quantityPicked,
        pickLocation: i.pickLocation,
      })),
    })),
  );

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const result = [];
  for (const s of sorted) {
    const o = orderMap.get(s.id);
    if (o) result.push(await mapPackingOrder(o));
  }
  return { orders: result };
}

export async function listUnifiedPackingQueue(tenantId: string) {
  const [waveRaw, ordersResult, replenishmentNeeds] = await Promise.all([
    listWavePackingLinesInternal(tenantId),
    listPackingQueue(tenantId),
    listReplenishmentNeeds(tenantId),
  ]);

  type WaveLineQueue = Omit<(typeof waveRaw.lines)[0], "collectionDeadline" | "pickLocation"> & {
    collectionDeadline: string | null;
  };

  const items: Array<
    | { kind: "wave_line"; sortKey: number; line: WaveLineQueue }
    | { kind: "order"; sortKey: number; order: (typeof ordersResult.orders)[0] }
    | { kind: "replenishment"; sortKey: number; need: (typeof replenishmentNeeds)[0] }
  > = [];

  for (const line of waveRaw.lines) {
    const { collectionDeadline, pickLocation: _pick, ...lineRest } = line;
    items.push({
      kind: "wave_line",
      sortKey: line.waveUrgency,
      line: {
        ...lineRest,
        collectionDeadline: collectionDeadline?.toISOString() ?? null,
      },
    });
  }
  for (const order of ordersResult.orders) {
    items.push({ kind: "order", sortKey: order.packingUrgency ?? 0, order });
  }
  for (const need of replenishmentNeeds) {
    items.push({ kind: "replenishment", sortKey: need.deficit, need });
  }

  return { items };
}

export async function findPackingOrderByQuery(tenantId: string, q: string) {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const order = await prisma.order.findFirst({
    where: {
      tenantId,
      status: OrderStatus.PICKED_AWAITING_CONFERENCE,
      OR: [
        { erpOrderId: { equals: trimmed, mode: "insensitive" } },
        { basket: { code: { equals: trimmed, mode: "insensitive" } } },
        { basket: { barcode: { equals: trimmed, mode: "insensitive" } } },
      ],
    },
    include: orderInclude,
  });
  if (!order) return null;
  return mapPackingOrder(order);
}

export async function getPackingSession(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: orderInclude,
  });
  if (!order) throw new Error("Pedido não encontrado");
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new Error("Pedido não está aguardando packing");
  }
  return mapPackingOrder(order);
}

export async function startPacking(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new PackingSessionError("Pedido não encontrado", 404);
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new PackingSessionError("Pedido não está aguardando packing");
  }

  const state = await getPackingOperationalState(orderId);
  if (state.packingInProgress) {
    if (
      state.packingOperatorId !== userId &&
      !state.hasPackedProgress
    ) {
      throw new PackingSessionError(
        `Pedido em conferência por ${state.packingOperatorName ?? "outro operador"}`,
        409,
      );
    }
  } else {
    await prisma.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_START },
    });
  }

  return getPackingSession(orderId);
}

export async function cancelPacking(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new PackingSessionError("Pedido não encontrado", 404);
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new PackingSessionError("Pedido não está aguardando packing");
  }

  const state = await getPackingOperationalState(orderId);
  if (!state.packingInProgress) {
    return { cancelled: false, reason: "no_active_session" };
  }

  if (state.hasPackedProgress) {
    throw new PackingSessionError(
      "Não é possível cancelar: já há itens conferidos",
      409,
    );
  }

  if (state.packingOperatorId && state.packingOperatorId !== userId) {
    throw new PackingSessionError(
      "Apenas quem iniciou a conferência pode cancelar",
      403,
    );
  }

  await prisma.orderTimeLog.create({
    data: { orderId, userId, event: OrderTimeLogEvent.PACK_CANCEL },
  });

  return { cancelled: true };
}

async function applyPackingQuantity(
  orderId: string,
  itemId: string,
  quantity: number,
) {
  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, orderId },
  });
  if (!item) throw new Error("Item não pertence ao pedido");

  const qty = Math.max(1, Math.floor(quantity));
  const remaining = item.quantityPicked - item.quantityPacked;
  if (remaining <= 0) throw new Error("Item já conferido no packing");

  const increment = Math.min(qty, remaining);
  await prisma.orderItem.update({
    where: { id: item.id },
    data: { quantityPacked: { increment } },
  });
}

export async function confirmPackingItem(
  orderId: string,
  userId: string,
  itemId: string,
  quantity: number,
) {
  await startPacking(orderId, userId);
  await applyPackingQuantity(orderId, itemId, quantity);
  return getPackingSession(orderId);
}

export async function scanPackingItem(
  orderId: string,
  userId: string,
  barcode: string,
  quantity = 1,
) {
  await startPacking(orderId, userId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) throw new Error("Pedido não encontrado");

  const code = barcode.trim();
  const item = order.items.find((i) => {
    const product = i.product;
    if (!product) return false;
    return (
      product.sku === code ||
      product.barcode === code ||
      product.barcode?.toUpperCase() === code.toUpperCase()
    );
  });
  if (!item) throw new Error("Produto não pertence ao pedido");

  await applyPackingQuantity(orderId, item.id, quantity);
  return getPackingSession(orderId);
}

export async function completePacking(orderId: string, userId: string) {
  const session = await getPackingSession(orderId);
  if (!session.allPacked) {
    throw new Error("Ainda há itens pendentes de conferência no packing");
  }

  const orderBefore = await prisma.order.findUnique({ where: { id: orderId } });
  if (!orderBefore) throw new Error("Pedido não encontrado");

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.DISPATCHING },
    });
    await recordOrderStageChange(tx, {
      tenantId: orderBefore.tenantId,
      orderId,
      fromStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
      toStatus: OrderStatus.DISPATCHING,
      userId,
    });
    await tx.orderTimeLog.create({
      data: { orderId, userId, event: OrderTimeLogEvent.PACK_END },
    });
    const { ensureDispatchStartLog } = await import(
      "./order-time-log-helpers.js"
    );
    await ensureDispatchStartLog(tx, orderId, userId);
  });

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order) {
    await notifyUsersWithPermission(Permission.SHIPPING_VIEW, {
      title: "Pedido pronto para expedir",
      body: `${order.erpOrderId} aguarda despacho.`,
      category: "SHIPPING",
      data: { orderId: order.id, erpOrderId: order.erpOrderId },
    });
  }

  return { orderId, status: OrderStatus.DISPATCHING, completed: true };
}

export type PackingIssueType =
  | "MISSING"
  | "DAMAGED"
  | "WRONG_ITEM"
  | "WRONG_QUANTITY";

export const PACKING_ISSUE_TYPE_LABEL: Record<PackingIssueType, string> = {
  MISSING: "Item faltando",
  DAMAGED: "Avaria no produto",
  WRONG_ITEM: "Item separado errado",
  WRONG_QUANTITY: "Quantidade divergente",
};

export interface PackingIssuePayload {
  itemId: string;
  quantity: number;
  type: PackingIssueType;
  description?: string;
}

export async function reportPackingIssue(
  orderId: string,
  userId: string,
  input: PackingIssuePayload,
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { sku: true, name: true } } } },
    },
  });
  if (!order) throw new PackingSessionError("Pedido não encontrado", 404);
  if (order.status !== OrderStatus.PICKED_AWAITING_CONFERENCE) {
    throw new PackingSessionError("Pedido não está em conferência de packing");
  }

  const item = order.items.find((i) => i.id === input.itemId);
  if (!item) {
    throw new PackingSessionError("Item não pertence ao pedido", 404);
  }

  if (!PACKING_ISSUE_TYPE_LABEL[input.type]) {
    throw new PackingSessionError("Tipo de problema inválido");
  }

  const qty = Math.floor(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new PackingSessionError("Quantidade inválida");
  }
  if (qty > item.quantityPicked) {
    throw new PackingSessionError(
      "Quantidade reportada maior que a quantidade separada",
    );
  }

  const description = input.description?.trim().slice(0, 280) ?? "";

  if (!item.product) {
    throw new PackingSessionError("Produto do item não encontrado");
  }
  const product = item.product;

  const reasonPayload = {
    itemId: item.id,
    productId: item.productId,
    sku: product.sku,
    productName: product.name,
    type: input.type,
    quantity: qty,
    description,
  };

  const newPicked = Math.max(0, item.quantityPicked - qty);
  const newPacked = Math.min(item.quantityPacked, newPicked);

  const packingState = await getPackingOperationalState(orderId);

  await prisma.$transaction(async (tx) => {
    const { detachOrderFromWaveForPackingReturn } = await import(
      "./pick-wave.js"
    );
    await detachOrderFromWaveForPackingReturn(
      tx,
      order.tenantId,
      orderId,
      item.id,
      qty,
    );

    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        quantityPicked: newPicked,
        quantityPacked: newPacked,
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.PACKING_RETURNED_TO_PICKING,
        assignedPickerId: null,
      },
    });
    await recordOrderStageChange(tx, {
      tenantId: order.tenantId,
      orderId,
      fromStatus: order.status,
      toStatus: OrderStatus.PACKING_RETURNED_TO_PICKING,
      userId,
      reason: JSON.stringify(reasonPayload),
    });
    await tx.orderTimeLog.create({
      data: {
        orderId,
        userId,
        event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
        reason: JSON.stringify(reasonPayload),
      },
    });
    if (packingState.packingInProgress) {
      await tx.orderTimeLog.create({
        data: { orderId, userId, event: OrderTimeLogEvent.PACK_CANCEL },
      });
    }
  });

  const summary = `${product.sku} · ${PACKING_ISSUE_TYPE_LABEL[input.type]} · ${qty} un.`;
  await notifyUsersWithPermission(Permission.MOBILE_ACCESS, {
    title: "Pedido retornou do packing",
    body: `${order.erpOrderId} — ${summary}`,
    category: "PICKING",
    data: {
      orderId: order.id,
      erpOrderId: order.erpOrderId,
      issueType: input.type,
      sku: product.sku,
    },
  });

  return {
    orderId,
    status: OrderStatus.PACKING_RETURNED_TO_PICKING,
    reported: true,
    summary,
  };
}

async function listWavePackingLinesInternal(tenantId: string) {
  const lines = await prisma.pickWaveLine.findMany({
    where: {
      wave: { tenantId, status: PickWaveStatus.RELEASED },
      quantityPicked: { gt: 0 },
      sortStatus: { not: PickWaveLineSortStatus.SORTED },
    },
    take: 100,
    include: {
      product: { select: { sku: true, name: true } },
      wave: {
        select: {
          id: true,
          name: true,
          releasedAt: true,
          orders: {
            include: {
              order: {
                select: {
                  priority: true,
                  collectionDeadline: true,
                  marketplace: true,
                },
              },
            },
          },
        },
      },
      pickLocation: { select: { corridor: true, row: true, barcode: true } },
    },
  });

  const mapped = lines.map((l) => {
    const waveOrders = l.wave.orders.map((wo) => wo.order);
    const { waveUrgency, collectionDeadline } = aggregateWaveUrgency(waveOrders);
    return {
      id: l.id,
      waveId: l.waveId,
      waveName: l.wave.name,
      waveReleasedAt: l.wave.releasedAt?.toISOString() ?? null,
      waveUrgency,
      collectionDeadline,
      sku: l.product.sku,
      productName: l.product.name,
      locationBarcode: l.pickLocation.barcode,
      routeLabel: formatRouteLabel(l.pickLocation),
      quantityPicked: l.quantityPicked,
      quantityTotal: l.quantityTotal,
      sortStatus: l.sortStatus,
      pickLocation: l.pickLocation,
    };
  });

  const sorted = sortWavePackingLines(
    mapped.map((l) => ({
      ...l,
      waveUrgency: l.waveUrgency,
      collectionDeadline: l.collectionDeadline,
      pickLocation: l.pickLocation,
    })),
  );

  return { lines: sorted };
}

export async function listWavePackingLines(tenantId: string) {
  const { lines } = await listWavePackingLinesInternal(tenantId);
  return {
    lines: lines.map(
      ({ pickLocation: _p, collectionDeadline: _c, ...rest }) => rest,
    ),
  };
}

export async function getWavePackingLine(lineId: string) {
  const line = await getWaveLineDetail(lineId);
  if (!line) throw new Error("Linha não encontrada");
  if (line.sortStatus === PickWaveLineSortStatus.SORTED) {
    throw new Error("Linha já finalizada no packing");
  }
  const meta = await prisma.pickWaveLine.findUnique({
    where: { id: lineId },
    select: {
      waveId: true,
      wave: {
        select: {
          name: true,
          orders: {
            include: {
              order: {
                select: {
                  priority: true,
                  collectionDeadline: true,
                  marketplace: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const waveOrders =
    meta?.wave.orders.map((wo) => wo.order) ?? [];
  const { collectionDeadline } = aggregateWaveUrgency(waveOrders);
  return {
    collectionDeadline: collectionDeadline?.toISOString() ?? null,
    line: {
      ...line,
      waveId: meta?.waveId ?? "",
      waveName: meta?.wave.name ?? "",
    },
  };
}

export async function sortWaveAllocationWeb(
  lineId: string,
  userId: string,
  input: {
    allocationId: string;
    quantity: number;
    basketBarcode?: string;
  },
) {
  return confirmSortAllocation({
    lineId,
    allocationId: input.allocationId,
    quantity: input.quantity,
    basketBarcode: input.basketBarcode,
    userId,
    webPacking: true,
  });
}

export {
  fetchShippingLabelsForOrder,
  fetchShippingLabelFile,
  fetchShippingLabelPreview,
} from "./tiny-shipping-labels.js";
