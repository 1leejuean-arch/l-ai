import type {
  CalendarEvent,
  CalendarEventCandidate,
  CalendarMutationMatch,
  CalendarMutationTarget,
  CalendarUpdatePatch,
  GoogleCalendarEvent,
} from "./types";

const SEOUL_TIME_ZONE = "Asia/Seoul";
const SEOUL_OFFSET = "+09:00";

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

function toSeoulIso(date: Date) {
  const parts = Object.fromEntries(
    SEOUL_PARTS_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${SEOUL_OFFSET}`;
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function getBigrams(value: string) {
  if (value.length < 2) {
    return [value];
  }

  return Array.from({ length: value.length - 1 }, (_, index) =>
    value.slice(index, index + 2),
  );
}

function getTitleSimilarity(left: string, right: string) {
  if (left === right) {
    return 1;
  }

  if (left.includes(right) || right.includes(left)) {
    return 0.8;
  }

  const leftBigrams = getBigrams(left);
  const remainingRight = getBigrams(right);
  let matches = 0;

  for (const bigram of leftBigrams) {
    const matchIndex = remainingRight.indexOf(bigram);

    if (matchIndex >= 0) {
      matches += 1;
      remainingRight.splice(matchIndex, 1);
    }
  }

  return (2 * matches) / (leftBigrams.length + getBigrams(right).length);
}

function toCandidate(event: GoogleCalendarEvent): CalendarEventCandidate | null {
  const eventId = event.id?.trim();
  const title = event.summary?.trim() || "제목 없는 일정";

  if (!eventId) {
    return null;
  }

  if (event.start.dateTime && event.end.dateTime) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return null;
    }

    return {
      eventId,
      title,
      start: toSeoulIso(start),
      end: toSeoulIso(end),
      isAllDay: false,
    };
  }

  if (event.start.date && event.end.date) {
    return {
      eventId,
      title,
      start: event.start.date,
      end: event.end.date,
      isAllDay: true,
    };
  }

  return null;
}

export function matchCalendarEvents(
  events: GoogleCalendarEvent[],
  target: CalendarMutationTarget,
  options: { includeAllDay: boolean },
): CalendarMutationMatch {
  let candidates = events
    .map(toCandidate)
    .filter((candidate): candidate is CalendarEventCandidate => candidate !== null)
    .filter((candidate) => options.includeAllDay || !candidate.isAllDay);

  if (target.title) {
    const normalizedTarget = normalizeTitle(target.title);
    const scored = candidates.map((candidate) => ({
      candidate,
      score: getTitleSimilarity(normalizeTitle(candidate.title), normalizedTarget),
    }));
    const exact = scored.filter(({ score }) => score === 1);
    const relevant = exact.length > 0 ? exact : scored.filter(({ score }) => score >= 0.5);

    candidates = relevant.map(({ candidate }) => candidate);
  }

  if (target.start) {
    const targetTime = Date.parse(target.start);
    const exactTime = candidates.filter(
      (candidate) =>
        !candidate.isAllDay &&
        Math.abs(Date.parse(candidate.start) - targetTime) < 60_000,
    );

    if (exactTime.length > 0) {
      candidates = exactTime;
    } else {
      candidates = [];
    }
  }

  if (candidates.length === 0) {
    return { kind: "none" };
  }

  if (candidates.length === 1) {
    return { kind: "one", candidate: candidates[0] };
  }

  return { kind: "multiple", candidates };
}

export function applyCalendarUpdate(
  candidate: CalendarEventCandidate,
  patch: CalendarUpdatePatch,
): { before: CalendarEvent; after: CalendarEvent } | null {
  if (candidate.isAllDay) {
    return null;
  }

  const before: CalendarEvent = {
    title: candidate.title,
    start: candidate.start,
    end: candidate.end,
  };
  const oldDuration = Date.parse(before.end) - Date.parse(before.start);
  const start = patch.start || before.start;
  const end = patch.end
    ? patch.end
    : patch.start
      ? toSeoulIso(new Date(Date.parse(patch.start) + oldDuration))
      : before.end;
  const after: CalendarEvent = {
    title: patch.title || before.title,
    start,
    end,
  };

  if (Date.parse(after.end) <= Date.parse(after.start)) {
    return null;
  }

  return { before, after };
}
