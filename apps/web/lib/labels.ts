import { OrderStatus } from "@wms/shared";
import type { OrderStatus as OrderStatusType } from "@wms/shared";

export const ORDER_STATUS_LABEL: Record<OrderStatusType, string> = {
  [OrderStatus.PENDING]: "Aguardando separação",
  [OrderStatus.PICKING]: "Em separação",
  [OrderStatus.PAUSED_ISSUE]: "Pausado (problema)",
  [OrderStatus.PICKED_AWAITING_CONFERENCE]: "Aguardando conferência",
  [OrderStatus.PACKING_RETURNED_TO_PICKING]: "Retorno para separação",
  [OrderStatus.DISPATCHING]: "Pronto para expedir",
  [OrderStatus.DISPATCHED]: "Expedido",
};

export const LOCATION_TYPE_LABEL: Record<string, string> = {
  PICK_FACE: "Estoque de giro",
  PULMAO: "Pulmão",
};

export const RECEIPT_KIND_LABEL: Record<string, string> = {
  ENTRY: "NF de entrada",
  RETURN: "Devolução",
};

export const PURCHASE_RECEIPT_STATUS_LABEL: Record<string, string> = {
  WAITING_ENTRY: "Aguardando entrada",
  READY_TO_CHECK: "Pronto para conferir",
  IN_CHECK: "Em conferência",
  COMPLETED: "Conferidos",
  ISSUE: "Com problema",
  CANCELLED: "Cancelada",
};

export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  ENTRY: "Entrada",
  EXIT: "Saída",
  TRANSFER: "Transferência",
  ADJUSTMENT: "Ajuste",
  PICK_ALLOCATION: "Separação",
  REPLENISHMENT: "Reabastecimento",
};
