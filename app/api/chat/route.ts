
import {
  getLastAction,
  getLastActionRecency,
  saveLastAction,
} from "@/lib/memory/action";
import { getMemory } from "@/lib/memory/context";
import {
  getCalendarCheckRange,
  isDuplicateCalendarEvent,
} from "@/lib/drive/calendar-register";
import { routeUserMessage } from "@/lib/ai/router";
import {
  clearCalendarContext,
  getCalendarContext,
  hydrateCalendarContext,
  saveCalendarContext,
} from "@/lib/calendar/context";
import {
  handleDriveCalendarFlow,
} from "@/lib/drive/calendar-flow";
import {
  getDriveContext,
  hydrateDriveContext,
  isDriveContextFollowUp,
  saveDriveContext,
} from "@/lib/drive/context";
import type {
  ChatApiError,
  ChatApiResponse,
} from "@/app/types/chat";

import {
  answerDriveFileQuestion,
  combineDriveFiles,
  compareDriveFiles,
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
  CalendarEvent,
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
  "ㅇㅇ",
  "웅",
  "어",
  "그래",
  "그래 해",
  "그래 해줘",
  "해",
  "해줘",
  "진행",
  "진행해",
  "확인",
  "네",
  "넵",
  "예",
  "좋아",
  "좋음",
  "ㅇㅋ",
  "오케이",
  "ok",
  "okay",
]);

const ACTION_APPROVAL_MESSAGES = {
  create: new Set([
    "추가",
    "추가해",
    "추가해줘",
    "등록",
    "등록해",
    "등록해줘",
  ]),

  update: new Set([
    "수정",
    "수정해",
    "수정해줘",
    "변경",
    "변경해",
    "변경해줘",
    "바꿔",
    "바꿔줘",
  ]),

  delete: new Set([
    "삭제",
    "삭제해",
    "삭제해줘",
    "지워",
    "지워줘",
  ]),
} as const;

