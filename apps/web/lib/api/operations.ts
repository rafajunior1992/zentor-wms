import { apiFetch } from "@/lib/api/client";
import type { PaginationMeta } from "@/lib/pagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export interface BoardIssueDetail {
  source: "PACKING" | "PAUSE";
  typeLabel: string;
  sku: string;
  productName: string | null;
  quantity: number;
  description: string | null;
  summary: string;
}

export interface OrderRow {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: string;
  priority: number;
  collectionDeadline: string | null;
  marketplace: string | null;
  pickerName: string | null;
  basketCode: string | null;
  itemCount: number;
  qtyOrdered: number;
  qtyPicked: number;
  hasShippingLabel?: boolean;
  issueSummary?: string | null;
  issueDetail?: BoardIssueDetail | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseRef {
  id: string;
  code: string;
  name: string | null;
}

export interface LocationRow {
  id: string;
  corridor: string;
  row: string;
  barcode: string;
  barracaoId: string | null;
  setorId: string | null;
  corredorId: string | null;
  estanteId: string | null;
  colunaId: string | null;
  linhaId: string | null;
  barracao: WarehouseRef | null;
  setor: WarehouseRef | null;
  corredor: WarehouseRef | null;
  estante: WarehouseRef | null;
  coluna: WarehouseRef | null;
  linha: WarehouseRef | null;
  type: string;
  productId: string | null;
  product: { sku: string; name: string } | null;
  currentQuantity: number;
  capacity: number;
  minThreshold: number;
  active: boolean;
}

export function fetchOrders(params?: {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  notInWave?: boolean;
  marketplace?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.notInWave) sp.set("notInWave", "true");
  if (params?.marketplace) sp.set("marketplace", params.marketplace);
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ orders: OrderRow[]; pagination: PaginationMeta }>(
    `/api/orders?${sp}`,
  );
}

export function fetchPendingOrdersForWave(params?: {
  q?: string;
  pageSize?: number;
  notInWave?: boolean;
  marketplace?: string;
}) {
  return fetchOrders({
    status: "PENDING",
    q: params?.q,
    pageSize: params?.pageSize ?? 200,
    notInWave: params?.notInWave ?? true,
    marketplace: params?.marketplace,
  });
}

export function fetchAvailableMarketplaces() {
  return apiFetch<{
    marketplaces: Array<{ value: string; label: string }>;
  }>("/api/orders/marketplaces");
}

export interface PickProximityGroup {
  id: string;
  orderIds: string[];
  orders: Array<{ id: string; erpOrderId: string; marketplace: string | null }>;
  routeHint: string;
  proximityScore: number;
}

export function fetchPickProximityGroups(params?: {
  marketplace?: string;
  limit?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.marketplace) sp.set("marketplace", params.marketplace);
  if (params?.limit) sp.set("limit", String(params.limit));
  const q = sp.toString();
  return apiFetch<{ groups: PickProximityGroup[] }>(
    `/api/orders/pick-proximity-groups${q ? `?${q}` : ""}`,
  );
}

export type BoardKind = "all" | "order" | "wave";

export type BoardOrderEntry = OrderRow & { kind: "order" };

export interface BoardWaveEntry {
  kind: "wave";
  id: string;
  name: string;
  status: string;
  orderCount: number;
  lineCount: number;
  qtyPicked: number;
  qtyTotal: number;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BoardEntry = BoardOrderEntry | BoardWaveEntry;

export interface BoardCounts {
  pending: number;
  picking: number;
  paused: number;
  separated: number;
  dispatching: number;
  waves: number;
  all: number;
}

export function fetchOrdersBoard(params?: {
  kind?: BoardKind;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  marketplace?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.kind) sp.set("kind", params.kind);
  if (params?.status) sp.set("status", params.status);
  if (params?.q) sp.set("q", params.q);
  if (params?.marketplace) sp.set("marketplace", params.marketplace);
  if (params?.page) sp.set("page", String(params.page));
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    entries: BoardEntry[];
    pagination: PaginationMeta;
    counts: BoardCounts;
  }>(`/api/orders/board?${sp}`);
}

export interface OrderDetail {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  status: string;
  priority: number;
  collectionDeadline: string | null;
  marketplace: string | null;
  pickerName: string | null;
  basketCode: string | null;
  updatedAt: string;
  items: Array<{
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    product: { sku: string; name: string };
  }>;
}

