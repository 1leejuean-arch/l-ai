import "server-only";

import { callCalendarN8n } from "@/lib/calendar/n8n";
import { createPlan } from "@/lib/brain/planner";
import { createReflection } from "@/lib/brain/reflection";
import {
  completeBrainTrace,
  getActiveBrainTrace,
  updateBrainTrace,
} from "@/lib/brain/trace";
import {
  driveCandidateToCalendarEvent,
  getCalendarCheckRange,
  isDriveCalendarCancelCommand,
  isDuplicateCalendarEvent,
  parseDriveCalendarAddCommand,
} from "@/lib/drive/calendar-register";
import type { DriveCalendarCandidate } from "@/lib/drive/calendar-extract";
import {
  deleteMemory,
  getMemory,
  saveMemory,
} from "@/lib/memory/context";
import { saveLastAction } from "@/lib/memory/action";

import type { MailContextItem } from "./context";

type PendingMailCalendar = {
  mail: MailContextItem;
  events: DriveCalendarCandidate[];
  updatedAt: number;
};

const TTL_MS = 1000 * 60 * 60 * 24;
const MEMORY_KEY = "pending_mail_calendar_candidates";
const pendingStore = new Map<string, PendingMailCalendar>();
const SEOUL_TIME_ZONE = "Asia/Seoul";
const KOREAN_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});
const KOREAN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function reply(message: string) {
  return Response.json({ reply: message });
}

async function getPending(sessionId: string) {
  const cached = pendingStore.get(sessionId);
  if (cached && Date.now() - cached.updatedAt <= TTL_MS) return cached;
  if (cached) pendingStore.delete(sessionId);

  const stored = await getMemory<PendingMailCalendar>(
    sessionId,
    "action",
    MEMORY_KEY,
    TTL_MS,
  );
  if (!stored || !Array.isArray(stored.events)) return null;
  pendingStore.set(sessionId, stored);
  return stored;
}

function savePending(
  sessionId: string,
  mail: MailContextItem,
  events: DriveCalendarCandidate[],
) {
  const pending = { mail, events, updatedAt: Date.now() };
  pendingStore.set(sessionId, pending);
  saveMemory(sessionId, "action", MEMORY_KEY, pending);
}

async function clearPending(sessionId: string) {
  pendingStore.delete(sessionId);
  await deleteMemory(sessionId, "action", MEMORY_KEY);
}

function formatCandidateDateTime(value: string, allDay: boolean) {
  const normalizedValue = allDay && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? `${value}T00:00:00+09:00`
    : value;
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return "날짜 확인 필요";
  }

  return allDay
    ? KOREAN_DATE_FORMATTER.format(date)
    : KOREAN_DATE_TIME_FORMATTER.format(date);
}

function getDisplayDescription(
  mail: MailContextItem,
  description: string | null,
) {
  const value = description?.trim();
  if (!value) return null;

  const subject = mail.subject?.trim();
  if (
    /^L-JMAIL\s*:/iu.test(value) ||
    /^(?:출처|메일\s*제목)\s*:/u.test(value) ||
    (subject && value === subject)
  ) {
    return null;
  }

  return value;
}

function formatCandidates(
  mail: MailContextItem,
  events: DriveCalendarCandidate[],
) {
  const lines = events.map((event, index) => {
    const description = getDisplayDescription(mail, event.description);
    const details = [
      `시작: ${formatCandidateDateTime(event.start, event.allDay)}`,
      event.end
        ? `종료: ${formatCandidateDateTime(event.end, event.allDay)}`
        : null,
      event.location ? `장소: ${event.location}` : null,
      description ? `추가 내용: ${description}` : null,
    ]
      .filter((line) => line !== null)
      // Markdown의 soft line break가 한 줄로 합쳐지지 않도록 hard break를 사용한다.
      .join("  \n");

    return [
      `${index + 1}. ${event.title}`,
      "",
      details,
    ].join("\n");
  });

  return [
    `${mail.subject || "선택한 메일"}에서 일정 후보 ${events.length}개를 찾았어.`,
    ...lines,
    '등록하려면 "1번 추가해줘", "전부 추가해줘"라고 말해줘.',
  ].join("\n\n");
}

