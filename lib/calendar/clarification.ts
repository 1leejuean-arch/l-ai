import type {
  CalendarEventCandidate,
  CalendarUnresolvedTime,
} from "./types";

export type CalendarMeridiem = "am" | "pm";

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

export function formatMeridiemQuestion(
  candidate: CalendarEventCandidate,
  time: CalendarUnresolvedTime,
) {
  const minute = time.minute === 0 ? "" : ` ${time.minute}분`;
  return `'${candidate.title}'를 오전 ${time.hour}시${minute}로 변경할까요, 오후 ${time.hour}시${minute}로 변경할까요?`;
}
