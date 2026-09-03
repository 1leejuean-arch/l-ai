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
  action: DriveAction,
  query?: string,
): Promise<GoogleDriveFile[]> {
  let response: Response;

  const body =
    action === "search"
      ? {
          action: "search",
          query: query?.trim() ?? "",
        }
      : {
          action: "recent",
        };

  try {
    response = await fetch(getDriveUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DRIVE_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[Drive] Webhook request failed.", error);
    console.error("[Drive] Target URL:", getDriveUrl());
    throw new Error("Drive webhook request failed");
  }

  if (!response.ok) {
    console.error(`[Drive] Webhook returned HTTP ${response.status}.`);
    throw new Error("Drive webhook request failed");
  }

  const raw = await response.text();

  if (!raw.trim()) {
    return [];
  }

  let result: unknown;

  try {
    result = JSON.parse(raw);
  } catch {
    console.error("[Drive] Webhook returned invalid JSON.");
    throw new Error("Drive webhook returned invalid JSON");
  }

  return parseDriveFiles(result);
}

export async function searchGoogleDrive(
  query: string,
): Promise<GoogleDriveFile[]> {
  return callDriveWebhook("search", query);
}

export async function getRecentGoogleDriveFiles(): Promise<
  GoogleDriveFile[]
> {
  return callDriveWebhook("recent");
}