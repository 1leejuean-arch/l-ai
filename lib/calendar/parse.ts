import "server-only";

import { getOpenAIClient, getOpenAIModel } from "@/lib/ai/openai";
import type {
  CalendarDeleteRequest,
  CalendarEvent,
  CalendarIntent,
  CalendarMutationTarget,
  CalendarParseResult,
  CalendarRange,
  CalendarUpdateRequest,
} from "./types";

const SEOUL_TIME_ZONE = "Asia/Seoul";
const SEOUL_OFFSET = "+09:00";
const ISO_SEOUL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/;

const CALENDAR_INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "create_calendar_event",
        "get_calendar_events",
        "update_calendar_event",
        "delete_calendar_event",
        "clarify_calendar_request",
        "not_calendar_request",
      ],
    },
    title: { type: ["string", "null"] },
    start: { type: ["string", "null"] },
    end: { type: ["string", "null"] },
    rangeLabel: { type: ["string", "null"] },
    targetTitle: { type: ["string", "null"] },
    targetStart: { type: ["string", "null"] },
    newTitle: { type: ["string", "null"] },
    newStart: { type: ["string", "null"] },
    newEnd: { type: ["string", "null"] },
    timeHour: { type: ["integer", "null"], minimum: 1, maximum: 12 },
    timeMinute: { type: ["integer", "null"], minimum: 0, maximum: 59 },
    missingField: {
      type: ["string", "null"],
      enum: ["ampm", "date", "time", "target", null],
    },
    clarification: { type: ["string", "null"] },
  },
  required: [
    "action",
    "title",
    "start",
    "end",
    "rangeLabel",
    "targetTitle",
    "targetStart",
    "newTitle",
    "newStart",
    "newEnd",
    "timeHour",
    "timeMinute",
    "missingField",
    "clarification",
  ],
  additionalProperties: false,
} as const;

const SEOUL_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const SEOUL_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  weekday: "long",
});

