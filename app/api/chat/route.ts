import {
  getMailContext,
  saveMailContext,
} from "@/lib/mail/context";

import {
  formatSelfCheckReport,
  runSelfCheck,
} from "@/lib/diagnostics/self-check";

import {
  appendLearningProfileEntry,
  clearPendingLearningCandidates,
  clearPendingLearningConflict,
  deleteLearningFact,
  deleteMostRecentLearningFact,
  getLearningFact,
  getLearningHistory,
  getLearningFacts,
  getLearningMode,
  getPendingLearningCandidates,
  getPendingLearningConflict,
  setLearningMode,
  setPendingLearningCandidates,
  setPendingLearningConflict,
  undoLatestLearningChange,
  upsertLearningFacts,
} from "@/lib/memory/learning";

import {
  extractLearningCandidateEdits,
  extractLearningDeleteTarget,
  extractProfileFacts,
  extractProfileFactsFromFile,
  interpretMemoryRequest,
} from "@/lib/memory/learning-ai";

import {
  searchLJmail,
} from "@/lib/mail/client";

import {
  createBrainTrace,
  getActiveBrainTrace,
  getLastBrainTrace,
} from "@/lib/brain/trace";

import { createReflection } from "@/lib/brain/reflection";
import { createPlan } from "@/lib/brain/planner";
import {
  getActionHistory,
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
  buildContextSummary,
  resolveConversationContext,
} from "@/lib/context/resolver";

import type {
  ContextSnapshot,
} from "@/lib/context/resolver";

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
  generateAssistantReplyWithFile,
  generateAssistantReplyWithImage,
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

function getFastCalendarGetRange(
  message: string,
  now = new Date(),
): {
  range: CalendarRange;
  rangeLabel: string;
} | null {
  const normalized =
    message.replace(/\s+/gu, "");

  const explicitDateMatch =
  /(\d{4})년(\d{1,2})월(\d{1,2})일/u.exec(
    normalized,
  );

if (explicitDateMatch) {
  const year =
    Number(explicitDateMatch[1]);

  const month =
    Number(explicitDateMatch[2]);

  const day =
    Number(explicitDateMatch[3]);

  const startDate =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  const isValidDate =
    startDate.getUTCFullYear() === year &&
    startDate.getUTCMonth() ===
      month - 1 &&
    startDate.getUTCDate() === day;

  if (!isValidDate) {
    return null;
  }

  const endDate =
    new Date(startDate);

  endDate.setUTCDate(
    endDate.getUTCDate() + 1,
  );

  const formatDate = (
    date: Date,
  ) => {
    const yyyy =
      date.getUTCFullYear();

    const mm =
      String(
        date.getUTCMonth() + 1,
      ).padStart(2, "0");

    const dd =
      String(
        date.getUTCDate(),
      ).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}T00:00:00+09:00`;
  };

  return {
    range: {
      start:
        formatDate(startDate),
      end:
        formatDate(endDate),
    },
    rangeLabel:
      `${year}년 ${month}월 ${day}일`,
  };
}

if (!normalized.includes("이번주")) {
  return null;
}

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(now);

  const getPart = (type: string) =>
    parts.find(
      (part) => part.type === type,
    )?.value ?? "";

  const year = Number(
    getPart("year"),
  );
  const month = Number(
    getPart("month"),
  );
  const day = Number(
    getPart("day"),
  );

  if (
    !year ||
    !month ||
    !day
  ) {
    return null;
  }

  const currentDate =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  const dayOfWeek =
    currentDate.getUTCDay();

  const daysFromMonday =
    dayOfWeek === 0
      ? 6
      : dayOfWeek - 1;

  const startDate =
    new Date(currentDate);

  startDate.setUTCDate(
    startDate.getUTCDate() -
      daysFromMonday,
  );

  const endDate =
    new Date(startDate);

  endDate.setUTCDate(
    endDate.getUTCDate() + 7,
  );

  const toSeoulMidnight = (
    date: Date,
  ) => {
    const yyyy =
      date.getUTCFullYear();

    const mm =
      String(
        date.getUTCMonth() + 1,
      ).padStart(2, "0");

    const dd =
      String(
        date.getUTCDate(),
      ).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}T00:00:00+09:00`;
  };

  return {
    range: {
      start:
        toSeoulMidnight(
          startDate,
        ),
      end:
        toSeoulMidnight(
          endDate,
        ),
    },
    rangeLabel: "이번 주",
  };
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
  {
    kind:
      | "select_update"
      | "select_delete"
      | "select_drive_search";
  }
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

  if (
  pending.kind ===
  "select_drive_search"
) {
  const candidate =
    pending.candidates[
      selectedIndex
    ];

  clearPendingCalendarAction(
    sessionId,
  );

  return handleDriveSearch(
    sessionId,
    candidate.title,
  );
}

const candidate =
  pending.candidates[
    selectedIndex
  ];

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
  .map((event) => {
    const start =
      event.start?.dateTime ??
      event.start?.date ??
      null;

    const end =
      event.end?.dateTime ??
      event.end?.date ??
      null;

    if (!start || !end) {
      return null;
    }

    return {
      title:
        event.summary?.trim() ||
        "제목 없는 일정",
      start,
      end,
    };
  })
  .filter(
    (
      event,
    ): event is {
      title: string;
      start: string;
      end: string;
    } => event !== null,
  ),
    });

await saveLastAction(
  sessionId,
  {
    type: "calendar_get",
    label: `${rangeLabel} 일정 조회`,
    data: {
      rangeLabel,
    },
  },
);

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

