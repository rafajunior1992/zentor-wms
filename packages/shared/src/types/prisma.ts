/**
 * Tipagens espelhadas do schema Prisma (@wms/api/prisma/schema.prisma).
 * Mantidas manualmente para uso em web/mobile sem depender do Prisma Client.
 * Ao alterar o schema, atualize este arquivo em conjunto.
 */

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------

export const UserRole = {
  PICKER: "PICKER",
  EXPEDITER: "EXPEDITER",
  REPLENISHER: "REPLENISHER",
  ADMIN: "ADMIN",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const LocationType = {
  PICK_FACE: "PICK_FACE",
  PULMAO: "PULMAO",
} as const;
export type LocationType = (typeof LocationType)[keyof typeof LocationType];

export const OrderStatus = {
  PENDING: "PENDING",
  PICKING: "PICKING",
  PAUSED_ISSUE: "PAUSED_ISSUE",
  PICKED_AWAITING_CONFERENCE: "PICKED_AWAITING_CONFERENCE",
  PACKING_RETURNED_TO_PICKING: "PACKING_RETURNED_TO_PICKING",
  DISPATCHING: "DISPATCHING",
  DISPATCHED: "DISPATCHED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderTimeLogEvent = {
  START: "START",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  END: "END",
  PACK_START: "PACK_START",
  PACK_END: "PACK_END",
  PACK_CANCEL: "PACK_CANCEL",
  PACK_REPORT_ISSUE: "PACK_REPORT_ISSUE",
} as const;
export type OrderTimeLogEvent =
  (typeof OrderTimeLogEvent)[keyof typeof OrderTimeLogEvent];

export const InventoryMovementType = {
  ENTRY: "ENTRY",
  EXIT: "EXIT",
  TRANSFER: "TRANSFER",
  ADJUSTMENT: "ADJUSTMENT",
  PICK_ALLOCATION: "PICK_ALLOCATION",
  REPLENISHMENT: "REPLENISHMENT",
} as const;
export type InventoryMovementType =
  (typeof InventoryMovementType)[keyof typeof InventoryMovementType];

// -----------------------------------------------------------------------------
// Entidades base
// -----------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name: string;
  password: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
  requiresItemScan: boolean;
  barcode: string | null;
  supplierName?: string | null;
  erpStockQuantity?: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Location {
  id: string;
  corridor: string;
  row: string;
  barcode: string;
  type: LocationType;
  productId: string | null;
  currentQuantity: number;
  capacity: number;
  minThreshold: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Basket {
  id: string;
  code: string;
  barcode: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: string;
  erpOrderId: string;
  status: OrderStatus;
  priority: number;
  basketId: string | null;
  assignedPickerId: string | null;
  customerName: string | null;
  shippingLabel: string | null;
  notes: string | null;
  collectionDeadline: Date | null;
  marketplace: string | null;
  erpSource: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  erpSku: string | null;
  erpDescription: string | null;
  lineNumber: number;
  quantityOrdered: number;
  quantityPicked: number;
  pickLocationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryMovement {
  id: string;
  createdAt: Date;
  type: InventoryMovementType;
  quantity: number;
  userId: string;
  productId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  orderId: string | null;
  reference: string | null;
  notes: string | null;
}

export interface OrderTimeLog {
  id: string;
  orderId: string;
  userId: string;
  event: OrderTimeLogEvent;
  reason: string | null;
  createdAt: Date;
}

// -----------------------------------------------------------------------------
// DTOs públicos (sem campos sensíveis)
// -----------------------------------------------------------------------------

export type PublicUser = Omit<User, "password">;

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface OrderItemWithProduct extends OrderItem {
  product: Product | null;
}

export interface OrderDetail extends Order {
  items: OrderItemWithProduct[];
  basket: Basket | null;
  assignedPicker: PublicUser | null;
}

export interface LocationWithProduct extends Location {
  product: Product | null;
}

export interface InventoryMovementDetail extends InventoryMovement {
  product: Product;
  fromLocation: Location | null;
  toLocation: Location | null;
  user: PublicUser;
}

// -----------------------------------------------------------------------------
// Payloads de criação / atualização (API contracts)
// -----------------------------------------------------------------------------

export interface CreateProductInput {
  sku: string;
  name: string;
  requiresItemScan?: boolean;
  barcode?: string;
}

export interface CreateLocationInput {
  corridor: string;
  row: string;
  barcode: string;
  type: LocationType;
  productId?: string;
  capacity: number;
  minThreshold?: number;
  currentQuantity?: number;
}

export interface CreateBasketInput {
  code: string;
  barcode: string;
}

export interface CreateOrderInput {
  erpOrderId: string;
  priority?: number;
  customerName?: string;
  shippingLabel?: string;
  notes?: string;
  items: Array<{
    productId: string;
    lineNumber: number;
    quantityOrdered: number;
    pickLocationId?: string;
  }>;
}

export interface RecordInventoryMovementInput {
  type: InventoryMovementType;
  quantity: number;
  productId: string;
  fromLocationId?: string;
  toLocationId?: string;
  orderId?: string;
  reference?: string;
  notes?: string;
}

export interface RecordOrderTimeLogInput {
  orderId: string;
  event: OrderTimeLogEvent;
  reason?: string;
}

// -----------------------------------------------------------------------------
// Utilitários de domínio
// -----------------------------------------------------------------------------

/** Labels em português para exibição na UI */
export const OrderStatusLabel: Record<OrderStatus, string> = {
  PENDING: "Pendente",
  PICKING: "Em separação",
  PAUSED_ISSUE: "Pausado (problema)",
  PICKED_AWAITING_CONFERENCE: "Separado — aguardando conferência",
  PACKING_RETURNED_TO_PICKING: "Retorno para separação",
  DISPATCHING: "Em expedição",
  DISPATCHED: "Expedido",
};

export const UserRoleLabel: Record<UserRole, string> = {
  PICKER: "Separador",
  EXPEDITER: "Expedidor",
  REPLENISHER: "Reabastecedor",
  ADMIN: "Administrador",
};

export const LocationTypeLabel: Record<LocationType, string> = {
  PICK_FACE: "Gôndola (Pick Face)",
  PULMAO: "Pulmão",
};

/** Verifica se a localização está abaixo do limite de reabastecimento */
export function isBelowReplenishmentThreshold(location: Location): boolean {
  return location.currentQuantity <= location.minThreshold;
}

/** Verifica se o item do pedido foi totalmente separado */
export function isOrderItemFullyPicked(item: OrderItem): boolean {
  return item.quantityPicked >= item.quantityOrdered;
}

/** Status terminais que encerram o fluxo operacional */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DISPATCHED,
] as const;

/** Status em que o pedido está ativamente sendo trabalhado */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PICKING,
  OrderStatus.DISPATCHING,
] as const;
