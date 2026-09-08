import "server-only";

import type { DriveCalendarCandidate } from "./calendar-extract";

type PendingDriveCalendar = {
  fileId: string;
  fileName: string;
  webViewLink?: string;
  events: DriveCalendarCandidate[];
  updatedAt: number;
};

const pendingDriveCalendars =
  new Map<string, PendingDriveCalendar>();

const TTL_MS = 1000 * 60 * 30;

export function setPendingDriveCalendar(
  sessionId: string,
  data: Omit<PendingDriveCalendar, "updatedAt">,
) {
  pendingDriveCalendars.set(sessionId, {
    ...data,
    updatedAt: Date.now(),
  });
}

export function getPendingDriveCalendar(
  sessionId: string,
): PendingDriveCalendar | null {
  const pending = pendingDriveCalendars.get(sessionId);

  if (!pending) {
    return null;
  }

  if (Date.now() - pending.updatedAt > TTL_MS) {
    pendingDriveCalendars.delete(sessionId);
    return null;
  }

  return pending;
}

export function clearPendingDriveCalendar(
  sessionId: string,
) {
  pendingDriveCalendars.delete(sessionId);
}