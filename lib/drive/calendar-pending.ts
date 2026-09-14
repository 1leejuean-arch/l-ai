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

export const DRIVE_CALENDAR_PENDING_TTL_MS =
  1000 * 60 * 60 * 24;

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

  if (
    Date.now() - pending.updatedAt >
    DRIVE_CALENDAR_PENDING_TTL_MS
  ) {
    pendingDriveCalendars.delete(sessionId);

    console.log(
      "[L-AI Memory] Expired pending cleared:",
      {
        sessionId,
        memoryKey:
          "pending_calendar_candidates",
      },
    );

    return null;
  }

  return pending;
}

export function clearPendingDriveCalendar(
  sessionId: string,
) {
  pendingDriveCalendars.delete(sessionId);
}