export function fetchOrderDetail(id: string) {
  return apiFetch<OrderDetail>(`/api/orders/${id}`);
}

export function fetchLocations(params?: {
  q?: string;
  sku?: string;
  page?: number;
  pageSize?: number;
  type?: "PULMAO" | "PICK_FACE";
}) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.sku) sp.set("sku", params.sku);
  if (params?.type) sp.set("type", params.type);
  if (params?.page) sp.set("page", String(params.page));
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ locations: LocationRow[]; pagination: PaginationMeta }>(
    `/api/locations?${sp}`,
  );
}

export interface UnassignedPickFaceProduct {
  id: string | null;
  sku: string;
  name: string | null;
  reason?: "no_pick_face" | "missing_product";
  assignable?: boolean;
  pausedOrderCount?: number;
}

export function fetchUnassignedPickFaceProducts(params?: {
  q?: string;
  page?: number;
  pageSize?: number;
  scope?: "paused_orders" | "catalog";
}) {
  const sp = new URLSearchParams();
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.page) sp.set("page", String(params.page));
  sp.set("pageSize", String(params?.pageSize ?? 100));
  sp.set("scope", params?.scope ?? "paused_orders");
  return apiFetch<{
    products: UnassignedPickFaceProduct[];
    total: number;
    pagination: PaginationMeta;
  }>(`/api/locations/unassigned-products?${sp}`);
}

export function fetchBaskets(page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    baskets: Array<{
      id: string;
      code: string;
      barcode: string;
      active: boolean;
      ordersInUse: number;
    }>;
    pagination: PaginationMeta;
  }>(`/api/baskets?${sp}`);
}

export function fetchStockLocations(
  q?: string,
  lowOnly?: boolean,
  page?: number,
  pageSize?: number,
  type?: "PULMAO" | "PICK_FACE",
) {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (lowOnly) sp.set("lowOnly", "true");
  if (type) sp.set("type", type);
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{ locations: LocationRow[]; pagination: PaginationMeta }>(
    `/api/stock/locations?${sp}`,
  );
}

export function fetchMovements(
  page?: number,
  pageSize?: number,
  locationType?: "PULMAO" | "PICK_FACE",
) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  if (locationType) sp.set("type", locationType);
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    movements: Array<{
      id: string;
      type: string;
      quantity: number;
      createdAt: string;
      reference: string | null;
      notes: string | null;
      product: { sku: string; name: string };
      userName: string;
      fromLocation: { barcode: string; type?: string } | null;
      toLocation: { barcode: string; type?: string } | null;
      orderErpId: string | null;
      purchaseReceiptSessionId: string | null;
      putawaySessionId: string | null;
      pickWaveLineId: string | null;
      cargoTransferId: string | null;
      startedAt: string | null;
      completedAt: string | null;
      durationSeconds: number | null;
      cargoTransfer: {
        id: string;
        status: string;
        withdrawnByName: string;
        depositedByName: string | null;
      } | null;
    }>;
    pagination: PaginationMeta;
  }>(`/api/stock/movements?${sp}`);
}

export type PurchaseReceiptListSession = {
  id: string;
  kind: string;
  reference: string | null;
  tinyNotaId: number | null;
  accessKey: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  status: string;
  tinySyncStatus: string | null;
  operatorName: string;
  startedAt: string;
  conferenceStartedAt: string | null;
  conferenceEndedAt: string | null;
  completedAt: string | null;
  receiptDurationMs: number | null;
  conferenceDurationMs: number | null;
  itemCount: number;
  itemsChecked: number;
  putaway: {
    status: string;
    operatorName: string | null;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  } | null;
};

export type PurchaseReceiptItemDetail = {
  id: string;
  lineNumber: number;
  description: string | null;
  barcode: string | null;
  supplierSku: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantityExpected: number;
  quantityChecked: number;
  completed: boolean;
  suggestedLocation: string | null;
  putawayLocation: string | null;
};