function partsToRecord(parts: Intl.DateTimeFormatPart[]) {
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function getSeoulNowContext(now: Date) {
  const parts = partsToRecord(SEOUL_PARTS_FORMATTER.formatToParts(now));
  const dateTime = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${SEOUL_OFFSET}`;
  return `${dateTime} (${SEOUL_WEEKDAY_FORMATTER.format(now)})`;
}

function isCalendarIntent(value: unknown): value is CalendarIntent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const nullableKeys = [
    "title",
    "start",
    "end",
    "rangeLabel",
    "targetTitle",
    "targetStart",
    "newTitle",
    "newStart",
    "newEnd",
    "clarification",
  ] as const;

  const missingField = record.missingField;
  const timeHour = record.timeHour;
  const timeMinute = record.timeMinute;

  return (
    (record.action === "create_calendar_event" ||
      record.action === "get_calendar_events" ||
      record.action === "update_calendar_event" ||
      record.action === "delete_calendar_event" ||
      record.action === "clarify_calendar_request" ||
      record.action === "not_calendar_request") &&
    nullableKeys.every(
      (key) =>
        key in record &&
        (record[key] === null || typeof record[key] === "string"),
    ) &&
    (missingField === null ||
      missingField === "ampm" ||
      missingField === "date" ||
      missingField === "time" ||
      missingField === "target") &&
    (timeHour === null ||
      (Number.isInteger(timeHour) && Number(timeHour) >= 1 && Number(timeHour) <= 12)) &&
    (timeMinute === null ||
      (Number.isInteger(timeMinute) &&
        Number(timeMinute) >= 0 &&
        Number(timeMinute) <= 59))
  );
}

function isValidSeoulDateTime(value: string) {
  const match = ISO_SEOUL_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return false;
  }

  const parts = partsToRecord(
    SEOUL_PARTS_FORMATTER.formatToParts(new Date(timestamp)),
  );
  const [, year, month, day, hour, minute, second] = match;

  return (
    parts.year === year &&
    parts.month === month &&
    parts.day === day &&
    parts.hour === hour &&
    parts.minute === minute &&
    parts.second === second
  );
}

function toValidatedRange(
  start: string | null,
  end: string | null,
): CalendarRange | null {
  if (
    !start ||
    !end ||
    !isValidSeoulDateTime(start) ||
    !isValidSeoulDateTime(end) ||
    Date.parse(end) <= Date.parse(start)
  ) {
    return null;
  }

  return { start, end };
}

function toCalendarEvent(intent: CalendarIntent): CalendarEvent | null {
  const title = intent.title?.trim();
  const range = toValidatedRange(intent.start, intent.end);

  return title && range ? { title, ...range } : null;
}

function toMutationTarget(intent: CalendarIntent): CalendarMutationTarget | null {
  const title = intent.targetTitle?.trim() || null;
  const start = intent.targetStart;

  if (start && !isValidSeoulDateTime(start)) {
    return null;
  }

  return title || start ? { title, start } : null;
}

function toUpdateRequest(intent: CalendarIntent): CalendarUpdateRequest | null {
  const range = toValidatedRange(intent.start, intent.end);
  const target = toMutationTarget(intent);
  const title = intent.newTitle?.trim() || null;
  const start = intent.newStart;
  const end = intent.newEnd;
  const unresolvedTime =
    intent.timeHour !== null
      ? { hour: intent.timeHour, minute: intent.timeMinute ?? 0 }
      : null;

  if (
    !range ||
    !target ||
    (!title && !start && !end && !unresolvedTime) ||
    (start && !isValidSeoulDateTime(start)) ||
    (end && !isValidSeoulDateTime(end)) ||
    (start && end && Date.parse(end) <= Date.parse(start))
  ) {
    return null;
  }

  return {
    range,
    target,
    patch: { title, start, end },
    unresolvedTime,
    missingField: intent.missingField,
    clarification: intent.clarification?.trim() || null,
  };
}

function toDeleteRequest(intent: CalendarIntent): CalendarDeleteRequest | null {
  const range = toValidatedRange(intent.start, intent.end);
  const target = toMutationTarget(intent);

  return range && target ? { range, target } : null;
}

export async function parseCalendarRequest(
  message: string,
  now = new Date(),
  context?: { operation: "update" | "delete"; originalMessage: string },
): Promise<CalendarParseResult> {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: `사용자의 메시지가 Google Calendar 일정 생성, 조회, 수정, 삭제 요청인지 판별한다.
현재 Asia/Seoul 날짜와 시간은 ${getSeoulNowContext(now)}이다.
${
  context
    ? `이 입력은 직전 calendar_${context.operation} 요청의 추가 답변이다. 반드시 ${context.operation === "update" ? "update_calendar_event" : "delete_calendar_event"} 문맥을 유지하고, 원래 요청(${context.originalMessage})과 새 답변을 합쳐 해석한다.`
    : ""
}

공통 규칙:
- Calendar와 관계없는 대화는 not_calendar_request다.
- 수정/삭제 요청에서 날짜, 시간, 대상 또는 오전/오후가 부족해도 action을 update_calendar_event/delete_calendar_event로 유지한다. missingField에 ampm, date, time, target 중 하나를 쓰고 clarification에 짧은 한국어 질문을 작성한다.
- 생성/조회 요청의 정보가 부족하거나 Calendar 작업 종류 자체를 확정할 수 없을 때만 clarify_calendar_request를 사용한다.
- 모든 datetime은 YYYY-MM-DDTHH:mm:ss+09:00 형식이다.
- 오늘, 내일, 모레, 이번 주, 다음 주, 요일은 현재 Asia/Seoul 시각을 기준으로 계산한다.
- 연도 없는 월/일은 가장 가까운 미래 날짜로 해석한다.
- start와 end는 작업 대상을 조회할 범위다. 하루는 당일 00:00부터 다음 날 00:00까지, 주는 월요일 00:00부터 다음 월요일 00:00까지다.
- 수정·삭제에 날짜가 없고 제목만 명확하면 오늘 00:00부터 1년 뒤 00:00까지를 조회 범위로 사용한다.

생성(create_calendar_event):
- title, start, end에 새 일정을 작성한다. 종료 시간이 없으면 1시간 일정으로 만든다.
- 나머지 필드는 모두 null이다.

조회(get_calendar_events):
- start, end와 자연스러운 한국어 rangeLabel만 작성한다.
- 나머지 필드는 모두 null이다.

수정(update_calendar_event):
- start와 end에는 기존 일정을 찾을 조회 범위를 작성한다.
- targetTitle에는 기존 일정 제목을, 기존 시작 시각을 사용자가 특정했다면 targetStart에 작성한다.
- 제목 변경은 newTitle, 시작 변경은 newStart, 종료 변경을 명시한 경우에만 newEnd에 작성한다.
- 시작 시각만 바꾸고 종료 시각을 말하지 않았다면 newEnd는 null이다. 서버가 기존 일정 길이를 유지한다.
- 시간만 변경하면 newTitle은 null이다. 제목만 변경하면 newStart와 newEnd는 null이다.
- "8시"처럼 오전/오후가 불명확하면 newStart는 null, timeHour는 8, timeMinute는 0, missingField는 ampm으로 작성한다. 날짜가 없으면 오늘 범위에서 대상을 먼저 찾는다.
- 시간 변경이 확정되면 timeHour, timeMinute, missingField는 null이다.
- title과 rangeLabel은 null이다. 추가 질문이 필요하지 않으면 clarification도 null이다.

삭제(delete_calendar_event):
- start와 end에는 대상을 찾을 조회 범위를 작성한다.
- targetTitle과 targetStart 중 사용자가 특정한 정보를 작성한다.
- title, rangeLabel, newTitle, newStart, newEnd는 null이다. 추가 질문이 필요하지 않으면 missingField와 clarification도 null이다.

재질문과 일반 대화:
- clarify_calendar_request는 clarification 외 모든 필드가 null이다.
- not_calendar_request는 action 외 모든 필드가 null이다.
- 사용하지 않는 timeHour, timeMinute, missingField는 null이다.`,
    input: context
      ? `원래 요청: ${context.originalMessage}\n추가 답변: ${message}`
      : message,
    text: {
      format: {
        type: "json_schema",
        name: "calendar_intent",
        description: "Calendar 작업 의도, 조회 범위, 대상, 변경 정보",
        strict: true,
        schema: CALENDAR_INTENT_SCHEMA,
      },
    },
  });

  let data: unknown;

  try {
    data = JSON.parse(response.output_text);
  } catch {
    throw new Error("Calendar intent response was not valid JSON");
  }

  if (!isCalendarIntent(data)) {
    throw new Error("Calendar intent response did not match the schema");
  }

  if (data.action === "not_calendar_request") {
    return { kind: "not_calendar" };
  }

  if (data.action === "clarify_calendar_request") {
    return {
      kind: "clarify",
      message: data.clarification?.trim() || "일정 요청을 조금 더 구체적으로 알려주세요.",
    };
  }

  if (data.action === "get_calendar_events") {
    const range = toValidatedRange(data.start, data.end);
    const rangeLabel = data.rangeLabel?.trim();

    return range && rangeLabel
      ? { kind: "get", range, rangeLabel }
      : { kind: "clarify", message: "어느 날짜의 일정을 조회할까요?" };
  }

  if (data.action === "update_calendar_event") {
    const request = toUpdateRequest(data);
    return request
      ? { kind: "update", request }
      : {
          kind: "clarify",
          operation: "update",
          message: data.clarification?.trim() || "어떤 일정을 어떻게 수정할까요?",
        };
  }

  if (data.action === "delete_calendar_event") {
    const request = toDeleteRequest(data);
    return request
      ? { kind: "delete", request }
      : {
          kind: "clarify",
          operation: "delete",
          message: data.clarification?.trim() || "어떤 일정을 삭제할까요?",
        };
  }

  const event = toCalendarEvent(data);
  return event
    ? { kind: "create", event }
    : {
        kind: "clarify",
        message: "일정의 날짜와 시간을 정확히 알려주세요.",
      };
}
