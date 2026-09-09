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
      kind: "selected";
      indexes: number[];
    };

export function parseDriveCalendarAddCommand(
  message: string,
): DriveCalendarAddCommand | null {
  const normalized = message
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .replace(/\s+/gu, " ");

  if (
    /^(?:전부|전체|모두)\s*(?:일정\s*)?(?:추가|등록|넣어)(?:해\s*줘|해줘)?$/u.test(
      normalized,
    )
  ) {
    return {
      kind: "all",
    };
  }

  if (
    !/(?:추가|등록|넣어)/u.test(
      normalized,
    )
  ) {
    return null;
  }

  const numberMatches =
    normalized.match(/\d+/gu);

  if (
    !numberMatches ||
    numberMatches.length === 0
  ) {
    return null;
  }

  const indexes = [
    ...new Set(
      numberMatches.map(
        (number) =>
          Number(number) - 1,
      ),
    ),
  ];

  if (
    indexes.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0,
    )
  ) {
    return null;
  }

  return {
    kind: "selected",
    indexes,
  };
}

export function isDriveCalendarCancelCommand(
  message: string,
) {
  const normalized = message
    .trim()
    .replace(/[.!?。！？]+$/u, "");

  return /^(?:일정\s*)?(?:추가\s*)?(?:취소|취소해\s*줘|취소해줘)$/u.test(
    normalized,
  );
}

function addOneDay(
  dateString: string,
) {
  const date = new Date(
    `${dateString}T00:00:00+09:00`,
  );

  date.setDate(
    date.getDate() + 1,
  );

  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    );

  return formatter.format(date);
}

export function driveCandidateToCalendarEvent(
  candidate: DriveCalendarCandidate,
): CalendarEvent {
  if (candidate.allDay) {
    const start =
      `${candidate.start}T00:00:00+09:00`;

    const endDate =
      candidate.end &&
      /^\d{4}-\d{2}-\d{2}$/u.test(
        candidate.end,
      )
        ? candidate.end
        : addOneDay(
            candidate.start,
          );

    return {
      title: candidate.title,
      start,
      end:
        `${endDate}T00:00:00+09:00`,
      location:
        candidate.location,
      description:
        candidate.description,
    };
  }

  const start =
    candidate.start;

  let end =
    candidate.end;

  if (!end) {
    const startDate =
      new Date(start);

    if (
      !Number.isNaN(
        startDate.getTime(),
      )
    ) {
      startDate.setHours(
        startDate.getHours() + 1,
      );

      end =
        startDate.toISOString();
    }
  }

  return {
    title: candidate.title,
    start,
    end: end || start,
    location:
      candidate.location,
    description:
      candidate.description,
  };
}

function normalizeTitle(
  title: string,
) {
  return title
    .replace(/\s+/gu, "")
    .toLowerCase()
    .trim();
}

function getGoogleEventStart(
  event: GoogleCalendarEvent,
) {
  if (event.start.dateTime) {
    const timestamp =
      new Date(
        event.start.dateTime,
      ).getTime();

    return Number.isNaN(timestamp)
      ? null
      : timestamp;
  }

  if (event.start.date) {
    const timestamp =
      new Date(
        `${event.start.date}T00:00:00+09:00`,
      ).getTime();

    return Number.isNaN(timestamp)
      ? null
      : timestamp;
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
    new Date(
      target.start,
    ).getTime();

  if (
    Number.isNaN(targetStart)
  ) {
    return false;
  }

  return existingEvents.some(
    (event) => {
      const eventTitle =
        normalizeTitle(
          event.summary || "",
        );

      const eventStart =
        getGoogleEventStart(
          event,
        );

      if (
        eventStart === null
      ) {
        return false;
      }

      return (
        eventTitle ===
          targetTitle &&
        Math.abs(
          eventStart -
            targetStart,
        ) <
          1000 * 60
      );
    },
  );
}

export function getCalendarCheckRange(
  event: CalendarEvent,
) {
  const start =
    new Date(event.start);

  if (
    Number.isNaN(
      start.getTime(),
    )
  ) {
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
    start:
      rangeStart.toISOString(),
    end:
      rangeEnd.toISOString(),
  };
}