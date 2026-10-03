import "server-only";

import {
  deleteMemory,
  getMemory,
  saveMemory,
} from "@/lib/memory/context";

export type MailConversationContext = {
  recentQuery: string;
};

const MAIL_CONTEXT_TTL_MS =
  1000 * 60 * 60 * 24 * 7;

const MAIL_CONTEXT_MEMORY_KEY =
  "recent_query";

function isMailConversationContext(
  value: unknown,
): value is MailConversationContext {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    typeof record.recentQuery ===
      "string" &&
    record.recentQuery.trim().length > 0
  );
}

export function saveMailContext(
  sessionId: string,
  query: string,
) {
  const recentQuery = query.trim();

  if (!recentQuery) {
    return;
  }

  saveMemory(
    sessionId,
    "mail",
    MAIL_CONTEXT_MEMORY_KEY,
    {
      recentQuery,
    },
  );
}

export async function getMailContext(
  sessionId: string,
): Promise<MailConversationContext | null> {
  const stored =
    await getMemory<unknown>(
      sessionId,
      "mail",
      MAIL_CONTEXT_MEMORY_KEY,
      MAIL_CONTEXT_TTL_MS,
    );

  if (
    !isMailConversationContext(stored)
  ) {
    return null;
  }

  return stored;
}

export async function clearMailContext(
  sessionId: string,
) {
  await deleteMemory(
    sessionId,
    "mail",
    MAIL_CONTEXT_MEMORY_KEY,
  );
}