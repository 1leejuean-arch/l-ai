import type { ChatApiError, ChatApiResponse } from "@/app/types/chat";
import {
  answerDriveFileQuestion,
  generateAssistantReply,
  summarizeDriveFile,
  OpenAIConfigurationError,
} from "@/lib/ai/openai";
import {
  formatCalendarCandidateSelection,
  formatCalendarConfirmation,
  formatCalendarCreated,
  formatCalendarDeleteConfirmation,
  formatCalendarDeleted,
  formatCalendarEvents,
  formatCalendarUpdateConfirmation,
  formatCalendarUpdated,
} from "@/lib/calendar/format";
import {
  formatMeridiemQuestion,
  hasExplicitCalendarDate,
  parseCalendarTextTimeChange,
  parseMeridiemReply,
  resolveCandidateDateTime,
  resolveCandidateStart,
} from "@/lib/calendar/clarification";
import {
  applyCalendarUpdate,
  matchCalendarEvents,
} from "@/lib/calendar/mutation";
import { callCalendarN8n } from "@/lib/calendar/n8n";
import { parseCalendarRequest } from "@/lib/calendar/parse";
import {
  clearPendingCalendarAction,
  getPendingCalendarAction,
  setPendingCalendarAction,
  takePendingCalendarAction,
} from "@/lib/calendar/pending";
import {
  attachCalendarSession,
  getCalendarSession,
} from "@/lib/calendar/session";
import type {
  CalendarDeleteRequest,
  CalendarEventCandidate,
  CalendarParseResult,
  CalendarRange,
  CalendarUpdatePatch,
  CalendarUpdateRequest,
  PendingCalendarAction,
} from "@/lib/calendar/types";
import {
  formatDriveSearchResults,
  formatRecentDriveFiles,
} from "@/lib/drive/format";
import { parseDriveSearchIntent } from "@/lib/drive/intent";
import {
  getRecentGoogleDriveFiles,
  readGoogleDriveFile,
  searchGoogleDrive,
} from "@/lib/drive/n8n";
import { callN8nWebhook } from "@/lib/n8n/client";

type ChatRequestBody = {
  message: string;
};

const N8N_TEST_MESSAGES = new Set([
  "n8n 테스트해줘",
  "n8n 연결 테스트",
  "n8n 테스트",
]);

const GENERIC_APPROVAL_MESSAGES = new Set([
  "응",
  "그래",
  "진행해",
  "확인",
  "네",
  "예",
  "좋아",
]);

const ACTION_APPROVAL_MESSAGES = {
  create: new Set(["추가", "추가해줘"]),
  update: new Set(["수정", "수정해줘"]),
  delete: new Set(["삭제", "삭제해줘"]),
} as const;

const CANCEL_MESSAGES = new Set([
  "취소",
  "취소해줘",
  "아니",
  "아니요",
  "그만",
]);

function isChatRequestBody(value: unknown): value is ChatRequestBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "message" in value &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  );
}

function normalizeShortReply(message: string) {
  return message.trim().toLowerCase().replace(/[.!?。！？]+$/u, "");
}

function parseSelectionIndex(message: string, candidateCount: number) {
  const normalized = normalizeShortReply(message).replace(/\s/g, "");
  const wordIndexes: Record<string, number> = {
    첫번째: 0,
    첫째: 0,
    두번째: 1,
    둘째: 1,
    세번째: 2,
    셋째: 2,
  };
  const numericMatch = /^(\d+)번?$/.exec(normalized);
  const index = numericMatch
    ? Number(numericMatch[1]) - 1
    : wordIndexes[normalized];

  return Number.isInteger(index) && index >= 0 && index < candidateCount
    ? index
    : null;
}

function chatReply(reply: string) {
  return Response.json({ reply } satisfies ChatApiResponse);
}

function chatError(error: string, status: number) {
  return Response.json({ error } satisfies ChatApiError, { status });
}

function isConfirmation(
  pending: PendingCalendarAction,
): pending is Extract<
  PendingCalendarAction,
  { kind: "create" | "update" | "delete" }