export type PurchaseReceiptDetail = {
  id: string;
  kind: string;
  reference: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  accessKey: string | null;
  tinyNotaId: number | null;
  status: string;
  tinySyncStatus: string | null;
  tinySyncMessage: string | null;
  operatorName: string;
  startedAt: string;
  conferenceStartedAt: string | null;
  conferenceEndedAt: string | null;
  completedAt: string | null;
  items: PurchaseReceiptItemDetail[];
  nextItem: {
    id: string;
    lineNumber: number;
    description: string | null;
    supplierSku: string | null;
    barcode: string | null;
    quantityExpected: number;
    quantityChecked: number;
    remaining: number;
  } | null;
  allChecked: boolean;
  timeLogs: Array<{ event: string; at: string; userName: string }>;
  putaway: {
    id: string;
    status: string;
    operatorName: string | null;
    startedAt: string | null;
    completedAt: string | null;
    items: Array<{
      id: string;
      productCode: string | null;
      description: string | null;
      quantityExpected: number;
      quantityStored: number;
      locationBarcode: string | null;
    }>;
  } | null;
};

export function syncPurchaseReceipts() {
  return apiFetch<{
    created: number;
    skipped: number;
    tinyConnected: boolean;
    warning?: string;
  }>("/api/purchase-receipts/sync", { method: "POST", body: "{}" });
}

export type SyncTinySalesOrdersResult = {
  created: number;
  updated: number;
  skipped: number;
  listedFromTiny: number;
  ordersRemoved: number;
  wavesRemoved: number;
  demoRemoved: number;
  cancelledRemoved: number;
  errors: Array<{ erpOrderId: string; message: string }>;
  tinyConnected: boolean;
  resumed?: boolean;
  rateLimited?: boolean;
  warning?: string;
};

export function syncTinySalesOrders(params?: {
  days?: number;
  connectionId?: string;
  forceRestart?: boolean;
}) {
  return apiFetch<SyncTinySalesOrdersResult>(
    "/api/integrations/tiny/sync-orders",
    {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    },
  );
}

export type SyncTinyProductsResult = {
  created: number;
  updated: number;
  skipped: number;
  skippedExisting: number;
  listedFromTiny: number;
  errors: Array<{ sku: string; message: string }>;
  tinyConnected: boolean;
  resumed: boolean;
  rateLimited?: boolean;
  fromOffset: number;
  warning?: string;
};

export type TinySyncJobStatus = {
  kind: "products" | "orders";
  running: boolean;
  resumable: boolean;
  stale: boolean;
  pauseReason: "rate_limit" | "interrupted" | null;
  progressPercent: number | null;
  progressLabel: string;
  startedAt: string | null;
  updatedAt: string | null;
  lastSyncAt: string | null;
  offset: number | null;
  total: number | null;
  stats: {
    created?: number;
    updated?: number;
    skipped?: number;
    skippedExisting?: number;
    listedFromTiny?: number;
    cancelledRemoved?: number;
  } | null;
  phase?: "syncable" | "cancelled";
  situacaoIndex?: number;
  situacaoLabel?: string;
  days?: number;
};

export type TinySyncStatusResponse = {
  products: TinySyncJobStatus;
  orders: TinySyncJobStatus;
};

export function fetchTinySyncStatus(connectionId?: string) {
  const query = connectionId
    ? `?connectionId=${encodeURIComponent(connectionId)}`
    : "";
  return apiFetch<TinySyncStatusResponse>(
    `/api/integrations/tiny/sync-status${query}`,
  );
}

export function syncTinyProducts(params?: {
  connectionId?: string;
  forceRestart?: boolean;
  refreshExisting?: boolean;
}) {
  return apiFetch<SyncTinyProductsResult>(
    "/api/integrations/tiny/sync-products",
    {
      method: "POST",
      body: JSON.stringify(params ?? {}),
    },
  );
}

export function fetchPurchaseReceipts(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  kind?: "ENTRY" | "RETURN";
  q?: string;
  from?: string;
  to?: string;
  sort?: "asc" | "desc";
}) {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.status) sp.set("status", params.status);
  if (params?.kind) sp.set("kind", params.kind);
  if (params?.q) sp.set("q", params.q);
  if (params?.from) sp.set("from", params.from);
  if (params?.to) sp.set("to", params.to);
  if (params?.sort) sp.set("sort", params.sort);
  sp.set("pageSize", String(params?.pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    sessions: PurchaseReceiptListSession[];
    pagination: PaginationMeta;
    statusCounts: Record<string, number>;
  }>(`/api/purchase-receipts?${sp}`);
}

