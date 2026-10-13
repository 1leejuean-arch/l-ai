import "server-only";

import type { LocalPendingAction } from "./types";

const PENDING_TTL_MS = 30 * 60 * 1000;

type PendingEntry = {
  action: LocalPendingAction;
  expiresAt: number;
};

const globalLocalPending = globalThis as typeof globalThis & {
  lAiLocalPendingActions?: Map<string, PendingEntry>;
};

const pendingActions =
  globalLocalPending.lAiLocalPendingActions ??
  new Map<string, PendingEntry>();

globalLocalPending.lAiLocalPendingActions = pendingActions;

export function setPendingLocalAction(
  sessionId: string,
  action: LocalPendingAction,
) {
  pendingActions.set(sessionId, {
    action,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
}

export function getPendingLocalAction(sessionId: string) {
  const pending = pendingActions.get(sessionId);
  if (!pending) return null;

  if (pending.expiresAt <= Date.now()) {
    pendingActions.delete(sessionId);
    return null;
  }

  return pending.action;
}

export function clearPendingLocalAction(sessionId: string) {
  pendingActions.delete(sessionId);
}
