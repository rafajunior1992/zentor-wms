import type { FastifyInstance } from "fastify";
import { formatMarketplace } from "@wms/shared";
import { OrderStatus, OrderTimeLogEvent, InventoryMovementType } from "@prisma/client";
import { requireMobileAccess } from "../lib/auth-guard.js";
import { prisma } from "../lib/prisma.js";
import { resolveUserId } from "../lib/user-context.js";
import {
  LocationStockError,
  stockLocation,
} from "../services/location-stock.js";
import {
  LocationAdjustError,
  adjustLocationQuantity,
} from "../services/location-adjust.js";
import { requestReplenishmentFromPickFace } from "../services/replenishment-request.js";
import {
  CargoTransferError,
  cancelCargoTransfer,
  depositCargoTransfer,
  getCargoTransfer,
  listPendingCargoTransfers,
  withdrawCargoTransfer,
} from "../services/cargo-transfer.js";
import {
  PickWaveError,
  acceptPickWave,
  releasePickWave,
  releasePickWaveAccept,
  getCurrentReleasedWave,
  getOpenWave,
  getReleasedWaveById,
  listReleasedWaves,
  getOrderIdsInActiveWave,
  getWaveLineDetail,
  mapWaveLineSummary,
} from "../services/pick-wave.js";
import { acceptOrdersBatch } from "../services/order-picking-batch.js";
import { isWaveEnabled } from "../services/wave-settings.js";
import { confirmConsolidatedPick } from "../services/pick-wave-pick.js";
import { confirmSortAllocation } from "../services/pick-wave-sort.js";
import {
  completePurchaseReceipt,
  confirmReceiptItem,
  getPurchaseReceiptSession,
  isTinyConnectedError,
  listPurchaseReceiptQueue,
  markConferenceStarted,
  scanPurchaseReceiptItem,
  startPurchaseReceiptByBarcode,
} from "../services/tiny-purchase-receipt.js";
import {
  completePutaway,
  getPutawaySession,
  listPutawayQueue,
  startPutaway,
  storePutawayItem,
} from "../services/putaway.js";

function formatLocation(loc: { corridor: string; row: string; barcode: string }) {
  return `${loc.corridor}-${loc.row} · ${loc.barcode}`;
}

