import type { FastifyInstance } from "fastify";
import {
  InventoryMovementType,
  LocationType,
  OrderStatus,
  OrderTimeLogEvent,
  Prisma,
} from "@prisma/client";
import { Permission } from "@wms/shared";
import { prisma } from "../lib/prisma.js";
import { createPermissionGuard } from "../lib/auth-guard.js";
import { parsePagination, buildPaginationMeta } from "../lib/pagination.js";
import { createNotification, notifyUsersWithPermission } from "../services/notifications.js";
import {
  getReportsSummary,
  reportToCsv,
  REPORT_IDS,
  resolveReportId,
  runReport,
  type ReportId,
} from "../services/reports.js";
import {
  importLocations,
  normalizeImportRow,
  type LocationImportInput,
  type LocationImportMode,
} from "../services/location-import.js";
import {
  assertMaxPickFaceLocations,
  LocationRuleError,
} from "../services/location-rules.js";
import {
  listPickFacePendingSkus,
  listProductsWithoutPickFace,
  resumePausedOrdersAfterPickFace,
} from "../services/product-locations.js";
import { selectableProductWhere } from "../services/product-selectable.js";
import {
  layoutInclude,
  resolveLocationLayout,
} from "../services/warehouse-layout.js";
import { registerWarehouseRoutes } from "./warehouse.js";
import {
  PickWaveError,
  addOrdersToWave,
  getOpenWave,
  listPickWaves,
  previewWaveRelease,
  releasePickWave,
  removeOrderFromWave,
  closePickWave,
} from "../services/pick-wave.js";
import {
  getWaveSettings,
  setWaveSettings,
  WAVE_SETTING_META,
  type WaveSettings,
} from "../services/wave-settings.js";
import { enrichOrderPriority } from "../services/marketplace-priority.js";
import { marketplaceWhereClause } from "../services/marketplace-filter.js";
import { marketplaceDisplayLabel } from "../services/marketplace-priority.js";
import {
  getPurchaseReceiptDetailForWeb,
  listPurchaseReceiptsForWeb,
} from "../services/purchase-receipt-web.js";
import { syncPurchaseReceiptsFromTiny } from "../services/sync-purchase-receipts-from-tiny.js";
import {
  completePurchaseReceipt,
  confirmReceiptItem,
  isTinyConnectedError,
  markConferenceStarted,
  scanPurchaseReceiptItem,
  startPurchaseReceiptByBarcode,
} from "../services/tiny-purchase-receipt.js";
import {
  completeReturnReceipt,
  scanReturnReceiptProduct,
  startReturnReceiptSession,
} from "../services/purchase-receipt-return.js";
import {
  getOrderDetail,
  getOrdersBoard,
  getWaveDetail,
  type BoardKind,
} from "../services/orders-board.js";
import {
  assertResourceTenant,
  tenantWhere,
  TenantContextError,
} from "../lib/tenant-context.js";
import {
  completePacking,
  confirmPackingItem,
  findPackingOrderByQuery,
  getPackingSession,
  getWavePackingLine,
  listPackingQueue,
  listUnifiedPackingQueue,
  listWavePackingLines,
  reportPackingIssue,
  scanPackingItem,
  sortWaveAllocationWeb,
  startPacking,
  type PackingIssuePayload,
  type PackingIssueType,
  cancelPacking,
  PackingSessionError,
  fetchShippingLabelsForOrder,
  fetchShippingLabelFile,
  fetchShippingLabelPreview,
} from "../services/order-packing.js";
import {
  completePutaway,
  getPutawaySession,
  listPutawayQueue,
  startPutaway,
  storePutawayItem,
} from "../services/putaway.js";

const guard = (p: string) => createPermissionGuard(p);

