import "server-only";

import type {
  CalendarAction,
  CalendarActionData,
  CalendarDeleteData,
  CalendarEvent,
  CalendarRange,
  CalendarUpdateData,
  GoogleCalendarEvent,
  GoogleCalendarEventTime,
} from "./types";

const CALENDAR_REQUEST_TIMEOUT_MS = 15_000;

function getCalendarUrl() {
  const webhookUrl = process.env.N8N_CALENDAR_URL?.trim();

  if (!webhookUrl) {
    console.error("[Calendar] Webhook configuration is missing.");
    throw new Error("Calendar webhook is not configured");
  }

  return webhookUrl;
}

function isCalendarEventTime(value: unknown): value is GoogleCalendarEventTime {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    (typeof record.dateTime === "string" && record.dateTime.length > 0) ||
    (typeof record.date === "string" && record.date.length > 0)
  );
}

function isGoogleCalendarEvent(value: unknown): value is GoogleCalendarEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    (record.id === undefined || typeof record.id === "string") &&
    (record.summary === undefined || typeof record.summary === "string") &&
    isCalendarEventTime(record.start) &&
    isCalendarEventTime(record.end)
  );
}

function parseCalendarGetResponse(value: unknown) {
  if (!Array.isArray(value)) {
    console.error("[Calendar] Webhook returned an invalid event list.");
    throw new Error("Calendar webhook returned an invalid event list");
  }

  return value.filter(isGoogleCalendarEvent);
}

async function sendCalendarRequest<A extends CalendarAction>(
  action: A,
  data: CalendarActionData[A],
) {
  let response: Response;

  try {
    response = await fetch(getCalendarUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data }),
      signal: AbortSignal.timeout(CALENDAR_REQUEST_TIMEOUT_MS),
    });
  } catch {
    console.error("[Calendar] Webhook request failed.");
    throw new Error("Calendar webhook request failed");
  }

  if (!response.ok) {
    console.error(`[Calendar] Webhook returned HTTP ${response.status}.`);
    throw new Error("Calendar webhook request failed");
  }

  return response;
}

export async function callCalendarN8n(
  action: "calendar_create",
  data: CalendarEvent,
): Promise<void>;
export async function callCalendarN8n(
  action: "calendar_get",
  data: CalendarRange,
): Promise<GoogleCalendarEvent[]>;
export async function callCalendarN8n(
  action: "calendar_update",
  data: CalendarUpdateData,
): Promise<void>;
export async function callCalendarN8n(
  action: "calendar_delete",
  data: CalendarDeleteData,
): Promise<void>;
export async function callCalendarN8n(
  action: CalendarAction,
  data: CalendarEvent | CalendarRange | CalendarUpdateData | CalendarDeleteData,
): Promise<void | GoogleCalendarEvent[]> {
  const response = await sendCalendarRequest(action, data);

  if (action !== "calendar_get") {
    return;
  }

  const raw = await response.text();

  if (!raw.trim()) {
    return [];
  }

  let result: unknown;

  try {
    result = JSON.parse(raw);
  } catch {
    console.error("[Calendar] Webhook returned invalid JSON.");
    throw new Error("Calendar webhook returned invalid JSON");
  }

  return parseCalendarGetResponse(result);
}
