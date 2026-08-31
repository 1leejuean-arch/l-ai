import "server-only";

const N8N_REQUEST_TIMEOUT_MS = 15_000;

export type N8nWebhookResponse = {
  success: true;
  message: string;
  received: string;
};

function isN8nWebhookResponse(value: unknown): value is N8nWebhookResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true &&
    "message" in value &&
    typeof value.message === "string" &&
    "received" in value &&
    typeof value.received === "string"
  );
}

function getWebhookUrl() {
  const webhookUrl = process.env.N8N_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    throw new Error("n8n webhook is not configured");
  }

  return webhookUrl;
}

export async function callN8nWebhook(
  message: string,
): Promise<N8nWebhookResponse> {
  const response = await fetch(getWebhookUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(N8N_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error("n8n webhook request failed");
  }

  const data: unknown = await response.json();

  if (!isN8nWebhookResponse(data)) {
    throw new Error("n8n webhook returned an invalid response");
  }

  return data;
}