> {
  return (
    pending.kind === "create" ||
    pending.kind === "update" ||
    pending.kind === "delete"
  );
}

function isActionApproval(message: string) {
  return Object.values(ACTION_APPROVAL_MESSAGES).some((messages) =>
    messages.has(message),
  );
}

function isApprovalForPending(
  message: string,
  pending: Extract<
    PendingCalendarAction,
    { kind: "create" | "update" | "delete" }
  >,
) {
  return (
    GENERIC_APPROVAL_MESSAGES.has(message) ||
    ACTION_APPROVAL_MESSAGES[pending.kind].has(message)
  );
}

function expectedApprovalMessage(pending: PendingCalendarAction) {
  if (pending.kind === "create") return "현재 확인 중인 작업은 일정 추가야. 추가 또는 취소라고 말해줘.";
  if (pending.kind === "update") return "현재 확인 중인 작업은 일정 수정이야. 수정 또는 취소라고 말해줘.";
  if (pending.kind === "delete") return "현재 확인 중인 작업은 일정 삭제야. 삭제 또는 취소라고 말해줘.";
  if (pending.kind === "clarify_update") {
    return formatMeridiemQuestion(pending.targetEvent, pending.unresolvedTime);
  }
  if (pending.kind === "clarify_request") return pending.question;
  return "먼저 수정하거나 삭제할 일정 번호를 선택해줘.";
}

async function handleN8nTest(message: string) {
  try {
    const result = await callN8nWebhook(message);
    return chatReply(
      `${result.message} ✅\n전달된 메시지: ${result.received}`,
    );
  } catch {
    return chatError("n8n 자동화 서버에 연결하지 못했습니다.", 502);
  }
}

async function handleDriveSearch(query: string) {
  try {
    const files = await searchGoogleDrive(query);
    return chatReply(formatDriveSearchResults(query, files));
  } catch {
    return chatError("Google Drive 파일 검색에 실패했습니다.", 502);
  }
}

async function executePendingAction(sessionId: string) {
  const pending = takePendingCalendarAction(sessionId);

  if (!pending || !isConfirmation(pending)) {
    return chatReply("확인할 일정 작업이 없습니다.");
  }

  try {
    if (pending.kind === "create") {
      await callCalendarN8n("calendar_create", pending.event);
      return chatReply(formatCalendarCreated(pending.event));
    }

    if (pending.kind === "update") {
      await callCalendarN8n("calendar_update", {
        eventId: pending.eventId,
        ...pending.after,
      });
      return chatReply(formatCalendarUpdated(pending.after));
    }

    await callCalendarN8n("calendar_delete", {
      eventId: pending.candidate.eventId,
    });
    return chatReply(formatCalendarDeleted());
  } catch {
    const operation =
      pending.kind === "create"
        ? "생성"
        : pending.kind === "update"
          ? "수정"
          : "삭제";
    return chatError(`Google Calendar 일정 ${operation}에 실패했습니다.`, 502);
  }
}

function prepareUpdateConfirmation(
  sessionId: string,
  candidate: CalendarEventCandidate,
  patch: CalendarUpdatePatch,
) {
  const updated = applyCalendarUpdate(candidate, patch);

  if (!updated) {
    return chatReply("이 일정은 요청한 방식으로 수정할 수 없습니다.");
  }

  setPendingCalendarAction(sessionId, {
    kind: "update",
    eventId: candidate.eventId,
    before: updated.before,
    after: updated.after,
  });
  return chatReply(
    formatCalendarUpdateConfirmation(updated.before, updated.after),
  );
}

