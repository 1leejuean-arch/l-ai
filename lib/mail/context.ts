import "server-only";

import {
  deleteMemory,
  getMemory,
  saveMemory,
} from "@/lib/memory/context";

import type { MailSearchResult } from "./client";

export type MailContextItem = {
  id: string;
  subject: string | null;
  sender: string | null;
  senderName: string | null;
  date: string | null;
  preview: string | null;
  body: string | null;
};

export type MailDraft = {
  kind: "new" | "reply" | "forward";
  to: string | null;
  subject: string;
  body: string;
  sourceLabel: string;
  createdAt: number;
};

export type MailConversationContext = {
  recentQuery: string;
  results: MailContextItem[];
  selectedMail: MailContextItem | null;
  selectionPending: boolean;
  draft: MailDraft | null;
};

const MAIL_CONTEXT_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAIL_CONTEXT_MEMORY_KEY = "recent_query";

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function toContextItem(email: MailSearchResult): MailContextItem {
  return {
    id: email.id,
    subject: optionalString(email.subject),
    sender: optionalString(email.from_email),
    senderName: optionalString(email.from_name),
    date:
      optionalString(email.received_at) ||
      optionalString(email.sent_at) ||
      optionalString(email.created_at),
    preview: optionalString(email.preview)?.slice(0, 1000) ?? null,
    body: optionalString(email.body_text)?.slice(0, 30_000) ?? null,
  };
}

function isMailContextItem(value: unknown): value is MailContextItem {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.id.trim().length > 0;
}

function isMailDraft(value: unknown): value is MailDraft {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "new" ||
      record.kind === "reply" ||
      record.kind === "forward") &&
    (record.to === null || typeof record.to === "string") &&
    typeof record.subject === "string" &&
    typeof record.body === "string" &&
    typeof record.sourceLabel === "string" &&
    typeof record.createdAt === "number"
  );
}

function parseMailConversationContext(
  value: unknown,
): MailConversationContext | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.recentQuery !== "string" ||
    !record.recentQuery.trim()
  ) {
    return null;
  }

  const results = Array.isArray(record.results)
    ? record.results.filter(isMailContextItem).slice(0, 10)
    : [];

  return {
    recentQuery: record.recentQuery.trim(),
    results,
    selectedMail: isMailContextItem(record.selectedMail)
      ? record.selectedMail
      : null,
    selectionPending:
      record.selectionPending === true && results.length > 0,
    draft: isMailDraft(record.draft) ? record.draft : null,
  };
}

function persistMailContext(
  sessionId: string,
  context: MailConversationContext,
) {
  saveMemory(
    sessionId,
    "mail",
    MAIL_CONTEXT_MEMORY_KEY,
    context,
  );
}

export function saveMailContext(
  sessionId: string,
  query: string,
  emails: MailSearchResult[] = [],
) {
  const recentQuery = query.trim();
  if (!recentQuery) return;

  const results = emails
    .filter((email) => email.id.trim().length > 0)
    .slice(0, 10)
    .map(toContextItem);

  persistMailContext(sessionId, {
    recentQuery,
    results,
    selectedMail: results.length === 1 ? results[0] : null,
    // 검색 결과를 화면에 번호로 보여준 직후에는 결과가 하나뿐이어도
    // "1번 메일 열어줘"를 받을 수 있어야 한다.
    selectionPending: results.length > 0,
    draft: null,
  });
}

export async function selectMailContextResult(
  sessionId: string,
  index: number,
) {
  const context = await getMailContext(sessionId);
  const selectedMail = context?.results[index] ?? null;
  if (!context || !selectedMail) return null;

  persistMailContext(sessionId, {
    ...context,
    selectedMail,
    selectionPending: false,
  });

  return selectedMail;
}

export async function saveMailDraft(
  sessionId: string,
  draft: Omit<MailDraft, "createdAt">,
) {
  const context = await getMailContext(sessionId);
  const next: MailConversationContext = {
    recentQuery: context?.recentQuery ?? "메일 초안",
    results: context?.results ?? [],
    selectedMail: context?.selectedMail ?? null,
    selectionPending: context?.selectionPending ?? false,
    draft: { ...draft, createdAt: Date.now() },
  };

  persistMailContext(sessionId, next);
  return next.draft;
}

export async function getMailContext(
  sessionId: string,
): Promise<MailConversationContext | null> {
  const stored = await getMemory<unknown>(
    sessionId,
    "mail",
    MAIL_CONTEXT_MEMORY_KEY,
    MAIL_CONTEXT_TTL_MS,
  );

  return parseMailConversationContext(stored);
}

export async function clearMailContext(sessionId: string) {
  await deleteMemory(
    sessionId,
    "mail",
    MAIL_CONTEXT_MEMORY_KEY,
  );
}
