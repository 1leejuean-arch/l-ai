import "server-only";

import type { DriveAction, GoogleDriveFile } from "./types";

const DRIVE_REQUEST_TIMEOUT_MS = 15_000;

function getDriveUrl() {
  const webhookUrl = process.env.N8N_DRIVE_SEARCH_URL?.trim();

  if (!webhookUrl) {
    console.error("[Drive] Webhook configuration is missing.");
    throw new Error("Drive webhook is not configured");
  }

  return webhookUrl;
}

function isGoogleDriveFile(value: unknown): value is GoogleDriveFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    record.id.trim().length > 0 &&
    typeof record.name === "string" &&
    record.name.trim().length > 0
  );
}

function parseDriveFiles(value: unknown): GoogleDriveFile[] {
  if (!Array.isArray(value)) {
    console.error("[Drive] Webhook returned an invalid file list.");
    throw new Error("Drive webhook returned an invalid file list");
  }

  return value.filter(isGoogleDriveFile).map((file) => ({
    id: file.id.trim(),
    name: file.name.trim(),
    webViewLink:
      typeof file.webViewLink === "string"
        ? file.webViewLink.trim()
        : undefined,
    modifiedTime:
      typeof file.modifiedTime === "string"
        ? file.modifiedTime.trim()
        : undefined,
  }));
}

async function callDriveWebhook(
  action: DriveAction | "read",
  payload: Record<string, unknown> = {},
) {
  let response: Response;

  try {
    response = await fetch(getDriveUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        ...payload,
      }),
      signal: AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[Drive] Webhook request failed.", error);
    throw new Error("Drive webhook request failed");
  }

  if (!response.ok) {
    console.error(`[Drive] Webhook returned HTTP ${response.status}.`);
    throw new Error("Drive webhook request failed");
  }

  return response;
}

export async function searchGoogleDrive(query: string) {
  const response = await callDriveWebhook("search", {
    query,
  });

  let result: unknown;

  try {
    result = await response.json();
  } catch {
    console.error("[Drive] Search webhook returned invalid JSON.");
    throw new Error("Drive search webhook returned invalid JSON");
  }

  return parseDriveFiles(result);
}

export async function getRecentGoogleDriveFiles() {
  const response = await callDriveWebhook("recent");

  let result: unknown;

  try {
    result = await response.json();
  } catch {
    console.error("[Drive] Recent webhook returned invalid JSON.");
    throw new Error("Drive recent webhook returned invalid JSON");
  }

  return parseDriveFiles(result);
}

export async function readGoogleDriveFile(fileId: string) {
  const response = await callDriveWebhook("read", {
    fileId,
  });

  let result: unknown;

  try {
    result = await response.json();
  } catch {
    console.error("[Drive] Read webhook returned invalid JSON.");
    throw new Error("Drive read webhook returned invalid JSON");
  }

  const item = Array.isArray(result) ? result[0] : result;

  if (
    typeof item !== "object" ||
    item === null ||
    typeof (item as Record<string, unknown>).text !== "string"
  ) {
    console.error("[Drive] Read webhook returned invalid file content.");
    throw new Error("Drive read webhook returned invalid file content");
  }

  return (item as { text: string }).text.trim();
}