function prepareUpdateNextStep(
  sessionId: string,
  candidate: CalendarEventCandidate,
  request: CalendarUpdateRequest,
  originalMessage: string,
) {
  const textTimeChange = hasExplicitCalendarDate(originalMessage)
    ? null
    : parseCalendarTextTimeChange(originalMessage);
  let normalizedRequest = request;

  if (textTimeChange?.kind === "ambiguous") {
    normalizedRequest = {
      ...request,
      patch: { ...request.patch, start: null, end: null },
      unresolvedTime: textTimeChange.time,
      missingField: "ampm",
    };
  } else if (textTimeChange?.kind === "resolved") {
    const start = textTimeChange.start
      ? resolveCandidateDateTime(candidate, textTimeChange.start)
      : null;
    const end = textTimeChange.end
      ? resolveCandidateDateTime(candidate, textTimeChange.end)
      : null;

    if (
      (textTimeChange.start === null || start) &&
      (textTimeChange.end === null || end)
    ) {
      normalizedRequest = {
        ...request,
        patch: { ...request.patch, start, end },
        unresolvedTime: null,
        missingField: null,
        clarification: null,
      };
    }
  }

  if (
    normalizedRequest.missingField === "ampm" &&
    normalizedRequest.unresolvedTime
  ) {
    setPendingCalendarAction(sessionId, {
      kind: "clarify_update",
      targetEvent: candidate,
      requestedChanges: normalizedRequest.patch,
      unresolvedTime: normalizedRequest.unresolvedTime,
      missingField: "ampm",
      stage: "clarification",
    });
    return chatReply(
      formatMeridiemQuestion(candidate, normalizedRequest.unresolvedTime),
    );
  }

  if (normalizedRequest.missingField) {
    const question =
      normalizedRequest.clarification ||
      "일정 수정에 필요한 정보를 조금 더 알려줘.";
    setPendingCalendarAction(sessionId, {
      kind: "clarify_request",
      operation: "update",
      originalMessage,
      question,
      missingField: normalizedRequest.missingField,
      stage: "clarification",
    });
    return chatReply(question);
  }

  return prepareUpdateConfirmation(
    sessionId,
    candidate,
    normalizedRequest.patch,
  );
}

function prepareDeleteConfirmation(
  sessionId: string,
  candidate: CalendarEventCandidate,
) {
  setPendingCalendarAction(sessionId, { kind: "delete", candidate });
  return chatReply(formatCalendarDeleteConfirmation(candidate));
}

function handlePendingSelection(
  sessionId: string,
  pending: Extract<
    PendingCalendarAction,
    { kind: "select_update" | "select_delete" }
  >,
  message: string,
) {
  const selectedByIndex = parseSelectionIndex(message, pending.candidates.length);
  const normalizedTitle = message.replace(/\s/gu, "");
  const titleMatches = pending.candidates
    .map((candidate, index) => ({
      index,
      title: candidate.title.replace(/\s/gu, ""),
    }))
    .filter(
      ({ title }) =>
        title === normalizedTitle ||
        title.includes(normalizedTitle) ||
        normalizedTitle.includes(title),
    );
  const selectedIndex =
    selectedByIndex ?? (titleMatches.length === 1 ? titleMatches[0].index : null);

  if (selectedIndex === null) {
    return null;
  }

  const candidate = pending.candidates[selectedIndex];

  if (pending.kind === "select_delete") {
    return prepareDeleteConfirmation(sessionId, candidate);
  }

  return prepareUpdateNextStep(
    sessionId,
    candidate,
    {
      range: { start: candidate.start, end: candidate.end },
      target: { title: candidate.title, start: candidate.start },
      patch: pending.patch,
      unresolvedTime: pending.unresolvedTime,
      missingField: pending.missingField,
      clarification: pending.clarification,
    },
    pending.originalMessage,
  );
}

async function getMutationCandidates(range: CalendarRange) {
  try {
    return await callCalendarN8n("calendar_get", range);
  } catch {
    return null;
  }
}

async function handleCalendarUpdate(
  sessionId: string,
  request: CalendarUpdateRequest,
  originalMessage: string,
) {
  const events = await getMutationCandidates(request.range);

  if (!events) {
    return chatError("Google Calendar 일정 조회에 실패했습니다.", 502);
  }

  const match = matchCalendarEvents(events, request.target, {
    includeAllDay: false,
  });

  if (match.kind === "none") {
    return chatReply("수정할 일정을 찾지 못했어.");
  }

  if (match.kind === "multiple") {
    setPendingCalendarAction(sessionId, {
      kind: "select_update",
      candidates: match.candidates,
      patch: request.patch,
      unresolvedTime: request.unresolvedTime,
      missingField: request.missingField,
      clarification: request.clarification,
      originalMessage,
    });
    return chatReply(
      formatCalendarCandidateSelection(match.candidates, request.target.title),
    );
  }

  return prepareUpdateNextStep(
    sessionId,
    match.candidate,
    request,
    originalMessage,
  );
}

