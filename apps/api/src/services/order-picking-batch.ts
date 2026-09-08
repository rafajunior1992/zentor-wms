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

export type BatchAcceptError = { orderId: string; message: string };

export async function acceptOrdersBatch(
  tenantId: string,
  userId: string,
  orderIds: string[],
): Promise<{ accepted: string[]; errors: BatchAcceptError[] }> {
  const accepted: string[] = [];
  const errors: BatchAcceptError[] = [];
  const uniqueIds = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];

  for (const orderId of uniqueIds) {
    const result = await tryAcceptOneOrder(tenantId, userId, orderId);
    if (result.ok) {
      accepted.push(orderId);
    } else {
      errors.push({ orderId, message: result.message });
    }
  }

  return { accepted, errors };
}

async function tryAcceptOneOrder(
  tenantId: string,
  userId: string,
  orderId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: {
      waveOrders: { include: { wave: { select: { status: true } } } },
    },
  });
  if (!order) {
    return { ok: false, message: "Pedido não encontrado" };
  }
  if (!ACCEPTABLE_STATUSES.includes(order.status)) {
    return { ok: false, message: "Pedido não está na fila" };
  }
  const activeWaveLink = order.waveOrders.some(
    (wo) => wo.wave?.status === "RELEASED",
  );
  if (
    activeWaveLink &&
    order.status !== OrderStatus.PACKING_RETURNED_TO_PICKING &&
    order.status !== OrderStatus.PAUSED_ISSUE
  ) {
    return {
      ok: false,
      message: "Pedido está em uma onda ativa — use separação em onda",
    };
  }

  const fromStatus = order.status;

  const accepted = await prisma.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
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
    if (result.count === 0) return false;

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

    return true;
  });

  if (!accepted) {
    return { ok: false, message: "Pedido já aceito ou indisponível na fila" };
  }
  return { ok: true };
}
