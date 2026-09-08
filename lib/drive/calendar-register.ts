import "server-only";

import type {
  CalendarEvent,
  GoogleCalendarEvent,
} from "@/lib/calendar/types";

import type {
  DriveCalendarCandidate,
} from "./calendar-extract";

export type DriveCalendarAddCommand =
  | {
      kind: "all";
    }
  | {
      kind: "one";
      index: number;
    };

export function parseDriveCalendarAddCommand(
  message: string,
): DriveCalendarAddCommand | null {
  const normalized = message
    .trim()
    .replace(/[.!?。！？]+$/u, "");

  if (
    /^(?:전부|전체|모두)\s*(?:일정\s*)?(?:추가|등록|넣어)(?:해\s*줘|해줘)?$/u.test(
      normalized,
    )
  ) {
    return {
      kind: "all",
    };
  }

  const numberMatch = normalized.match(
    /^(\d+)\s*번(?:\s*일정)?\s*(?:추가|등록|넣어)(?:해\s*줘|해줘)?$/u,
  );

  if (numberMatch) {
    return {
      kind: "one",
      index: Number(numberMatch[1]) - 1,
    };
  }

  return null;
}

function addOneDay(dateString: string) {
  const date = new Date(
    `${dateString}T00:00:00+09:00`,
  );

  date.setDate(date.getDate() + 1);

  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1,
  ).padStart(2, "0");
  const day = String(
    date.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function driveCandidateToCalendarEvent(
  candidate: DriveCalendarCandidate,
): CalendarEvent {
  if (candidate.allDay) {
    const start =
      `${candidate.start}T00:00:00+09:00`;

    const endDate =
      candidate.end ||
      addOneDay(candidate.start);

    const end =
      `${endDate}T00:00:00+09:00`;

    return {
      title: candidate.title,
      start,
      end,
    };
  }

  const start = candidate.start;

  let end = candidate.end;

  if (!end) {
    const startDate = new Date(start);

    if (!Number.isNaN(startDate.getTime())) {
      startDate.setHours(
        startDate.getHours() + 1,
      );

      end = startDate.toISOString();
    }
  }

  return {
    title: candidate.title,
    start,
    end: end || start,
  };
}

function normalizeTitle(title: string) {
  return title
    .replace(/\s+/gu, "")
    .toLowerCase()
    .trim();
}

function getGoogleEventStart(
  event: GoogleCalendarEvent,
) {
  if (event.start.dateTime) {
    return new Date(
      event.start.dateTime,
    ).getTime();
  }

  if (event.start.date) {
    return new Date(
      `${event.start.date}T00:00:00+09:00`,
    ).getTime();
  }

  return null;
}

export function isDuplicateCalendarEvent(
  target: CalendarEvent,
  existingEvents: GoogleCalendarEvent[],
) {
  const targetTitle =
    normalizeTitle(target.title);

  const targetStart =
    new Date(target.start).getTime();

  if (
    Number.isNaN(targetStart)
  ) {
    return false;
  }

  return existingEvents.some((event) => {
    const eventTitle =
      normalizeTitle(
        event.summary || "",
      );

    const eventStart =
      getGoogleEventStart(event);

    if (eventStart === null) {
      return false;
    }

    return (
      eventTitle === targetTitle &&
      Math.abs(
        eventStart - targetStart,
      ) <
        1000 * 60
    );
  });
}

export function getCalendarCheckRange(
  event: CalendarEvent,
) {
  const start =
    new Date(event.start);

  if (Number.isNaN(start.getTime())) {
    return {
      start: event.start,
      end: event.end,
    };
  }

  const rangeStart =
    new Date(start);

  rangeStart.setHours(
    0,
    0,
    0,
    0,
  );

  const rangeEnd =
    new Date(rangeStart);

  rangeEnd.setDate(
    rangeEnd.getDate() + 1,
  );

  return {
    start: rangeStart.toISOString(),
    end: rangeEnd.toISOString(),
  };
}