async function handleCalendarDelete(
  sessionId: string,
  request: CalendarDeleteRequest,
) {
  const events = await getMutationCandidates(request.range);

  if (!events) {
    return chatError("Google Calendar 일정 조회에 실패했습니다.", 502);
  }

  const match = matchCalendarEvents(events, request.target, {
    includeAllDay: true,
  });

  if (match.kind === "none") {
    return chatReply("삭제할 일정을 찾지 못했어.");
  }

  if (match.kind === "multiple") {
    setPendingCalendarAction(sessionId, {
      kind: "select_delete",
      candidates: match.candidates,
    });
    return chatReply(
      formatCalendarCandidateSelection(match.candidates, request.target.title),
    );
  }

  return prepareDeleteConfirmation(sessionId, match.candidate);
}

async function handleCalendarGet(range: CalendarRange, rangeLabel: string) {
  try {
    const events = await callCalendarN8n("calendar_get", range);
    return chatReply(formatCalendarEvents(events, rangeLabel));
  } catch {
    return chatError("Google Calendar 일정 조회에 실패했습니다.", 502);
  }
}

function handleUpdateClarification(
  sessionId: string,
  pending: Extract<PendingCalendarAction, { kind: "clarify_update" }>,
  message: string,
) {
  const resolvedReply = parseMeridiemReply(message, pending.unresolvedTime);

  if (!resolvedReply) {
    return chatReply(
      formatMeridiemQuestion(pending.targetEvent, pending.unresolvedTime),
    );
  }

  const start = resolveCandidateStart(
    pending.targetEvent,
    { hour: resolvedReply.hour, minute: resolvedReply.minute },
    resolvedReply.meridiem,
  );

  if (!start) {
    clearPendingCalendarAction(sessionId);
    return chatReply("이 일정의 시작 시간을 변경할 수 없습니다.");
  }

  return prepareUpdateConfirmation(sessionId, pending.targetEvent, {
    ...pending.requestedChanges,
    start,
  });
}

async function handleStoredRequestClarification(
  sessionId: string,
  pending: Extract<PendingCalendarAction, { kind: "clarify_request" }>,
  message: string,
) {
  const combinedMessage = `${pending.originalMessage}\n추가 답변: ${message}`;
  const result: CalendarParseResult = await parseCalendarRequest(
    message,
    new Date(),
    {
      operation: pending.operation,
      originalMessage: pending.originalMessage,
    },
  );

  if (pending.operation === "update" && result.kind === "update") {
    return handleCalendarUpdate(sessionId, result.request, combinedMessage);
  }

  if (pending.operation === "delete" && result.kind === "delete") {
    return handleCalendarDelete(sessionId, result.request);
  }

  if (
    result.kind === "clarify" &&
    (!result.operation || result.operation === pending.operation)
  ) {
    setPendingCalendarAction(sessionId, {
      ...pending,
      originalMessage: combinedMessage,
      question: result.message,
    });
    return chatReply(result.message);
  }

  return chatReply(pending.question);
}