export function fetchPurchaseReceiptDetail(id: string) {
  return apiFetch<PurchaseReceiptDetail>(`/api/purchase-receipts/${id}`);
}

export function startPurchaseReceipt(barcode: string) {
  return apiFetch<{ session: { id: string } }>("/api/purchase-receipts/start", {
    method: "POST",
    body: JSON.stringify({ barcode }),
  });
}

export function startReturnReceipt(reference?: string) {
  return apiFetch<{ session: { id: string } }>(
    "/api/purchase-receipts/return/start",
    {
      method: "POST",
      body: JSON.stringify({ reference }),
    },
  );
}

export function markPurchaseReceiptConferenceStart(id: string) {
  return apiFetch<{ ok: boolean }>(
    `/api/purchase-receipts/${id}/conference-start`,
    { method: "POST", body: "{}" },
  );
}

export function scanPurchaseReceiptItem(
  id: string,
  barcode: string,
  quantity?: number,
) {
  return apiFetch<{ detail: PurchaseReceiptDetail }>(
    `/api/purchase-receipts/${id}/scan`,
    {
      method: "POST",
      body: JSON.stringify({ barcode, quantity }),
    },
  );
}

export function confirmPurchaseReceiptItem(
  id: string,
  itemId: string,
  quantity?: number,
) {
  return apiFetch<{ detail: PurchaseReceiptDetail }>(
    `/api/purchase-receipts/${id}/confirm-item`,
    {
      method: "POST",
      body: JSON.stringify({ itemId, quantity }),
    },
  );
}

export function completePurchaseReceipt(id: string) {
  return apiFetch<{ detail: PurchaseReceiptDetail }>(
    `/api/purchase-receipts/${id}/complete`,
    { method: "POST", body: "{}" },
  );
}

export function scanReturnReceiptItem(
  id: string,
  barcode: string,
  quantity?: number,
) {
  return apiFetch<{ detail: PurchaseReceiptDetail }>(
    `/api/purchase-receipts/return/${id}/scan`,
    {
      method: "POST",
      body: JSON.stringify({ barcode, quantity }),
    },
  );
}

export function completeReturnReceipt(id: string, pulmaoLocationBarcode: string) {
  return apiFetch<{ detail: PurchaseReceiptDetail }>(
    `/api/purchase-receipts/return/${id}/complete`,
    {
      method: "POST",
      body: JSON.stringify({ pulmaoLocationBarcode }),
    },
  );
}

export function fetchReceipts(page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    receipts: Array<{
      id: string;
      quantity: number;
      createdAt: string;
      reference: string | null;
      notes: string | null;
      product: { sku: string; name: string };
      user: { name: string };
      toLocation: { barcode: string; corridor: string; row: string };
    }>;
    pagination: PaginationMeta;
  }>(`/api/receipts?${sp}`);
}

export type PickSegmentDto = {
  locationId: string;
  barcode: string;
  corridor: string;
  row: string;
  quantity: number;
  label: string;
};

export interface PackingOrder {
  id: string;
  erpOrderId: string;
  customerName: string | null;
  shippingLabel?: string | null;
  marketplace?: string | null;
  status: string;
  priority?: number;
  collectionDeadline?: string | null;
  packingUrgency?: number;
  routeLabel?: string | null;
  basket: { id: string; code: string; barcode: string } | null;
  assignedPicker: { name: string } | null;
  allPacked: boolean;
  packingInProgress?: boolean;
  packingOperatorName?: string | null;
  items: Array<{
    id: string;
    lineNumber: number;
    quantityOrdered: number;
    quantityPicked: number;
    quantityPacked: number;
    remaining: number;
    pickSegments?: PickSegmentDto[];
    multiGondolaHint?: string | null;
    product: {
      id: string;
      sku: string;
      name: string;
      barcode: string | null;
      imageUrl?: string | null;
      unit?: string | null;
      weight?: string | number | null;
    };
  }>;
}

export type PackingWaveLineSummary = {
  id: string;
  waveId: string;
  waveName: string;
  waveReleasedAt?: string | null;
  waveUrgency?: number;
  collectionDeadline?: string | null;
  sku: string;
  productName: string;
  locationBarcode: string;
  routeLabel?: string;
  quantityPicked: number;
  quantityTotal: number;
  sortStatus: string;
};

