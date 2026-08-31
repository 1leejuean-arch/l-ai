import type {
  CalendarEvent,
  CalendarEventCandidate,
  GoogleCalendarEvent,
} from "./types";

const SEOUL_TIME_ZONE = "Asia/Seoul";

const DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  month: "long",
  day: "numeric",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: SEOUL_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function isSameSeoulDate(start: Date, end: Date) {
  return (
    DATE_WITH_YEAR_FORMATTER.format(start) ===
    DATE_WITH_YEAR_FORMATTER.format(end)
  );
}

function formatRange(event: CalendarEvent, includeYear: boolean) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const dateFormatter = includeYear ? DATE_WITH_YEAR_FORMATTER : DATE_FORMATTER;
  const startText = `${dateFormatter.format(start)} ${TIME_FORMATTER.format(start)}`;
  const endText = isSameSeoulDate(start, end)
    ? TIME_FORMATTER.format(end)
    : `${dateFormatter.format(end)} ${TIME_FORMATTER.format(end)}`;

  return `${startText} ~ ${endText}`;
}

function formatTimedEvent(event: GoogleCalendarEvent) {
  const startValue = event.start.dateTime;
  const endValue = event.end.dateTime;

  if (!startValue || !endValue) {
    return null;
  }

  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const timeRange = isSameSeoulDate(start, end)
    ? TIME_FORMATTER.formatRange(start, end)
    : `${DATE_FORMATTER.format(start)} ${TIME_FORMATTER.format(start)} ~ ${DATE_FORMATTER.format(end)} ${TIME_FORMATTER.format(end)}`;

  return `${timeRange} — ${event.summary?.trim() || "제목 없는 일정"}`;
}

function formatAllDayEvent(event: GoogleCalendarEvent) {
  if (!event.start.date || !event.end.date) {
    return null;
  }

  return `하루 종일 — ${event.summary?.trim() || "제목 없는 일정"}`;
}

function formatCandidate(candidate: CalendarEventCandidate, includeYear: boolean) {
  if (candidate.isAllDay) {
    const date = new Date(`${candidate.start}T00:00:00+09:00`);
    const dateFormatter = includeYear ? DATE_WITH_YEAR_FORMATTER : DATE_FORMATTER;
    return `${dateFormatter.format(date)} 하루 종일`;
  }

  return formatRange(
    {
      title: candidate.title,
      start: candidate.start,
      end: candidate.end,
    },
    includeYear,
  );
}

export function formatCalendarConfirmation(event: CalendarEvent) {
  return `다음 일정으로 추가할까요?\n\n${event.title}\n${formatRange(event, true)}\n\n추가 / 취소`;
}

export function formatCalendarCreated(event: CalendarEvent) {
  return `일정을 추가했어 ✅\n${event.title}\n${formatRange(event, false)}`;
}

export function formatCalendarUpdateConfirmation(
  before: CalendarEvent,
  after: CalendarEvent,
) {
  return `다음 일정을 수정할까요?\n\n${before.title}\n${formatRange(before, true)}\n\n변경 후:\n${after.title}\n${formatRange(after, true)}\n\n수정 / 취소`;
}

export function formatCalendarUpdated(event: CalendarEvent) {
  return `일정을 수정했어 ✅\n${event.title}\n${formatRange(event, false)}`;
}

export function formatCalendarDeleteConfirmation(
  candidate: CalendarEventCandidate,
) {
  return `이 일정을 삭제할까요?\n\n${candidate.title}\n${formatCandidate(candidate, true)}\n\n삭제 / 취소`;
}

export function formatCalendarDeleted() {
  return "일정을 삭제했어 ✅";
}

export function formatCalendarCandidateSelection(
  candidates: CalendarEventCandidate[],
  targetTitle: string | null,
) {
  const subject = targetTitle ? `${targetTitle} 일정이` : "조건에 맞는 일정이";
  const choices = candidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${formatCandidate(candidate, false)} — ${candidate.title}`,
    )
    .join("\n");

  return `${subject} ${candidates.length}개 있어. 어떤 일정을 말하는 거야?\n\n${choices}`;
}

export function formatCalendarEvents(
  events: GoogleCalendarEvent[],
  rangeLabel: string,
) {
  const eventLines = events
    .map((event) =>
      event.start.dateTime
        ? formatTimedEvent(event)
        : formatAllDayEvent(event),
    )
    .filter((line): line is string => line !== null);

  if (eventLines.length === 0) {
    return `${rangeLabel}은 등록된 일정이 없어.`;
  }

  return `${rangeLabel} 일정은 ${eventLines.length}개 있어.\n\n${eventLines
    .map((line) => `• ${line}`)
    .join("\n")}`;
}
