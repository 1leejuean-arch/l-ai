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

/*
 * 제목 완전 비교용.
 *
 * 예:
 * "1학년 프로그램"
 * "1학년  프로그램"
 *
 * 둘 다 같은 값으로 정규화된다.
 */
function normalizeTitle(
  title: string,
) {
  return title
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(
      /[\[\](){}<>"'“”‘’.,!?:;·ㆍ_-]/gu,
      "",
    )
    .trim();
}

/*
 * 제목 단어 비교용.
 */
function getTitleWords(
  title: string,
) {
  return title
    .toLowerCase()
    .replace(
      /[\[\](){}<>"'“”‘’.,!?:;·ㆍ_-]/gu,
      " ",
    )
    .replace(/\s+/gu, " ")
    .trim()
    .split(" ")
    .filter(
      (word) =>
        word.length > 0,
    );
}

/*
 * 두 제목이 같은 일정으로 볼 만큼
 * 유사한지 판단한다.
 */
function isSimilarTitle(
  firstTitle: string,
  secondTitle: string,
) {
  const first =
    normalizeTitle(
      firstTitle,
    );

  const second =
    normalizeTitle(
      secondTitle,
    );

  if (
    !first ||
    !second
  ) {
    return false;
  }

  /*
   * 1. 완전히 같은 제목
   */
  if (first === second) {
    return true;
  }

  /*
   * 2. 한 제목이 다른 제목에 포함
   *
   * 예:
   * "[1학년] 1학년 프로그램"
   * "1학년 프로그램"
   */
  if (
    first.includes(second) ||
    second.includes(first)
  ) {
    return true;
  }

  /*
   * 3. 단어 유사도 검사
   */
  const firstWords =
    getTitleWords(
      firstTitle,
    );

  const secondWords =
    getTitleWords(
      secondTitle,
    );

  if (
    firstWords.length === 0 ||
    secondWords.length === 0
  ) {
    return false;
  }

  const firstSet =
    new Set(firstWords);

  const secondSet =
    new Set(secondWords);

  let matchedWords = 0;

  for (
    const word of firstSet
  ) {
    if (
      secondSet.has(word)
    ) {
      matchedWords += 1;
    }
  }

  const smallerWordCount =
    Math.min(
      firstSet.size,
      secondSet.size,
    );

  if (
    smallerWordCount === 0
  ) {
    return false;
  }

  const similarity =
    matchedWords /
    smallerWordCount;

  /*
   * 작은 쪽 제목 기준으로
   * 단어가 70% 이상 겹치면
   * 유사한 제목으로 판단.
   */
  return similarity >= 0.7;
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

/*
 * 한국 시간 기준 YYYY-MM-DD 반환.
 *
 * Vercel 서버가 UTC여도
 * 날짜 비교가 틀어지지 않게 한다.
 */
function getKoreaDateKey(
  timestamp: number,
) {
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

  return formatter.format(
    new Date(timestamp),
  );
}

/*
 * Calendar 중복 일정 검사
 *
 * 조건:
 * 1. 같은 날짜
 * 2. 시작시간 차이 15분 이내
 * 3. 제목이 동일하거나 충분히 유사
 */
export function isDuplicateCalendarEvent(
  target: CalendarEvent,
  existingEvents: GoogleCalendarEvent[],
) {
  const targetStart =
    new Date(
      target.start,
    ).getTime();

  if (
    Number.isNaN(targetStart)
  ) {
    return false;
  }

  const targetDate =
    getKoreaDateKey(
      targetStart,
    );

  return existingEvents.some(
    (event) => {
      const eventStart =
        getGoogleEventStart(
          event,
        );

      if (
        eventStart === null
      ) {
        return false;
      }

      /*
       * 날짜가 다르면 다른 일정
       */
      const eventDate =
        getKoreaDateKey(
          eventStart,
        );

      if (
        eventDate !==
        targetDate
      ) {
        return false;
      }

      /*
       * 시작 시간이 15분보다
       * 많이 차이나면 다른 일정
       */
      const timeDifference =
        Math.abs(
          eventStart -
            targetStart,
        );

      const maxDifference =
        1000 * 60 * 15;

      if (
        timeDifference >
        maxDifference
      ) {
        return false;
      }

      /*
       * 마지막으로 제목 유사도 검사
       */
      return isSimilarTitle(
        target.title,
        event.summary || "",
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

  /*
   * 한국 날짜 기준으로 하루 범위를 생성.
   */
  const koreaDate =
    getKoreaDateKey(
      start.getTime(),
    );

  return {
    start:
      `${koreaDate}T00:00:00+09:00`,
    end:
      `${addOneDay(
        koreaDate,
      )}T00:00:00+09:00`,
  };
}