export async function mobileRoutes(app: FastifyInstance) {
  app.addHook("onRequest", requireMobileAccess);

  // ---------------------------------------------------------------------------
  // Picking — fila e aceite
  // ---------------------------------------------------------------------------

  app.get("/mobile/orders/queue", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    const waveOrderIds = await getOrderIdsInActiveWave(tenantId);
    const waveExclusion =
      waveOrderIds.length > 0 ? { id: { notIn: waveOrderIds } } : {};
    const [pendingOrders, inProgressOrders] = await Promise.all([
      prisma.order.findMany({
        where: {
          tenantId,
          status: {
            in: [
              OrderStatus.PENDING,
              OrderStatus.PACKING_RETURNED_TO_PICKING,
            ],
          },
          ...waveExclusion,
        },
        orderBy: [
          { priority: "desc" },
          { collectionDeadline: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
        ],
        include: {
          items: true,
        },
      }),
      prisma.order.findMany({
        where: {
          tenantId,
          status: OrderStatus.PICKING,
          assignedPickerId: userId,
          basketId: null,
          ...waveExclusion,
        },
        orderBy: [{ updatedAt: "desc" }],
        include: {
          items: true,
        },
      }),
    ]);

    const rawOrders = [
      ...inProgressOrders,
      ...pendingOrders.filter(
        (o) => !inProgressOrders.some((active) => active.id === o.id),
      ),
    ];
    const inProgressIds = new Set(inProgressOrders.map((o) => o.id));

    const { buildOrderPickProfiles } = await import(
      "../services/pick-wave-order-profile.js"
    );
    const {
      buildPickProximityGroups,
      orderProximityNeighborCount,
      sortOrdersByPickProximity,
    } = await import("../services/order-proximity.js");
    const { getWaveSettings } = await import("../services/wave-settings.js");
    const settings = await getWaveSettings(tenantId);
    const profiles = await buildOrderPickProfiles(tenantId, rawOrders);
    const orders = sortOrdersByPickProximity(rawOrders, profiles);
    const clusters = await buildPickProximityGroups(tenantId, orders, {
      maxDistance: settings.proximityMaxDistance,
      maxGroups: 8,
      maxOrdersPerGroup: 8,
    });

    const returnedIds = orders
      .filter((o) => o.status === OrderStatus.PACKING_RETURNED_TO_PICKING)
      .map((o) => o.id);

    const lastIssueByOrder = new Map<string, string | null>();
    if (returnedIds.length > 0) {
      const logs = await prisma.orderTimeLog.findMany({
        where: {
          orderId: { in: returnedIds },
          event: OrderTimeLogEvent.PACK_REPORT_ISSUE,
        },
        orderBy: { createdAt: "desc" },
      });
      for (const log of logs) {
        if (lastIssueByOrder.has(log.orderId)) continue;
        let summary: string | null = null;
        if (log.reason) {
          try {
            const parsed = JSON.parse(log.reason) as {
              sku?: string;
              type?: string;
              quantity?: number;
            };
            const typeLabel =
              parsed.type === "MISSING"
                ? "Item faltando"
                : parsed.type === "DAMAGED"
                  ? "Avaria"
                  : parsed.type === "WRONG_ITEM"
                    ? "Item errado"
                    : parsed.type === "WRONG_QUANTITY"
                      ? "Qtd divergente"
                      : "Problema";
            summary = `${parsed.sku ?? ""} · ${typeLabel} · ${parsed.quantity ?? 0} un.`;
          } catch {
            summary = "Retorno para separação";
          }
        }
        lastIssueByOrder.set(log.orderId, summary);
      }
    }

    const queueOrders = orders.map((o) => {
      const returned = o.status === OrderStatus.PACKING_RETURNED_TO_PICKING;
      const resumingPicking = inProgressIds.has(o.id);
      const profile = profiles.get(o.id);
      return {
        id: o.id,
        erpOrderId: o.erpOrderId,
        priority: o.priority,
        customerName: o.customerName,
        marketplace: o.marketplace,
        marketplaceLabel: formatMarketplace(o.marketplace),
        collectionDeadline: o.collectionDeadline?.toISOString() ?? null,
        itemCount: o.items.length,
        totalUnits: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
        returnedFromPacking: returned,
        resumingPicking,
        issueSummary: returned
          ? lastIssueByOrder.get(o.id) ?? null
          : null,
        routeHint: profile?.routeHint ?? null,
        proximityNeighborCount: orderProximityNeighborCount(o.id, clusters),
      };
    });

    return {
      orders: queueOrders,
      proximityGroups: clusters.map((g) => ({
        id: g.id,
        orderIds: g.orderIds,
        routeHint: g.routeHint,
        proximityScore: g.proximityScore,
        orders: g.orders.map((o) => ({
          id: o.id,
          erpOrderId: o.erpOrderId,
          marketplace: o.marketplace,
        })),
      })),
    };
  });

  app.get("/mobile/picking/problem-orders", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const { listProblemOrders } = await import(
      "../services/picking-problems.js"
    );
    return listProblemOrders(tenantId);
  });

  app.get("/mobile/waves/problem-waves", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const { listProblemWaves } = await import("../services/picking-problems.js");
    return listProblemWaves(tenantId);
  });

  app.post<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/accept",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;
      const tenantId = request.authUser!.tenantId!;
      try {
        const { acceptOrderForPicking } = await import(
          "../services/order-picking-assignment.js"
        );
        const result = await acceptOrderForPicking(tenantId, userId, orderId);
        return { id: result.id, status: result.status };
      } catch (e) {
        if (e instanceof Error && "statusCode" in e) {
          return reply
            .status((e as { statusCode: number }).statusCode)
            .send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{ Body: { orderIds?: string[] } }>(
    "/mobile/orders/accept-batch",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      const orderIds = Array.isArray(request.body?.orderIds)
        ? request.body.orderIds
        : [];
      if (orderIds.length === 0) {
        return reply.status(400).send({ error: "orderIds obrigatório" });
      }
      return acceptOrdersBatch(tenantId, userId, orderIds);
    },
  );

  app.post<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/release",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        const { releaseOrderAccept } = await import(
          "../services/order-picking-assignment.js"
        );
        return await releaseOrderAccept(
          tenantId,
          request.params.orderId,
          userId,
        );
      } catch (e) {
        if (e instanceof Error && "statusCode" in e) {
          return reply
            .status((e as { statusCode: number }).statusCode)
            .send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{ Params: { orderId: string }; Body: { basketBarcode: string } }>(
    "/mobile/orders/:orderId/basket",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;
      const { basketBarcode } = request.body ?? {};

      if (!basketBarcode?.trim()) {
        return reply.status(400).send({ error: "Código da cesta obrigatório" });
      }

      const tenantId = request.authUser!.tenantId!;
      const basket = await prisma.basket.findFirst({
        where: {
          tenantId,
          barcode: basketBarcode.trim(),
          active: true,
        },
      });
      if (!basket) return reply.status(404).send({ error: "Cesta não encontrada" });

      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      const { acceptOrderForPicking } = await import(
        "../services/order-picking-assignment.js"
      );
      try {
        await acceptOrderForPicking(tenantId, userId, orderId);
      } catch (e) {
        if (e instanceof Error && "statusCode" in e) {
          return reply
            .status((e as { statusCode: number }).statusCode)
            .send({ error: e.message });
        }
        throw e;
      }

      const { ensurePickingStartLog } = await import(
        "../services/order-time-log-helpers.js"
      );
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { basketId: basket.id },
        });
        await ensurePickingStartLog(tx, orderId, userId);
      });

      return { basketId: basket.id, basketCode: basket.code };
    }
  );

  app.get<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/picking",
    async (request, reply) => {
      const { orderId } = request.params;
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          basket: true,
          items: {
            orderBy: { lineNumber: "asc" },
            include: {
              product: true,
              pickLocation: {
                include: {
                  proximityCorredor: { select: { code: true } },
                  proximityEstante: { select: { code: true } },
                  proximityLinha: { select: { code: true } },
                },
              },
            },
          },
        },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      const { pickNextItemByRoute, sortPendingItemsByRoute, mapLocationForRoute } =
        await import("../services/location-route.js");

      const isPending = (i: (typeof order.items)[0]) =>
        i.quantityPicked < i.quantityOrdered;

      const mapPickLoc = (loc: (typeof order.items)[0]["pickLocation"]) =>
        loc
          ? {
              id: loc.id,
              corridor: loc.corridor,
              row: loc.row,
              barcode: loc.barcode,
              label: formatLocation(loc),
              currentQuantity: loc.currentQuantity,
              capacity: loc.capacity,
              minThreshold: loc.minThreshold,
            }
          : null;

      const mapForRoute = (
        loc: NonNullable<(typeof order.items)[0]["pickLocation"]>,
      ) => mapLocationForRoute(loc);

      const lastPickedItem = [...order.items]
        .filter((i) => i.quantityPicked > 0 && i.pickLocation)
        .sort((a, b) => b.lineNumber - a.lineNumber)[0];
      const lastLocation = lastPickedItem?.pickLocation
        ? mapForRoute(lastPickedItem.pickLocation)
        : null;

      const routeItems = order.items.map((item) => ({
        ...item,
        pickLocation: item.pickLocation ? mapForRoute(item.pickLocation) : null,
      }));

      const isPendingQty = (i: {
        quantityPicked: number;
        quantityOrdered: number;
      }) => i.quantityPicked < i.quantityOrdered;

      const nextItem =
        pickNextItemByRoute(routeItems, isPendingQty, lastLocation) ??
        order.items.find(isPending);

      const routeQueue = sortPendingItemsByRoute(
        routeItems,
        isPendingQty,
        lastLocation,
      );

      const nextOrderItem = nextItem
        ? (order.items.find((i) => i.id === nextItem.id) ?? null)
        : null;
      const remaining = nextOrderItem
        ? nextOrderItem.quantityOrdered - nextOrderItem.quantityPicked
        : 0;

      return {
        order: {
          id: order.id,
          erpOrderId: order.erpOrderId,
          status: order.status,
          marketplace: order.marketplace,
          marketplaceLabel: formatMarketplace(order.marketplace),
          basket: order.basket,
          collectionDeadline: order.collectionDeadline?.toISOString() ?? null,
        },
        items: order.items.map((item) => ({
          id: item.id,
          lineNumber: item.lineNumber,
          quantityOrdered: item.quantityOrdered,
          quantityPicked: item.quantityPicked,
          product: item.product,
          pickLocation: mapPickLoc(item.pickLocation),
          completed: item.quantityPicked >= item.quantityOrdered,
        })),
        routeQueue: routeQueue.slice(0, 5).map((item) => {
          const original = order.items.find((i) => i.id === item.id);
          return {
            id: item.id,
            lineNumber: item.lineNumber,
            pickLocation: original
              ? mapPickLoc(original.pickLocation)
              : item.pickLocation
                ? {
                    id: item.pickLocation.id ?? "",
                    corridor: item.pickLocation.corridor,
                    row: item.pickLocation.row,
                    barcode: "",
                    label: `${item.pickLocation.corridor}-${item.pickLocation.row}`,
                    currentQuantity: 0,
                    capacity: 0,
                    minThreshold: 0,
                  }
                : null,
          };
        }),
        nextItem: nextOrderItem
          ? {
              id: nextOrderItem.id,
              lineNumber: nextOrderItem.lineNumber,
              quantityOrdered: nextOrderItem.quantityOrdered,
              quantityPicked: nextOrderItem.quantityPicked,
              remaining,
              product: nextOrderItem.product,
              pickLocation: mapPickLoc(nextOrderItem.pickLocation),
              stockMismatchHint:
                nextOrderItem.pickLocation &&
                nextOrderItem.pickLocation.currentQuantity < remaining
                  ? `Saldo na gôndola (${nextOrderItem.pickLocation.currentQuantity}) menor que o pendente (${remaining})`
                  : null,
            }
          : null,
        allPicked: !nextOrderItem,
      };
    }
  );

  app.post<{
    Params: { orderId: string; itemId: string };
    Body: { locationBarcode: string };
  }>(
    "/mobile/orders/:orderId/items/:itemId/validate-location",
    async (request, reply) => {
      const { orderId, itemId } = request.params;
      const { locationBarcode } = request.body ?? {};

      const item = await prisma.orderItem.findFirst({
        where: { id: itemId, orderId },
        include: { pickLocation: true },
      });
      if (!item) return reply.status(404).send({ error: "Item não encontrado" });
      if (!item.pickLocation) {
        return reply.status(400).send({ error: "Item sem localização de pick" });
      }
      if (item.pickLocation.barcode !== locationBarcode?.trim()) {
        return reply.status(400).send({
          error: "Gôndola incorreta",
          expected: item.pickLocation.barcode,
        });
      }
      return { valid: true, location: formatLocation(item.pickLocation) };
    }
  );

  app.post<{
    Params: { orderId: string; itemId: string };
    Body: { quantity: number };
  }>(
    "/mobile/orders/:orderId/items/:itemId/pick",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId, itemId } = request.params;
      const quantity = Number(request.body?.quantity ?? 0);

      if (quantity <= 0) {
        return reply.status(400).send({ error: "Quantidade inválida" });
      }

      const item = await prisma.orderItem.findFirst({
        where: { id: itemId, orderId },
        include: {
          product: true,
          pickLocation: true,
          order: { select: { tenantId: true } },
        },
      });
      if (!item) return reply.status(404).send({ error: "Item não encontrado" });

      const newPicked = Math.min(
        item.quantityPicked + quantity,
        item.quantityOrdered
      );
      const pickedDelta = newPicked - item.quantityPicked;

      await prisma.$transaction(async (tx) => {
        await tx.orderItem.update({
          where: { id: itemId },
          data: { quantityPicked: newPicked },
        });

        if (pickedDelta > 0 && item.pickLocationId) {
          await tx.location.update({
            where: { id: item.pickLocationId },
            data: {
              currentQuantity: { decrement: pickedDelta },
            },
          });
          if (item.productId) {
            await tx.inventoryMovement.create({
              data: {
                tenantId: item.order.tenantId,
                type: InventoryMovementType.PICK_ALLOCATION,
                quantity: pickedDelta,
                userId,
                productId: item.productId,
                fromLocationId: item.pickLocationId,
                orderId,
              },
            });
          }
        }
      });

      return {
        quantityPicked: newPicked,
        completed: newPicked >= item.quantityOrdered,
      };
    }
  );

  app.post<{ Params: { orderId: string }; Body: { reason: string } }>(
    "/mobile/orders/:orderId/report-issue",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;
      const reason = request.body?.reason?.trim() || "Problema reportado no mobile";

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.PAUSED_ISSUE },
        });
        const { recordOrderStageChange } = await import(
          "../services/order-stage-log.js"
        );
        await recordOrderStageChange(tx, {
          tenantId: order.tenantId,
          orderId,
          fromStatus: order.status,
          toStatus: OrderStatus.PAUSED_ISSUE,
          userId,
          reason,
        });
        await tx.orderTimeLog.create({
          data: {
            orderId,
            userId,
            event: OrderTimeLogEvent.PAUSE,
            reason,
          },
        });
      });

      return { status: OrderStatus.PAUSED_ISSUE, notified: true };
    }
  );

  app.post<{ Params: { orderId: string } }>(
    "/mobile/orders/:orderId/complete-picking",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { orderId } = request.params;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      const incomplete = order.items.some(
        (i) => i.quantityPicked < i.quantityOrdered
      );
      if (incomplete) {
        return reply.status(400).send({ error: "Ainda há itens pendentes" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.PICKED_AWAITING_CONFERENCE },
        });
        const { recordOrderStageChange } = await import(
          "../services/order-stage-log.js"
        );
        await recordOrderStageChange(tx, {
          tenantId: order.tenantId,
          orderId,
          fromStatus: order.status,
          toStatus: OrderStatus.PICKED_AWAITING_CONFERENCE,
          userId,
        });
        await tx.orderTimeLog.create({
          data: {
            orderId,
            userId,
            event: OrderTimeLogEvent.END,
          },
        });
      });

      return { status: OrderStatus.PICKED_AWAITING_CONFERENCE };
    }
  );

  // ---------------------------------------------------------------------------
  // Replenishment
  // ---------------------------------------------------------------------------

  app.get<{ Params: { barcode: string } }>(
    "/mobile/locations/barcode/:barcode",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const barcode = decodeURIComponent(request.params.barcode);
      const location = await prisma.location.findFirst({
        where: { tenantId, barcode, active: true },
        include: { product: true },
      });
      if (!location) return reply.status(404).send({ error: "Localização não encontrada" });

      return {
        id: location.id,
        corridor: location.corridor,
        row: location.row,
        barcode: location.barcode,
        type: location.type,
        currentQuantity: location.currentQuantity,
        capacity: location.capacity,
        minThreshold: location.minThreshold,
        label: formatLocation(location),
        product: location.product,
        needsReplenishment: location.currentQuantity <= location.minThreshold,
      };
    }
  );

  app.post<{
    Params: { locationId: string };
    Body: {
      countedQuantity?: number;
      productBarcode?: string;
      reason?: string;
      orderId?: string;
      itemId?: string;
      waveLineId?: string;
    };
  }>(
    "/mobile/locations/:locationId/adjust-quantity",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        return await adjustLocationQuantity({
          tenantId,
          userId,
          locationId: request.params.locationId,
          countedQuantity: Number(request.body?.countedQuantity),
          productBarcode: request.body?.productBarcode,
          reason: request.body?.reason,
          orderId: request.body?.orderId,
          itemId: request.body?.itemId,
          waveLineId: request.body?.waveLineId,
        });
      } catch (e) {
        if (e instanceof LocationAdjustError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { barcode: string };
    Body: {
      countedQuantity?: number;
      productBarcode?: string;
      reason?: string;
      orderId?: string;
      itemId?: string;
      waveLineId?: string;
    };
  }>(
    "/mobile/locations/barcode/:barcode/adjust-quantity",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        return await adjustLocationQuantity({
          tenantId,
          userId,
          barcode: decodeURIComponent(request.params.barcode),
          countedQuantity: Number(request.body?.countedQuantity),
          productBarcode: request.body?.productBarcode,
          reason: request.body?.reason,
          orderId: request.body?.orderId,
          itemId: request.body?.itemId,
          waveLineId: request.body?.waveLineId,
        });
      } catch (e) {
        if (e instanceof LocationAdjustError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { barcode: string };
    Body: { inputMode?: string; value?: number };
  }>(
    "/mobile/locations/barcode/:barcode/request-replenishment",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      const inputMode = request.body?.inputMode;
      const value = Number(request.body?.value);
      if (inputMode !== "UNITS" && inputMode !== "PERCENT") {
        return reply.status(400).send({
          error: 'inputMode deve ser "UNITS" ou "PERCENT"',
        });
      }
      if (!Number.isFinite(value)) {
        return reply.status(400).send({ error: "value obrigatório" });
      }
      try {
        return await requestReplenishmentFromPickFace({
          tenantId,
          userId,
          barcode: decodeURIComponent(request.params.barcode),
          inputMode,
          value,
        });
      } catch (e) {
        if (e instanceof LocationAdjustError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { locationId: string };
    Body: { quantity: number; productBarcode?: string };
  }>(
    "/mobile/locations/:locationId/replenish",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const { locationId } = request.params;
      const quantity = Number(request.body?.quantity ?? 0);
      const productBarcode = request.body?.productBarcode?.trim();

      if (quantity <= 0) {
        return reply.status(400).send({ error: "Quantidade inválida" });
      }

      const location = await prisma.location.findUnique({
        where: { id: locationId },
        include: { product: true },
      });
      if (!location) return reply.status(404).send({ error: "Gôndola não encontrada" });
      if (location.type !== "PICK_FACE") {
        return reply.status(400).send({ error: "Reabastecimento apenas em gôndolas" });
      }

      if (productBarcode && location.product?.barcode !== productBarcode) {
        return reply
          .status(400)
          .send({ error: "Produto não corresponde à gôndola" });
      }

      const newQty = Math.min(
        location.currentQuantity + quantity,
        location.capacity
      );
      const added = newQty - location.currentQuantity;

      if (added <= 0) {
        return reply.status(400).send({ error: "Gôndola já está na capacidade máxima" });
      }

      await prisma.$transaction(async (tx) => {
        await tx.location.update({
          where: { id: locationId },
          data: { currentQuantity: newQty },
        });
        if (location.productId) {
          await tx.inventoryMovement.create({
            data: {
              tenantId: location.tenantId,
              type: InventoryMovementType.REPLENISHMENT,
              quantity: added,
              userId,
              productId: location.productId,
              toLocationId: locationId,
              notes: "Reabastecimento via mobile",
            },
          });
        }
      });

      return {
        currentQuantity: newQty,
        added,
      };
    }
  );

  app.post<{
    Params: { locationId: string };
    Body: { productBarcode?: string; quantity?: number };
  }>(
    "/mobile/locations/:locationId/stock",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const productBarcode = request.body?.productBarcode?.trim() ?? "";

      try {
        const result = await stockLocation({
          locationId: request.params.locationId,
          productBarcode,
          quantity: request.body?.quantity,
          userId,
        });
        return result;
      } catch (e) {
        if (e instanceof LocationStockError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Body: {
      fromLocationBarcode?: string;
      toLocationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/replenishment/transfer", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    try {
      const from = request.body?.fromLocationBarcode ?? "";
      const to = request.body?.toLocationBarcode ?? "";
      const productBarcode = request.body?.productBarcode ?? "";
      const quantity = Number(request.body?.quantity ?? 0);
      const withdrawn = await withdrawCargoTransfer({
        tenantId,
        userId,
        fromLocationBarcode: from,
        productBarcode,
        quantity,
      });
      const deposited = await depositCargoTransfer({
        tenantId,
        userId,
        transferId: withdrawn.transfer.id,
        toLocationBarcode: to,
        productBarcode,
        quantity,
      });
      return {
        transfer: deposited.transfer,
        fromLocation: withdrawn.fromLocation,
        toLocation: deposited.toLocation,
        transferred: quantity,
        legacy: true,
      };
    } catch (e) {
      if (e instanceof CargoTransferError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get("/mobile/replenishment/needs", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    const { listReplenishmentNeedsForMobile } = await import(
      "../services/replenishment-assignment.js"
    );
    return listReplenishmentNeedsForMobile(tenantId, userId);
  });

  app.post<{ Params: { pickFaceId: string } }>(
    "/mobile/replenishment/needs/:pickFaceId/accept",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        const { acceptReplenishmentNeed } = await import(
          "../services/replenishment-assignment.js"
        );
        return await acceptReplenishmentNeed(
          tenantId,
          request.params.pickFaceId,
          userId,
        );
      } catch (e) {
        if (e instanceof Error && "statusCode" in e) {
          return reply
            .status((e as { statusCode: number }).statusCode)
            .send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{ Params: { pickFaceId: string } }>(
    "/mobile/replenishment/needs/:pickFaceId/release",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        const { releaseReplenishmentAssignment } = await import(
          "../services/replenishment-assignment.js"
        );
        return await releaseReplenishmentAssignment(
          tenantId,
          request.params.pickFaceId,
          userId,
        );
      } catch (e) {
        if (e instanceof Error && "statusCode" in e) {
          return reply
            .status((e as { statusCode: number }).statusCode)
            .send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get<{ Params: { code: string }; Querystring: { type?: string } }>(
    "/mobile/products/:code/locations",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const type =
        request.query.type === "PICK_FACE" ? "PICK_FACE" : "PULMAO";
      try {
        const { listProductLocations } = await import(
          "../services/product-locations.js"
        );
        return await listProductLocations(
          tenantId,
          decodeURIComponent(request.params.code),
          type,
        );
      } catch (e) {
        if (e instanceof Error && "statusCode" in e) {
          return reply
            .status((e as { statusCode: number }).statusCode)
            .send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Body: { locationBarcode?: string; productBarcode?: string; quantity?: number };
  }>("/mobile/locations/pulmao/stock", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    try {
      const { stockPulmaoLocation } = await import("../services/pulmao-stock.js");
      return await stockPulmaoLocation({
        tenantId,
        userId,
        locationBarcode: request.body?.locationBarcode ?? "",
        productBarcode: request.body?.productBarcode ?? "",
        quantity: Number(request.body?.quantity ?? 0),
      });
    } catch (e) {
      if (e instanceof LocationStockError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.post<{
    Body: {
      fromLocationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
      targetPickFaceId?: string;
    };
  }>("/mobile/cargo-transfers/withdraw", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    try {
      return await withdrawCargoTransfer({
        tenantId,
        userId,
        fromLocationBarcode: request.body?.fromLocationBarcode ?? "",
        productBarcode: request.body?.productBarcode ?? "",
        quantity: Number(request.body?.quantity ?? 0),
        targetPickFaceId: request.body?.targetPickFaceId,
      });
    } catch (e) {
      if (e instanceof CargoTransferError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get("/mobile/cargo-transfers/pending", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    return {
      transfers: await listPendingCargoTransfers(tenantId, { userId }),
      allTransfers: await listPendingCargoTransfers(tenantId),
    };
  });

  app.post<{ Params: { id: string } }>(
    "/mobile/cargo-transfers/:id/cancel",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        return await cancelCargoTransfer(tenantId, request.params.id, userId);
      } catch (e) {
        if (e instanceof CargoTransferError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/mobile/cargo-transfers/:id",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      try {
        return await getCargoTransfer(tenantId, request.params.id);
      } catch (e) {
        if (e instanceof CargoTransferError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/mobile/cargo-transfers/:id/suggest-face",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      try {
        const transfer = await getCargoTransfer(tenantId, request.params.id);
        const { suggestPickFaceDeposit } = await import(
          "../services/pick-face-resolve.js"
        );
        const loc = await suggestPickFaceDeposit(
          tenantId,
          transfer.product.id,
          transfer.quantity,
        );
        if (!loc) {
          return reply.status(404).send({
            error: "Nenhum endereço de estoque de giro disponível",
          });
        }
        return {
          suggested: {
            barcode: loc.barcode,
            corridor: loc.corridor,
            row: loc.row,
            currentQuantity: loc.currentQuantity,
            capacity: loc.capacity,
            label: `${loc.corridor}-${loc.row}`,
          },
        };
      } catch (e) {
        if (e instanceof CargoTransferError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      toLocationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/cargo-transfers/:id/deposit", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const userId = resolveUserId(request);
    try {
      return await depositCargoTransfer({
        tenantId,
        userId,
        transferId: request.params.id,
        toLocationBarcode: request.body?.toLocationBarcode ?? "",
        productBarcode: request.body?.productBarcode,
        quantity: request.body?.quantity,
      });
    } catch (e) {
      if (e instanceof CargoTransferError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // ---------------------------------------------------------------------------
  // Pick wave
  // ---------------------------------------------------------------------------

  function mapWaveMobilePayload(
    wave: NonNullable<Awaited<ReturnType<typeof getReleasedWaveById>>>,
    userId: string,
  ) {
    const canWork = !wave.acceptedById || wave.acceptedById === userId;
    const waveOrders = wave.orders.map((wo) => wo.order);
    let collectionDeadline: Date | null = null;
    for (const o of waveOrders) {
      if (o.collectionDeadline) {
        if (
          !collectionDeadline ||
          o.collectionDeadline.getTime() < collectionDeadline.getTime()
        ) {
          collectionDeadline = o.collectionDeadline;
        }
      }
    }
    const marketplaces = [
      ...new Set(
        waveOrders.map((o) => formatMarketplace(o.marketplace)).filter((m) => m !== "—"),
      ),
    ];
    return {
      wave: {
        id: wave.id,
        name: wave.name,
        status: wave.status,
        releasedAt: wave.releasedAt,
        orderCount: wave.orders.length,
        gondolaPasses: wave.lines.length,
        marketplaces,
        acceptedById: wave.acceptedById,
        acceptedByName: wave.acceptedBy?.name ?? null,
        acceptedAt: wave.acceptedAt,
        canAccept: !wave.acceptedById,
        canWork,
        isMine: wave.acceptedById === userId,
        collectionDeadline: collectionDeadline?.toISOString() ?? null,
      },
      lines: canWork ? wave.lines.map(mapWaveLineSummary) : [],
    };
  }

  app.get("/mobile/waves/released", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const { scorePackingUrgency } = await import(
      "../services/packing-queue-sort.js"
    );
    const waves = await listReleasedWaves(tenantId);
    const summaries = waves.map((w) => {
      const orders = w.orders.map((wo) => wo.order);
      const urgency = Math.max(
        ...orders.map((o) =>
          scorePackingUrgency({
            priority: o.priority,
            collectionDeadline: o.collectionDeadline,
            marketplace: o.marketplace,
          }),
        ),
        0,
      );
      let collectionDeadline: Date | null = null;
      for (const o of orders) {
        if (o.collectionDeadline) {
          if (
            !collectionDeadline ||
            o.collectionDeadline.getTime() < collectionDeadline.getTime()
          ) {
            collectionDeadline = o.collectionDeadline;
          }
        }
      }
      const marketplaces = [
        ...new Set(
          orders
            .map((o) => formatMarketplace(o.marketplace))
            .filter((m) => m !== "—"),
        ),
      ];
      return {
        id: w.id,
        name: w.name,
        releasedAt: w.releasedAt,
        orderCount: w._count.orders,
        lineCount: w._count.lines,
        marketplaces,
        acceptedById: w.acceptedById,
        acceptedByName: w.acceptedBy?.name ?? null,
        packingUrgency: urgency,
        collectionDeadline: collectionDeadline?.toISOString() ?? null,
      };
    });
    summaries.sort((a, b) => b.packingUrgency - a.packingUrgency);
    return { waves: summaries };
  });

  app.get("/mobile/waves/open", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const wave = await getOpenWave(tenantId);
    if (!wave) return { wave: null };
    return {
      wave: {
        id: wave.id,
        name: wave.name,
        orderCount: wave._count.orders,
        lineCount: wave._count.lines,
      },
    };
  });

  app.post<{
    Body: { orderIds?: string[]; appendToWaveId?: string };
  }>("/mobile/waves/create-from-orders", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const userId = resolveUserId(request);
    const orderIds = Array.isArray(request.body?.orderIds)
      ? request.body.orderIds
      : [];
    if (orderIds.length === 0) {
      return reply.status(400).send({ error: "orderIds obrigatório" });
    }
    const appendToWaveId =
      typeof request.body?.appendToWaveId === "string"
        ? request.body.appendToWaveId.trim()
        : undefined;

    try {
      const result = await releasePickWave(tenantId, userId, {
        orderIds,
        auto: false,
        appendToWaveId: appendToWaveId || undefined,
      });
      return result;
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get("/mobile/waves/current", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const userId = resolveUserId(request);
    const wave = await getCurrentReleasedWave(tenantId);
    if (!wave) {
      return reply.status(404).send({ error: "Nenhuma onda ativa" });
    }

    return mapWaveMobilePayload(wave, userId);
  });

  app.post("/mobile/waves/current/accept", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const userId = resolveUserId(request);
    const wave = await getCurrentReleasedWave(tenantId);
    if (!wave) {
      return reply.status(404).send({ error: "Nenhuma onda ativa" });
    }

    try {
      const result = await acceptPickWave(wave.id, userId);
      return result;
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get<{ Params: { waveId: string } }>(
    "/mobile/waves/:waveId",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const enabled = await isWaveEnabled(tenantId);
      if (!enabled) {
        return reply.status(404).send({ error: "Separação em onda desabilitada" });
      }

      const userId = resolveUserId(request);
      const wave = await getReleasedWaveById(tenantId, request.params.waveId);
      if (!wave) {
        return reply.status(404).send({ error: "Onda não encontrada" });
      }
      return mapWaveMobilePayload(wave, userId);
    },
  );

  app.post<{ Params: { waveId: string } }>(
    "/mobile/waves/:waveId/accept",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const enabled = await isWaveEnabled(tenantId);
      if (!enabled) {
        return reply.status(404).send({ error: "Separação em onda desabilitada" });
      }

      const userId = resolveUserId(request);
      try {
        return await acceptPickWave(request.params.waveId, userId);
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{ Params: { waveId: string } }>(
    "/mobile/waves/:waveId/release",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const enabled = await isWaveEnabled(tenantId);
      if (!enabled) {
        return reply.status(404).send({ error: "Separação em onda desabilitada" });
      }

      const userId = resolveUserId(request);
      const wave = await getReleasedWaveById(tenantId, request.params.waveId);
      if (!wave) {
        return reply.status(404).send({ error: "Onda não encontrada" });
      }

      try {
        return await releasePickWaveAccept(request.params.waveId, userId);
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post("/mobile/waves/current/release", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    const enabled = await isWaveEnabled(tenantId);
    if (!enabled) {
      return reply.status(404).send({ error: "Separação em onda desabilitada" });
    }

    const userId = resolveUserId(request);
    const wave = await getCurrentReleasedWave(tenantId);
    if (!wave) {
      return reply.status(404).send({ error: "Nenhuma onda ativa" });
    }

    try {
      return await releasePickWaveAccept(wave.id, userId);
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.get("/mobile/config", async (request) => {
    const tenantId = request.authUser!.tenantId!;
    const waveEnabled = await isWaveEnabled(tenantId);
    return { waveEnabled };
  });

  app.get<{ Params: { lineId: string } }>(
    "/mobile/waves/lines/:lineId",
    async (request, reply) => {
      try {
        const line = await getWaveLineDetail(request.params.lineId);
        if (!line) {
          return reply.status(404).send({ error: "Linha não encontrada" });
        }
        return { line };
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Params: { lineId: string };
    Body: {
      locationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/waves/lines/:lineId/pick", async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      return await confirmConsolidatedPick({
        lineId: request.params.lineId,
        locationBarcode: request.body?.locationBarcode ?? "",
        productBarcode: request.body?.productBarcode,
        quantity: Number(request.body?.quantity ?? 0),
        userId,
      });
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  app.post<{
    Params: { lineId: string };
    Body: {
      allocationId?: string;
      quantity?: number;
      basketBarcode?: string;
    };
  }>("/mobile/waves/lines/:lineId/sort", async (request, reply) => {
    const userId = resolveUserId(request);
    try {
      return await confirmSortAllocation({
        lineId: request.params.lineId,
        allocationId: request.body?.allocationId ?? "",
        quantity: Number(request.body?.quantity ?? 0),
        basketBarcode: request.body?.basketBarcode,
        userId,
      });
    } catch (e) {
      if (e instanceof PickWaveError) {
        return reply.status(e.statusCode).send({ error: e.message });
      }
      throw e;
    }
  });

  // ---------------------------------------------------------------------------
  // Recebimento / conferência de compra (NF entrada — Tiny)
  // ---------------------------------------------------------------------------

  app.get("/mobile/purchase-receipts/queue", async (request, reply) => {
    const tenantId = request.authUser!.tenantId!;
    try {
      const queue = await listPurchaseReceiptQueue(tenantId);
      return { queue };
    } catch (e) {
      if (isTinyConnectedError(e)) {
        return reply.status(503).send({
          error:
            "Tiny ERP não conectado. Peça ao administrador para conectar em Integrações.",
        });
      }
      const message = e instanceof Error ? e.message : "Erro ao listar notas";
      return reply.status(422).send({ error: message });
    }
  });

  app.post<{ Body: { barcode?: string } }>(
    "/mobile/purchase-receipts/start",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código DANFE obrigatório" });
      }
      try {
        const tenantId = request.authUser!.tenantId!;
        return await startPurchaseReceiptByBarcode({
          tenantId,
          barcode,
          userId,
        });
      } catch (e) {
        if (isTinyConnectedError(e)) {
          return reply.status(503).send({
            error: "Tiny ERP não conectado.",
          });
        }
        const message =
          e instanceof Error ? e.message : "Erro ao iniciar recebimento";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/:sessionId",
    async (request, reply) => {
      try {
        return await getPurchaseReceiptSession(request.params.sessionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sessão não encontrada";
        return reply.status(404).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { barcode?: string; quantity?: number };
  }>(
    "/mobile/purchase-receipts/:sessionId/scan",
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código do produto obrigatório" });
      }
      try {
        return await scanPurchaseReceiptItem({
          sessionId: request.params.sessionId,
          barcode,
          quantity: request.body?.quantity,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao registrar bip";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { itemId?: string; quantity?: number };
  }>(
    "/mobile/purchase-receipts/:sessionId/confirm-item",
    async (request, reply) => {
      const { itemId, quantity } = request.body ?? {};
      if (!itemId) {
        return reply.status(400).send({ error: "itemId obrigatório" });
      }
      try {
        return await confirmReceiptItem(
          request.params.sessionId,
          itemId,
          Number(quantity ?? 1),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao confirmar item";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/:sessionId/conference-start",
    async (request, reply) => {
      const userId = resolveUserId(request);
      try {
        await markConferenceStarted(request.params.sessionId, userId);
        return { ok: true };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao iniciar conferência";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/:sessionId/complete",
    async (request, reply) => {
      const userId = resolveUserId(request);
      try {
        return await completePurchaseReceipt(request.params.sessionId, userId);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar conferência";
        return reply.status(422).send({ error: message });
      }
    },
  );

  // Devolução (recebimento caminhão)
  app.post<{ Body: { reference?: string } }>(
    "/mobile/purchase-receipts/return/start",
    async (request, reply) => {
      const tenantId = request.authUser!.tenantId!;
      const userId = resolveUserId(request);
      try {
        const { startReturnReceiptSession } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await startReturnReceiptSession({
          tenantId,
          userId,
          reference: request.body?.reference,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao iniciar devolução";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/mobile/purchase-receipts/return/:sessionId",
    async (request, reply) => {
      try {
        const { getReturnReceiptSession } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await getReturnReceiptSession(request.params.sessionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sessão não encontrada";
        return reply.status(404).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { barcode?: string; quantity?: number };
  }>(
    "/mobile/purchase-receipts/return/:sessionId/scan",
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código do produto obrigatório" });
      }
      try {
        const { scanReturnReceiptProduct } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await scanReturnReceiptProduct({
          sessionId: request.params.sessionId,
          barcode,
          quantity: request.body?.quantity,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao registrar bip";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { pulmaoLocationBarcode?: string };
  }>(
    "/mobile/purchase-receipts/return/:sessionId/complete",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const pulmaoLocationBarcode = request.body?.pulmaoLocationBarcode?.trim();
      if (!pulmaoLocationBarcode) {
        return reply.status(400).send({ error: "Bipe o pulmão de destino" });
      }
      try {
        const { completeReturnReceipt } = await import(
          "../services/purchase-receipt-return.js"
        );
        return await completeReturnReceipt({
          sessionId: request.params.sessionId,
          userId,
          pulmaoLocationBarcode,
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar devolução";
        return reply.status(422).send({ error: message });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Armazenagem (putaway pós-recebimento)
  // ---------------------------------------------------------------------------

  app.get("/mobile/putaway/queue", async (request, reply) => {
    try {
      const tenantId = request.authUser!.tenantId!;
      const queue = await listPutawayQueue(tenantId);
      return { queue };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao listar fila";
      return reply.status(422).send({ error: message });
    }
  });

  app.post<{ Body: { purchaseReceiptId?: string } }>(
    "/mobile/putaway/start",
    async (request, reply) => {
      const userId = resolveUserId(request);
      const purchaseReceiptId = request.body?.purchaseReceiptId?.trim();
      if (!purchaseReceiptId) {
        return reply.status(400).send({ error: "purchaseReceiptId obrigatório" });
      }
      try {
        return await startPutaway(purchaseReceiptId, userId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao iniciar armazenagem";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/mobile/putaway/:sessionId",
    async (request, reply) => {
      try {
        return await getPutawaySession(request.params.sessionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Sessão não encontrada";
        return reply.status(404).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: {
      itemId?: string;
      locationBarcode?: string;
      productBarcode?: string;
      quantity?: number;
    };
  }>("/mobile/putaway/:sessionId/store", async (request, reply) => {
    const userId = resolveUserId(request);
    const { itemId, locationBarcode, productBarcode } = request.body ?? {};
    if (!itemId || !locationBarcode) {
      return reply.status(400).send({ error: "itemId e local são obrigatórios" });
    }
    try {
      return await storePutawayItem({
        sessionId: request.params.sessionId,
        itemId,
        locationBarcode,
        productBarcode: productBarcode?.trim() || undefined,
        quantity: Number(request.body?.quantity ?? 1),
        userId,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao armazenar";
      return reply.status(422).send({ error: message });
    }
  });

  app.post<{ Params: { sessionId: string } }>(
    "/mobile/putaway/:sessionId/complete",
    async (request, reply) => {
      try {
        return await completePutaway(request.params.sessionId);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar armazenagem";
        return reply.status(422).send({ error: message });
      }
    },
  );
}
