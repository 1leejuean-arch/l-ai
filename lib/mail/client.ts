import "server-only";

export type MailSearchResult = {
  id: string;
  folder: string | null;
  direction: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[] | null;
  subject: string | null;
  body_text: string | null;
  preview: string | null;
  status: string | null;
  is_read: boolean | null;
  is_starred: boolean | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string | null;
};

type MailSearchResponse = {
  ok: boolean;
  query?: string;
  folder?: string | null;
  count?: number;
  emails?: MailSearchResult[];
  error?: string;
};

function getMailApiConfig() {
  const url =
    process.env.L_JMAIL_AI_API_URL?.trim();

  const apiKey =
    process.env.L_JMAIL_AI_API_KEY?.trim();

  if (!url || !apiKey) {
    return null;
  }

  return {
    url: url.replace(/\/+$/u, ""),
    apiKey,
  };
}

export async function searchLJmail(
  query: string,
  options?: {
    folder?: string;
    limit?: number;
  },
): Promise<MailSearchResult[]> {
  const config = getMailApiConfig();

  if (!config) {
    throw new Error(
      "L-JMAIL API environment variables are missing.",
    );
  }

  const response = await fetch(
    `${config.url}/mail/search`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${config.apiKey}`,
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        query,
        folder:
          options?.folder,
        limit:
          options?.limit ?? 10,
      }),
      cache: "no-store",
    },
  );

  let result: MailSearchResponse;

  try {
    result =
      (await response.json()) as MailSearchResponse;
  } catch {
    throw new Error(
      "L-JMAIL API returned invalid JSON.",
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      result.error ??
        `L-JMAIL API request failed (${response.status})`,
    );
  }

  return Array.isArray(result.emails)
    ? result.emails
    : [];
}