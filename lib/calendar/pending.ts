import "server-only";

import type { PendingCalendarAction } from "./types";

const CALENDAR_PENDING_TTL_MS =
  30 * 60 * 1000;

type PendingCalendarEntry = {
  action: PendingCalendarAction;
  expiresAt: number;
};

const globalCalendarStore = globalThis as typeof globalThis & {
  lAiPendingCalendarActions?: Map<string, PendingCalendarEntry>;
};

const pendingActions =
  globalCalendarStore.lAiPendingCalendarActions ??
  new Map<string, PendingCalendarEntry>();

globalCalendarStore.lAiPendingCalendarActions = pendingActions;

export function setPendingCalendarAction(
  sessionId: string,
  action: PendingCalendarAction,
) {
  pendingActions.set(sessionId, {
    action,
    expiresAt:
      Date.now() +
      CALENDAR_PENDING_TTL_MS,
  });
}

export function getPendingCalendarAction(sessionId: string) {
  const pending = pendingActions.get(sessionId);

  if (!pending) {
    return null;
  }

  if (pending.expiresAt <= Date.now()) {
    pendingActions.delete(sessionId);

    console.log(
      "[L-AI Memory] Expired pending cleared:",
      {
        sessionId,
        pendingKind:
          pending.action.kind,
      },
    );

    return null;
  }

  return pending.action;
}

export function takePendingCalendarAction(sessionId: string) {
  const action = getPendingCalendarAction(sessionId);
  pendingActions.delete(sessionId);
  return action;
}

export function clearPendingCalendarAction(sessionId: string) {
  pendingActions.delete(sessionId);
}
