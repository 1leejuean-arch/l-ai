import type {
  CalendarEventCandidate,
  CalendarUnresolvedTime,
} from "./types";

export type CalendarMeridiem = "am" | "pm";

export type CalendarClockTime = {
  hour: number;
  minute: number;
};

export type CalendarTextTimeChange =
  | {
      kind: "resolved";
      start: CalendarClockTime | null;
      end: CalendarClockTime | null;
    }
  | { kind: "ambiguous"; time: CalendarUnresolvedTime };

const CLOCK_PATTERN = /(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/gu;

function toClockTime(
  meridiem: string | undefined,
  hourText: string,
  minuteText: string | undefined,
): CalendarClockTime | null {
  const hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;

  if (!meridiem || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  return {
    hour:
      meridiem === "오전"
        ? hour === 12
          ? 0
          : hour
        : hour === 12
          ? 12
          : hour + 12,
    minute,
  };
}

export function hasExplicitCalendarDate(message: string) {
  return /오늘|내일|모레|이번\s*주|다음\s*주|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}\s*년/u.test(
    message,
  );
}

export function parseCalendarTextTimeChange(
  message: string,
): CalendarTextTimeChange | null {
  const matches = Array.from(message.matchAll(CLOCK_PATTERN));

  if (matches.length === 0) {
    return null;
  }

  const first = matches[0];
  const firstHour = Number(first[2]);
  const firstMinute = first[3] ? Number(first[3]) : 0;

  if (!first[1]) {
    return firstHour >= 1 && firstHour <= 12 && firstMinute <= 59
      ? { kind: "ambiguous", time: { hour: firstHour, minute: firstMinute } }
      : null;
  }

  const firstClock = toClockTime(first[1], first[2], first[3]);

  if (!firstClock) {
    return null;
  }

  if (/부터/u.test(message) && /까지/u.test(message) && matches.length >= 2) {
    const second = matches[1];
    const secondClock = toClockTime(
      second[1] || first[1],
      second[2],
      second[3],
    );

    return secondClock
      ? { kind: "resolved", start: firstClock, end: secondClock }
      : null;
  }

  const changesEnd = /끝나는\s*시간|종료\s*시간/u.test(message);

  return {
    kind: "resolved",
    start: changesEnd ? null : firstClock,
    end: changesEnd ? firstClock : null,
  };
}

export function parseMeridiemReply(
  message: string,
  unresolvedTime: CalendarUnresolvedTime,
) {
  const normalized = message.trim().replace(/[.!?。！？]+$/u, "");
  const match = /^(오전|오후)(?:\s*(\d{1,2})\s*시?)?(?:\s*(\d{1,2})\s*분?)?$/u.exec(
    normalized,
  );

  if (!match) {
    return null;
  }

  const hour = match[2] ? Number(match[2]) : unresolvedTime.hour;
  const minute = match[3] ? Number(match[3]) : unresolvedTime.minute;

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  return {
    meridiem: match[1] === "오전" ? ("am" as const) : ("pm" as const),
    hour,
    minute,
  };
}

export function resolveCandidateStart(
  candidate: CalendarEventCandidate,
  time: CalendarUnresolvedTime,
  meridiem: CalendarMeridiem,
) {
  if (candidate.isAllDay) {
    return null;
  }

  const dateMatch = /^(\d{4}-\d{2}-\d{2})T/u.exec(candidate.start);

  if (!dateMatch) {
    return null;
  }

  const hour =
    meridiem === "am"
      ? time.hour === 12
        ? 0
        : time.hour
      : time.hour === 12
        ? 12
        : time.hour + 12;

  return `${dateMatch[1]}T${String(hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}:00+09:00`;
}

export function resolveCandidateDateTime(
  candidate: CalendarEventCandidate,
  time: CalendarClockTime,
) {
  if (candidate.isAllDay) {
    return null;
  }

  const dateMatch = /^(\d{4}-\d{2}-\d{2})T/u.exec(candidate.start);

  return dateMatch
    ? `${dateMatch[1]}T${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}:00+09:00`
    : null;
}

export function formatMeridiemQuestion(
  candidate: CalendarEventCandidate,
  time: CalendarUnresolvedTime,
) {
  const minute = time.minute === 0 ? "" : ` ${time.minute}분`;
  return `'${candidate.title}'를 오전 ${time.hour}시${minute}로 변경할까요, 오후 ${time.hour}시${minute}로 변경할까요?`;
}
