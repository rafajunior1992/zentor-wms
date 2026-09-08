import { OrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { recordOrderStageChange } from "./order-stage-log.js";
import {
  ensurePickingStartLog,
  ensureResumeAfterPause,
} from "./order-time-log-helpers.js";

const ACCEPTABLE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.PACKING_RETURNED_TO_PICKING,
  OrderStatus.PAUSED_ISSUE,
];

export class OrderPickingAssignmentError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "OrderPickingAssignmentError";
  }
}

export async function releaseOrderAccept(
  tenantId: string,
  orderId: string,
  userId: string,
): Promise<{ released: boolean; status: OrderStatus }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: true },
  });
  if (!order) {
    throw new OrderPickingAssignmentError("Pedido não encontrado", 404);
  }
  if (order.assignedPickerId !== userId) {
    throw new OrderPickingAssignmentError(
      "Este pedido não está atribuído a você",
      403,
    );
  }
  if (order.status !== OrderStatus.PICKING) {
    throw new OrderPickingAssignmentError(
      "Pedido não está em separação",
      409,
    );
  }
  if (order.basketId) {
    throw new OrderPickingAssignmentError(
      "Cesta já vinculada — não é possível cancelar o aceite",
      409,
    );
  }
  const hasPicked = order.items.some((i) => i.quantityPicked > 0);
  if (hasPicked) {
    throw new OrderPickingAssignmentError(
      "Separação já iniciada — não é possível cancelar o aceite",
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.PENDING,
        assignedPickerId: null,
      },
    });
    await recordOrderStageChange(tx, {
      tenantId,
      orderId,
      fromStatus: order.status,
      toStatus: OrderStatus.PENDING,
      userId,
    });
  });

  return { released: true, status: OrderStatus.PENDING };
}

export async function acceptOrderForPicking(
  tenantId: string,
  userId: string,
  orderId: string,
): Promise<{ id: string; status: OrderStatus; alreadyAccepted: boolean }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: {
      waveOrders: { include: { wave: { select: { status: true } } } },
    },
  });
  if (!order) {
    throw new OrderPickingAssignmentError("Pedido não encontrado", 404);
  }

  if (
    order.status === OrderStatus.PICKING &&
    order.assignedPickerId === userId
  ) {
    return { id: orderId, status: order.status, alreadyAccepted: true };
  }

  if (
    order.status === OrderStatus.PICKING &&
    order.assignedPickerId &&
    order.assignedPickerId !== userId
  ) {
    throw new OrderPickingAssignmentError(
      "Pedido já está em separação por outro operador",
      409,
    );
  }

  if (!ACCEPTABLE_STATUSES.includes(order.status)) {
    throw new OrderPickingAssignmentError("Pedido não está na fila", 409);
  }

  const activeWaveLink = order.waveOrders.some(
    (wo) => wo.wave?.status === "RELEASED",
  );
  if (
    activeWaveLink &&
    order.status !== OrderStatus.PACKING_RETURNED_TO_PICKING &&
    order.status !== OrderStatus.PAUSED_ISSUE
  ) {
    throw new OrderPickingAssignmentError(
      "Pedido está em uma onda ativa — use separação em onda",
      409,
    );
  }

  const fromStatus = order.status;

  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.order.updateMany({
      where: {
        id: orderId,
        tenantId,
        status: { in: ACCEPTABLE_STATUSES },
      },
      data: {
        status: OrderStatus.PICKING,
        assignedPickerId: userId,
      },
    });
    if (updateResult.count === 0) return 0;

    await recordOrderStageChange(tx, {
      tenantId,
      orderId,
      fromStatus,
      toStatus: OrderStatus.PICKING,
      userId,
    });

    if (fromStatus === OrderStatus.PAUSED_ISSUE) {
      await ensureResumeAfterPause(tx, orderId, userId);
    } else {
      await ensurePickingStartLog(tx, orderId, userId);
    }

    return updateResult.count;
  });

  if (result === 0) {
    throw new OrderPickingAssignmentError(
      "Pedido já aceito ou indisponível na fila",
      409,
    );
  }

  return { id: orderId, status: OrderStatus.PICKING, alreadyAccepted: false };
}
