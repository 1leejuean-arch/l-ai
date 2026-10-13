import "server-only";

import {
  getOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { DriveCalendarCandidate } from "@/lib/drive/calendar-extract";

import type { MailContextItem, MailDraft } from "./context";

function getMailText(mail: MailContextItem) {
  return (mail.body || mail.preview || "").slice(0, 30_000);
}

export async function summarizeMail(mail: MailContextItem) {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: `L-JMAIL 메일 요약 기능이다. 메일에 실제로 있는 내용만 근거로 핵심 목적, 요청 사항, 날짜, 장소, 해야 할 일을 자연스러운 한국어로 간결하게 정리한다. 추측하지 않는다.`,
    input: `제목: ${mail.subject || "(제목 없음)"}\n발신자: ${mail.senderName || mail.sender || "알 수 없음"}\n\n${getMailText(mail)}`,
  });

  const summary = response.output_text.trim();
  if (!summary) throw new Error("OpenAI returned an empty mail summary");
  return summary;
}

export async function extractCalendarEventsFromMail(
  mail: MailContextItem,
): Promise<DriveCalendarCandidate[]> {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: `L-JMAIL 메일에서 Google Calendar 등록 후보를 추출한다. 메일에 명시된 제목, 날짜, 시작/종료 시간, 장소만 사용하고 추측하지 않는다. 대한민국 시간대는 +09:00이다. 시간이 없으면 allDay=true와 YYYY-MM-DD 날짜를 사용한다. description에는 메일 제목을 출처로 짧게 기록한다.`,
    input: `메일 제목: ${mail.subject || "(제목 없음)"}\n발신자: ${mail.senderName || mail.sender || "알 수 없음"}\n\n${getMailText(mail)}`,
    text: {
      format: {
        type: "json_schema",
        name: "mail_calendar_candidates",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            events: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  start: { type: "string" },
                  end: { type: ["string", "null"] },
                  location: { type: ["string", "null"] },
                  description: { type: ["string", "null"] },
                  allDay: { type: "boolean" },
                },
                required: [
                  "title",
                  "start",
                  "end",
                  "location",
                  "description",
                  "allDay",
                ],
              },
            },
          },
          required: ["events"],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as {
    events?: Array<Record<string, unknown>>;
  };

  return Array.isArray(parsed.events)
    ? parsed.events
        .filter(
          (event) =>
            typeof event.title === "string" &&
            event.title.trim().length > 0 &&
            typeof event.start === "string" &&
            event.start.trim().length > 0 &&
            typeof event.allDay === "boolean",
        )
        .map((event) => ({
          title: String(event.title).trim(),
          start: String(event.start).trim(),
          end: typeof event.end === "string" ? event.end.trim() : null,
          location:
            typeof event.location === "string"
              ? event.location.trim()
              : null,
          description:
            typeof event.description === "string"
              ? event.description.trim()
              : `L-JMAIL: ${mail.subject || "제목 없음"}`,
          allDay: event.allDay === true,
        }))
    : [];
}

type DraftInput = {
  kind: MailDraft["kind"];
  to: string | null;
  sourceLabel: string;
  sourceText: string;
  request: string;
  originalSubject?: string | null;
};

function getThreadDraftSubject(
  kind: Extract<MailDraft["kind"], "reply" | "forward">,
  originalSubject: string | null | undefined,
) {
  const fallback = "(제목 없음)";
  const subject = originalSubject?.trim() || fallback;

  if (kind === "reply") {
    const withoutReplyPrefix = subject
      .replace(/^(?:re\s*:\s*)+/iu, "")
      .trim();
    return `Re: ${withoutReplyPrefix || fallback}`;
  }

  const withoutForwardPrefix = subject
    .replace(/^(?:(?:fwd|fw)\s*:\s*)+/iu, "")
    .trim();
  return `Fwd: ${withoutForwardPrefix || fallback}`;
}

export async function createMailDraft(input: DraftInput) {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: `L-AI 메일 초안 작성 기능이다. 제공된 원문과 사용자 요청만 근거로 정중하고 간결한 한국어 메일 초안을 만든다. 수신자가 제공되지 않았으면 추측하지 말고 to를 null로 둔다. 실제 전송은 하지 않는다.`,
    input: `사용자 요청: ${input.request}\n출처: ${input.sourceLabel}\n\n${input.sourceText.slice(0, 30_000)}`,
    text: {
      format: {
        type: "json_schema",
        name: "mail_draft",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["subject", "body"],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as {
    subject?: unknown;
    body?: unknown;
  };
  if (
    typeof parsed.subject !== "string" ||
    !parsed.subject.trim() ||
    typeof parsed.body !== "string" ||
    !parsed.body.trim()
  ) {
    throw new Error("OpenAI returned an invalid mail draft");
  }

  return {
    kind: input.kind,
    to: input.to,
    subject:
      input.kind === "new"
        ? parsed.subject.trim()
        : getThreadDraftSubject(input.kind, input.originalSubject),
    body: parsed.body.trim(),
    sourceLabel: input.sourceLabel,
  } satisfies Omit<MailDraft, "createdAt">;
}

export function calendarEventToDraftSource(event: CalendarEvent) {
  return [
    `일정 제목: ${event.title}`,
    `시작: ${event.start}`,
    `종료: ${event.end}`,
    event.location ? `장소: ${event.location}` : null,
    event.description ? `설명: ${event.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
