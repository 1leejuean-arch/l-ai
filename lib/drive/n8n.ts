import "server-only";

import type { GoogleDriveFile } from "./types";

const DRIVE_SEARCH_TIMEOUT_MS = 15_000;

function getDriveSearchUrl() {
  const webhookUrl = process.env.N8N_DRIVE_SEARCH_URL?.trim();

  if (!webhookUrl) {
    console.error("[Drive] Webhook configuration is missing.");
    throw new Error("Drive search webhook is not configured");
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

export async function searchGoogleDrive(query: string) {
  let response: Response;

  try {
    response = await fetch(getDriveSearchUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(DRIVE_SEARCH_TIMEOUT_MS),
    });
  } catch {
    console.error("[Drive] Webhook request failed.");
    throw new Error("Drive search webhook request failed");
  }

  if (!response.ok) {
    console.error(`[Drive] Webhook returned HTTP ${response.status}.`);
    throw new Error("Drive search webhook request failed");
  }

  let result: unknown;

  try {
    result = await response.json();
  } catch {
    console.error("[Drive] Webhook returned invalid JSON.");
    throw new Error("Drive search webhook returned invalid JSON");
  }

  if (!Array.isArray(result)) {
    console.error("[Drive] Webhook returned an invalid file list.");
    throw new Error("Drive search webhook returned an invalid file list");
  }

  return result
    .filter(isGoogleDriveFile)
    .map((file) => ({ id: file.id.trim(), name: file.name.trim() }));
}