export async function startMailCalendarCandidates(
  sessionId: string,
  mail: MailContextItem,
  events: DriveCalendarCandidate[],
) {
  if (events.length === 0) {
    return reply("선택한 메일에서 명확한 일정 후보를 찾지 못했어.");
  }

  savePending(sessionId, mail, events);
  await saveLastAction(sessionId, {
    type: "mail_calendar_extract",
    label: `${mail.subject || "메일"} 일정 후보 추출`,
    data: { mailId: mail.id, candidateCount: events.length },
  });

  const plan = createPlan({
    message: "선택한 메일에서 일정을 찾아 캘린더에 추가해줘",
    intent: "mail_calendar_extract",
    confidence: 1,
  });
  const reflection = createReflection(plan, {
    completedToolIds: ["mail.read", "mail.calendar.extract"],
    waitingFor: "user_selection",
  });
  await updateBrainTrace(sessionId, {
    state: "waiting",
    reflection,
    waitingFor: "user_selection",
  });

  return reply(formatCandidates(mail, events));
}

export async function handlePendingMailCalendar(
  message: string,
  sessionId: string,
): Promise<Response | null> {
  let command = parseDriveCalendarAddCommand(message);
  const cancel = isDriveCalendarCancelCommand(message);
  const genericAdd = /^(?:(?:그거|그걸)\s*)?(?:캘린더(?:에)?|일정(?:을)?)?\s*(?:추가|등록|넣어)(?:해\s*줘|해줘|줘)?$/u.test(
    message.trim(),
  );
  if (!command && !cancel && !genericAdd) return null;

  const pending = await getPending(sessionId);
  if (!pending) return null;

  if (!command && genericAdd && pending.events.length === 1) {
    command = { kind: "selected", indexes: [0] };
  }

  if (!command && !cancel) {
    return reply("추가할 일정 번호를 말해줘.");
  }

  if (cancel) {
    await clearPending(sessionId);
    return reply("메일에서 찾은 Calendar 일정 추가를 취소했어.");
  }

  const indexes = command!.kind === "all"
    ? pending.events.map((_, index) => index)
    : command!.indexes;
  if (indexes.some((index) => index < 0 || index >= pending.events.length)) {
    return reply(`선택할 수 있는 일정은 1번부터 ${pending.events.length}번까지야.`);
  }

  const activeTrace = await getActiveBrainTrace(sessionId);
  if (activeTrace) {
    await updateBrainTrace(sessionId, {
      state: "executing",
      waitingFor: null,
    });
  }

  const resolved = new Set<number>();
  const added: string[] = [];
  const duplicates: string[] = [];
  const failed: string[] = [];

  for (const index of indexes) {
    const event = driveCandidateToCalendarEvent(pending.events[index]);
    try {
      const existing = await callCalendarN8n(
        "calendar_get",
        getCalendarCheckRange(event),
      );
      if (isDuplicateCalendarEvent(event, existing)) {
        duplicates.push(event.title);
        resolved.add(index);
        continue;
      }

      await callCalendarN8n("calendar_create", event);
      await saveLastAction(sessionId, {
        type: "calendar_create",
        label: `${event.title} 일정 추가`,
        data: { title: event.title, start: event.start, end: event.end },
      });
      added.push(event.title);
      resolved.add(index);
    } catch (error) {
      console.error("[Mail Calendar] Registration failed:", event.title, error);
      failed.push(event.title);
    }
  }

  const remaining = pending.events.filter((_, index) => !resolved.has(index));
  if (remaining.length === 0) {
    await clearPending(sessionId);
  } else {
    savePending(sessionId, pending.mail, remaining);
  }

  const plan = createPlan({
    message: "선택한 메일의 일정 후보를 캘린더에 추가해줘",
    intent: "mail_calendar_extract",
    confidence: 1,
  });
  const onlyFailed = added.length === 0 && duplicates.length === 0 && failed.length > 0;
  const reflection = createReflection(plan, {
    completedToolIds:
      remaining.length === 0
        ? ["mail.read", "mail.calendar.extract", "calendar.create"]
        : ["mail.read", "mail.calendar.extract"],
    failed: onlyFailed,
    waitingFor: remaining.length > 0 && !onlyFailed ? "user_selection" : null,
  });

  if (remaining.length === 0 && !onlyFailed) {
    await completeBrainTrace(sessionId, reflection);
  } else {
    await updateBrainTrace(sessionId, {
      state: onlyFailed ? "failed" : "waiting",
      reflection,
      waitingFor: onlyFailed ? null : "user_selection",
    });
  }

  const output = [
    added.length ? `Calendar에 추가: ${added.join(", ")}` : null,
    duplicates.length ? `이미 등록되어 건너뜀: ${duplicates.join(", ")}` : null,
    failed.length ? `등록 실패: ${failed.join(", ")}` : null,
    remaining.length ? `남은 후보: ${remaining.length}개` : "처리할 일정 후보가 모두 끝났어.",
  ].filter(Boolean);

  return reply(output.join("\n\n"));
}