const calendarRepeatWordPattern =
  /(?:다시\s*(?:보여|조회|확인)|한\s*번\s*더\s*(?:보여|조회|확인))/u;

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
  calendarRepeatWordPattern.test(
    rawMessage,
  )
) {
  const rememberedRangeLabel =
    rememberedCalendarContext.rangeLabel?.trim() ??
    "";

  const fastCalendarRange =
    getFastCalendarGetRange(
      rememberedRangeLabel,
    );

  if (fastCalendarRange) {
    console.log(
      "[L-AI Fast Path] Calendar context repeat",
      {
        original: rawMessage,
        rangeLabel:
          fastCalendarRange.rangeLabel,
      },
    );

    return handleCalendarGet(
      sessionId,
      fastCalendarRange.range,
      fastCalendarRange.rangeLabel,
    );
  }
}

  if (
  !calendarDeleteWordPattern.test(
    rawMessage,
  ) &&
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
    "select_delete" ||
  rawPending?.kind ===
    "select_drive_search"
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
  previousBrainTrace:
    Awaited<
      ReturnType<typeof getActiveBrainTrace>
    >,
) {
  let message = currentMessage;

  let routedMessage:
    | Awaited<ReturnType<typeof routeUserMessage>>
    | null = null;

  try {
const contextPreparationStartedAt =
  Date.now();

    const driveContextForRouter =
      getDriveContext(sessionId);

    const calendarContextForRouter =
      getCalendarContext(sessionId);

   const [
  lastActionForContext,
  actionHistoryForContext,
  learningHistoryForContext,
  mailContextForRouter,
] = await Promise.all([
  getLastAction(sessionId),
  getActionHistory(sessionId),
  getLearningHistory(sessionId),
  getMailContext(sessionId),
]);

    const latestLearningChange =
      learningHistoryForContext[0] ?? null;

    const contextSnapshot: ContextSnapshot = {
      lastAction: lastActionForContext
        ? {
            type: lastActionForContext.type,
            label: lastActionForContext.label,
          }
        : null,

recentActions:
  actionHistoryForContext.length > 0
    ? actionHistoryForContext.map(
        (action) => ({
          type: action.type,
          label: action.label,
          createdAt: action.createdAt,
        }),
      )
    : null,

      memory: {
        latestChange: latestLearningChange
          ? {
              category:
                latestLearningChange.category,
              key: latestLearningChange.key,
              previousValue:
                latestLearningChange.previousValue,
              nextValue:
                latestLearningChange.nextValue,
            }
          : null,
      },

      calendar: calendarContextForRouter
        ? {
            recentEvents:
              calendarContextForRouter.events
                .slice(0, 5)
                .map((event) => ({
                  id: null,
                  summary: event.title,
                  start: event.start,
                })),
          }
        : null,

      drive: driveContextForRouter
        ? {
            recentFile: {
              id: driveContextForRouter.fileId,
              name: driveContextForRouter.fileName,
            },
          }
        : null,

      mail: mailContextForRouter
  ? {
      recentQuery:
        mailContextForRouter.recentQuery,
    }
  : null,

      brain: previousBrainTrace
  ? {
      goal: previousBrainTrace.goal,
      state: previousBrainTrace.state,
    }
  : null,
    };

const contextSummary =
  buildContextSummary(contextSnapshot);

  console.log(
  "[L-AI Context Summary]",
  contextSummary,
);

const contextPreparationMs =
  Date.now() -
  contextPreparationStartedAt;

console.log(
  "[L-AI Perf] Context preparation:",
  `${contextPreparationMs}ms`,
);

const contextResolverStartedAt =
  Date.now();

const contextResolution =
  await resolveConversationContext(
    message,
    contextSummary,
  );

const contextResolverMs =
  Date.now() -
  contextResolverStartedAt;

console.log(
  "[L-AI Perf] Context resolver:",
  `${contextResolverMs}ms`,
);

console.log(
  "[L-AI Context Resolver]",
  {
    original: message,
    domain: contextResolution.domain,
    action: contextResolution.action,
    confidence:
      contextResolution.confidence,
    reason: contextResolution.reason,
  },
);

    console.log(
      "[L-AI Memory] Priority selected: ai_router",
      {
        sessionId,
      },
    );

const isContextReferenceAction =
  contextResolution.action === "repeat" ||
  contextResolution.action === "reference" ||
  contextResolution.action === "reuse_previous";

const lastActionDomain =
  lastActionForContext?.type === "memory_recall"
    ? "memory"
    : lastActionForContext?.type.startsWith("drive_")
      ? "drive"
      : lastActionForContext?.type.startsWith("calendar_")
        ? "calendar"
        : lastActionForContext?.type.startsWith("mail_")
          ? "mail"
          : null;

const canFallbackToLastAction =
  contextResolution.domain === "unknown" &&
  isContextReferenceAction &&
  contextResolution.confidence >= 0.7 &&
  lastActionDomain !== null;

const effectiveContextDomain =
  canFallbackToLastAction
    ? lastActionDomain
    : contextResolution.domain;

    console.log(
  "[L-AI Context Effective]",
  {
    resolverDomain:
      contextResolution.domain,
    effectiveDomain:
      effectiveContextDomain,
    action:
      contextResolution.action,
    confidence:
      contextResolution.confidence,
    usedLastActionFallback:
      canFallbackToLastAction,
    lastActionType:
      lastActionForContext?.type ?? null,
  },
);

const shouldUseContextResolution =
  (
    contextResolution.confidence >= 0.85 &&
    contextResolution.action !== "none" &&
    contextResolution.domain !== "unknown"
  ) ||
  canFallbackToLastAction;

const selectedHistoryActionIndex = (() => {
  const normalized =
    message.replace(/\s+/gu, "");

  const wordIndexes: Record<string, number> = {
    첫번째: 0,
    두번째: 1,
    세번째: 2,
    네번째: 3,
    다섯번째: 4,
  };

  for (const [word, index] of Object.entries(
    wordIndexes,
  )) {
    if (normalized.includes(word)) {
      return index;
    }
  }

  const numericMatch =
    /([1-5])(?:번째|번)/u.exec(
      normalized,
    );

  return numericMatch
    ? Number(numericMatch[1]) - 1
    : null;
})();

const selectedHistoryAction =
  selectedHistoryActionIndex !== null
    ? actionHistoryForContext[
        selectedHistoryActionIndex
      ] ?? null
    : null;

const selectedHistoryDriveQuery =
  selectedHistoryAction?.type ===
    "drive_search" &&
  typeof selectedHistoryAction.data?.query ===
    "string"
    ? selectedHistoryAction.data.query.trim()
    : null;

const previousDriveQuery =
  selectedHistoryDriveQuery ||
  (
    lastActionForContext?.type ===
      "drive_search" &&
    typeof lastActionForContext.data?.query ===
      "string"
      ? lastActionForContext.data.query.trim()
      : null
  );

const previousMemoryQuery =
  lastActionForContext?.type === "memory_recall" &&
  typeof lastActionForContext.data?.query === "string"
    ? lastActionForContext.data.query.trim()
    : null;

const previousCalendarRangeLabel =
  lastActionForContext?.type === "calendar_get" &&
  typeof lastActionForContext.data?.rangeLabel === "string"
    ? lastActionForContext.data.rangeLabel.trim()
    : null;

const isGenericDriveContinuationRequest =
  /^(?:계속해|계속|마저\s*해(?:줘)?|아까\s*하던\s*거\s*(?:마저\s*)?해(?:줘)?|하던\s*거\s*(?:계속|마저\s*해(?:줘)?))$/u.test(
    message.trim(),
  );

const previousMailQuery =
  mailContextForRouter?.recentQuery?.trim() ||
  null;

const messageForRouter =
  shouldUseContextResolution &&
  effectiveContextDomain === "memory" &&
  contextResolution.action === "repeat" &&
  previousMemoryQuery
    ? previousMemoryQuery
    : shouldUseContextResolution &&
        effectiveContextDomain === "calendar" &&
        contextResolution.action === "repeat" &&
        previousCalendarRangeLabel
      ? `${previousCalendarRangeLabel} 보여줘`
      : shouldUseContextResolution &&
          effectiveContextDomain === "drive" &&
(
  contextResolution.action === "repeat" ||
  (
    contextResolution.action === "continue" &&
    isGenericDriveContinuationRequest
  )
) &&
previousDriveQuery
        ? `내 Google Drive에서 ${previousDriveQuery} 파일을 찾아줘`
        : shouldUseContextResolution &&
            effectiveContextDomain === "mail" &&
            contextResolution.action === "repeat" &&
            previousMailQuery
          ? `내 메일에서 ${previousMailQuery} 관련 메일을 찾아줘`
          : message;

const aiRouterStartedAt =
  Date.now();

routedMessage = await routeUserMessage(
  messageForRouter,
  {
    previousFileName:
      driveContextForRouter?.fileName ??
      null,

    contextDomain:
      shouldUseContextResolution
        ? effectiveContextDomain
        : null,

    contextAction:
      shouldUseContextResolution
        ? contextResolution.action
        : null,

    contextConfidence:
      shouldUseContextResolution
        ? contextResolution.confidence
        : null,

    contextReason:
      shouldUseContextResolution
        ? contextResolution.reason
        : null,
  },
);

const aiRouterMs =
  Date.now() -
  aiRouterStartedAt;

console.log(
  "[L-AI Perf] AI router:",
  `${aiRouterMs}ms`,
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
        message,
      );

    const calendarResult =
      await parseCalendarRequest(
        calendarMessage,
        new Date(),
      );

    if (calendarResult.kind === "get") {
  const response =
    await handleCalendarGet(
      sessionId,
      calendarResult.range,
      calendarResult.rangeLabel,
    );

  const calendarGetSucceeded =
  response.ok;

const reflection =
  createReflection(
    createPlan({
      message: rawMessage,
      intent: "calendar_get",
      confidence:
        routedMessage?.confidence ??
        null,
    }),
    calendarGetSucceeded
      ? {
          completedToolIds: [
            "calendar.get",
          ],
        }
      : {
          failed: true,
        },
  );

  console.log(
    "[L-AI Brain] Reflection",
    reflection,
  );

  return response;
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

async function handleBrainTraceRecall(
  sessionId: string,
  rawMessage: string,
) {
  const normalized =
    rawMessage.trim().toLowerCase();

  const brainRecallPattern =
  /(?:방금\s*작업|마지막\s*작업|작업\s*어떻게\s*됐|작업\s*성공|작업\s*실패)/u;
  if (!brainRecallPattern.test(normalized)) {
    return null;
  }

  const trace =
    await getLastBrainTrace(
      sessionId,
    );

  if (!trace) {
    return chatReply(
      "최근에 완료된 작업 기록을 찾지 못했어.",
    );
  }

  const stateLabel =
    trace.state === "success"
      ? "성공"
      : trace.state === "failed"
        ? "실패"
        : trace.state;

  const completedSteps =
    trace.reflection
      ?.completedSteps
      ?.join(", ") ??
    "기록 없음";

  return chatReply(
    [
      `마지막 작업은 **${stateLabel}** 상태로 끝났어.`,
      "",
      `작업 목표: ${trace.goal}`,
      `완료 단계: ${completedSteps}`,
      `Trace ID: ${trace.traceId}`,
    ].join("\n"),
  );
}

async function handleChatRequest(request: Request, sessionId: string) {
  let rawMessage = "";
let uploadedFile: File | null = null;

const contentType =
  request.headers.get("content-type") ?? "";

if (
  contentType.includes(
    "multipart/form-data",
  )
) {
  try {
    const formData =
      await request.formData();

    const messageValue =
      formData.get("message");

    const fileValue =
      formData.get("file");

    rawMessage =
      typeof messageValue === "string"
        ? messageValue.trim()
        : "";

    if (fileValue instanceof File) {
      uploadedFile = fileValue;
    }
  } catch {
    return chatError(
      "파일 첨부 요청을 읽지 못했어.",
      400,
    );
  }
} else {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return chatError(
      "올바른 요청 형식이 필요해.",
      400,
    );
  }

  if (!isChatRequestBody(body)) {
    return chatError(
      "message 값을 입력해줘.",
      400,
    );
  }

  rawMessage =
    body.message.trim();
}

if (!rawMessage) {
  return chatError(
    "message 값을 입력해줘.",
    400,
  );
}

if (uploadedFile) {
  console.log(
    "[L-AI Attachment] Received:",
    {
      name: uploadedFile.name,
      type: uploadedFile.type,
      size: uploadedFile.size,
    },
  );
}

const looksLikeFileLearningRequest =
  Boolean(uploadedFile) &&
  /(?:기억|기억해|기억해줘|저장|저장해|저장해줘|장기기억|나에\s*대한\s*정보|내\s*정보)/u.test(
    rawMessage,
  );

if (
  uploadedFile &&
  looksLikeFileLearningRequest
) {
  try {
    const arrayBuffer =
      await uploadedFile.arrayBuffer();

    const fileBase64 =
      Buffer.from(
        arrayBuffer,
      ).toString("base64");

    const facts =
      await extractProfileFactsFromFile(
        rawMessage,
        fileBase64,
        uploadedFile.name,
        uploadedFile.type,
      );

    if (facts.length === 0) {
      return chatReply(
        "이 파일에서는 장기기억 후보로 저장할 만한 사용자 정보를 찾지 못했어.",
      );
    }

    const pendingFacts =
      facts.map((fact) => ({
        category: fact.category,
        key: fact.key,
        value: fact.value,
        updatedAt: Date.now(),
      }));

    await setPendingLearningCandidates(
      sessionId,
      pendingFacts,
    );

    const lines =
      pendingFacts.map(
        (fact) =>
          `- **${fact.value}**`,
      );

    return chatReply(
      [
        "이 파일에서 장기기억 후보를 찾았어.",
        "",
        ...lines,
        "",
        "이 정보들을 저장할까?",
        "",
        "원하면 저장 전에 수정하거나 새 정보를 추가해도 돼.",
      ].join("\n"),
    );
  } catch (error) {
    console.error(
      "[L-AI Learning] File learning analysis failed:",
      error,
    );

    return chatError(
      "첨부파일에서 장기기억 후보를 분석하지 못했어.",
      500,
    );
  }
}

if (
  uploadedFile &&
  uploadedFile.type.startsWith("image/")
) {
  try {
    const arrayBuffer =
      await uploadedFile.arrayBuffer();

    const imageBase64 =
      Buffer.from(
        arrayBuffer,
      ).toString("base64");

    const learningFacts =
      await getLearningFacts(
        sessionId,
      );

    const userMemory =
      learningFacts.length > 0
        ? learningFacts
            .map(
              (fact) =>
                `- [${fact.category}/${fact.key}] ${fact.value}`,
            )
            .join("\n")
        : null;

    const reply =
      await generateAssistantReplyWithImage(
        rawMessage,
        imageBase64,
        uploadedFile.type,
        userMemory,
      );

    return chatReply(reply);
  } catch (error) {
    console.error(
      "[L-AI Attachment] Image analysis failed:",
      error,
    );

    return chatError(
      "이미지 내용을 분석하지 못했어.",
      500,
    );
  }
}

if (
  uploadedFile &&
  (
    uploadedFile.type === "application/pdf" ||
    uploadedFile.name.toLowerCase().endsWith(".pdf")
  )
) {
  try {
    const arrayBuffer =
      await uploadedFile.arrayBuffer();

    const fileBase64 =
      Buffer.from(
        arrayBuffer,
      ).toString("base64");

    const learningFacts =
      await getLearningFacts(
        sessionId,
      );

    const userMemory =
      learningFacts.length > 0
        ? learningFacts
            .map(
              (fact) =>
                `- [${fact.category}/${fact.key}] ${fact.value}`,
            )
            .join("\n")
        : null;

    const reply =
      await generateAssistantReplyWithFile(
        rawMessage,
        fileBase64,
        uploadedFile.name,
        userMemory,
      );

    return chatReply(reply);
  } catch (error) {
    console.error(
      "[L-AI Attachment] PDF analysis failed:",
      error,
    );

    return chatError(
      "PDF 파일 내용을 분석하지 못했어.",
      500,
    );
  }
}

if (
  uploadedFile &&
  (
    uploadedFile.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    uploadedFile.name.toLowerCase().endsWith(".docx")
  )
) {
  try {
    const arrayBuffer =
      await uploadedFile.arrayBuffer();

    const fileBase64 =
      Buffer.from(
        arrayBuffer,
      ).toString("base64");

    const learningFacts =
      await getLearningFacts(
        sessionId,
      );

    const userMemory =
      learningFacts.length > 0
        ? learningFacts
            .map(
              (fact) =>
                `- [${fact.category}/${fact.key}] ${fact.value}`,
            )
            .join("\n")
        : null;

    const reply =
      await generateAssistantReplyWithFile(
        rawMessage,
        fileBase64,
        uploadedFile.name,
        userMemory,
      );

    return chatReply(reply);
  } catch (error) {
    console.error(
      "[L-AI Attachment] DOCX analysis failed:",
      error,
    );

    return chatError(
      "DOCX 파일 내용을 분석하지 못했어.",
      500,
    );
  }
}

if (
  uploadedFile &&
  (
    uploadedFile.type ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    uploadedFile.name.toLowerCase().endsWith(".pptx")
  )
) {
  try {
    const arrayBuffer =
      await uploadedFile.arrayBuffer();

    const fileBase64 =
      Buffer.from(
        arrayBuffer,
      ).toString("base64");

    const learningFacts =
      await getLearningFacts(
        sessionId,
      );

    const userMemory =
      learningFacts.length > 0
        ? learningFacts
            .map(
              (fact) =>
                `- [${fact.category}/${fact.key}] ${fact.value}`,
            )
            .join("\n")
        : null;

    const reply =
      await generateAssistantReplyWithFile(
        rawMessage,
        fileBase64,
        uploadedFile.name,
        userMemory,
      );

    return chatReply(reply);
  } catch (error) {
    console.error(
      "[L-AI Attachment] PPTX analysis failed:",
      error,
    );

    return chatError(
      "PPTX 파일 내용을 분석하지 못했어.",
      500,
    );
  }
}

if (
  uploadedFile &&
  (
    uploadedFile.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    uploadedFile.name.toLowerCase().endsWith(".xlsx")
  )
) {
  try {
    const arrayBuffer =
      await uploadedFile.arrayBuffer();

    const fileBase64 =
      Buffer.from(
        arrayBuffer,
      ).toString("base64");

    const learningFacts =
      await getLearningFacts(
        sessionId,
      );

    const userMemory =
      learningFacts.length > 0
        ? learningFacts
            .map(
              (fact) =>
                `- [${fact.category}/${fact.key}] ${fact.value}`,
            )
            .join("\n")
        : null;

    const reply =
      await generateAssistantReplyWithFile(
        rawMessage,
        fileBase64,
        uploadedFile.name,
        userMemory,
      );

    return chatReply(reply);
  } catch (error) {
    console.error(
      "[L-AI Attachment] XLSX analysis failed:",
      error,
    );

    return chatError(
      "XLSX 파일 내용을 분석하지 못했어.",
      500,
    );
  }
}

if (
  uploadedFile &&
  (
    uploadedFile.type === "text/plain" ||
    uploadedFile.name.toLowerCase().endsWith(".txt") ||
    uploadedFile.name.toLowerCase().endsWith(".md")
  )
) {

  try {
    const fileText =
      await uploadedFile.text();

    const trimmedFileText =
      fileText.slice(0, 30_000);

    const learningFacts =
      await getLearningFacts(
        sessionId,
      );

    const userMemory =
      learningFacts.length > 0
        ? learningFacts
            .map(
              (fact) =>
                `- [${fact.category}/${fact.key}] ${fact.value}`,
            )
            .join("\n")
        : null;

    const reply =
      await generateAssistantReply(
        [
          rawMessage,
          "",
          `첨부 파일명: ${uploadedFile.name}`,
          "",
          "--- 첨부 파일 내용 시작 ---",
          trimmedFileText,
          "--- 첨부 파일 내용 끝 ---",
        ].join("\n"),
        userMemory,
      );

    return chatReply(reply);
  } catch (error) {
    console.error(
      "[L-AI Attachment] Text file analysis failed:",
      error,
    );

    return chatError(
      "텍스트 파일 내용을 읽지 못했어.",
      500,
    );
  }
}

let message = rawMessage;

const normalizedSelfCheckMessage =
  rawMessage
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/u, "");

const isSelfCheckRequest =
  /(?:자가진단|자가\s*진단|전체\s*기능\s*점검|기능\s*점검|상태\s*점검|(?:오류|문제)(?:가)?\s*(?:있는지|있는\s*(?:거|것)|있(?:어|나|나요))|전체\s*테스트|기능\s*테스트)/u.test(
    normalizedSelfCheckMessage,
  );

if (isSelfCheckRequest) {
  const report =
    await runSelfCheck(
      sessionId,
    );

  return chatReply(
    formatSelfCheckReport(
      report,
    ),
  );
}

const isLearningProfileListRequest =
  /(?:나에\s*대해\s*(?:뭐|무엇).*(?:기억|알고)|내\s*(?:정보|기억).*(?:보여|알려)|(?:기억한|저장한|학습한)\s*(?:내\s*)?(?:정보|내용).*(?:전체|전부)?.*(?:보여|알려)|내가\s*알려준\s*(?:정보|내용).*(?:보여|알려))/u.test(
    rawMessage,
  );

if (isLearningProfileListRequest) {
  const facts =
    await getLearningFacts(
      sessionId,
    );

  if (facts.length === 0) {
    return chatReply(
      "아직 장기기억에 저장된 사용자 정보가 없어.",
    );
  }

  const categoryNames: Record<
    string,
    string
  > = {
    identity: "기본 정보",
    preference: "선호",
    habit: "습관",
    communication: "대화·설명 방식",
    school: "학교",
    work: "업무",
    project: "프로젝트",
    relationship: "인물·관계",
    goal: "목표",
    other: "기타",
  };

  const grouped =
    new Map<
      string,
      typeof facts
    >();

  for (const fact of facts) {
    const existing =
      grouped.get(
        fact.category,
      ) ?? [];

    existing.push(fact);

    grouped.set(
      fact.category,
      existing,
    );
  }

  const sections =
    Array.from(
      grouped.entries(),
    ).map(
      ([category, items]) => {
        const title =
          categoryNames[
            category
          ] ?? category;

        const lines =
          items.map(
            (fact) =>
              `- ${fact.value}`,
          );

        return [
          `### ${title}`,
          ...lines,
        ].join("\n");
      },
    );

  return chatReply(
    [
      "## 내가 기억하고 있는 사용자 정보",
      "",
      ...sections,
      "",
      `총 ${facts.length}개의 정보를 기억하고 있어.`,
    ].join("\n\n"),
  );
}    

const normalizedLearningCommand =
  rawMessage
    .trim()
    .toLowerCase()
    .replace(/[.!?。！？]+$/u, "");

const isLearningModeStart =
  /^(?:엘리[,\s]*)?(?:(?:지금부터|이제)\s*)?(?:(?:사용자\s*정보|내\s*정보)(?:를|을)?\s*)?(?:(?:등록|학습|입력)(?:을|를)?\s*)?(?:시작|시작할게|시작해|시작해줘|할게|해보자)$/u.test(
    normalizedLearningCommand,
  );

const isLearningModeEnd =
  /^(?:엘리[,\s]*)?(?:(?:이제|오늘은|일단)\s*)?(?:(?:사용자\s*정보|내\s*정보)(?:를|을)?\s*)?(?:(?:등록|학습|입력)(?:을|를)?\s*)?(?:끝|종료|끝낼게|종료할게|끝내|끝내줘|종료해|종료해줘|여기까지|그만할게|멈춰|멈출게|멈춰줘|멈추자)$/u.test(
    normalizedLearningCommand,
  );

if (isLearningModeStart) {
  const status =
    await setLearningMode(
      sessionId,
      true,
    );

  if (status === "failed") {
    return chatError(
      "사용자 정보 등록 모드를 시작하지 못했어.",
      500,
    );
  }

  return chatReply(
    "사용자 정보 등록 모드를 시작했어. 이제 형식 신경 쓰지 말고 나한테 기억시키고 싶은 내용을 편하게 말해줘.",
  );
}

if (isLearningModeEnd) {
  const status =
    await setLearningMode(
      sessionId,
      false,
    );

  if (status === "failed") {
    return chatError(
      "사용자 정보 등록 모드를 종료하지 못했어.",
      500,
    );
  }

  return chatReply(
    "사용자 정보 등록 모드를 종료했어. 지금까지 알려준 정보는 앞으로 대화할 때 참고할게.",
  );
}

const looksLikeLearningRollbackRequest =
  /(?:다시\s*원래대로|원래대로\s*(?:해줘|돌려줘|바꿔줘)?|이전(?:으로|값으로)\s*(?:돌려줘|바꿔줘)?|방금\s*(?:수정한|바꾼)\s*(?:거|것)\s*(?:되돌려줘|돌려줘)|아까\s*(?:수정하기\s*전|바꾸기\s*전)(?:으로)?\s*(?:돌려줘|해줘)?)/u.test(
    rawMessage,
  );

if (looksLikeLearningRollbackRequest) {
  const result =
    await undoLatestLearningChange(
      sessionId,
    );

  if (result.status === "failed") {
    return chatError(
      "이전 사용자 정보로 되돌리지 못했어.",
      500,
    );
  }

  if (!result.undone) {
    return chatReply(
      "되돌릴 사용자 정보 변경 기록이 없어.",
    );
  }

  if (result.undone.previousValue === null) {
    return chatReply(
      `알겠어. 최근에 추가했던 **${result.undone.nextValue ?? "사용자 정보"}**를 취소했어.`,
    );
  }

  return chatReply(
    `알겠어. **${result.undone.nextValue ?? "최근 값"}**에서 **${result.undone.previousValue}**로 되돌렸어.`,
  );
}

const looksLikeCalendarOperationMessage =
  /(?:일정|캘린더|calendar)/iu.test(
    rawMessage,
  ) &&
  /(?:추가|등록|만들|수정|바꿔|변경|삭제|지워|취소|조회|보여|확인)/u.test(
    rawMessage,
  );

const semanticLearningStartedAt =
  Date.now();

const semanticLearningFacts =
  looksLikeCalendarOperationMessage
    ? []
    : await getLearningFacts(
        sessionId,
      );

console.log(
  "[L-AI Perf] Semantic learning facts:",
  `${Date.now() - semanticLearningStartedAt}ms`,
);

const semanticMemoryStartedAt =
  Date.now();

const semanticMemoryResult =
  looksLikeCalendarOperationMessage
    ? {
        intent: "none" as const,
        confidence: 0,
      }
    : await interpretMemoryRequest(
        rawMessage,
        semanticLearningFacts,
      );

console.log(
  "[L-AI Perf] Semantic memory interpreter:",
  `${Date.now() - semanticMemoryStartedAt}ms`,
);

const looksLikeActionHistoryReference =
  (
    /(?:첫|두|세|네|다섯|\d+)\s*(?:번째|번)\s*(?:거|것|작업|항목)?/u.test(
      rawMessage,
    ) ||
    /(?:그거\s*말고\s*(?:전에|이전)|그\s*전\s*거|두\s*단계\s*전)/u.test(
      rawMessage,
    )
  ) &&
  /(?:다시|보여|해줘|실행|말해|찾아|열어)/u.test(
    rawMessage,
  );

const looksLikeSemanticRecall =
  !looksLikeCalendarOperationMessage &&
  !looksLikeActionHistoryReference &&
  semanticMemoryResult.intent === "recall" &&
  semanticMemoryResult.confidence >= 0.8;

const looksLikeSemanticUpdate =
  !looksLikeCalendarOperationMessage &&
  !looksLikeActionHistoryReference &&
  semanticMemoryResult.intent === "update" &&
  semanticMemoryResult.confidence >= 0.8;

const looksLikeSemanticAdd =
  !looksLikeCalendarOperationMessage &&
  !looksLikeActionHistoryReference &&
  semanticMemoryResult.intent === "add" &&
  semanticMemoryResult.confidence >= 0.8;

const looksLikeSemanticDelete =
  !looksLikeCalendarOperationMessage &&
  !looksLikeActionHistoryReference &&
  semanticMemoryResult.intent === "delete" &&
  semanticMemoryResult.confidence >= 0.8;

const looksLikeLearningDeleteRequest =
  !looksLikeCalendarOperationMessage &&
  !looksLikeActionHistoryReference &&
  /(?:기억하지\s*마|기억하지마|삭제해|삭제해줘|지워|지워줘|잊어|잊어줘)/u.test(
    rawMessage,
  );

if (
  looksLikeLearningDeleteRequest ||
  looksLikeSemanticDelete
) {
  const deleteTarget =
    await extractLearningDeleteTarget(
      rawMessage,
    );

  if (deleteTarget.kind === "recent") {
    const result =
      await deleteMostRecentLearningFact(
        sessionId,
      );

    if (result.status === "failed") {
      return chatError(
        "최근 사용자 정보를 삭제하지 못했어.",
        500,
      );
    }

    if (!result.deleted) {
      return chatReply(
        "삭제할 최근 사용자 정보가 없어.",
      );
    }

    console.log(
      "[L-AI Learning] Deleted recent fact:",
      {
        sessionId,
        deleted:
          result.deleted,
      },
    );

    return chatReply(
      `방금 기억한 정보 중 **${result.deleted.value}** 관련 내용을 삭제했어.`,
    );
  }

  if (deleteTarget.kind === "specific") {
    const result =
      await deleteLearningFact(
        sessionId,
        deleteTarget.category,
        deleteTarget.key,
      );

    if (result.status === "failed") {
      return chatError(
        "사용자 정보를 삭제하지 못했어.",
        500,
      );
    }

    if (!result.deleted) {
      return chatReply(
        "그 정보는 현재 장기기억에서 찾지 못했어.",
      );
    }

    console.log(
      "[L-AI Learning] Deleted specific fact:",
      {
        sessionId,
        category:
          deleteTarget.category,
        key:
          deleteTarget.key,
      },
    );

    return chatReply(
      "해당 사용자 정보를 장기기억에서 삭제했어.",
    );
  }

  return chatReply(
    "어떤 정보를 지우면 되는지 조금만 더 구체적으로 말해줘.",
  );
}

const APPROVE_SHORT_REPLIES = new Set([
  "ㅇㅇ",
  "얍",
  "엉",
  "그려",
  "ㄱㄱ",
  "ㄱ",
  "진행해",
  "좋다",
  "낫벧",
  "진행시켜",
  "ㅇ",
  "웅",
  "응",
  "ㄹㅊㄱ",
  "그래",
  "좋아",
  "네",
  "넵",
  "예",
  "ok",
  "okay",
]);

const pendingLearningConflict =
  await getPendingLearningConflict(
    sessionId,
  );

if (pendingLearningConflict) {
  const normalizedReply =
    rawMessage.trim().toLowerCase();

  const approve =
  APPROVE_SHORT_REPLIES.has(
    normalizedReply,
  ) ||
  /^(?:일단\s*)?(?:(?:그거|그것|그것들|이거|이것|이것들|전부|모두)\s*)?(?:그대로\s*)?(?:저장|저장해|저장해줘|기억|기억해|기억해줘)$/u.test(
    normalizedReply,
  );

  const reject =
    /^(?:아니|아니요|ㄴㄴ|취소|그만|됐어|안\s*할래)$/u.test(
      normalizedReply,
    );

  if (approve) {
    const nextFacts =
      pendingLearningConflict.conflicts.map(
        (conflict) =>
          conflict.next,
      );

    const result =
      await upsertLearningFacts(
        sessionId,
        nextFacts,
      );

    await clearPendingLearningConflict(
      sessionId,
    );

    if (result.status === "failed") {
      return chatError(
        "사용자 정보를 수정하지 못했어.",
        500,
      );
    }

    if (
      pendingLearningConflict.conflicts.length ===
      1
    ) {
      const conflict =
        pendingLearningConflict.conflicts[0];

      return chatReply(
        `알겠어. **${conflict.previous.value}**에서 **${conflict.next.value}**로 수정해서 기억했어.`,
      );
    }

    return chatReply(
      `알겠어. ${pendingLearningConflict.conflicts.length}개의 사용자 정보를 수정해서 기억했어.`,
    );
  }

  if (reject) {
    await clearPendingLearningConflict(
      sessionId,
    );

    return chatReply(
      "알겠어. 기존 사용자 정보는 그대로 유지할게.",
    );
  }
}

const pendingLearningCandidates =
  await getPendingLearningCandidates(
    sessionId,
  );

if (pendingLearningCandidates) {
  const normalizedReply =
    rawMessage.trim().toLowerCase();

  const approve =
  APPROVE_SHORT_REPLIES.has(
    normalizedReply,
  ) ||
  /^(?:일단\s*)?(?:(?:그거|그것|그것들|이거|이것|이것들|전부|모두)\s*)?(?:그대로\s*)?(?:저장|저장해|저장해줘|기억|기억해|기억해줘)$/u.test(
    normalizedReply,
  );

  const reject =
    /^(?:아니|아니요|ㄴㄴ|취소|그만|됐어|안\s*할래)$/u.test(
      normalizedReply,
    );

  if (approve) {
    const facts =
      pendingLearningCandidates.facts.map(
        (fact) => ({
          category: fact.category,
          key: fact.key,
          value: fact.value,
        }),
      );

    const result =
      await upsertLearningFacts(
        sessionId,
        facts,
      );

    await clearPendingLearningCandidates(
      sessionId,
    );

    if (result.status === "failed") {
      return chatError(
        "장기기억 후보를 저장하지 못했어.",
        500,
      );
    }

    return chatReply(
      `알겠어. ${facts.length}개의 정보를 장기기억에 저장했어.`,
    );
  }

  if (reject) {
    await clearPendingLearningCandidates(
      sessionId,
    );

    return chatReply(
      "알겠어. 이번 장기기억 후보는 저장하지 않을게.",
    );
  }

  const edits =
    await extractLearningCandidateEdits(
      rawMessage,
      pendingLearningCandidates.facts,
    );

  if (edits.length > 0) {
    const updatedFacts =
      pendingLearningCandidates.facts.map(
        (fact) => ({
          ...fact,
        }),
      );

    for (const edit of edits) {
      const index =
        updatedFacts.findIndex(
          (fact) =>
            fact.category === edit.category &&
            fact.key === edit.key,
        );

      if (edit.action === "remove") {
        if (index >= 0) {
          updatedFacts.splice(index, 1);
        }

        continue;
      }

      if (!edit.value) {
        continue;
      }

      if (index >= 0) {
        updatedFacts[index] = {
          ...updatedFacts[index],
          value: edit.value,
          updatedAt: Date.now(),
        };
      } else {
        updatedFacts.push({
          category: edit.category,
          key: edit.key,
          value: edit.value,
          updatedAt: Date.now(),
        });
      }
    }

    await setPendingLearningCandidates(
      sessionId,
      updatedFacts,
    );

    const lines =
      updatedFacts.map(
        (fact) =>
          `- **${fact.value}**`,
      );

    return chatReply(
      [
        "수정했어.",
        "",
        ...lines,
        "",
        "이 내용으로 저장할까?",
      ].join("\n"),
    );
  }
}

if (looksLikeSemanticAdd) {
  const facts =
    await extractProfileFacts(
      rawMessage,
    );

  if (facts.length === 0) {
    return chatReply(
      "기억할 사용자 정보를 정확히 찾지 못했어. 조금만 더 구체적으로 말해줘.",
    );
  }

  const conflicts = [];

  for (const fact of facts) {
    const existingFact =
      await getLearningFact(
        sessionId,
        fact.category,
        fact.key,
      );

    if (
      existingFact &&
      existingFact.value !== fact.value
    ) {
      conflicts.push({
        previous: existingFact,
        next: fact,
      });
    }
  }

  if (conflicts.length > 0) {
    const status =
      await setPendingLearningConflict(
        sessionId,
        conflicts,
      );

    if (status === "failed") {
      return chatError(
        "사용자 정보 확인 상태를 저장하지 못했어.",
        500,
      );
    }

    const lines =
      conflicts.map(
        (conflict) =>
          `- **${conflict.previous.value}** → **${conflict.next.value}**`,
      );

    return chatReply(
      [
        "기존 기억과 다른 정보가 있어.",
        "",
        ...lines,
        "",
        "이렇게 수정해서 기억할까?",
      ].join("\n"),
    );
  }

  const result =
    await upsertLearningFacts(
      sessionId,
      facts,
    );

  if (result.status === "failed") {
    return chatError(
      "사용자 정보를 기억하지 못했어.",
      500,
    );
  }

  return chatReply(
    facts.length === 1
      ? `알겠어. **${facts[0].value}** 정보도 기억해둘게.`
      : `알겠어. ${facts.length}개의 사용자 정보를 추가로 기억했어.`,
  );
}

const looksLikeLearningUpdateRequest =
  !(
    /(?:일정|캘린더|calendar)/iu.test(
      rawMessage,
    ) &&
    /(?:추가|등록|만들|수정|바꿔|변경|삭제|지워|취소|조회|보여|확인)/u.test(
      rawMessage,
    )
  ) &&
  /(?:바꿔|바꿔줘|변경|변경해|변경해줘|수정|수정해|수정해줘|정정|정정해|정정해줘|아니고|아니야)/u.test(
    rawMessage,
  );

if (
  looksLikeLearningUpdateRequest ||
  looksLikeSemanticUpdate
) {
  const facts =
    await extractProfileFacts(
      rawMessage,
    );

  if (facts.length === 0) {
    return chatReply(
      "어떤 사용자 정보를 어떻게 바꾸면 되는지 조금만 더 구체적으로 말해줘.",
    );
  }

  const conflicts = [];

for (const fact of facts) {
  const existingFact =
    await getLearningFact(
      sessionId,
      fact.category,
      fact.key,
    );

  if (
    existingFact &&
    existingFact.value !== fact.value
  ) {
    conflicts.push({
      previous: existingFact,
      next: fact,
    });
  }
}

if (conflicts.length > 0) {
  const status =
    await setPendingLearningConflict(
      sessionId,
      conflicts,
    );

  if (status === "failed") {
    return chatError(
      "사용자 정보 수정 확인 상태를 저장하지 못했어.",
      500,
    );
  }

  if (conflicts.length === 1) {
    const conflict =
      conflicts[0];

    return chatReply(
      `기존에는 **${conflict.previous.value}**로 기억하고 있어. **${conflict.next.value}**로 수정할까?`,
    );
  }

  const conflictLines =
    conflicts.map(
      (conflict) =>
        `- **${conflict.previous.value}** → **${conflict.next.value}**`,
    );

  return chatReply(
    [
      `${conflicts.length}개의 정보가 기존 기억과 달라.`,
      "",
      ...conflictLines,
      "",
      "전부 수정할까?",
    ].join("\n"),
  );
}

  const result =
    await upsertLearningFacts(
      sessionId,
      facts,
    );

  if (result.status === "failed") {
    return chatError(
      "사용자 정보를 수정하지 못했어.",
      500,
    );
  }

  console.log(
    "[L-AI Learning] Updated profile facts:",
    {
      sessionId,
      facts,
    },
  );

  return chatReply(
    facts.length === 1
      ? "알겠어. 해당 사용자 정보를 수정해서 기억했어."
      : `알겠어. ${facts.length}개의 사용자 정보를 수정해서 기억했어.`,
  );
}

const learningMode =
  await getLearningMode(sessionId);

if (learningMode.enabled) {
  const originalResult =
    await appendLearningProfileEntry(
      sessionId,
      rawMessage,
    );

  if (originalResult.status === "failed") {
    return chatError(
      "사용자 정보를 저장하지 못했어.",
      500,
    );
  }

  const facts =
    await extractProfileFacts(
      rawMessage,
    );

  if (facts.length > 0) {
    const structuredResult =
      await upsertLearningFacts(
        sessionId,
        facts,
      );

    if (
      structuredResult.status ===
      "failed"
    ) {
      return chatError(
        "사용자 정보를 분석했지만 장기기억 저장에 실패했어.",
        500,
      );
    }

    console.log(
      "[L-AI Learning] Stored profile facts:",
      {
        sessionId,
        facts,
      },
    );

    return chatReply(
      `기억해둘게. 이번 내용에서 ${facts.length}개의 장기정보를 정리해서 저장했어. 계속 편하게 알려줘.`,
    );
  }

  return chatReply(
    "내용은 기록했어. 다만 이번 말에서는 장기적으로 저장할 사용자 정보는 따로 찾지 못했어. 계속 편하게 알려줘.",
  );
}

const looksLikeProfileRecallRequest =
  /(?:내\s*(?:이름|생일|나이|학교|직업|취향|관심사|목표)|내가\s*(?:좋아하는|싫어하는)|나에\s*대해|나(?:는)?\s*(?:어디|어느|무슨)\s*학교|나\s*학교\s*어디|내가\s*(?:어디|어느|무슨)\s*학교)/u.test(
    rawMessage,
  );

if (
  looksLikeProfileRecallRequest ||
  looksLikeSemanticRecall
) {
  const learningFacts =
    await getLearningFacts(
      sessionId,
    );

  if (learningFacts.length === 0) {
    return chatReply(
      "아직 그 질문에 답할 수 있는 사용자 정보를 기억하고 있지 않아.",
    );
  }

  const userMemory =
    learningFacts
      .map(
        (fact) =>
          `- [${fact.category}/${fact.key}] ${fact.value}`,
      )
      .join("\n");

  console.log(
    "[L-AI Learning] Profile recall:",
    {
      sessionId,
      facts:
        learningFacts.map(
          (fact) => ({
            category:
              fact.category,
            key:
              fact.key,
            value:
              fact.value,
          }),
        ),
    },
  );

  const reply =
  await generateAssistantReply(
    rawMessage,
    userMemory,
  );

await saveLastAction(
  sessionId,
  {
    type: "memory_recall",
    label: "사용자 정보 조회",
    data: {
      query: rawMessage,
    },
  },
);

return chatReply(reply);
}

const brainTraceRecallResponse =
  await handleBrainTraceRecall(
    sessionId,
    rawMessage,
  );

if (brainTraceRecallResponse) {
  return brainTraceRecallResponse;
}

const brainPreparationStartedAt =
  Date.now();

const prePlan = createPlan({
  message: rawMessage,
  intent: null,
  confidence: null,
});

console.log(
  "[L-AI Brain] Pre-plan",
  {
    goal: prePlan.goal,
    source: prePlan.source,
    risk: prePlan.risk,
    requiresConfirmation:
      prePlan.requiresConfirmation,
    confidence:
      prePlan.confidence,
    steps: prePlan.steps,
  },
);

console.log(
  "[L-AI Perf] Brain preparation:",
  `${Date.now() - brainPreparationStartedAt}ms`,
);

const contextHydrationStartedAt =
  Date.now();

const brainTraceStartedAt =
  Date.now();

const existingBrainTrace =
  await getActiveBrainTrace(
    sessionId,
  );

const looksLikeBrainContinuation =
  /(?:^\s*\d+\s*번|전부|모두|추가해|등록해|넣어줘|취소)/u.test(
    rawMessage,
  );

const brainTrace =
  existingBrainTrace &&
  existingBrainTrace.state ===
    "waiting" &&
  looksLikeBrainContinuation
    ? existingBrainTrace
    : await createBrainTrace(
        sessionId,
        prePlan,
      );

console.log(
  "[L-AI Perf] Brain trace:",
  `${Date.now() - brainTraceStartedAt}ms`,
);

console.log(
  "[L-AI Brain] Trace",
  {
    traceId:
      brainTrace.traceId,
    state:
      brainTrace.state,
    goal:
      brainTrace.goal,
  },
);

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

console.log(
  "[L-AI Perf] Context hydration:",
  `${Date.now() - contextHydrationStartedAt}ms`,
);

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

const looksLikeCalendarToDriveRequest =
  /(?:그\s*일정|해당\s*일정|이\s*일정)/u.test(
    rawMessage,
  ) &&
  /(?:관련|연관)/u.test(
    rawMessage,
  ) &&
  /(?:파일|문서)/u.test(
    rawMessage,
  ) &&
  /(?:찾아|검색|보여)/u.test(
    rawMessage,
  );

if (
  looksLikeCalendarToDriveRequest &&
  rememberedCalendarContext &&
  rememberedCalendarContext.events.length > 1
) {
  const candidates =
    rememberedCalendarContext.events.map(
      (event) => ({
        title: event.title,
        start: event.start,
        end: event.end,
      }),
    );

  setPendingCalendarAction(
    sessionId,
    {
      kind: "select_drive_search",
      candidates,
    },
  );

  const options =
    candidates
      .map(
        (event, index) =>
          `${index + 1}. ${event.title}`,
      )
      .join("\n");

  return chatReply(
    `관련 파일을 찾을 일정이 여러 개 있어. 어떤 일정인지 골라줘.\n\n${options}`,
  );
}

if (
  looksLikeCalendarToDriveRequest &&
  rememberedCalendarContext?.events.length === 1
) {
  const targetEvent =
    rememberedCalendarContext.events[0];

  console.log(
    "[L-AI Cross Domain] Calendar -> Drive",
    {
      sessionId,
      eventTitle: targetEvent.title,
    },
  );

  return handleDriveSearch(
    sessionId,
    targetEvent.title,
  );
}

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

const looksLikeFastCalendarGet =
  /(?:일정|캘린더|calendar)/iu.test(
    rawMessage,
  ) &&
  /(?:보여|조회|확인|알려)/u.test(
    rawMessage,
  ) &&
  /(?:오늘|내일|모레|이번\s*주|다음\s*주|이번\s*달|다음\s*달|\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/u.test(
    rawMessage,
  ) &&
  !/(?:추가|등록|만들|수정|바꿔|변경|삭제|지워|취소)/u.test(
    rawMessage,
  ) &&
  !/(?:그거|그\s*일정|아까|전에|이전|다시|첫\s*번째|두\s*번째|세\s*번째|네\s*번째|\d+\s*번째)/u.test(
    rawMessage,
  );

if (looksLikeFastCalendarGet) {
  const fastPathStartedAt =
    Date.now();

  const fastCalendarRange =
    getFastCalendarGetRange(
      rawMessage,
    );

  if (fastCalendarRange) {
    console.log(
      "[L-AI Fast Path] Local calendar range",
      {
        original: rawMessage,
        rangeLabel:
          fastCalendarRange.rangeLabel,
        range:
          fastCalendarRange.range,
      },
    );

    const response =
      await handleCalendarGet(
        sessionId,
        fastCalendarRange.range,
        fastCalendarRange.rangeLabel,
      );

    console.log(
      "[L-AI Perf] Calendar fast path:",
      `${Date.now() - fastPathStartedAt}ms`,
    );

    return response;
  }

  const calendarResult =
    await parseCalendarRequest(
      rawMessage,
      new Date(),
    );

  if (calendarResult.kind === "get") {
    console.log(
      "[L-AI Fast Path] Calendar get",
      {
        original: rawMessage,
        rangeLabel:
          calendarResult.rangeLabel,
      },
    );

    const response =
      await handleCalendarGet(
        sessionId,
        calendarResult.range,
        calendarResult.rangeLabel,
      );

    const reflection =
      createReflection(
        createPlan({
          message: rawMessage,
          intent: "calendar_get",
          confidence: 1,
        }),
        {
          completedToolIds: [
            "calendar.get",
          ],
        },
      );

    console.log(
      "[L-AI Brain] Reflection",
      reflection,
    );

    console.log(
      "[L-AI Perf] Calendar fast path:",
      `${Date.now() - fastPathStartedAt}ms`,
    );

    return response;
  }
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
    existingBrainTrace,
  );

if (routerResult.response) {
  return routerResult.response;
}

const routedMessage =
  routerResult.routedMessage;

message = routerResult.message;

const brainPlan = createPlan({
  message: rawMessage,
  intent:
    routedMessage?.intent ?? null,
  confidence:
    routedMessage?.confidence ?? null,
});

console.log(
  "[L-AI Brain] Planner observation",
  {
    goal: brainPlan.goal,
    source: brainPlan.source,
    risk: brainPlan.risk,
    requiresConfirmation:
      brainPlan.requiresConfirmation,
    confidence:
      brainPlan.confidence,
    steps: brainPlan.steps,
  },
);

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

const calendarExecutionStartedAt =
  Date.now();

const routedCalendarResponse =
  await handleRoutedCalendarIntent(
    sessionId,
    rawMessage,
    message,
    routedMessage,
  );

const calendarExecutionMs =
  Date.now() -
  calendarExecutionStartedAt;

console.log(
  "[L-AI Perf] Calendar execution:",
  `${calendarExecutionMs}ms`,
);

if (routedCalendarResponse) {
  return routedCalendarResponse;
}

/*
 * AI Router - L-JMAIL 검색
 */
if (
  routedMessage?.intent === "mail_search"
) {
  try {
    const query =
      routedMessage.target.searchQuery?.trim() ||
      message.trim();

    const emails = await searchLJmail(
  query,
  {
    limit: 10,
  },
);

await saveLastAction(
  sessionId,
  {
    type: "mail_search",
    label: `${query} 메일 검색`,
    data: {
      query,
      resultCount: emails.length,
    },
  },
);

saveMailContext(
  sessionId,
  query,
);

if (emails.length === 0) {

      return chatReply(
        query
          ? `'${query}'와 관련된 메일을 찾지 못했어.`
          : "조건에 맞는 메일을 찾지 못했어.",
      );
    }

    const lines = emails.map(
      (email, index) => {
        const sender =
          email.from_name ||
          email.from_email ||
          "알 수 없는 발신자";

        const subject =
          email.subject ||
          "(제목 없음)";

        const preview =
          email.preview ||
          email.body_text ||
          "";

        const date =
          email.received_at ||
          email.sent_at ||
          email.created_at ||
          "";

        return [
          `${index + 1}. **${subject}**`,
          `   보낸 사람: ${sender}`,
          date
            ? `   날짜: ${date}`
            : null,
          preview
            ? `   미리보기: ${preview.slice(0, 160)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n");
      },
    );

    return chatReply(
      [
        `**'${query}' 관련 메일 ${emails.length}개를 찾았어.**`,
        "",
        ...lines,
      ].join("\n\n"),
    );
  } catch (error) {
    console.error(
      "[L-JMAIL] Mail search failed:",
      error,
    );

    return chatError(
      "L-JMAIL 메일 검색에 실패했어.",
      502,
    );
  }
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
      : chatReply(
          "Google Drive에서 어떤 파일을 찾을까?",
        );
  }
}

/*
 * ============================================================
 * GENERAL AI RESPONSE
 *
 * Calendar / Drive / Mail 등 특정 Domain에서 처리되지 않은
 * 일반 대화는 여기에서 처리한다.
 *
 * 사용자가 직접 가르쳐준 장기기억도 함께 전달한다.
 * ============================================================
 */

try {
  const learningFacts =
    await getLearningFacts(
      sessionId,
    );

  const userMemory =
    learningFacts.length > 0
      ? learningFacts
          .map(
            (fact) =>
              `- [${fact.category}/${fact.key}] ${fact.value}`,
          )
          .join("\n")
      : null;

  console.log(
  "[L-AI Learning] Injecting profile memory:",
  {
    sessionId,
    factCount:
      learningFacts.length,
    facts:
      learningFacts.map(
        (fact) => ({
          category: fact.category,
          key: fact.key,
          value: fact.value,
        }),
      ),
  },
);

  const reply =
    await generateAssistantReply(
      message,
      userMemory,
    );

  return chatReply(reply);
} catch (error) {
  console.error(
    "[L-AI] General AI response failed:",
    error,
  );

  if (
    error instanceof
    OpenAIConfigurationError
  ) {
    return chatError(
      "OpenAI 설정을 확인해줘.",
      500,
    );
  }

  return chatError(
    "답변을 생성하지 못했어.",
    500,
  );
}
}

export async function POST(request: Request) {
    const sessionId =
    request.headers.get("x-session-id") ||
    request.headers.get("x-chat-session-id") ||
    crypto.randomUUID();

  return handleChatRequest(
    request,
    sessionId,
  );
}