export type ReplenishmentNeedSummary = {
  id: string;
  pickFaceId: string;
  pickFaceBarcode: string;
  routeLabel: string;
  productId: string;
  sku: string;
  productName: string;
  currentQuantity: number;
  minThreshold: number;
  capacity: number;
  deficit: number;
  suggestedPulmao: {
    id: string;
    barcode: string;
    label: string;
    currentQuantity: number;
  } | null;
};

export type PackingQueueItem =
  | { kind: "wave_line"; sortKey: number; line: PackingWaveLineSummary }
  | { kind: "order"; sortKey: number; order: PackingOrder }
  | { kind: "replenishment"; sortKey: number; need: ReplenishmentNeedSummary };

export function scanPackingBasket(barcode: string) {
  return apiFetch<{ order: PackingOrder }>("/api/packing/baskets/scan", {
    method: "POST",
    body: JSON.stringify({ barcode }),
  });
}

export function fetchPackingQueue() {
  return apiFetch<{ orders: PackingOrder[] }>("/api/packing/orders/queue");
}

export function fetchUnifiedPackingQueue() {
  return apiFetch<{ items: PackingQueueItem[] }>("/api/packing/queue/unified");
}

export function searchPackingOrder(q: string) {
  return apiFetch<{ order: PackingOrder }>(
    `/api/packing/orders/search?q=${encodeURIComponent(q)}`,
  );
}

export function fetchPackingSession(orderId: string) {
  return apiFetch<PackingOrder>(`/api/packing/orders/${orderId}`);
}

export function confirmPackingItem(
  orderId: string,
  itemId: string,
  quantity: number,
) {
  return apiFetch<PackingOrder>(`/api/packing/orders/${orderId}/confirm-item`, {
    method: "POST",
    body: JSON.stringify({ itemId, quantity }),
  });
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

export function reportPackingIssue(
  orderId: string,
  payload: PackingIssuePayload,
) {
  return apiFetch<{
    orderId: string;
    status: string;
    reported: boolean;
    summary: string;
  }>(`/api/packing/orders/${orderId}/report-issue`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchWavePackingLines() {
  return apiFetch<{
    lines: Array<{
      id: string;
      waveId: string;
      waveName: string;
      sku: string;
      productName: string;
      locationBarcode: string;
      quantityPicked: number;
      quantityTotal: number;
      sortStatus: string;
    }>;
  }>("/api/packing/waves/lines");
}

export function fetchWavePackingLine(lineId: string) {
  return apiFetch<{
    collectionDeadline: string | null;
    line: {
      id: string;
      waveId: string;
      waveName: string;
      product: { sku: string; name: string };
      quantityPicked: number;
      quantityTotal: number;
      sortStatus: string;
      allocations: Array<{
        id: string;
        quantity: number;
        quantitySorted: number;
        remaining: number;
        order: {
          id: string;
          erpOrderId: string;
          priority: number;
          basketCode: string | null;
          basketId: string | null;
        };
      }>;
    };
  }>(`/api/packing/waves/lines/${lineId}`);
}

export function fetchShippingQueue(page?: number, pageSize?: number) {
  const sp = new URLSearchParams();
  if (page) sp.set("page", String(page));
  sp.set("pageSize", String(pageSize ?? DEFAULT_PAGE_SIZE));
  return apiFetch<{
    orders: Array<{
      id: string;
      erpOrderId: string;
      customerName: string | null;
      status: string;
      basket: { code: string } | null;
      assignedPicker: { name: string } | null;
      items: Array<{
        lineNumber: number;
        quantityOrdered: number;
        quantityPicked: number;
        product: { sku: string; name: string };
      }>;
      updatedAt: string;
      dispatchElapsedSec?: number | null;
      dispatchElapsedLabel?: string | null;
    }>;
    pagination: PaginationMeta;
  }>(`/api/shipping/queue?${sp}`);
}

export {
  defaultReportPeriod,
  fetchReportData,
  fetchReportTypes,
} from "@/lib/api/reports";
export type { ReportId, ReportResult, ReportTypeMeta } from "@/lib/api/reports";