const CANCEL_MESSAGES = new Set([
  "취소",
  "취소해줘",
  "ㄴㄴ",
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

function isIndependentCommandWhileClarifying(
  message: string,
) {
  const normalized =
    normalizeShortReply(message);

  if (
    CANCEL_MESSAGES.has(normalized) ||
    GENERIC_APPROVAL_MESSAGES.has(normalized) ||
    isActionApproval(normalized) ||
    /^(?:\d+\s*번?|첫\s*번째|두\s*번째|세\s*번째|첫째|둘째|셋째)$/u.test(
      normalized,
    )
  ) {
    return false;
  }

  const hasExplicitDateOrTime =
    /(?:오늘|내일|모레|이번\s*주|다음\s*주|\d{1,2}\s*월|\d{1,2}\s*일|(?:월|화|수|목|금|토|일)요일|오전|오후|\d{1,2}\s*시|\d{1,2}:\d{2})/u.test(
      normalized,
    );

  const isLastActionCommand =
    isLastActionDirectCommand(
      normalized,
    );

  const isCalendarCreateCommand =
    hasExplicitDateOrTime &&
    /(?:추가|등록|만들어|생성)/u.test(
      normalized,
    );

  const isCalendarGetCommand =
    /(?=.*(?:일정|스케줄))(?=.*(?:보여|조회|알려|확인|뭐\s*있))/u.test(
      normalized,
    );

  const isCalendarDeleteCommand =
    /(?=.*(?:일정|스케줄))(?=.*(?:삭제|지워|없애))/u.test(
      normalized,
    );

  const isCalendarUpdateCommand =
    hasExplicitDateOrTime &&
    /(?=.*(?:일정|스케줄))(?=.*(?:수정|변경|바꿔|옮겨|미뤄|당겨))/u.test(
      normalized,
    );

  const isDriveCommand =
    /(?=.*(?:드라이브|파일|\.[a-z0-9]{2,5}))(?=.*(?:찾아|검색|요약|읽어|내용|열어))/iu.test(
      normalized,
    );

  return (
    isLastActionCommand ||
    isCalendarCreateCommand ||
    isCalendarGetCommand ||
    isCalendarDeleteCommand ||
    isCalendarUpdateCommand ||
    isDriveCommand
  );
}

function isLastActionDirectCommand(
  message: string,
) {
  return /(?:방금|아까|최근에).*(?:뭐|무엇|알려|뭐였|취소|되돌려|원래대로|삭제|지워)/u.test(
    message,
  );
}

function getExplicitMemoryTarget(
  message: string,
) {
  if (/(?:파일|문서|드라이브)/u.test(message)) {
    return "drive_context" as const;
  }

  if (/(?:일정|캘린더|달력)/u.test(message)) {
    return "calendar_context" as const;
  }

  return null;
}

function chatReply(reply: string) {
  return Response.json({ reply } satisfies ChatApiResponse);
}

function chatError(error: string, status: number) {
  return Response.json({ error } satisfies ChatApiError, { status });
}

function getStoredCalendarEvent(
  value: unknown,
): CalendarEvent | null {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return null;
  }

  const event =
    value as Record<string, unknown>;

  if (
    typeof event.title !== "string" ||
    !event.title.trim() ||
    typeof event.start !== "string" ||
    !event.start.trim() ||
    typeof event.end !== "string" ||
    !event.end.trim()
  ) {
    return null;
  }

  return {
    title: event.title,
    start: event.start,
    end: event.end,
  };
}

function isSameCalendarEvent(
  left: CalendarEvent | null,
  right: CalendarEvent,
) {
  return (
    left?.title === right.title &&
    left.start === right.start &&
    left.end === right.end
  );
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

async function handleDriveSearch(
  sessionId: string,
  query: string,
) {
  try {
    const files = await searchGoogleDrive(query);

    if (files.length > 0) {
      const normalizedQuery =
        query.toLowerCase().trim();

      const matchedFile =
        files.find(
          (file) =>
            file.name
              .toLowerCase()
              .trim() ===
            normalizedQuery,
        ) ??
        (files.length === 1
          ? files[0]
          : null);

      await saveLastAction(
        sessionId,
        {
          type: "drive_search",
          label: matchedFile
            ? `${matchedFile.name} 파일 검색`
            : `${query} 파일 검색`,
          data: matchedFile
            ? {
                fileId: matchedFile.id,
                fileName: matchedFile.name,
                webViewLink:
                  matchedFile.webViewLink,
                query,
              }
            : {
                query,
                resultCount:
                  files.length,
              },
        },
      );
    }

    if (files.length === 1) {
      const file = files[0];

      saveDriveContext(sessionId, {
        fileId: file.id,
        fileName: file.name,
        webViewLink: file.webViewLink,
      });

      console.log("[Drive Context] Saved search result:", {
        sessionId,
        fileName: file.name,
      });
    }

    return chatReply(
      formatDriveSearchResults(query, files),
    );
  } catch {
    return chatError(
      "Google Drive 파일 검색에 실패했습니다.",
      502,
    );
  }
}

async function executePendingAction(sessionId: string) {
  const pending =
    takePendingCalendarAction(sessionId);

  if (!pending || !isConfirmation(pending)) {
    return chatReply(
      "확인할 일정 작업이 없습니다.",
    );
  }

  console.log(
    "[L-AI Memory] Priority selected: calendar_pending",
    {
      sessionId,
      pendingKind: pending.kind,
    },
  );

  try {
    if (pending.kind === "create") {
  /*
   * 실제 생성하기 전에 같은 날짜의
   * 기존 Calendar 일정을 먼저 조회한다.
   */
  const checkRange =
    getCalendarCheckRange(
      pending.event,
    );

  const existingEvents =
    await callCalendarN8n(
      "calendar_get",
      checkRange,
    );

  /*
   * 같은 날짜 + 비슷한 제목 +
   * 시작시간 15분 이내라면 중복으로 판단.
   */
  const isDuplicate =
    isDuplicateCalendarEvent(
      pending.event,
      existingEvents,
    );

  if (isDuplicate) {
    console.log(
      "[Calendar] Duplicate event blocked:",
      {
        title:
          pending.event.title,
        start:
          pending.event.start,
      },
    );

    return chatReply(
      `이미 비슷한 일정이 등록되어 있어서 추가하지 않았어.\n\n` +
        `**${pending.event.title}**`,
    );
  }

  /*
   * 중복이 아닐 때만 실제 생성
   */
  await callCalendarN8n(
    "calendar_create",
    pending.event,
  );

await saveLastAction(
  sessionId,
  {
    type: "calendar_create",
    label:
      `${pending.event.title} 일정 추가`,
    data: {
      title:
        pending.event.title,
      start:
        pending.event.start,
      end:
        pending.event.end,
    },
  },
);

  saveCalendarContext(
    sessionId,
    {
      rangeLabel:
        "방금 생성한 일정",
      events: [
        {
          title:
            pending.event.title,
          start:
            pending.event.start,
          end:
            pending.event.end,
        },
      ],
    },
  );

  return chatReply(
    formatCalendarCreated(
      pending.event,
    ),
  );
    }

    if (pending.kind === "update") {
  const previousLastAction =
    await getLastAction(sessionId);

  const previousActionData =
    previousLastAction?.data;

  const previousBefore =
    getStoredCalendarEvent(
      previousActionData?.before,
    );

  const previousAfter =
    getStoredCalendarEvent(
      previousActionData?.after,
    ) ??
    getStoredCalendarEvent({
      title:
        previousActionData?.title,
      start:
        previousActionData?.start,
      end:
        previousActionData?.end,
    });

  const isRollback =
    previousLastAction?.type ===
      "calendar_update" &&
    previousActionData?.eventId ===
      pending.eventId &&
    isSameCalendarEvent(
      previousBefore,
      pending.after,
    ) &&
    isSameCalendarEvent(
      previousAfter,
      pending.before,
    );

  await callCalendarN8n(
    "calendar_update",
    {
      eventId: pending.eventId,
      ...pending.after,
    },
  );

  await saveLastAction(
    sessionId,
    {
      type: "calendar_update",
      label:
        isRollback
          ? `${pending.after.title} 일정 수정 되돌리기`
          : `${pending.after.title} 일정 수정`,
      data: {
        eventId:
          pending.eventId,

        title:
          pending.after.title,

        start:
          pending.after.start,

        end:
          pending.after.end,

        before: {
          title:
            pending.before.title,
          start:
            pending.before.start,
          end:
            pending.before.end,
        },

        after: {
          title:
            pending.after.title,
          start:
            pending.after.start,
          end:
            pending.after.end,
        },
      },
    },
  );

  saveCalendarContext(
    sessionId,
    {
      rangeLabel:
        "방금 수정한 일정",
      events: [
        {
          title:
            pending.after.title,
          start:
            pending.after.start,
          end:
            pending.after.end,
        },
      ],
    },
  );

  return chatReply(
    formatCalendarUpdated(
      pending.after,
    ),
  );
}

    await callCalendarN8n(
  "calendar_delete",
  {
    eventId:
      pending.candidate.eventId,
  },
);

await saveLastAction(
  sessionId,
  {
    type: "calendar_delete",
    label:
      `${pending.candidate.title} 일정 삭제`,
    data: {
      eventId:
        pending.candidate.eventId,
      title:
        pending.candidate.title,
      start:
        pending.candidate.start,
      end:
        pending.candidate.end,
    },
  },
);

clearCalendarContext(sessionId);

    return chatReply(
      formatCalendarDeleted(),
    );
  } catch {
    const operation =
      pending.kind === "create"
        ? "생성"
        : pending.kind === "update"
          ? "수정"
          : "삭제";

    return chatError(
      `Google Calendar 일정 ${operation}에 실패했습니다.`,
      502,
    );
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

function buildCalendarContextMessage(
  sessionId: string,
  message: string,
) {
  const context =
    getCalendarContext(sessionId);

  if (
    !context ||
    context.events.length === 0
  ) {
    return message;
  }

  const recentEvents =
    context.events
      .map(
        (event, index) =>
          `${index + 1}. 제목: ${event.title}, 시작: ${event.start}, 종료: ${event.end}`,
      )
      .join("\n");

  return `
최근 대화에서 사용자가 확인한 Calendar 일정은 다음과 같다.

조회 범위:
${context.rangeLabel || "알 수 없음"}

최근 일정:
${recentEvents}

현재 사용자 요청:
${message}

"그거", "그 일정", "아까꺼", "방금꺼" 같은 표현은
위 최근 일정 문맥을 우선해서 해석한다.

최근 일정이 정확히 1개라면
사용자가 다시 날짜나 제목을 말하지 않아도
그 일정을 가리키는 것으로 해석한다.
`.trim();
}

function resolveCalendarReferenceMessage(
  sessionId: string,
  message: string,
) {
  const context =
    getCalendarContext(sessionId);

  if (
    !context ||
    context.events.length !== 1
  ) {
    return message;
  }

  const referencePattern =
    /(?:그거|그\s*일정|아까꺼|아까\s*거|방금꺼|방금\s*거|저거)/u;

  if (!referencePattern.test(message)) {
    return message;
  }

  console.log(
    "[L-AI Memory] Priority selected: calendar_context",
    {
      sessionId,
    },
  );

  const event = context.events[0];

  const requestWithoutReference =
    message
      .replace(referencePattern, "")
      .trim();

  return `
${event.start}에 시작하는 "${event.title}" 일정을 ${requestWithoutReference}
`.trim();
}
async function handleCalendarGet(
  sessionId: string,
  range: CalendarRange,
  rangeLabel: string,
) {
  try {
    const events = await callCalendarN8n(
      "calendar_get",
      range,
    );

    saveCalendarContext(sessionId, {
      rangeLabel,
      events: events
        .filter(
          (event) =>
            event.start?.dateTime &&
            event.end?.dateTime,
        )
        .map((event) => ({
          title:
            event.summary?.trim() ||
            "제목 없는 일정",
          start: event.start.dateTime!,
          end: event.end.dateTime!,
        })),
    });

    return chatReply(
      formatCalendarEvents(
        events,
        rangeLabel,
      ),
    );
  } catch {
    return chatError(
      "Google Calendar 일정 조회에 실패했습니다.",
      502,
    );
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

async function handleLastActionMemory(
  sessionId: string,
  rawMessage: string,
) {
  const lastActionQuestionPattern =
    /(?:방금|아까|최근에).*(?:뭐|무엇).*(?:했|한)|(?:방금|아까|최근에).*(?:작업|한\s*거).*(?:알려|뭐였)/u;

  const lastActionRecency =
    getLastActionRecency(
      rawMessage,
    );

  /*
   * 최근 작업 조회
   *
   * 예:
   * "방금 한 거 뭐였지?"
   */
  if (
    lastActionQuestionPattern.test(
      rawMessage,
    )
  ) {
    const lastAction =
      await getLastAction(
        sessionId,
        lastActionRecency,
      );

    if (!lastAction) {
      return chatReply(
        "최근에 기억하고 있는 작업이 없어.",
      );
    }

    console.log(
      "[L-AI Memory] Priority selected: last_action",
      {
        sessionId,
        type: lastAction.type,
      },
    );

    return chatReply(
      `방금 기억하고 있는 작업은 **${lastAction.label}**이야.`,
    );
  }

  /*
   * 최근 Calendar 수정 되돌리기
   *
   * 예:
   * "방금 수정한 거 되돌려줘"
   */
  const lastActionRollbackPattern =
    /(?:방금|아까|최근(?:에)?).*(?:수정|바꾼|변경).*(?:되돌려|원래대로|취소)/u;

  if (
    lastActionRollbackPattern.test(
      rawMessage,
    )
  ) {
    const lastAction =
      await getLastAction(
        sessionId,
        lastActionRecency,
      );

    if (!lastAction) {
      return chatReply(
        "최근에 되돌릴 수정 작업을 기억하고 있지 않아.",
      );
    }

    console.log(
      "[L-AI Memory] Priority selected: last_action",
      {
        sessionId,
        type: lastAction.type,
      },
    );

    if (
      lastAction.type !==
      "calendar_update"
    ) {
      return chatReply(
        `최근 작업은 **${lastAction.label}**이지만, 일정 수정 작업이 아니라서 되돌릴 수 없어.`,
      );
    }

    const eventId =
      typeof lastAction.data?.eventId ===
      "string" &&
      lastAction.data.eventId.trim()
        ? lastAction.data.eventId
        : null;

    const before =
      getStoredCalendarEvent(
        lastAction.data?.before,
      );

    const after =
      getStoredCalendarEvent(
        lastAction.data?.after,
      ) ??
      getStoredCalendarEvent({
        title: lastAction.data?.title,
        start: lastAction.data?.start,
        end: lastAction.data?.end,
      });

    if (
      !eventId ||
      !before ||
      !after
    ) {
      return chatReply(
        "최근 일정 수정 정보가 부족해서 되돌릴 수 없어.",
      );
    }

    setPendingCalendarAction(
      sessionId,
      {
        kind: "update",
        eventId,
        before: after,
        after: before,
      },
    );

    const confirmation =
      formatCalendarUpdateConfirmation(
        after,
        before,
      );

    return chatReply(
      confirmation.replace(
        "다음 일정을 수정할까요?",
        "이 일정 변경을 되돌릴까요?",
      ),
    );
  }

  /*
   * 최근 작업 취소
   *
   * 현재 자동 취소 지원:
   * Calendar create
   */
  const lastActionCancelPattern =
    /(?:방금|아까|최근에).*(?:한\s*거|작업|일정).*(?:취소|되돌려|삭제|지워)/u;

  if (
    lastActionCancelPattern.test(
      rawMessage,
    ) &&
    getExplicitMemoryTarget(
      rawMessage,
    ) === null
  ) {
    const lastAction =
      await getLastAction(
        sessionId,
        lastActionRecency,
      );

    if (!lastAction) {
      return chatReply(
        "최근에 취소할 작업을 기억하고 있지 않아.",
      );
    }

    console.log(
      "[L-AI Memory] Priority selected: last_action",
      {
        sessionId,
        type: lastAction.type,
      },
    );

    if (
      lastAction.type !==
      "calendar_create"
    ) {
      return chatReply(
        `최근 작업은 **${lastAction.label}**이지만, 아직 이 작업은 자동으로 취소할 수 없어.`,
      );
    }

    const title =
      typeof lastAction.data?.title ===
      "string"
        ? lastAction.data.title
        : null;

    const start =
      typeof lastAction.data?.start ===
      "string"
        ? lastAction.data.start
        : null;

    const end =
      typeof lastAction.data?.end ===
      "string"
        ? lastAction.data.end
        : start;

    if (
      !title ||
      !start ||
      !end
    ) {
      return chatReply(
        "방금 생성한 일정 정보가 부족해서 자동으로 취소할 수 없어.",
      );
    }

    const range =
      getCalendarCheckRange({
        title,
        start,
        end,
      });

    const deleteRequest:
      CalendarDeleteRequest = {
        range,
        target: {
          title,
          start,
        },
      };

    console.log(
      "[L-AI Memory] Cancel last calendar action:",
      {
        sessionId,
        title,
        start,
      },
    );

    return handleCalendarDelete(
      sessionId,
      deleteRequest,
    );
  }

  /*
   * last_action 관련 요청이 아니면
   * 다음 처리 단계로 넘긴다.
   */
  return null;
}

async function handleDriveContextFollowUp(
  sessionId: string,
  rawMessage: string,
  message: string,
  hasRememberedCalendarContext: boolean,
) {
  const savedDriveContext =
    getDriveContext(sessionId);

  if (
    !savedDriveContext ||
    !isDriveContextFollowUp(message) ||
    (
      getExplicitMemoryTarget(rawMessage) !==
        "drive_context" &&
      hasRememberedCalendarContext
    )
  ) {
    return null;
  }

  console.log(
    "[L-AI Memory] Priority selected: drive_context",
    {
      sessionId,
      fileName:
        savedDriveContext.fileName,
    },
  );

  const text =
    await readGoogleDriveFile(
      savedDriveContext.fileId,
    );

  if (!text) {
    return chatReply(
      `'${savedDriveContext.fileName}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
    );
  }

  const answer =
    await answerDriveFileQuestion(
      savedDriveContext.fileName,
      text,
      message,
    );

  const fileUrl =
    savedDriveContext.webViewLink ||
    `https://drive.google.com/open?id=${encodeURIComponent(
      savedDriveContext.fileId,
    )}`;

  const isSummaryRequest =
    /요약/u.test(rawMessage);

  await saveLastAction(
    sessionId,
    {
      type: isSummaryRequest
        ? "drive_summary"
        : "drive_read",

      label: isSummaryRequest
        ? `${savedDriveContext.fileName} 파일 요약`
        : `${savedDriveContext.fileName} 내용 확인`,

      data: {
        fileId:
          savedDriveContext.fileId,

        fileName:
          savedDriveContext.fileName,

        webViewLink:
          savedDriveContext.webViewLink,
      },
    },
  );

  return chatReply(
    `**${savedDriveContext.fileName}에서 이어서 확인한 내용**\n\n${answer}\n\n[원본 파일 열기](${fileUrl})`,
  );
}

async function handleCalendarDirectMemoryReference(
  sessionId: string,
  rawMessage: string,
) {
  const rememberedCalendarContext =
    getCalendarContext(sessionId);

  const rememberedCalendarReferencePattern =
    /(?:그거|그걸|그\s*거|그\s*일정|저거|저걸|아까꺼|아까\s*거|아까\s*그거|아까\s*일정|아까\s*(?:만든|생성한|추가한|수정한)\s*일정|방금꺼|방금\s*거|방금\s*그거|방금\s*일정|방금\s*만든\s*거|방금\s*(?:만든|생성한|추가한|수정한)\s*일정|방금\s*수정한\s*거|전에\s*말한\s*거|아까\s*말한\s*거)/u;

  const calendarUpdateWordPattern =
    /(?:바꿔|변경|수정|옮겨|미뤄|당겨)/u;

  const calendarDeleteWordPattern =
    /(?:지워|삭제|없애)/u;

  if (
    rememberedCalendarContext?.events.length !== 1 ||
    !rememberedCalendarReferencePattern.test(rawMessage)
  ) {
    return null;
  }

  console.log(
    "[L-AI Memory] Priority selected: calendar_context",
    {
      sessionId,
    },
  );

  const targetEvent =
    rememberedCalendarContext.events[0];

  if (
    calendarUpdateWordPattern.test(
      rawMessage,
    )
  ) {
    console.log(
      "[Calendar Direct Reference: Update]",
      {
        rawMessage,
        targetEvent,
      },
    );

    const directUpdateRequest:
      CalendarUpdateRequest = {
      range: {
        start: targetEvent.start,
        end: targetEvent.end,
      },

      target: {
        title: targetEvent.title,
        start: targetEvent.start,
      },

      patch: {
        title: null,
        start: null,
        end: null,
      },

      unresolvedTime: null,
      missingField: null,
      clarification: null,
    };

    return handleCalendarUpdate(
      sessionId,
      directUpdateRequest,
      rawMessage,
    );
  }

  if (
    calendarDeleteWordPattern.test(
      rawMessage,
    )
  ) {
    console.log(
      "[Calendar Direct Reference: Delete]",
      {
        rawMessage,
        targetEvent,
      },
    );

    const directDeleteRequest:
      CalendarDeleteRequest = {
      range: {
        start: targetEvent.start,
        end: targetEvent.end,
      },

      target: {
        title: targetEvent.title,
        start: targetEvent.start,
      },
    };

    return handleCalendarDelete(
      sessionId,
      directDeleteRequest,
    );
  }

  return null;
}

async function handleCalendarPending(
  sessionId: string,
  rawMessage: string,
  rawShortReply: string,
) {
  let rawPending =
    getPendingCalendarAction(sessionId);

  /*
   * 명시적인 Calendar pending 취소
   */
  if (
    CANCEL_MESSAGES.has(
      rawShortReply,
    )
  ) {
    if (!rawPending) {
      return chatReply(
        "취소할 일정 작업이 없습니다.",
      );
    }

    console.log(
      "[L-AI Memory] Priority selected: calendar_pending",
      {
        sessionId,
        pendingKind:
          rawPending.kind,
      },
    );

    clearPendingCalendarAction(
      sessionId,
    );

    return chatReply(
      "Calendar 작업을 취소했어.",
    );
  }

  /*
   * clarification 진행 중
   * 완전히 새로운 명령이 들어오면
   * 오래된 clarification을 제거한다.
   */
  if (
    (
      rawPending?.kind ===
        "clarify_update" ||
      rawPending?.kind ===
        "clarify_request"
    ) &&
    isIndependentCommandWhileClarifying(
      rawMessage,
    )
  ) {
    console.log(
      "[Calendar Pending] Cleared stale clarification for a new command:",
      {
        sessionId,
        pendingKind:
          rawPending.kind,
        rawMessage,
      },
    );

    clearPendingCalendarAction(
      sessionId,
    );

    rawPending = null;
  }

  /*
   * 기존 update clarification
   */
  if (
    rawPending?.kind ===
    "clarify_update"
  ) {
    return handleUpdateClarification(
      sessionId,
      rawPending,
      rawShortReply,
    );
  }

  /*
   * AI 기반 stored clarification
   */
  if (
    rawPending?.kind ===
    "clarify_request"
  ) {
    try {
      return await handleStoredRequestClarification(
        sessionId,
        rawPending,
        rawMessage,
      );
    } catch (error) {
      if (
        error instanceof
        OpenAIConfigurationError
      ) {
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

  /*
   * 여러 일정 중 수정 / 삭제 대상 선택
   */
  if (
    rawPending?.kind ===
      "select_update" ||
    rawPending?.kind ===
      "select_delete"
  ) {
    const selectionResponse =
      handlePendingSelection(
        sessionId,
        rawPending,
        rawShortReply,
      );

    if (selectionResponse) {
      return selectionResponse;
    }

    /*
     * last_action 명령은
     * pending을 뚫고 다음 단계로 갈 수 있다.
     */
    if (
      !isLastActionDirectCommand(
        rawMessage,
      )
    ) {
      return chatReply(
        expectedApprovalMessage(
          rawPending,
        ),
      );
    }
  }

  /*
   * Calendar create / update / delete
   * 실제 실행 승인
   */
  if (
    rawPending &&
    isConfirmation(rawPending)
  ) {
    if (
      isApprovalForPending(
        rawShortReply,
        rawPending,
      )
    ) {
      return executePendingAction(
        sessionId,
      );
    }

    if (
      !isLastActionDirectCommand(
        rawMessage,
      )
    ) {
      return chatReply(
        expectedApprovalMessage(
          rawPending,
        ),
      );
    }
  }

  /*
   * pending도 없는데
   * "ㅇㅇ", "수정", "삭제" 같은
   * 승인 메시지만 들어온 경우
   */
  if (
    GENERIC_APPROVAL_MESSAGES.has(
      rawShortReply,
    ) ||
    isActionApproval(
      rawShortReply,
    )
  ) {
    return chatReply(
      "확인할 일정 작업이 없습니다.",
    );
  }

  /*
   * Calendar pending 관련 요청이 아니면
   * 다음 단계로 넘긴다.
   */
  return null;
}

async function preprocessDriveCalendarCrossContext(
  sessionId: string,
  rawMessage: string,
  currentMessage: string,
) {
  const rememberedDriveFile =
    await getMemory<{
      fileId: string;
      fileName: string;
      webViewLink?: string;
    }>(
      sessionId,
      "drive",
      "recent_file",
    );

  const driveToCalendarPattern =
    /(?:그\s*파일|아까\s*파일|방금\s*파일|그\s*문서).*(?:일정|캘린더|달력).*(?:추가|등록|넣어|만들어)|(?:그\s*파일|아까\s*파일|방금\s*파일|그\s*문서).*(?:일정\s*찾아)/u;

  /*
   * Drive → Calendar cross-context 요청이 아니면
   * 기존 message를 그대로 반환한다.
   */
  if (
    !rememberedDriveFile ||
    !driveToCalendarPattern.test(rawMessage)
  ) {
    return {
      message: currentMessage,
      response: null,
    };
  }

  console.log(
    "[L-AI Memory] Priority selected: drive_context",
    {
      sessionId,
      fileName:
        rememberedDriveFile.fileName,
    },
  );

  console.log(
    "[L-AI Memory] Drive → Calendar cross-context:",
    {
      sessionId,
      fileName:
        rememberedDriveFile.fileName,
      fileId:
        rememberedDriveFile.fileId,
    },
  );

  const text =
    await readGoogleDriveFile(
      rememberedDriveFile.fileId,
    );

  if (!text) {
    return {
      message: currentMessage,
      response: chatReply(
        `${rememberedDriveFile.fileName} 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
      ),
    };
  }

  /*
   * 실제 일정 등록은 여기서 하지 않는다.
   * 기존 Drive → Calendar flow가 이해할 수 있는
   * message로만 변환한다.
   */
  return {
    message:
      `${rememberedDriveFile.fileName} 파일 내용에서 일정 찾아서 캘린더에 추가해줘.\n\n` +
      text,
    response: null,
  };
}

async function handleAiRouter(
  sessionId: string,
  currentMessage: string,
) {
  let message = currentMessage;

  let routedMessage:
    | Awaited<ReturnType<typeof routeUserMessage>>
    | null = null;

  try {
    const driveContextForRouter =
      getDriveContext(sessionId);

    console.log(
      "[L-AI Memory] Priority selected: ai_router",
      {
        sessionId,
      },
    );

    routedMessage = await routeUserMessage(
      message,
      {
        previousFileName:
          driveContextForRouter?.fileName ??
          null,
      },
    );

    if (routedMessage) {
      console.log("[AI Router]", {
        original: message,
        normalized:
          routedMessage.normalizedMessage,
        intent: routedMessage.intent,
        confidence:
          routedMessage.confidence,
      });

      const isCalendarIntent =
        routedMessage.intent ===
          "calendar_get" ||
        routedMessage.intent ===
          "calendar_create" ||
        routedMessage.intent ===
          "calendar_update" ||
        routedMessage.intent ===
          "calendar_delete";

      if (
        !isCalendarIntent &&
        routedMessage.needsClarification &&
        routedMessage.clarificationQuestion
      ) {
        return {
          routedMessage,
          message,
          response: chatReply(
            routedMessage.clarificationQuestion,
          ),
        };
      }

      const normalizedMessage =
        routedMessage.normalizedMessage.trim();

      if (
        normalizedMessage &&
        routedMessage.confidence >= 0.65
      ) {
        message = normalizedMessage;
      }
    }
  } catch (error) {
    console.error(
      "[AI Router] Route failed:",
      error,
    );

    routedMessage = null;
  }

  return {
    routedMessage,
    message,
    response: null,
  };
}

async function handleRoutedCalendarIntent(
  sessionId: string,
  rawMessage: string,
  message: string,
  routedMessage:
    | Awaited<ReturnType<typeof routeUserMessage>>
    | null,
) {
  if (
    !routedMessage ||
    (
      routedMessage.intent !== "calendar_get" &&
      routedMessage.intent !== "calendar_create" &&
      routedMessage.intent !== "calendar_update" &&
      routedMessage.intent !== "calendar_delete"
    )
  ) {
    return null;
  }

  try {
    const referencedMessage =
      resolveCalendarReferenceMessage(
        sessionId,
        rawMessage,
      );

    const calendarMessage =
      referencedMessage !== rawMessage
        ? referencedMessage
        : buildCalendarContextMessage(
            sessionId,
            rawMessage,
          );

    const calendarResult =
      await parseCalendarRequest(
        calendarMessage,
        new Date(),
      );

    if (calendarResult.kind === "get") {
      return handleCalendarGet(
        sessionId,
        calendarResult.range,
        calendarResult.rangeLabel,
      );
    }

    if (calendarResult.kind === "create") {
      setPendingCalendarAction(
        sessionId,
        {
          kind: "create",
          event: calendarResult.event,
        },
      );

      return chatReply(
        formatCalendarConfirmation(
          calendarResult.event,
        ),
      );
    }

    if (calendarResult.kind === "update") {
      return handleCalendarUpdate(
        sessionId,
        calendarResult.request,
        message,
      );
    }

    if (calendarResult.kind === "delete") {
      return handleCalendarDelete(
        sessionId,
        calendarResult.request,
      );
    }

    if (calendarResult.kind === "clarify") {
      if (
        calendarResult.operation === "update" ||
        calendarResult.operation === "delete"
      ) {
        setPendingCalendarAction(
          sessionId,
          {
            kind: "clarify_request",
            operation:
              calendarResult.operation,
            originalMessage: message,
            question:
              calendarResult.message,
            missingField: null,
            stage: "clarification",
          },
        );
      }

      return chatReply(
        calendarResult.message,
      );
    }

    return chatReply(
      "일정 요청은 이해했는데 세부 내용을 정확히 해석하지 못했어. 조금만 다르게 말해줘.",
    );
  } catch (error) {
    console.error(
      "[AI Router] Calendar execution failed:",
      error,
    );

    if (
      error instanceof
      OpenAIConfigurationError
    ) {
      return chatError(
        "AI 서비스를 사용할 수 없습니다. 서버 설정을 확인해 주세요.",
        503,
      );
    }

    return chatError(
      "Calendar 요청을 처리하지 못했어. 잠시 후 다시 시도해줘.",
      502,
    );
  }
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

  const rawMessage = body.message.trim();
let message = rawMessage;

/*
 * ============================================================
 * 1. REQUEST CONTEXT HYDRATION
 *
 * 요청을 처리하기 전에 Supabase에 저장된
 * Calendar / Drive 대화 컨텍스트를 복원한다.
 *
 * IMPORTANT:
 * 이 단계는 AI Router보다 먼저 실행되어야 한다.
 * ============================================================
 */

await hydrateCalendarContext(sessionId);
await hydrateDriveContext(sessionId);

/*
 * 2. CROSS-CONTEXT PREPROCESSING
 */

const crossContextResult =
  await preprocessDriveCalendarCrossContext(
    sessionId,
    rawMessage,
    message,
  );

if (crossContextResult.response) {
  return crossContextResult.response;
}

message = crossContextResult.message;

if (N8N_TEST_MESSAGES.has(message)) {
  return handleN8nTest(message);
}

const rawShortReply =
  normalizeShortReply(rawMessage);

/*
 * ============================================================
 * 3. CALENDAR PENDING HANDLER
 *
 * 사용자가 이전 Calendar 작업에 대해
 * 짧게 답한 내용을 AI Router보다 먼저 처리한다.
 *
 * 예:
 * "응"
 * "추가"
 * "취소"
 * "1번"
 *
 * 처리 대상:
 * - Calendar create 승인
 * - update/delete 대상 선택
 * - clarification 응답
 * - pending 취소
 *
 * IMPORTANT:
 * 이 단계는 AI Router보다 먼저 실행되어야 한다.
 * 짧은 승인/선택 답변을 일반 대화로 오해하지 않게 한다.
 * ============================================================
 */

const calendarPendingResponse =
  await handleCalendarPending(
    sessionId,
    rawMessage,
    rawShortReply,
  );

if (calendarPendingResponse) {
  return calendarPendingResponse;
}

/*
 * ============================================================
 * 4. LAST ACTION MEMORY
 *
 * 사용자가 방금/아까/최근에 했던 작업을
 * 다시 묻거나 되돌리거나 취소하려는 요청을 처리한다.
 *
 * 예:
 * "방금 한 거 뭐였지?"
 * "아까 수정한 거 되돌려줘"
 * "방금 한 거 취소해줘"
 *
 * 현재 지원:
 * - 최근 작업 조회
 * - Calendar update 되돌리기
 * - Calendar create 취소
 *
 * IMPORTANT:
 * 이 단계는 AI Router보다 먼저 실행되어야 한다.
 * 이미 저장된 last_action을 우선 참조하기 때문이다.
 * ============================================================
 */

const lastActionResponse =
  await handleLastActionMemory(
    sessionId,
    rawMessage,
  );

if (lastActionResponse) {
  return lastActionResponse;
}

/*
 * ============================================================
 * 5. CALENDAR DIRECT MEMORY REFERENCE
 *
 * 최근 Calendar 컨텍스트에 일정이 정확히 1개 있을 때,
 * "그거", "방금꺼", "아까꺼" 같은 표현을
 * AI Router보다 먼저 직접 해석한다.
 *
 * 예:
 * "그거 오후 9시로 바꿔줘"
 * "방금꺼 삭제해줘"
 *
 * 처리 대상:
 * - Calendar update
 * - Calendar delete
 *
 * IMPORTANT:
 * 최근 일정이 정확히 1개일 때만 직접 참조한다.
 * 여러 일정이 있을 때는 이 단계에서 임의로 고르지 않는다.
 * ============================================================
 */

/*
 * 최근 Calendar 일정 직접 참조
 *
 * 최근 일정이 정확히 1개라면
 * "그거", "방금꺼", "아까꺼" 같은 표현을
 * AI Router보다 먼저 처리한다.
 */
const rememberedCalendarContext =
  getCalendarContext(sessionId);

const calendarDirectMemoryResponse =
  await handleCalendarDirectMemoryReference(
    sessionId,
    rawMessage,
  );

if (calendarDirectMemoryResponse) {
  return calendarDirectMemoryResponse;
}

/*
 * ============================================================
 * 6. DRIVE CONTEXT FOLLOW-UP
 *
 * 최근에 사용한 Drive 파일을 기준으로
 * 후속 질문이나 요약 요청을 처리한다.
 *
 * 예:
 * "그 파일 요약해줘"
 * "그 파일 내용 알려줘"
 * "아까 파일에서 뭐라고 했지?"
 *
 * 처리 흐름:
 * - 최근 Drive 파일 컨텍스트 확인
 * - 파일 내용 읽기
 * - 후속 질문에 답변
 * - drive_read / drive_summary last_action 저장
 *
 * IMPORTANT:
 * 명시적으로 Drive 파일을 참조하는 후속 요청은
 * AI Router보다 먼저 처리한다.
 * ============================================================
 */

const driveContextFollowUpResponse =
  await handleDriveContextFollowUp(
    sessionId,
    rawMessage,
    message,
    Boolean(rememberedCalendarContext),
  );

if (driveContextFollowUpResponse) {
  return driveContextFollowUpResponse;
}

/*
 * ============================================================
 * 7. DRIVE → CALENDAR FLOW
 *
 * Drive 파일 안에서 일정 정보를 추출하고
 * Calendar 등록 후보로 만드는 특수 흐름을 처리한다.
 *
 * 예:
 * "그 파일에서 일정 찾아서 캘린더에 넣어줘"
 * "1번 추가해줘"
 * "전부 등록해줘"
 *
 * 처리 흐름:
 * - Drive 파일 내용 분석
 * - 일정 후보 추출
 * - 후보 pending 저장
 * - 번호 선택 / 전체 등록 / 취소 처리
 * - Calendar 중복 일정 검사
 *
 * IMPORTANT:
 * 이 흐름은 일반 AI Router보다 먼저 실행된다.
 * 후보 선택 같은 짧은 후속 응답이
 * 일반 대화로 처리되지 않게 해야 한다.
 * ============================================================
 */

const earlyDriveCalendarResponse =
  await handleDriveCalendarFlow(
    message,
    sessionId,
  );

if (earlyDriveCalendarResponse) {
  return earlyDriveCalendarResponse;
}

/*
 * ============================================================
 * 8. AI ROUTER
 *
 * 앞선 Memory / Pending / Context 전용 처리에서
 * 해결되지 않은 요청을 중앙 AI Router로 전달한다.
 *
 * Router 역할:
 * - 사용자 요청 intent 분류
 * - normalizedMessage 생성
 * - clarification 필요 여부 판단
 *
 * 이후 intent에 따라
 * Calendar / Drive / 일반 AI 처리 흐름으로 분기한다.
 *
 * IMPORTANT:
 * Calendar pending, last_action, 직접 참조,
 * Drive follow-up 같은 명확한 컨텍스트 요청보다
 * 뒤에서 실행되어야 한다.
 * ============================================================
 */

const routerResult =
  await handleAiRouter(
    sessionId,
    message,
  );

if (routerResult.response) {
  return routerResult.response;
}

const routedMessage =
  routerResult.routedMessage;

message = routerResult.message;

/*
 * ============================================================
 * 9. DOMAIN EXECUTION
 *
 * AI Router가 분류한 intent를 기준으로
 * 실제 기능별 실행 로직으로 전달한다.
 *
 * 현재 주요 Domain:
 * - Calendar
 * - Google Drive
 * - 일반 AI 응답
 *
 * Calendar의 경우:
 * Router가 intent를 먼저 판단한 뒤
 * Calendar 전용 parser가 요청을 다시 해석하고 검증한다.
 *
 * IMPORTANT:
 * Router의 intent 결과만 믿고 바로 외부 작업을 실행하지 않는다.
 * 각 Domain의 기존 parser / validation / confirmation 흐름을
 * 그대로 유지한다.
 *
 * Gmail / Tasks 등 새로운 기능도 앞으로
 * 이 Domain Execution 영역에 연결한다.
 * ============================================================
 */

const routedCalendarResponse =
  await handleRoutedCalendarIntent(
    sessionId,
    rawMessage,
    message,
    routedMessage,
  );

if (routedCalendarResponse) {
  return routedCalendarResponse;
}
  /*
 * AI Router - Drive 직접 실행
 */
if (
  routedMessage?.intent === "drive_list" ||
  routedMessage?.intent === "drive_recent"
) {
  try {
    const files = await getRecentGoogleDriveFiles();

    return chatReply(
      formatRecentDriveFiles(files),
    );
  } catch (error) {
    console.error(
      "[AI Router] Drive list/recent failed:",
      error,
    );

    return chatError(
      "Google Drive 파일 목록을 불러오지 못했어.",
      502,
    );
  }
}
 const driveIntent = parseDriveSearchIntent(message);

if (driveIntent) {
  const selectDriveFile = (
    files: Awaited<ReturnType<typeof searchGoogleDrive>>,
    query: string,
  ) => {
    const normalizedQuery = query.toLowerCase().trim();

    const exactMatch = files.find(
      (file) => file.name.toLowerCase() === normalizedQuery,
    );

    if (exactMatch) {
      return exactMatch;
    }

    const partialMatch = files.find((file) =>
      file.name.toLowerCase().includes(normalizedQuery),
    );

    if (partialMatch) {
      return partialMatch;
    }

    const pdfFile = files.find((file) =>
      file.name.toLowerCase().endsWith(".pdf"),
    );

    return pdfFile ?? files[0];
  };

  if (driveIntent.action === "recent") {
    const files = await getRecentGoogleDriveFiles();

    return chatReply(formatRecentDriveFiles(files));
  }

  if (driveIntent.action === "combine") {
    const queries = driveIntent.queries;

    if (!queries || queries.length < 2) {
      return chatReply("종합할 파일을 2개 이상 알려줘.");
    }

    const searchResults = await Promise.all(
      queries.map((query) => searchGoogleDrive(query)),
    );

    for (let index = 0; index < searchResults.length; index += 1) {
      if (searchResults[index].length === 0) {
        return chatReply(
          `Google Drive에서 '${queries[index]}' 파일을 찾지 못했어.`,
        );
      }
    }

    const selectedFiles = searchResults.map((files, index) =>
      selectDriveFile(files, queries[index]),
    );

    const texts = await Promise.all(
      selectedFiles.map((file) => readGoogleDriveFile(file.id)),
    );

    for (let index = 0; index < texts.length; index += 1) {
      if (!texts[index]) {
        return chatReply(
          `'${selectedFiles[index].name}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
        );
      }
    }

    const combined = await combineDriveFiles(
      selectedFiles.map((file, index) => ({
        name: file.name,
        text: texts[index],
      })),
      driveIntent.combineQuestion,
    );

    const links = selectedFiles
      .map((file, index) => {
        const fileUrl =
          file.webViewLink ||
          `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;

        return `[파일 ${index + 1} 열기 - ${file.name}](${fileUrl})`;
      })
      .join(" · ");

    return chatReply(
      `**${selectedFiles.length}개 파일 종합 결과**\n\n${combined}\n\n${links}`,
    );
  }

  if (driveIntent.action === "compare") {
    const queries = driveIntent.queries;

    if (!queries || queries.length < 2) {
      return chatReply("비교할 두 파일을 알려줘.");
    }

    const [firstQuery, secondQuery] = queries;

    const [firstFiles, secondFiles] = await Promise.all([
      searchGoogleDrive(firstQuery),
      searchGoogleDrive(secondQuery),
    ]);

    if (firstFiles.length === 0) {
      return chatReply(
        `Google Drive에서 '${firstQuery}' 파일을 찾지 못했어.`,
      );
    }

    if (secondFiles.length === 0) {
      return chatReply(
        `Google Drive에서 '${secondQuery}' 파일을 찾지 못했어.`,
      );
    }

    const firstFile = selectDriveFile(firstFiles, firstQuery);
    const secondFile = selectDriveFile(secondFiles, secondQuery);

    const [firstText, secondText] = await Promise.all([
      readGoogleDriveFile(firstFile.id),
      readGoogleDriveFile(secondFile.id),
    ]);

    if (!firstText) {
      return chatReply(
        `'${firstFile.name}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
      );
    }

    if (!secondText) {
      return chatReply(
        `'${secondFile.name}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
      );
    }

    const comparison = await compareDriveFiles(
      firstFile.name,
      firstText,
      secondFile.name,
      secondText,
      driveIntent.compareQuestion,
    );

    const firstUrl =
      firstFile.webViewLink ||
      `https://drive.google.com/open?id=${encodeURIComponent(firstFile.id)}`;

    const secondUrl =
      secondFile.webViewLink ||
      `https://drive.google.com/open?id=${encodeURIComponent(secondFile.id)}`;

    return chatReply(
      `**${firstFile.name} ↔ ${secondFile.name} 비교**\n\n${comparison}\n\n[첫 번째 파일 열기](${firstUrl}) · [두 번째 파일 열기](${secondUrl})`,
    );
  }

  if (driveIntent.action === "summarize") {
  const rememberedFile =
    getDriveContext(sessionId);

  let file:
    | {
        id: string;
        name: string;
        webViewLink?: string;
      }
    | null = rememberedFile
      ? {
          id: rememberedFile.fileId,
          name: rememberedFile.fileName,
          webViewLink:
            rememberedFile.webViewLink,
        }
      : null;

  /*
   * 최근 파일 기억이 없을 때만
   * Google Drive에서 다시 검색한다.
   */
  if (!file) {
    if (!driveIntent.query) {
      return chatReply(
        "Google Drive에서 어떤 파일을 요약할까?",
      );
    }

    const files =
      await searchGoogleDrive(
        driveIntent.query,
      );

    if (files.length === 0) {
      return chatReply(
        `Google Drive에서 '${driveIntent.query}' 파일을 찾지 못했어.`,
      );
    }

    const selectedFile =
      selectDriveFile(
        files,
        driveIntent.query,
      );

    file = {
      id: selectedFile.id,
      name: selectedFile.name,
      webViewLink:
        selectedFile.webViewLink,
    };

    saveDriveContext(sessionId, {
      fileId: file.id,
      fileName: file.name,
      webViewLink:
        file.webViewLink,
    });
  }

  console.log(
    "[Drive Context] Summarizing file:",
    {
      sessionId,
      fileName: file.name,
      fileId: file.id,
    },
  );

  const text =
    await readGoogleDriveFile(
      file.id,
    );

    if (!text) {
      return chatReply(
        `'${file.name}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
      );
    }

    const summary = await summarizeDriveFile(file.name, text);

    const fileUrl =
      file.webViewLink ||
        `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;

    await saveLastAction(
      sessionId,
      {
        type: "drive_summary",
        label:
          `${file.name} 파일 요약`,
        data: {
          fileId: file.id,
          fileName: file.name,
          webViewLink:
            file.webViewLink,
        },
      },
    );

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

    const file = selectDriveFile(files, driveIntent.query);
    saveDriveContext(sessionId, {
  fileId: file.id,
  fileName: file.name,
  webViewLink: file.webViewLink,
});
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

    await saveLastAction(
      sessionId,
      {
        type: "drive_read",
        label:
          `${file.name} 내용 확인`,
        data: {
          fileId: file.id,
          fileName: file.name,
          webViewLink:
            file.webViewLink,
        },
      },
    );

    return chatReply(
      `**${file.name}에서 확인한 내용**\n\n${answer}\n\n[원본 파일 열기](${fileUrl})`,
    );
  }

  if (driveIntent.action === "search") {
    return driveIntent.query
      ? handleDriveSearch(
  sessionId,
  driveIntent.query,
)
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
