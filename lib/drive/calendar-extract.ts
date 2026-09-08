import "server-only";

import {
  getOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";

export type DriveCalendarCandidate = {
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  description: string | null;
  allDay: boolean;
};

type RawDriveCalendarCandidate = {
  title?: unknown;
  start?: unknown;
  end?: unknown;
  location?: unknown;
  description?: unknown;
  allDay?: unknown;
};

function isValidCandidate(
  value: RawDriveCalendarCandidate,
): value is RawDriveCalendarCandidate & {
  title: string;
  start: string;
} {
  return (
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    typeof value.start === "string" &&
    value.start.trim().length > 0
  );
}

function cleanCandidate(
  value: RawDriveCalendarCandidate,
): DriveCalendarCandidate {
  return {
    title: String(value.title).trim(),

    start: String(value.start).trim(),

    end:
      typeof value.end === "string" &&
      value.end.trim().length > 0
        ? value.end.trim()
        : null,

    location:
      typeof value.location === "string" &&
      value.location.trim().length > 0
        ? value.location.trim()
        : null,

    description:
      typeof value.description === "string" &&
      value.description.trim().length > 0
        ? value.description.trim()
        : null,

    allDay: value.allDay === true,
  };
}

function getCandidateKey(
  candidate: DriveCalendarCandidate,
) {
  return [
    candidate.title
      .replace(/\s+/gu, "")
      .toLowerCase(),
    candidate.start,
  ].join("|");
}

function removeDuplicateCandidates(
  events: DriveCalendarCandidate[],
) {
  const seen = new Set<string>();

  return events.filter((event) => {
    const key = getCandidateKey(event);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

export async function extractCalendarEventsFromDriveFile(
  fileName: string,
  text: string,
) {
  const openai = getOpenAIClient();

  const trimmedText = text.slice(
    0,
    30_000,
  );

  const response =
    await openai.responses.create({
      model: getOpenAIModel(),

      instructions: `
너는 L-AI의 Google Drive 문서 일정 추출 엔진이다.

문서에서 Google Calendar에 실제로 등록할 수 있는
"구체적인 일정"을 찾아 구조화해야 한다.

반드시 JSON만 반환한다.
Markdown, 설명, 코드블록은 절대 반환하지 않는다.

반환 형식:

{
  "events": [
    {
      "title": "일정 제목",
      "start": "YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm:ss+09:00",
      "end": "YYYY-MM-DDTHH:mm:ss+09:00 또는 null",
      "location": "장소 또는 null",
      "description": "보조 설명 또는 null",
      "allDay": true
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━
[가장 중요한 규칙]
━━━━━━━━━━━━━━━━━━━━

문서가 표 형식에서 추출된 텍스트일 수 있다.

특히 다음과 같은 구조가 있을 수 있다.

날짜
→ 학년
→ 프로그램

예시:

2026-01-06
1학년
1학년 프로그램

2026-01-06
2학년
2학기 체육대회

2026-01-07
1학년
2학기 체육대회(미정)

2026-01-07
2학년
E스포츠

이런 구조라면 절대로

"2025학년도 학년말 꿈끼 탐색주간 운영
2026-01-06 ~ 2026-01-07"

같은 하나의 큰 일정으로만 합치지 않는다.

대신 가능한 경우 각각:

[1학년] 1학년 프로그램
[2학년] 2학기 체육대회
[1학년] 2학기 체육대회(미정)
[2학년] E스포츠

처럼 독립적인 일정 후보로 만든다.

━━━━━━━━━━━━━━━━━━━━
[표 복원 규칙]
━━━━━━━━━━━━━━━━━━━━

1. 여러 날짜가 있고 여러 프로그램이 있으면,
   날짜별 프로그램 관계를 최대한 복원한다.

2. "1학년", "2학년", "3학년"처럼
   대상 학년이 명확하면 제목 앞에 반드시 붙인다.

예:
[2학년] E스포츠

3. 같은 프로그램 이름이어도 날짜나 학년이 다르면
   서로 다른 일정으로 취급한다.

4. "(미정)"이라는 문구가 있으면 삭제하지 않는다.

예:
[1학년] 2학기 체육대회(미정)

5. 상위 행사명은 개별 프로그램이 명확히 존재하는 경우
   별도의 일정으로 만들지 않는 것을 우선한다.

예:
상위 제목:
"2025학년도 학년말 꿈끼 탐색주간 운영"

아래에 날짜별 세부 프로그램이 존재하면
세부 프로그램들을 우선 추출한다.

━━━━━━━━━━━━━━━━━━━━
[정확성 규칙]
━━━━━━━━━━━━━━━━━━━━

- 문서에 실제로 존재하는 정보만 사용한다.
- 날짜를 추측해서 만들지 않는다.
- 학년을 추측하지 않는다.
- 프로그램과 날짜의 연결을 전혀 판단할 수 없다면
  해당 프로그램은 일정으로 만들지 않는다.
- 표 구조가 일부 깨져 있더라도
  날짜 → 학년 → 프로그램 관계가 충분히 명확하면
  문맥을 복원해도 된다.
- 관계가 불확실하면 억지로 일정으로 만들지 않는다.
- 잘못된 자동 등록보다 누락이 더 안전하다.

━━━━━━━━━━━━━━━━━━━━
[날짜/시간 규칙]
━━━━━━━━━━━━━━━━━━━━

- 대한민국 시간대는 +09:00이다.
- 시간이 명확하면 ISO 날짜시간을 사용한다.

예:
2026-01-06T09:00:00+09:00

- 시간이 없으면 allDay=true로 한다.
- allDay=true이면 start는 YYYY-MM-DD 형식으로 한다.
- 하루짜리 종일 일정이면 end=null이어도 된다.
- 종료 시간이 명확하지 않으면 추측하지 않고 null로 둔다.

━━━━━━━━━━━━━━━━━━━━
[제목 규칙]
━━━━━━━━━━━━━━━━━━━━

학년이 있다면:

[학년] 프로그램명

형식을 사용한다.

예:
[1학년] 1학년 프로그램
[2학년] 2학기 체육대회
[1학년] 2학기 체육대회(미정)
[2학년] E스포츠

학년 정보가 없는 명확한 일정이면
프로그램명만 사용한다.

━━━━━━━━━━━━━━━━━━━━
[description 규칙]
━━━━━━━━━━━━━━━━━━━━

필요한 경우 다음처럼 원문 맥락을 짧게 넣을 수 있다.

"2025학년도 학년말 꿈끼 탐색주간 운영"

하지만 원문에 없는 정보를 만들어내면 안 된다.

━━━━━━━━━━━━━━━━━━━━
[중복 규칙]
━━━━━━━━━━━━━━━━━━━━

동일한
- 제목
- 날짜/시간

조합은 한 번만 반환한다.
`,

      input: `
파일명:
${fileName}

아래는 Google Drive 문서에서 추출한 텍스트다.

표 문서일 경우 행과 열의 순서가 일부 깨져 있을 수 있다.
가능한 경우 날짜, 학년, 프로그램의 관계를 복원하되
확신할 수 없는 연결은 만들지 마라.

--- 문서 내용 시작 ---

${trimmedText}

--- 문서 내용 끝 ---

이 문서에서 Google Calendar에 등록할 수 있는
구체적이고 신뢰할 수 있는 일정 후보들을 추출해줘.
`,
    });

  const output =
    response.output_text.trim();

  if (!output) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch {
    console.error(
      "[Drive Calendar] OpenAI returned invalid JSON:",
      output,
    );

    throw new Error(
      "Drive calendar extraction returned invalid JSON",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("events" in parsed) ||
    !Array.isArray(
      (parsed as {
        events?: unknown;
      }).events,
    )
  ) {
    throw new Error(
      "Drive calendar extraction returned invalid data",
    );
  }

  const rawEvents = (
    parsed as {
      events: RawDriveCalendarCandidate[];
    }
  ).events;

  const events = rawEvents
    .filter(isValidCandidate)
    .map(cleanCandidate);

  return removeDuplicateCandidates(
    events,
  );
}

function formatKoreanDateTime(
  value: string,
) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

export function formatDriveCalendarCandidates(
  fileName: string,
  events: DriveCalendarCandidate[],
) {
  if (events.length === 0) {
    return [
      `**${fileName}**에서`,
      "자동으로 캘린더에 등록할 만큼 명확한 일정을 찾지 못했어.",
      "",
      "표 구조나 날짜와 프로그램의 연결이 불분명할 수 있으니 원본 문서를 확인해줘.",
    ].join("\n");
  }

  const lines = events.map(
    (event, index) => {
      const start = event.allDay
        ? event.start
        : formatKoreanDateTime(
            event.start,
          );

      const details = [
        `**${index + 1}. ${event.title}**`,
        `- 시작: ${start}`,
      ];

      if (event.end) {
        details.push(
          `- 종료: ${
            event.allDay
              ? event.end
              : formatKoreanDateTime(
                  event.end,
                )
          }`,
        );
      }

      if (event.location) {
        details.push(
          `- 장소: ${event.location}`,
        );
      }

      if (event.description) {
        details.push(
          `- 참고: ${event.description}`,
        );
      }

      return details.join("\n");
    },
  );

  return [
    `**${fileName}에서 ${events.length}개의 일정 후보를 찾았어.**`,
    "",
    ...lines.flatMap((line) => [
      line,
      "",
    ]),
    "등록 전에 위 일정이 원본과 맞는지 확인해줘.",
  ].join("\n");
}