async function handleChatRequest(request: Request, sessionId: string) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return chatError("올바른 JSON 요청이 필요합니다.", 400);
  }

  if (!isChatRequestBody(body)) {
    return chatError("message 값을 입력해 주세요.", 400);
  }

  const message = body.message.trim();

  if (N8N_TEST_MESSAGES.has(message)) {
    return handleN8nTest(message);
  }

  const shortReply = normalizeShortReply(message);
  const pending = getPendingCalendarAction(sessionId);

  if (CANCEL_MESSAGES.has(shortReply)) {
    if (!pending) {
      return chatReply("취소할 일정 작업이 없습니다.");
    }

    clearPendingCalendarAction(sessionId);
    return chatReply("Calendar 작업을 취소했어.");
  }

  if (pending?.kind === "clarify_update") {
    return handleUpdateClarification(sessionId, pending, shortReply);
  }

  if (pending?.kind === "clarify_request") {
    try {
      return await handleStoredRequestClarification(
        sessionId,
        pending,
        message,
      );
    } catch (error) {
      if (error instanceof OpenAIConfigurationError) {
        return chatError(
          "AI 서비스를 사용할 수 없습니다. 서버 설정을 확인해 주세요.",
          503,
        );
      }

      return chatError(
        "AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        502,
      );
    }
  }

  if (pending?.kind === "select_update" || pending?.kind === "select_delete") {
    const selectionResponse = handlePendingSelection(
      sessionId,
      pending,
      shortReply,
    );

    if (selectionResponse) {
      return selectionResponse;
    }

    return chatReply(expectedApprovalMessage(pending));
  }

  if (pending && isConfirmation(pending)) {
    if (isApprovalForPending(shortReply, pending)) {
      return executePendingAction(sessionId);
    }

    if (isActionApproval(shortReply)) {
      return chatReply(expectedApprovalMessage(pending));
    }

    return chatReply(expectedApprovalMessage(pending));
  } else if (
    GENERIC_APPROVAL_MESSAGES.has(shortReply) ||
    isActionApproval(shortReply)
  ) {
    return chatReply("확인할 일정 작업이 없습니다.");
  }

 const driveIntent = parseDriveSearchIntent(message);

if (driveIntent) {
  if (driveIntent.action === "recent") {
    const files = await getRecentGoogleDriveFiles();

    return chatReply(formatRecentDriveFiles(files));
  }

  if (driveIntent.action === "summarize") {
    if (!driveIntent.query) {
      return chatReply("Google Drive에서 어떤 파일을 요약할까?");
    }

    const files = await searchGoogleDrive(driveIntent.query);

    if (files.length === 0) {
      return chatReply(
        `Google Drive에서 '${driveIntent.query}' 파일을 찾지 못했어.`,
      );
    }

    const file =
      files.find((item) =>
        item.name.toLowerCase().endsWith(".pdf"),
      ) ?? files[0];

    const text = await readGoogleDriveFile(file.id);

    if (!text) {
      return chatReply(
        `'${file.name}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
      );
    }

    const summary = await summarizeDriveFile(file.name, text);

    const fileUrl =
      file.webViewLink ||
      `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;

    return chatReply(
      `**${file.name} 요약**\n\n${summary}\n\n[원본 파일 열기](${fileUrl})`,
    );
  }

  if (driveIntent.action === "ask") {
    if (!driveIntent.query || !driveIntent.question) {
      return chatReply("어떤 파일에서 무엇을 확인할까?");
    }

    const files = await searchGoogleDrive(driveIntent.query);

    if (files.length === 0) {
      return chatReply(
        `Google Drive에서 '${driveIntent.query}' 파일을 찾지 못했어.`,
      );
    }

    const file =
      files.find((item) =>
        item.name.toLowerCase().endsWith(".pdf"),
      ) ?? files[0];

    const text = await readGoogleDriveFile(file.id);

    if (!text) {
      return chatReply(
        `'${file.name}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
      );
    }

    const answer = await answerDriveFileQuestion(
      file.name,
      text,
      driveIntent.question,
    );

    const fileUrl =
      file.webViewLink ||
      `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;

    return chatReply(
      `**${file.name}에서 확인한 내용**\n\n${answer}\n\n[원본 파일 열기](${fileUrl})`,
    );
  }

  if (driveIntent.action === "search") {
    return driveIntent.query
      ? handleDriveSearch(driveIntent.query)
      : chatReply("Google Drive에서 어떤 파일을 찾을까?");
  }
}
}
export async function POST(request: Request) {
  const sessionId =
    request.headers.get("x-session-id") ||
    request.headers.get("x-chat-session-id") ||
    crypto.randomUUID();

  return handleChatRequest(request, sessionId);
}