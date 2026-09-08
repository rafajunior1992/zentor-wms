import { OrderTimeLogEvent } from "@prisma/client";

const PICK_ACTIVE = new Set<string>([
  OrderTimeLogEvent.START,
  OrderTimeLogEvent.RESUME,
]);
const PICK_PAUSE = new Set<string>([
  OrderTimeLogEvent.PAUSE,
  OrderTimeLogEvent.END,
]);
const PACK_ACTIVE = new Set<string>([OrderTimeLogEvent.PACK_START]);
const PACK_PAUSE = new Set<string>([
  OrderTimeLogEvent.PACK_END,
  OrderTimeLogEvent.PACK_CANCEL,
]);
const DISPATCH_ACTIVE = new Set<string>([OrderTimeLogEvent.DISPATCH_START]);
const DISPATCH_PAUSE = new Set<string>([OrderTimeLogEvent.DISPATCH_END]);

function durationFromLogs(
  logs: { event: string; createdAt: Date }[],
  activeEvents: Set<string>,
  pauseEvents: Set<string>,
): number {
  const sorted = [...logs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  let totalMs = 0;
  let segmentStart: Date | null = null;

  for (const log of sorted) {
    if (activeEvents.has(log.event) && segmentStart === null) {
      segmentStart = log.createdAt;
    } else if (pauseEvents.has(log.event) && segmentStart !== null) {
      totalMs += log.createdAt.getTime() - segmentStart.getTime();
      segmentStart = null;
    }
  }

  if (segmentStart !== null && activeEvents.has(OrderTimeLogEvent.DISPATCH_START)) {
    totalMs += Date.now() - segmentStart.getTime();
  }

  return totalMs;
}

/** Duração ativa de picking (START/RESUME → PAUSE/END) em ms. */
export function activePickingDurationMs(
  logs: { event: string; createdAt: Date }[],
): number {
  return durationFromLogs(logs, PICK_ACTIVE, PICK_PAUSE);
}

/** Duração ativa de packing individual (PACK_START → PACK_END) em ms. */
export function activePackingDurationMs(
  logs: { event: string; createdAt: Date }[],
): number {
  return durationFromLogs(logs, PACK_ACTIVE, PACK_PAUSE);
}

/** Duração de expedição (DISPATCH_START → DISPATCH_END), incluindo em andamento. */
export function activeDispatchDurationMs(
  logs: { event: string; createdAt: Date }[],
): number {
  return durationFromLogs(logs, DISPATCH_ACTIVE, DISPATCH_PAUSE);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}