export async function webRoutes(app: FastifyInstance) {
  registerWarehouseRoutes(app, guard);

  // --- Pesquisa rápida ---
  app.get<{ Querystring: { q?: string } }>(
    "/api/search",
    { preHandler: guard(Permission.SEARCH_USE) },
    async (request) => {
      const q = request.query.q?.trim();
      if (!q || q.length < 2) {
        return { products: [], orders: [], locations: [] };
      }
      const contains = { contains: q, mode: "insensitive" as const };
      const tw = tenantWhere(request);
      const productWhere = await selectableProductWhere(tw.tenantId, {
        ...tw,
        active: true,
        OR: [{ sku: contains }, { name: contains }, { barcode: contains }],
      });

      const [products, orders, locations] = await Promise.all([
        prisma.product.findMany({
          where: productWhere,
          take: 15,
          orderBy: { sku: "asc" },
        }),
        prisma.order.findMany({
          where: {
            ...tw,
            OR: [
              { erpOrderId: contains },
              { customerName: contains },
            ],
          },
          take: 15,
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { items: true } } },
        }),
        prisma.location.findMany({
          where: {
            ...tw,
            active: true,
            OR: [{ barcode: contains }, { corridor: contains }, { row: contains }],
          },
          take: 15,
          include: { product: true },
        }),
      ]);

      return {
        products: products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode,
        })),
        orders: orders.map((o) => ({
          id: o.id,
          erpOrderId: o.erpOrderId,
          customerName: o.customerName,
          status: o.status,
          itemCount: o._count.items,
          createdAt: o.createdAt,
        })),
        locations: locations.map((l) => ({
          id: l.id,
          barcode: l.barcode,
          corridor: l.corridor,
          row: l.row,
          type: l.type,
          currentQuantity: l.currentQuantity,
          productSku: l.product?.sku ?? null,
          productName: l.product?.name ?? null,
        })),
      };
    },
  );

  // --- Produtos ---
  app.get<{ Querystring: { q?: string; page?: string; pageSize?: string } }>(
    "/api/products",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request) => {
      const q = request.query.q?.trim();
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const tw = tenantWhere(request);
      const where: Prisma.ProductWhereInput = await selectableProductWhere(
        tw.tenantId,
        {
          ...tw,
          ...(q
            ? {
                OR: [
                  { sku: { contains: q, mode: "insensitive" } },
                  { name: { contains: q, mode: "insensitive" } },
                  { barcode: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
      );
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          orderBy: { sku: "asc" },
          skip,
          take,
        }),
        prisma.product.count({ where }),
      ]);
      return { products, pagination: buildPaginationMeta(total, page, pageSize) };
    },
  );

  app.post<{
    Body: {
      sku?: string;
      name?: string;
      barcode?: string;
      requiresItemScan?: boolean;
      imageUrl?: string | null;
      unit?: string | null;
      weight?: number | null;
    };
  }>(
    "/api/products",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request, reply) => {
      const { sku, name, barcode, requiresItemScan, imageUrl, unit, weight } =
        request.body ?? {};
      if (!sku?.trim() || !name?.trim()) {
        return reply.status(400).send({ error: "SKU e nome são obrigatórios" });
      }
      try {
        const product = await prisma.product.create({
          data: {
            tenantId: tenantWhere(request).tenantId,
            sku: sku.trim().toUpperCase(),
            name: name.trim(),
            barcode: barcode?.trim() || null,
            requiresItemScan: requiresItemScan ?? false,
            imageUrl: imageUrl?.trim() || null,
            unit: unit?.trim() || null,
            weight: weight != null ? weight : null,
          },
        });
        return reply.status(201).send({ product });
      } catch {
        return reply.status(409).send({ error: "SKU ou código de barras já existe" });
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      barcode?: string;
      requiresItemScan?: boolean;
      active?: boolean;
      imageUrl?: string | null;
      unit?: string | null;
      weight?: number | null;
    };
  }>(
    "/api/products/:id",
    { preHandler: guard(Permission.PRODUCTS_MANAGE) },
    async (request, reply) => {
      const b = request.body ?? {};
      const product = await prisma.product.update({
        where: { id: request.params.id },
        data: {
          ...(b.name !== undefined ? { name: b.name.trim() } : {}),
          ...(b.barcode !== undefined
            ? { barcode: b.barcode?.trim() || null }
            : {}),
          ...(b.requiresItemScan !== undefined
            ? { requiresItemScan: b.requiresItemScan }
            : {}),
          ...(b.active !== undefined ? { active: b.active } : {}),
          ...(b.imageUrl !== undefined
            ? { imageUrl: b.imageUrl?.trim() || null }
            : {}),
          ...(b.unit !== undefined ? { unit: b.unit?.trim() || null } : {}),
          ...(b.weight !== undefined ? { weight: b.weight } : {}),
        },
      });
      return { product };
    },
  );

  // --- Pedidos (Vendas) ---
  app.get<{
    Querystring: {
      status?: string;
      q?: string;
      page?: string;
      pageSize?: string;
      notInWave?: string;
      marketplace?: string;
    };
  }>(
    "/api/orders",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const q = request.query.q?.trim();
      const status = request.query.status as OrderStatus | undefined;
      const notInWave = request.query.notInWave === "true";
      const marketplace = request.query.marketplace?.trim();
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where: Prisma.OrderWhereInput = { ...tenantWhere(request) };
      if (status && Object.values(OrderStatus).includes(status)) {
        where.status = status;
      }
      if (notInWave) {
        where.waveOrders = { none: {} };
      }
      const mpWhere = marketplaceWhereClause(marketplace);
      if (mpWhere) Object.assign(where, mpWhere);
      if (q) {
        where.OR = [
          { erpOrderId: { contains: q, mode: "insensitive" } },
          { customerName: { contains: q, mode: "insensitive" } },
          { marketplace: { contains: q, mode: "insensitive" } },
        ];
      }
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          skip,
          take,
          include: {
            assignedPicker: { select: { name: true } },
            basket: { select: { code: true } },
            _count: { select: { items: true } },
            items: { select: { quantityOrdered: true, quantityPicked: true } },
          },
        }),
        prisma.order.count({ where }),
      ]);
      return {
        orders: orders.map((o) => ({
          id: o.id,
          erpOrderId: o.erpOrderId,
          customerName: o.customerName,
          status: o.status,
          priority: o.priority,
          collectionDeadline: o.collectionDeadline,
          marketplace: o.marketplace,
          pickerName: o.assignedPicker?.name ?? null,
          basketCode: o.basket?.code ?? null,
          itemCount: o._count.items,
          qtyOrdered: o.items.reduce((s, i) => s + i.quantityOrdered, 0),
          qtyPicked: o.items.reduce((s, i) => s + i.quantityPicked, 0),
          hasShippingLabel: Boolean(o.shippingLabel),
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        })),
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.get<{
    Querystring: {
      status?: string;
      q?: string;
      page?: string;
      pageSize?: string;
      kind?: string;
      marketplace?: string;
    };
  }>(
    "/api/orders/board",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const kind = (request.query.kind as BoardKind | undefined) ?? "all";
      const status = request.query.status as OrderStatus | undefined;
      const q = request.query.q?.trim();
      const marketplace = request.query.marketplace?.trim();
      const { page, pageSize } = parsePagination(request.query);
      const validKind = ["all", "order", "wave"].includes(kind) ? kind : "all";
      return getOrdersBoard(tenantWhere(request).tenantId, {
        kind: validKind as BoardKind,
        status:
          status && Object.values(OrderStatus).includes(status)
            ? status
            : undefined,
        q: q || undefined,
        marketplace: marketplace || undefined,
        page,
        pageSize,
      });
    },
  );

  app.get(
    "/api/orders/marketplaces",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const rows = await prisma.order.findMany({
        where: tenantWhere(request),
        select: { marketplace: true },
        distinct: ["marketplace"],
      });
      const values = rows
        .map((r) => r.marketplace)
        .filter((m): m is string => m != null && m !== "")
        .sort((a, b) => a.localeCompare(b));
      return {
        marketplaces: values.map((value) => ({
          value,
          label: marketplaceDisplayLabel(value),
        })),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/orders/:id",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      const detail = await getOrderDetail(
        tenantWhere(request).tenantId,
        request.params.id,
      );
      if (!detail) return reply.status(404).send({ error: "Pedido não encontrado" });
      return detail;
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      priority?: number;
      collectionDeadline?: string | null;
      marketplace?: string | null;
    };
  }>(
    "/api/orders/:id",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      const { priority, collectionDeadline, marketplace } = request.body ?? {};
      try {
        const order = await prisma.order.update({
          where: { id: request.params.id },
          data: {
            ...(priority !== undefined ? { priority } : {}),
            ...(collectionDeadline !== undefined
              ? {
                  collectionDeadline:
                    collectionDeadline === null
                      ? null
                      : new Date(collectionDeadline),
                }
              : {}),
            ...(marketplace !== undefined ? { marketplace } : {}),
          },
        });
        if (
          priority === undefined &&
          (collectionDeadline !== undefined || marketplace !== undefined)
        ) {
          await enrichOrderPriority(order.id);
        }
        const refreshed = await prisma.order.findUnique({
          where: { id: order.id },
        });
        return { order: refreshed ?? order };
      } catch {
        return reply.status(404).send({ error: "Pedido não encontrado" });
      }
    },
  );

  app.get(
    "/api/waves",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const waves = await listPickWaves(tenantWhere(request).tenantId);
      return {
        waves: waves.map((w) => ({
          id: w.id,
          name: w.name,
          status: w.status,
          releasedAt: w.releasedAt,
          releasedBy: w.releasedBy?.name ?? null,
          acceptedBy: w.acceptedBy?.name ?? null,
          acceptedAt: w.acceptedAt,
          orderCount: w._count.orders,
          lineCount: w._count.lines,
          createdAt: w.createdAt,
        })),
      };
    },
  );

  app.post<{
    Body: {
      orderIds?: string[];
      marketplace?: string;
      partitionStrategy?: string;
    };
  }>(
    "/api/waves/preview",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const body = request.body ?? {};
      const orderIds = Array.isArray(body.orderIds)
        ? body.orderIds.filter((x) => typeof x === "string")
        : undefined;
      const marketplace =
        typeof body.marketplace === "string" ? body.marketplace : undefined;
      const partitionStrategy =
        typeof body.partitionStrategy === "string"
          ? body.partitionStrategy
          : undefined;
      try {
        return await previewWaveRelease(tenantWhere(request).tenantId, {
          orderIds,
          marketplace,
          partitionStrategy: partitionStrategy as
            | "SINGLE_ITEM"
            | "PROXIMITY"
            | "BY_PRODUCT"
            | undefined,
        });
      } catch (e) {
        if (e instanceof PickWaveError) {
          return {
            orderCount: 0,
            lineCount: 0,
            gondolaPasses: 0,
            orders: [],
            lines: [],
            waves: [],
            error: e.message,
          };
        }
        throw e;
      }
    },
  );

  app.get<{ Querystring: { marketplace?: string; limit?: string } }>(
    "/api/orders/pick-proximity-groups",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const limit = Number(request.query.limit);
      const { getPickProximityGroups } = await import(
        "../services/pick-proximity-recommendations.js"
      );
      return getPickProximityGroups(tenantWhere(request).tenantId, {
        marketplace: request.query.marketplace,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
      });
    },
  );

  app.get(
    "/api/waves/settings",
    { preHandler: guard(Permission.SETTINGS_MANAGE) },
    async (request) => {
      const settings = await getWaveSettings(tenantWhere(request).tenantId);
      return { settings, meta: WAVE_SETTING_META };
    },
  );

  app.put<{ Body: Partial<WaveSettings> }>(
    "/api/waves/settings",
    { preHandler: guard(Permission.SETTINGS_MANAGE) },
    async (request, reply) => {
      try {
        const settings = await setWaveSettings(
          tenantWhere(request).tenantId,
          request.body ?? {},
          request.authUser!.id,
        );
        return { settings, meta: WAVE_SETTING_META };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao salvar configurações";
        return reply.status(400).send({ error: message });
      }
    },
  );

  app.get(
    "/api/integrations/tiny/events",
    { preHandler: guard(Permission.OLIST_CONFIGURE) },
    async (request) => {
      const events = await prisma.integrationEventLog.findMany({
        where: { ...tenantWhere(request), source: "TINY" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { events };
    },
  );

  app.post<{
    Body: {
      orderIds?: string[];
      auto?: boolean;
      appendToWaveId?: string;
      marketplace?: string;
      partitionStrategy?: string;
    };
  }>(
    "/api/waves/release",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      const userId = request.authUser!.id;
      const body = request.body ?? {};
      try {
        const result = await releasePickWave(
          tenantWhere(request).tenantId,
          userId,
          {
            orderIds: body.orderIds,
            auto: body.auto ?? true,
            appendToWaveId: body.appendToWaveId,
            marketplace:
              typeof body.marketplace === "string" ? body.marketplace : undefined,
            partitionStrategy:
              typeof body.partitionStrategy === "string"
                ? (body.partitionStrategy as
                    | "SINGLE_ITEM"
                    | "PROXIMITY"
                    | "BY_PRODUCT")
                : undefined,
          },
        );
        return result;
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.get(
    "/api/waves/open",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request) => {
      const wave = await getOpenWave(tenantWhere(request).tenantId);
      if (!wave) return { wave: null };
      return {
        wave: {
          id: wave.id,
          name: wave.name,
          releasedAt: wave.releasedAt?.toISOString() ?? null,
          orderCount: wave._count.orders,
          lineCount: wave._count.lines,
        },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/waves/:id",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      const detail = await getWaveDetail(
        tenantWhere(request).tenantId,
        request.params.id,
      );
      if (!detail) return reply.status(404).send({ error: "Onda não encontrada" });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/waves/:id/close",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      try {
        await closePickWave(request.params.id);
        return { ok: true };
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { orderIds?: string[] } }>(
    "/api/waves/:id/orders",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      const orderIds = Array.isArray(request.body?.orderIds)
        ? request.body!.orderIds.filter((x) => typeof x === "string")
        : [];
      try {
        const result = await addOrdersToWave(
          tenantWhere(request).tenantId,
          request.params.id,
          orderIds,
        );
        return { ok: true, ...result };
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.delete<{ Params: { id: string; orderId: string } }>(
    "/api/waves/:id/orders/:orderId",
    { preHandler: guard(Permission.SALES_VIEW) },
    async (request, reply) => {
      try {
        await removeOrderFromWave(
          tenantWhere(request).tenantId,
          request.params.id,
          request.params.orderId,
        );
        return { ok: true };
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  // --- Localizações (Cadastros) ---
  app.get<{
    Querystring: {
      q?: string;
      page?: string;
      pageSize?: string;
      scope?: string;
    };
  }>(
    "/api/locations/unassigned-products",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const q = request.query.q?.trim();
      const { page, pageSize } = parsePagination(request.query);
      const tenantId = tenantWhere(request).tenantId;
      const scope = request.query.scope === "catalog" ? "catalog" : "paused_orders";

      if (scope === "catalog") {
        return listProductsWithoutPickFace(tenantId, { q, page, pageSize });
      }

      return listPickFacePendingSkus(tenantId, { q, page, pageSize });
    },
  );

  app.get<{
    Querystring: {
      q?: string;
      sku?: string;
      page?: string;
      pageSize?: string;
      type?: string;
    };
  }>(
    "/api/locations",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const q = request.query.q?.trim();
      const sku = request.query.sku?.trim();
      const typeFilter =
        request.query.type === LocationType.PULMAO ||
        request.query.type === LocationType.PICK_FACE
          ? request.query.type
          : undefined;
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where: Prisma.LocationWhereInput = {
        ...tenantWhere(request),
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(sku
          ? {
              product: {
                sku: { contains: sku, mode: "insensitive" },
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { barcode: { contains: q, mode: "insensitive" } },
                { corridor: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const [locations, total] = await Promise.all([
        prisma.location.findMany({
          where,
          orderBy: [{ corridor: "asc" }, { row: "asc" }],
          skip,
          take,
          include: layoutInclude,
        }),
        prisma.location.count({ where }),
      ]);
      return {
        locations,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{
    Body: {
      corridor?: string;
      row?: string;
      barcode?: string;
      barracaoId?: string | null;
      setorId?: string | null;
      corredorId?: string | null;
      estanteId?: string | null;
      colunaId?: string | null;
      linhaId?: string | null;
      proximityCorredorId?: string | null;
      proximityEstanteId?: string | null;
      proximityLinhaId?: string | null;
      type?: LocationType;
      productId?: string;
      capacity?: number;
      minThreshold?: number;
    };
  }>(
    "/api/locations",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const b = request.body ?? {};
      if (!b.barcode || !b.type) {
        return reply.status(400).send({ error: "Campos obrigatórios faltando" });
      }
      if (b.type === LocationType.PICK_FACE && !b.productId) {
        return reply
          .status(400)
          .send({ error: "Selecione o SKU para vincular ao estoque de giro" });
      }
      try {
        const tenantId = tenantWhere(request).tenantId;
        await assertMaxPickFaceLocations(
          tenantId,
          b.productId,
          b.type,
        );
        const layout = await resolveLocationLayout(
          tenantId,
          {
            barracaoId: b.barracaoId,
            setorId: b.setorId,
            corredorId: b.corredorId,
            estanteId: b.estanteId,
            colunaId: b.colunaId,
            linhaId: b.linhaId,
            proximityCorredorId: b.proximityCorredorId,
            proximityEstanteId: b.proximityEstanteId,
            proximityLinhaId: b.proximityLinhaId,
          },
          { corridor: b.corridor, row: b.row },
        );
        const location = await prisma.location.create({
          data: {
            tenantId,
            corridor: layout.corridor,
            row: layout.row,
            barcode: b.barcode.trim().toUpperCase(),
            barracaoId: layout.barracaoId,
            setorId: layout.setorId,
            corredorId: layout.corredorId,
            estanteId: layout.estanteId,
            colunaId: layout.colunaId,
            linhaId: layout.linhaId,
            proximityCorredorId: layout.proximityCorredorId,
            proximityEstanteId: layout.proximityEstanteId,
            proximityLinhaId: layout.proximityLinhaId,
            type: b.type,
            productId: b.productId || null,
            capacity: b.capacity ?? 100,
            minThreshold: b.minThreshold ?? 0,
            currentQuantity: 0,
          },
          include: layoutInclude,
        });
        const resumedOrders =
          b.type === LocationType.PICK_FACE && b.productId
            ? await resumePausedOrdersAfterPickFace(tenantId, b.productId)
            : { resumedOrderIds: [] };
        return reply.status(201).send({ location, resumedOrders });
      } catch (e) {
        if (e instanceof LocationRuleError) {
          return reply.status(400).send({ error: e.message });
        }
        if (e instanceof Error && e.message) {
          return reply.status(400).send({ error: e.message });
        }
        return reply.status(409).send({ error: "Código de barras já existe" });
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      productId?: string | null;
      barracaoId?: string | null;
      setorId?: string | null;
      corredorId?: string | null;
      estanteId?: string | null;
      colunaId?: string | null;
      linhaId?: string | null;
      proximityCorredorId?: string | null;
      proximityEstanteId?: string | null;
      proximityLinhaId?: string | null;
      capacity?: number;
      minThreshold?: number;
      active?: boolean;
    };
  }>(
    "/api/locations/:id",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      try {
        const existing = await prisma.location.findUnique({
          where: { id: request.params.id },
        });
        if (!existing) {
          return reply.status(404).send({ error: "Localização não encontrada" });
        }
        const productId =
          request.body.productId !== undefined
            ? request.body.productId
            : existing.productId;
        const type = existing.type;
        await assertMaxPickFaceLocations(
          existing.tenantId,
          productId,
          type,
          existing.id,
        );
        const layoutFields = [
          "barracaoId",
          "setorId",
          "corredorId",
          "estanteId",
          "colunaId",
          "linhaId",
          "proximityCorredorId",
          "proximityEstanteId",
          "proximityLinhaId",
        ] as const;
        const hasLayoutChange = layoutFields.some(
          (f) => request.body[f] !== undefined,
        );
        let updateData: Prisma.LocationUncheckedUpdateInput = {
          productId: request.body.productId,
          capacity: request.body.capacity,
          minThreshold: request.body.minThreshold,
          active: request.body.active,
        };
        if (hasLayoutChange) {
          const layout = await resolveLocationLayout(
            existing.tenantId,
            {
              barracaoId:
                request.body.barracaoId !== undefined
                  ? request.body.barracaoId
                  : existing.barracaoId,
              setorId:
                request.body.setorId !== undefined
                  ? request.body.setorId
                  : existing.setorId,
              corredorId:
                request.body.corredorId !== undefined
                  ? request.body.corredorId
                  : existing.corredorId,
              estanteId:
                request.body.estanteId !== undefined
                  ? request.body.estanteId
                  : existing.estanteId,
              colunaId:
                request.body.colunaId !== undefined
                  ? request.body.colunaId
                  : existing.colunaId,
              linhaId:
                request.body.linhaId !== undefined
                  ? request.body.linhaId
                  : existing.linhaId,
              proximityCorredorId:
                request.body.proximityCorredorId !== undefined
                  ? request.body.proximityCorredorId
                  : existing.proximityCorredorId,
              proximityEstanteId:
                request.body.proximityEstanteId !== undefined
                  ? request.body.proximityEstanteId
                  : existing.proximityEstanteId,
              proximityLinhaId:
                request.body.proximityLinhaId !== undefined
                  ? request.body.proximityLinhaId
                  : existing.proximityLinhaId,
            },
            { corridor: existing.corridor, row: existing.row },
          );
          updateData = {
            ...updateData,
            corridor: layout.corridor,
            row: layout.row,
            barracaoId: layout.barracaoId,
            setorId: layout.setorId,
            corredorId: layout.corredorId,
            estanteId: layout.estanteId,
            colunaId: layout.colunaId,
            linhaId: layout.linhaId,
            proximityCorredorId: layout.proximityCorredorId,
            proximityEstanteId: layout.proximityEstanteId,
            proximityLinhaId: layout.proximityLinhaId,
          };
        }
        const location = await prisma.location.update({
          where: { id: request.params.id },
          data: updateData,
          include: layoutInclude,
        });
        const resumedOrders =
          location.type === LocationType.PICK_FACE &&
          location.productId &&
          location.active
            ? await resumePausedOrdersAfterPickFace(
                existing.tenantId,
                location.productId,
              )
            : { resumedOrderIds: [] };
        return { location, resumedOrders };
      } catch (e) {
        if (e instanceof LocationRuleError) {
          return reply.status(400).send({ error: e.message });
        }
        if (e instanceof Error && e.message) {
          return reply.status(400).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{
    Body: {
      mode?: LocationImportMode;
      rows?: Array<Record<string, unknown>>;
    };
  }>(
    "/api/locations/import",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const rows = request.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return reply.status(400).send({ error: "Envie ao menos uma linha" });
      }
      if (rows.length > 5000) {
        return reply
          .status(400)
          .send({ error: "Máximo de 5000 linhas por importação" });
      }

      const mode: LocationImportMode =
        request.body?.mode === "createOnly" ? "createOnly" : "upsert";

      const parsed: LocationImportInput[] = [];
      const errors: Array<{ row: number; barcode?: string; message: string }> =
        [];

      rows.forEach((raw, i) => {
        const { data, error } = normalizeImportRow(raw, i + 2);
        if (error) errors.push(error);
        else if (data) parsed.push(data);
      });

      if (parsed.length === 0) {
        return reply.status(400).send({
          error: "Nenhuma linha válida para importar",
          errors,
        });
      }

      const result = await importLocations(
        tenantWhere(request).tenantId,
        parsed,
        mode,
      );
      return { ...result, errors: [...errors, ...result.errors] };
    },
  );

  // --- Cestas ---
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/baskets",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const tw = tenantWhere(request);
      const [baskets, total] = await Promise.all([
        prisma.basket.findMany({
          where: tw,
          orderBy: { code: "asc" },
          skip,
          take,
          include: { _count: { select: { orders: true } } },
        }),
        prisma.basket.count({ where: tw }),
      ]);
      return {
        baskets: baskets.map((b) => ({
          ...b,
          ordersInUse: b._count.orders,
        })),
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{ Body: { code?: string; barcode?: string } }>(
    "/api/baskets",
    { preHandler: guard(Permission.REGISTERS_VIEW) },
    async (request, reply) => {
      const { code, barcode } = request.body ?? {};
      if (!code?.trim() || !barcode?.trim()) {
        return reply.status(400).send({ error: "Código e barcode obrigatórios" });
      }
      try {
        const basket = await prisma.basket.create({
          data: {
            tenantId: tenantWhere(request).tenantId,
            code: code.trim().toUpperCase(),
            barcode: barcode.trim(),
          },
        });
        return reply.status(201).send({ basket });
      } catch {
        return reply.status(409).send({ error: "Cesta já cadastrada" });
      }
    },
  );

  // --- Estoque ---
  app.get<{
    Querystring: {
      q?: string;
      lowOnly?: string;
      type?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    "/api/stock/locations",
    { preHandler: guard(Permission.STOCK_VIEW) },
    async (request) => {
      const q = request.query.q?.trim();
      const lowOnly = request.query.lowOnly === "true";
      const typeFilter =
        request.query.type === LocationType.PULMAO ||
        request.query.type === LocationType.PICK_FACE
          ? request.query.type
          : undefined;
      const { page, pageSize, skip, take } = parsePagination(request.query);

      const baseWhere: Prisma.LocationWhereInput = {
        ...tenantWhere(request),
        ...(q
          ? {
              OR: [
                { barcode: { contains: q, mode: "insensitive" } },
                { product: { sku: { contains: q, mode: "insensitive" } } },
              ],
            }
          : { active: true }),
        ...(typeFilter ? { type: typeFilter } : {}),
      };

      if (lowOnly) {
        const all = await prisma.location.findMany({
          where: baseWhere,
          include: { product: true },
          orderBy: [{ corridor: "asc" }, { row: "asc" }],
        });
        const filtered = all.filter(
          (l) => l.currentQuantity <= l.minThreshold,
        );
        const slice = filtered.slice(skip, skip + take);
        return {
          locations: slice,
          pagination: buildPaginationMeta(filtered.length, page, pageSize),
        };
      }

      const [locations, total] = await Promise.all([
        prisma.location.findMany({
          where: baseWhere,
          include: { product: true },
          orderBy: [{ corridor: "asc" }, { row: "asc" }],
          skip,
          take,
        }),
        prisma.location.count({ where: baseWhere }),
      ]);
      return {
        locations,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.get<{
    Querystring: { page?: string; pageSize?: string; type?: string };
  }>(
    "/api/stock/movements",
    { preHandler: guard(Permission.STOCK_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query, 25);
      const typeFilter =
        request.query.type === LocationType.PULMAO ||
        request.query.type === LocationType.PICK_FACE
          ? request.query.type
          : undefined;
      const where: Prisma.InventoryMovementWhereInput = {
        ...tenantWhere(request),
        ...(typeFilter
          ? {
              OR: [
                { toLocation: { type: typeFilter } },
                { fromLocation: { type: typeFilter } },
              ],
            }
          : {}),
      };
      const [movements, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take,
          include: {
            product: { select: { sku: true, name: true } },
            user: { select: { name: true } },
            fromLocation: { select: { barcode: true, type: true } },
            toLocation: { select: { barcode: true, type: true } },
            order: { select: { erpOrderId: true } },
            cargoTransfer: {
              select: {
                id: true,
                status: true,
                withdrawnAt: true,
                depositedAt: true,
                withdrawnBy: { select: { name: true } },
                depositedBy: { select: { name: true } },
              },
            },
          },
        }),
        prisma.inventoryMovement.count({ where }),
      ]);
      return {
        movements: movements.map((m) => ({
          id: m.id,
          type: m.type,
          quantity: m.quantity,
          createdAt: m.createdAt,
          reference: m.reference,
          notes: m.notes,
          product: m.product,
          userName: m.user.name,
          fromLocation: m.fromLocation,
          toLocation: m.toLocation,
          orderErpId: m.order?.erpOrderId ?? null,
          cargoTransferId: m.cargoTransferId,
          putawaySessionId: m.putawaySessionId,
          purchaseReceiptSessionId: m.purchaseReceiptSessionId,
          pickWaveLineId: m.pickWaveLineId,
          startedAt: m.startedAt,
          completedAt: m.completedAt,
          durationSeconds:
            m.startedAt && m.completedAt
              ? Math.round(
                  (m.completedAt.getTime() - m.startedAt.getTime()) / 1000,
                )
              : null,
          cargoTransfer: m.cargoTransfer
            ? {
                id: m.cargoTransfer.id,
                status: m.cargoTransfer.status,
                withdrawnByName: m.cargoTransfer.withdrawnBy.name,
                depositedByName: m.cargoTransfer.depositedBy?.name ?? null,
                withdrawnAt: m.cargoTransfer.withdrawnAt,
                depositedAt: m.cargoTransfer.depositedAt,
              }
            : null,
        })),
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  // --- Recebimentos ---
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/receipts",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where = {
        ...tenantWhere(request),
        type: InventoryMovementType.ENTRY,
      };
      const [receipts, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take,
          include: {
            product: { select: { sku: true, name: true } },
            user: { select: { name: true } },
            toLocation: { select: { barcode: true, corridor: true, row: true } },
          },
        }),
        prisma.inventoryMovement.count({ where }),
      ]);
      return {
        receipts,
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{
    Body: {
      productId?: string;
      toLocationId?: string;
      quantity?: number;
      reference?: string;
      notes?: string;
    };
  }>(
    "/api/receipts",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const { productId, toLocationId, quantity, reference, notes } =
        request.body ?? {};
      if (!productId || !toLocationId || !quantity || quantity < 1) {
        return reply.status(400).send({ error: "Produto, local e quantidade são obrigatórios" });
      }
      const loc = await prisma.location.findUnique({ where: { id: toLocationId } });
      if (!loc) return reply.status(404).send({ error: "Localização não encontrada" });

      const [movement] = await prisma.$transaction([
        prisma.inventoryMovement.create({
          data: {
            tenantId: loc.tenantId,
            type: InventoryMovementType.ENTRY,
            quantity,
            userId: request.authUser!.id,
            productId,
            toLocationId,
            reference: reference?.trim() || null,
            notes: notes?.trim() || null,
          },
          include: {
            product: { select: { sku: true, name: true } },
            toLocation: { select: { barcode: true } },
          },
        }),
        prisma.location.update({
          where: { id: toLocationId },
          data: { currentQuantity: { increment: quantity }, productId },
        }),
      ]);

      return reply.status(201).send({ receipt: movement });
    },
  );

  app.post(
    "/api/purchase-receipts/sync",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      try {
        return await syncPurchaseReceiptsFromTiny({
          tenantId: tenantWhere(request).tenantId,
          userId: request.authUser!.id,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao sincronizar";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      status?: string;
      userId?: string;
      kind?: string;
      q?: string;
      from?: string;
      to?: string;
      sort?: string;
    };
  }>(
    "/api/purchase-receipts",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request) => {
      const { page, pageSize } = parsePagination(request.query);
      const kind =
        request.query.kind === "ENTRY" || request.query.kind === "RETURN"
          ? request.query.kind
          : undefined;
      const sort =
        request.query.sort === "asc" || request.query.sort === "desc"
          ? request.query.sort
          : "desc";
      return listPurchaseReceiptsForWeb({
        tenantId: tenantWhere(request).tenantId,
        page,
        pageSize,
        status: request.query.status,
        kind,
        userId: request.query.userId,
        q: request.query.q,
        from: request.query.from,
        to: request.query.to,
        sort,
      });
    },
  );

  app.post<{ Body: { barcode?: string } }>(
    "/api/purchase-receipts/start",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código DANFE obrigatório" });
      }
      try {
        return await startPurchaseReceiptByBarcode({
          tenantId: tenantWhere(request).tenantId,
          barcode,
          userId: request.authUser!.id,
        });
      } catch (e) {
        if (isTinyConnectedError(e)) {
          return reply.status(503).send({ error: "Tiny ERP não conectado." });
        }
        const message =
          e instanceof Error ? e.message : "Erro ao iniciar recebimento";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Body: { reference?: string } }>(
    "/api/purchase-receipts/return/start",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      try {
        return await startReturnReceiptSession({
          tenantId: tenantWhere(request).tenantId,
          userId: request.authUser!.id,
          reference: request.body?.reference,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao iniciar devolução";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/purchase-receipts/:id",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      try {
        const detail = await getPurchaseReceiptDetailForWeb(
          request.params.id,
          tenantWhere(request).tenantId,
        );
        if (!detail) {
          return reply.status(404).send({ error: "Sessão não encontrada" });
        }
        return detail;
      } catch (e) {
        if (e instanceof TenantContextError) {
          return reply.status(403).send({ error: e.message });
        }
        throw e;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/purchase-receipts/:id/conference-start",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      try {
        const session = await prisma.purchaseReceiptSession.findUnique({
          where: { id: request.params.id },
          select: { tenantId: true, status: true },
        });
        if (!session) {
          return reply.status(404).send({ error: "Sessão não encontrada" });
        }
        await assertResourceTenant(
          session.tenantId,
          tenantWhere(request).tenantId,
        );
        if (
          session.status === "READY_TO_CHECK" ||
          session.status === "WAITING_ENTRY"
        ) {
          await prisma.purchaseReceiptSession.update({
            where: { id: request.params.id },
            data: { status: "IN_CHECK" },
          });
        }
        await markConferenceStarted(request.params.id, request.authUser!.id);
        return { ok: true };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao iniciar conferência";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { barcode?: string; quantity?: number };
  }>(
    "/api/purchase-receipts/:id/scan",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código do produto obrigatório" });
      }
      try {
        const session = await prisma.purchaseReceiptSession.findUnique({
          where: { id: request.params.id },
          select: { tenantId: true },
        });
        if (!session) {
          return reply.status(404).send({ error: "Sessão não encontrada" });
        }
        await assertResourceTenant(
          session.tenantId,
          tenantWhere(request).tenantId,
        );
        await scanPurchaseReceiptItem({
          sessionId: request.params.id,
          barcode,
          quantity: request.body?.quantity,
        });
        const detail = await getPurchaseReceiptDetailForWeb(
          request.params.id,
          tenantWhere(request).tenantId,
        );
        return { detail };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao registrar bip";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { itemId?: string; quantity?: number };
  }>(
    "/api/purchase-receipts/:id/confirm-item",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const { itemId, quantity } = request.body ?? {};
      if (!itemId) {
        return reply.status(400).send({ error: "itemId obrigatório" });
      }
      try {
        const session = await prisma.purchaseReceiptSession.findUnique({
          where: { id: request.params.id },
          select: { tenantId: true },
        });
        if (!session) {
          return reply.status(404).send({ error: "Sessão não encontrada" });
        }
        await assertResourceTenant(
          session.tenantId,
          tenantWhere(request).tenantId,
        );
        await confirmReceiptItem(
          request.params.id,
          itemId,
          Number(quantity ?? 1),
        );
        const detail = await getPurchaseReceiptDetailForWeb(
          request.params.id,
          tenantWhere(request).tenantId,
        );
        return { detail };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao confirmar item";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/purchase-receipts/:id/complete",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      try {
        const session = await prisma.purchaseReceiptSession.findUnique({
          where: { id: request.params.id },
          select: { tenantId: true },
        });
        if (!session) {
          return reply.status(404).send({ error: "Sessão não encontrada" });
        }
        await assertResourceTenant(
          session.tenantId,
          tenantWhere(request).tenantId,
        );
        await completePurchaseReceipt(
          request.params.id,
          request.authUser!.id,
        );
        const detail = await getPurchaseReceiptDetailForWeb(
          request.params.id,
          tenantWhere(request).tenantId,
        );
        return { detail };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar conferência";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { barcode?: string; quantity?: number };
  }>(
    "/api/purchase-receipts/return/:id/scan",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código do produto obrigatório" });
      }
      try {
        const session = await prisma.purchaseReceiptSession.findUnique({
          where: { id: request.params.id },
          select: { tenantId: true },
        });
        if (!session) {
          return reply.status(404).send({ error: "Sessão não encontrada" });
        }
        await assertResourceTenant(
          session.tenantId,
          tenantWhere(request).tenantId,
        );
        await scanReturnReceiptProduct({
          sessionId: request.params.id,
          barcode,
          quantity: request.body?.quantity,
        });
        const detail = await getPurchaseReceiptDetailForWeb(
          request.params.id,
          tenantWhere(request).tenantId,
        );
        return { detail };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao registrar bip";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { pulmaoLocationBarcode?: string };
  }>(
    "/api/purchase-receipts/return/:id/complete",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const pulmao = request.body?.pulmaoLocationBarcode?.trim();
      if (!pulmao) {
        return reply
          .status(400)
          .send({ error: "Local de pulmão (código) obrigatório" });
      }
      try {
        const session = await prisma.purchaseReceiptSession.findUnique({
          where: { id: request.params.id },
          select: { tenantId: true },
        });
        if (!session) {
          return reply.status(404).send({ error: "Sessão não encontrada" });
        }
        await assertResourceTenant(
          session.tenantId,
          tenantWhere(request).tenantId,
        );
        await completeReturnReceipt({
          sessionId: request.params.id,
          userId: request.authUser!.id,
          pulmaoLocationBarcode: pulmao,
        });
        const detail = await getPurchaseReceiptDetailForWeb(
          request.params.id,
          tenantWhere(request).tenantId,
        );
        return { detail };
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Erro ao finalizar devolução";
        return reply.status(422).send({ error: message });
      }
    },
  );

  // --- Packing (web) ---
  app.get(
    "/api/packing/orders/queue",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request) => listPackingQueue(tenantWhere(request).tenantId),
  );

  app.get(
    "/api/packing/queue/unified",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request) => listUnifiedPackingQueue(tenantWhere(request).tenantId),
  );

  app.post<{ Body: { barcode?: string } }>(
    "/api/packing/baskets/scan",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) {
        return reply.status(400).send({ error: "Código da cesta obrigatório" });
      }
      const order = await findPackingOrderByQuery(
        tenantWhere(request).tenantId,
        barcode,
      );
      if (!order) {
        return reply
          .status(404)
          .send({ error: "Nenhum pedido aguardando packing para esta cesta" });
      }
      return { order };
    },
  );

  app.get<{ Querystring: { q?: string } }>(
    "/api/packing/orders/search",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      const q = request.query.q?.trim();
      if (!q) return reply.status(400).send({ error: "Informe pedido ou cesta" });
      const order = await findPackingOrderByQuery(
        tenantWhere(request).tenantId,
        q,
      );
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado na fila de packing" });
      return { order };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/packing/orders/:id",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        return await getPackingSession(request.params.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string }; Querystring: { refresh?: string } }>(
    "/api/packing/orders/:id/shipping-labels",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        const refresh = request.query.refresh === "1" || request.query.refresh === "true";
        return await fetchShippingLabelsForOrder({
          tenantId: request.authUser!.tenantId!,
          orderId: request.params.id,
          useCache: !refresh,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>(
    "/api/packing/orders/:id/shipping-label/file",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        const refresh = request.query.refresh === "1" || request.query.refresh === "true";
        const file = await fetchShippingLabelFile({
          tenantId: request.authUser!.tenantId!,
          orderId: request.params.id,
          useCache: !refresh,
        });
        if (!file.ok) {
          return reply.status(422).send(file.result);
        }
        return reply
          .header("Content-Type", file.contentType)
          .header(
            "Content-Disposition",
            `attachment; filename="${file.filename}"`,
          )
          .send(file.content);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>(
    "/api/packing/orders/:id/shipping-label/preview",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        const refresh = request.query.refresh === "1" || request.query.refresh === "true";
        const preview = await fetchShippingLabelPreview({
          tenantId: request.authUser!.tenantId!,
          orderId: request.params.id,
          useCache: !refresh,
        });
        if (!preview.ok) {
          return reply.status(422).send(preview.result);
        }
        return reply
          .header("Content-Type", preview.contentType)
          .header("Cache-Control", "private, max-age=300")
          .send(preview.content);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/packing/orders/:id/start",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        return await startPacking(request.params.id, request.authUser!.id);
      } catch (e) {
        if (e instanceof PackingSessionError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/packing/orders/:id/cancel",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        return await cancelPacking(request.params.id, request.authUser!.id);
      } catch (e) {
        if (e instanceof PackingSessionError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { itemId?: string; quantity?: number };
  }>(
    "/api/packing/orders/:id/confirm-item",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      const { itemId, quantity } = request.body ?? {};
      if (!itemId) return reply.status(400).send({ error: "itemId obrigatório" });
      try {
        return await confirmPackingItem(
          request.params.id,
          request.authUser!.id,
          itemId,
          Number(quantity ?? 1),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { barcode?: string; quantity?: number };
  }>(
    "/api/packing/orders/:id/scan",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      const barcode = request.body?.barcode?.trim();
      if (!barcode) return reply.status(400).send({ error: "Código obrigatório" });
      try {
        return await scanPackingItem(
          request.params.id,
          request.authUser!.id,
          barcode,
          Number(request.body?.quantity ?? 1),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/packing/orders/:id/complete",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        return await completePacking(request.params.id, request.authUser!.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      itemId?: string;
      quantity?: number;
      type?: PackingIssueType;
      description?: string;
    };
  }>(
    "/api/packing/orders/:id/report-issue",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      const { itemId, quantity, type, description } = request.body ?? {};
      if (!itemId) {
        return reply.status(400).send({ error: "itemId obrigatório" });
      }
      if (!type) {
        return reply.status(400).send({ error: "type obrigatório" });
      }
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        return reply.status(400).send({ error: "Quantidade inválida" });
      }
      const payload: PackingIssuePayload = {
        itemId,
        quantity: Math.floor(qty),
        type,
        description: description?.trim() || undefined,
      };
      try {
        return await reportPackingIssue(
          request.params.id,
          request.authUser!.id,
          payload,
        );
      } catch (e) {
        if (e instanceof PackingSessionError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get(
    "/api/packing/waves/lines",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request) => listWavePackingLines(tenantWhere(request).tenantId),
  );

  app.get<{ Params: { lineId: string } }>(
    "/api/packing/waves/lines/:lineId",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        return await getWavePackingLine(request.params.lineId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { lineId: string };
    Body: { allocationId?: string; quantity?: number; basketBarcode?: string };
  }>(
    "/api/packing/waves/lines/:lineId/sort",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      try {
        return await sortWaveAllocationWeb(
          request.params.lineId,
          request.authUser!.id,
          {
            allocationId: request.body?.allocationId ?? "",
            quantity: Number(request.body?.quantity ?? 0),
            basketBarcode: request.body?.basketBarcode,
          },
        );
      } catch (e) {
        if (e instanceof PickWaveError) {
          return reply.status(e.statusCode).send({ error: e.message });
        }
        const message = e instanceof Error ? e.message : "Erro";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    "/api/shipping/queue",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request) => {
      const { page, pageSize, skip, take } = parsePagination(request.query);
      const where = {
        ...tenantWhere(request),
        status: {
          in: [
            OrderStatus.PICKED_AWAITING_CONFERENCE,
            OrderStatus.DISPATCHING,
          ],
        },
      };
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: { updatedAt: "asc" },
          skip,
          take,
          include: {
            basket: { select: { code: true } },
            assignedPicker: { select: { name: true } },
            timeLogs: {
              where: {
                event: {
                  in: [
                    OrderTimeLogEvent.DISPATCH_START,
                    OrderTimeLogEvent.DISPATCH_END,
                  ],
                },
              },
              orderBy: { createdAt: "asc" },
              select: { event: true, createdAt: true },
            },
            items: {
              include: {
                product: { select: { sku: true, name: true } },
              },
            },
          },
        }),
        prisma.order.count({ where }),
      ]);
      const { activeDispatchDurationMs, formatDuration, msToSeconds } =
        await import("../services/operation-duration.js");
      return {
        orders: orders.map(({ timeLogs, ...order }) => {
          const elapsedMs = activeDispatchDurationMs(timeLogs);
          const elapsedSec = msToSeconds(elapsedMs);
          return {
            ...order,
            dispatchElapsedSec: elapsedSec > 0 ? elapsedSec : null,
            dispatchElapsedLabel:
              elapsedSec > 0 ? formatDuration(elapsedSec) : null,
          };
        }),
        pagination: buildPaginationMeta(total, page, pageSize),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { action?: string } }>(
    "/api/shipping/:id/advance",
    { preHandler: guard(Permission.SHIPPING_VIEW) },
    async (request, reply) => {
      const order = await prisma.order.findFirst({
        where: { id: request.params.id, ...tenantWhere(request) },
      });
      if (!order) return reply.status(404).send({ error: "Pedido não encontrado" });

      let next: OrderStatus | null = null;
      if (order.status === OrderStatus.PICKED_AWAITING_CONFERENCE) {
        next = OrderStatus.DISPATCHING;
      } else if (order.status === OrderStatus.DISPATCHING) {
        next = OrderStatus.DISPATCHED;
      } else {
        return reply.status(400).send({ error: "Pedido não está na fila de expedição" });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.order.update({
          where: { id: order.id },
          data: {
            status: next,
            ...(next === OrderStatus.DISPATCHED
              ? { dispatchedAt: new Date() }
              : {}),
          },
        });
        const { recordOrderStageChange } = await import(
          "../services/order-stage-log.js"
        );
        const userId = request.authUser!.id;
        await recordOrderStageChange(tx, {
          tenantId: order.tenantId,
          orderId: order.id,
          fromStatus: order.status,
          toStatus: next,
          userId,
        });
        const {
          ensureDispatchStartLog,
          ensureDispatchEndLog,
        } = await import("../services/order-time-log-helpers.js");
        if (next === OrderStatus.DISPATCHING) {
          await ensureDispatchStartLog(tx, order.id, userId);
        }
        if (next === OrderStatus.DISPATCHED) {
          await ensureDispatchEndLog(tx, order.id, userId);
        }
        return row;
      });

      if (next === OrderStatus.DISPATCHING) {
        await notifyUsersWithPermission(Permission.SHIPPING_VIEW, {
          title: "Pedido pronto para expedir",
          body: `${order.erpOrderId} aguarda despacho.`,
          category: "SHIPPING",
          data: { orderId: order.id, erpOrderId: order.erpOrderId },
        });
      }

      if (next === OrderStatus.DISPATCHED) {
        if (order.assignedPickerId) {
          await createNotification({
            userId: order.assignedPickerId,
            title: "Pedido expedido",
            body: `${order.erpOrderId} foi marcado como expedido.`,
            category: "ORDER",
            data: { orderId: order.id, erpOrderId: order.erpOrderId },
          });
        }
      }

      return { order: updated };
    },
  );

  app.get(
    "/api/settings/public",
    { preHandler: guard(Permission.SYSTEM_VIEW) },
    async (request) => {
      const settings = await prisma.systemSetting.findMany({
        where: tenantWhere(request),
        orderBy: { key: "asc" },
      });
      return { settings };
    },
  );

  // --- Relatórios ---
  app.get<{
    Querystring: { from?: string; to?: string };
  }>(
    "/api/reports/summary",
    { preHandler: guard(Permission.REPORTS_VIEW) },
    async (request) => {
      return getReportsSummary(
        tenantWhere(request).tenantId,
        request.query.from,
        request.query.to,
      );
    },
  );

  app.get("/api/reports/types", { preHandler: guard(Permission.REPORTS_VIEW) }, async () => ({
    types: [
      {
        id: "dispatched",
        label: "Expedidos",
        description: "Pedidos despachados no período selecionado",
        requiresPeriod: true,
        acceptsMarketplaceFilter: true,
      },
      {
        id: "orders",
        label: "Pedidos",
        description: "Pedidos criados ou atualizados no período",
        requiresPeriod: true,
        acceptsMarketplaceFilter: true,
      },
      {
        id: "pickings",
        label: "Pickings",
        description: "Itens separados (movimentações de pick) por operador",
        requiresPeriod: true,
        group: "operational",
      },
      {
        id: "packings",
        label: "Packings",
        description: "Itens conferidos no packing por operador e pedido",
        requiresPeriod: true,
        group: "operational",
      },
      {
        id: "replenishments",
        label: "Ressuprimentos",
        description: "Movimentações de reabastecimento (pulmão → gôndola)",
        requiresPeriod: true,
        group: "operational",
      },
      {
        id: "order_operation_timeline",
        label: "Tempos por etapa (segundos)",
        description:
          "Separação, embalagem até o erro, correção e embalagem final — por pedido, em segundos",
        requiresPeriod: true,
        group: "operation_times",
        acceptsMarketplaceFilter: true,
      },
      {
        id: "picking_time_by_order",
        label: "Tempo de picking por pedido",
        description: "Duração de separação por pedido (onda e individual)",
        requiresPeriod: true,
        group: "operation_times",
        acceptsMarketplaceFilter: true,
      },
      {
        id: "picking_time_by_user",
        label: "Tempo de picking por operador",
        description: "Totais e médias de tempo de separação por operador",
        requiresPeriod: true,
        group: "operation_times",
      },
      {
        id: "packing_time_by_order",
        label: "Tempo de packing por pedido",
        description: "Duração de packing/sort por pedido (onda e individual)",
        requiresPeriod: true,
        group: "operation_times",
        acceptsMarketplaceFilter: true,
      },
      {
        id: "packing_time_by_user",
        label: "Tempo de packing por operador",
        description: "Totais e médias de tempo de packing por operador",
        requiresPeriod: true,
        group: "operation_times",
      },
      {
        id: "movements",
        label: "Movimentações de estoque",
        description: "Entradas, saídas, transferências e ajustes (auditoria)",
        requiresPeriod: true,
        group: "audit",
      },
      {
        id: "packing_issues",
        label: "Incidentes no packing",
        description:
          "Itens com avaria, faltantes ou separados errado detectados no packing",
        requiresPeriod: true,
        acceptsMarketplaceFilter: true,
      },
      {
        id: "volume_by_marketplace",
        label: "Volume por marketplace",
        description:
          "Pedidos, expedidos, % do total e incidentes de packing agrupados por marketplace — exporte em Excel/PDF",
        requiresPeriod: true,
        group: "operational",
      },
      {
        id: "low_stock",
        label: "Estoque crítico",
        description: "Gôndolas com quantidade abaixo do mínimo (instantâneo)",
        requiresPeriod: false,
      },
    ],
  }));

  app.get<{
    Querystring: {
      report?: string;
      from?: string;
      to?: string;
      status?: string;
      movementType?: string;
      marketplace?: string;
      format?: string;
    };
  }>(
    "/api/reports/data",
    { preHandler: guard(Permission.REPORTS_VIEW) },
    async (request, reply) => {
      const reportRaw = request.query.report;
      const report = reportRaw ? resolveReportId(reportRaw) : null;
      if (!report) {
        return reply.status(400).send({
          error: `Informe report: ${REPORT_IDS.join(", ")}`,
        });
      }

      try {
        const result = await runReport({
          tenantId: tenantWhere(request).tenantId,
          report,
          from: request.query.from,
          to: request.query.to,
          status: request.query.status,
          movementType: request.query.movementType,
          marketplace: request.query.marketplace,
        });

        if (request.query.format === "csv") {
          const csv = reportToCsv(result);
          const period =
            result.from && result.to
              ? `${result.from}_${result.to}`
              : "atual";
          reply.header("Content-Type", "text/csv; charset=utf-8");
          reply.header(
            "Content-Disposition",
            `attachment; filename="help-route-${report}-${period}.csv"`,
          );
          return reply.send(csv);
        }

        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro ao gerar relatório";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // --- Armazenagem (putaway NF → pulmão) ---
  app.get(
    "/api/putaway/queue",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request) => listPutawayQueue(tenantWhere(request).tenantId),
  );

  app.post<{ Body: { purchaseReceiptId?: string } }>(
    "/api/putaway/start",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      const purchaseReceiptId = request.body?.purchaseReceiptId?.trim();
      if (!purchaseReceiptId) {
        return reply.status(400).send({ error: "purchaseReceiptId obrigatório" });
      }
      try {
        return await startPutaway(
          purchaseReceiptId,
          request.authUser!.id,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao iniciar";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/putaway/:sessionId",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
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
  }>(
    "/api/putaway/:sessionId/store",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
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
          userId: request.authUser!.id,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao armazenar";
        return reply.status(422).send({ error: message });
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/putaway/:sessionId/complete",
    { preHandler: guard(Permission.RECEIPTS_VIEW) },
    async (request, reply) => {
      try {
        return await completePutaway(request.params.sessionId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro ao finalizar";
        return reply.status(422).send({ error: message });
      }
    },
  );
}
