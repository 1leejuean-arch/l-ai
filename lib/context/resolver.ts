import "server-only";

import {
  getOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";

export type ContextDomain =
  | "memory"
  | "calendar"
  | "drive"
  | "mail"
  | "general"
  | "unknown";

export type ContextAction =
  | "continue"
  | "repeat"
  | "rollback"
  | "reuse_previous"
  | "reference"
  | "none";

export type ContextResolution = {
  domain: ContextDomain;
  action: ContextAction;
  confidence: number;
  reason: string;
};

type ContextResolutionRaw = {
  domain?: unknown;
  action?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

const VALID_DOMAINS: ContextDomain[] = [
  "memory",
  "calendar",
  "drive",
  "mail",
  "general",
  "unknown",
];

const VALID_ACTIONS: ContextAction[] = [
  "continue",
  "repeat",
  "rollback",
  "reuse_previous",
  "reference",
  "none",
];

export function buildContextSummary(
  snapshot: ContextSnapshot,
) {
  const lines: string[] = [];

  if (
    snapshot.lastAction?.type ||
    snapshot.lastAction?.label
  ) {
    lines.push(
      [
        "[최근 작업]",
        snapshot.lastAction.type
          ? `종류: ${snapshot.lastAction.type}`
          : null,
        snapshot.lastAction.label
          ? `설명: ${snapshot.lastAction.label}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (
    snapshot.memory?.latestChange
  ) {
    const change =
      snapshot.memory.latestChange;

    lines.push(
      [
        "[최근 사용자 정보 변경]",
        `대상: ${change.category}/${change.key}`,
        `이전 값: ${
          change.previousValue ??
          "(없음)"
        }`,
        `현재 값: ${
          change.nextValue ??
          "(없음)"
        }`,
      ].join("\n"),
    );
  }

  const recentEvents =
    snapshot.calendar?.recentEvents ??
    [];

  if (recentEvents.length > 0) {
    const eventLines =
      recentEvents
        .slice(0, 3)
        .map(
          (event, index) =>
            [
              `${index + 1}. ${
                event.summary ||
                "(제목 없음)"
              }`,
              event.start
                ? `시작: ${event.start}`
                : null,
            ]
              .filter(Boolean)
              .join(" / "),
        );

    lines.push(
      [
        "[최근 Calendar 문맥]",
        ...eventLines,
      ].join("\n"),
    );
  }

  if (
    snapshot.drive?.recentFile
  ) {
    lines.push(
      [
        "[최근 Drive 문맥]",
        `파일: ${
          snapshot.drive.recentFile
            .name ||
          "(파일명 없음)"
        }`,
      ].join("\n"),
    );
  }

  if (
    snapshot.mail?.recentQuery
  ) {
    lines.push(
      [
        "[최근 Mail 문맥]",
        `검색/참조: ${snapshot.mail.recentQuery}`,
      ].join("\n"),
    );
  }

  if (
    snapshot.brain?.goal ||
    snapshot.brain?.state
  ) {
    lines.push(
      [
        "[최근 Brain 문맥]",
        snapshot.brain.goal
          ? `목표: ${snapshot.brain.goal}`
          : null,
        snapshot.brain.state
          ? `상태: ${snapshot.brain.state}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (lines.length === 0) {
    return "(최근 문맥 없음)";
  }

  return lines.join("\n\n");
}

export async function resolveConversationContext(
  message: string,
  contextSummary: string,
): Promise<ContextResolution> {
  const openai =
    getOpenAIClient();

  const response =
    await openai.responses.create({
      model:
        getOpenAIModel(),

      instructions: `
너는 L-AI의 공통 대화 문맥 해석기다.

사용자의 현재 문장이
이전 대화나 최근 작업을 참조하는지 판단한다.

사용자는 짧은 반말, 줄임말,
대명사, 생략된 표현을 자주 사용할 수 있다.

예:

"아까처럼 해줘"
"전처럼"
"그거 다시 해"
"원래대로 돌려줘"
"방금 하던 거 계속해"
"그거 말고 이전 걸로"
"아까 파일 다시 보여줘"
"방금 일정 취소해줘"

현재 제공되는 최근 문맥을 참고해서
사용자가 어느 기능을 말하는지 판단한다.

domain:

memory
- 사용자 장기기억
- 이름, 학교, 나이, 취향 등

calendar
- 일정 생성, 수정, 삭제, 조회

drive
- Google Drive 파일 검색, 읽기, 요약, 비교

mail
- 메일 검색, 확인 등

general
- 특정 기능이 아닌 일반 대화/작업

unknown
- 현재 문맥만으로 대상 판단이 어려움


action:

continue
- 방금 하던 작업을 계속한다.

repeat
- 이전 작업을 다시 실행한다.

rollback
- 최근 변경을 이전 상태로 되돌린다.

reuse_previous
- 이전 값이나 이전 설정을 다시 사용한다.

reference
- "그거", "아까 거"처럼 최근 대상을 가리킨다.

none
- 이전 문맥을 참조하는 요청이 아니다.


중요 규칙:

1. 단순 키워드 일치가 아니라 실제 의미를 판단한다.

2. contextSummary에 없는 내용을 추측하지 않는다.

3. 여러 domain이 가능하고 확실하지 않으면
   unknown을 사용한다.

4. 일반적인 새 요청이면 action은 none이다.

5. confidence는 0~1 사이 숫자다.

6. reason은 왜 그렇게 판단했는지
   짧은 한국어 한 문장으로 작성한다.

반드시 JSON만 출력한다.

형식:

{
  "domain": "calendar",
  "action": "rollback",
  "confidence": 0.95,
  "reason": "최근 작업이 일정 수정이고 사용자가 원래대로 되돌리기를 요청했다."
}
`,

      input: `
최근 L-AI 문맥:

${contextSummary || "(최근 문맥 없음)"}

현재 사용자 메시지:

${message}

현재 메시지가 최근 문맥을 어떻게 참조하는지 분석해.
`,
    });

  const raw =
    response.output_text.trim();

  if (!raw) {
    return {
      domain: "unknown",
      action: "none",
      confidence: 0,
      reason:
        "문맥 분석 결과가 비어 있다.",
    };
  }

  try {
    const cleaned =
      raw
        .replace(
          /^```json\s*/iu,
          "",
        )
        .replace(
          /^```\s*/u,
          "",
        )
        .replace(
          /\s*```$/u,
          "",
        )
        .trim();

    const parsed =
      JSON.parse(
        cleaned,
      ) as ContextResolutionRaw;

    const domain =
      typeof parsed.domain ===
        "string" &&
      VALID_DOMAINS.includes(
        parsed.domain as ContextDomain,
      )
        ? (
            parsed.domain as ContextDomain
          )
        : "unknown";

    const action =
      typeof parsed.action ===
        "string" &&
      VALID_ACTIONS.includes(
        parsed.action as ContextAction,
      )
        ? (
            parsed.action as ContextAction
          )
        : "none";

    const confidence =
      typeof parsed.confidence ===
      "number"
        ? Math.max(
            0,
            Math.min(
              1,
              parsed.confidence,
            ),
          )
        : 0;

    const reason =
      typeof parsed.reason ===
        "string"
        ? parsed.reason.trim()
        : "";

    return {
      domain,
      action,
      confidence,
      reason,
    };
  } catch (error) {
    console.error(
      "[L-AI Context Resolver] Failed to parse:",
      error,
    );

    return {
      domain: "unknown",
      action: "none",
      confidence: 0,
      reason:
        "문맥 분석 결과를 해석하지 못했다.",
    };
  }
}

export type ContextSnapshot = {
  lastAction?: {
    type?: string | null;
    label?: string | null;
  } | null;

  memory?: {
    latestChange?: {
      category: string;
      key: string;
      previousValue: string | null;
      nextValue: string | null;
    } | null;
  } | null;

  calendar?: {
    recentEvents?: Array<{
      id?: string | null;
      summary?: string | null;
      start?: string | null;
    }>;
  } | null;

  drive?: {
    recentFile?: {
      id?: string | null;
      name?: string | null;
    } | null;
  } | null;

  mail?: {
    recentQuery?: string | null;
  } | null;

  brain?: {
    goal?: string | null;
    state?: string | null;
  } | null;
};

export type ContextSummaryInput = {
  lastAction?: string | null;
  memoryHistory?: string | null;
  calendarContext?: string | null;
  driveContext?: string | null;
  mailContext?: string | null;
  brainContext?: string | null;
};

