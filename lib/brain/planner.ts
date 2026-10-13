import {
  getTool,
} from "./tools";

import type {
  PlannerInput,
  PlannerResult,
  PlannerStep,
} from "./types";

function buildStep(
  order: number,
  toolId: string,
  reason: string,
): PlannerStep {
  return {
    order,
    toolId,
    reason,
  };
}

function calculatePlanRisk(
  steps: PlannerStep[],
) {
  const tools = steps
    .map((step) =>
      getTool(step.toolId),
    )
    .filter(
      (
        tool,
      ): tool is NonNullable<
        ReturnType<typeof getTool>
      > => Boolean(tool),
    );

  if (
    tools.some(
      (tool) =>
        tool.risk === "high",
    )
  ) {
    return "high" as const;
  }

  if (
    tools.some(
      (tool) =>
        tool.risk === "medium",
    )
  ) {
    return "medium" as const;
  }

  return "low" as const;
}

function requiresPlanConfirmation(
  steps: PlannerStep[],
) {
  return steps.some(
    (step) =>
      getTool(step.toolId)
        ?.requiresConfirmation ===
      true,
  );
}

function planFromIntent(
  input: PlannerInput,
): PlannerStep[] | null {
  switch (input.intent) {
    case "calendar_get":
      return [
        buildStep(
          1,
          "calendar.get",
          "사용자가 Calendar 일정 조회를 요청했다.",
        ),
      ];

    case "calendar_create":
      return [
        buildStep(
          1,
          "calendar.create",
          "사용자가 새로운 Calendar 일정 생성을 요청했다.",
        ),
      ];

    case "calendar_update":
      return [
        buildStep(
          1,
          "calendar.update",
          "사용자가 기존 Calendar 일정 수정을 요청했다.",
        ),
      ];

    case "calendar_delete":
      return [
        buildStep(
          1,
          "calendar.delete",
          "사용자가 Calendar 일정 삭제를 요청했다.",
        ),
      ];

        case "drive_search":
      return [
        buildStep(
          1,
          "drive.search",
          "사용자가 Google Drive 파일 검색을 요청했다.",
        ),
      ];

    case "mail_search":
      return [
        buildStep(
          1,
          "mail.search",
          "사용자가 L-JMAIL 메일 검색을 요청했다.",
        ),
      ];

    case "mail_read":
      return [buildStep(1, "mail.read", "선택한 메일 본문을 읽는다.")];

    case "mail_summary":
      return [
        buildStep(1, "mail.read", "선택한 메일 본문을 읽는다."),
        buildStep(2, "mail.summary", "메일의 핵심 내용을 요약한다."),
      ];

    case "mail_calendar_extract":
      const mailCalendarSteps = [
        buildStep(1, "mail.read", "선택한 메일 본문을 읽는다."),
        buildStep(2, "mail.calendar.extract", "메일에서 일정 후보를 추출한다."),
      ];

      if (/(?:캘린더|달력).*(?:추가|등록|넣어)|(?:일정|회의).*(?:캘린더|달력).*(?:추가|등록|넣어)/u.test(input.message)) {
        mailCalendarSteps.push(
          buildStep(3, "calendar.create", "사용자가 선택한 일정 후보를 Calendar에 등록한다."),
        );
      }

      return mailCalendarSteps;

    case "mail_draft":
      return [buildStep(1, "mail.draft", "선택한 자료를 바탕으로 발송 전 메일 초안을 만든다.")];

    case "drive_list":
    case "drive_recent":
      return [
        buildStep(
          1,
          "drive.list",
          "사용자가 Drive 파일 목록 확인을 요청했다.",
        ),
      ];

    default:
      return null;
  }
}

function planFromMessage(
  message: string,
): PlannerStep[] {
  const normalized =
    message.toLowerCase();

  const mentionsMail = /(?:메일|mail|l-jmail)/iu.test(normalized);
  const asksDraft = /(?:초안|작성|써\s*줘|만들)/u.test(normalized);
  const asksMailCalendarWork =
    /메일.*(?:찾아서|검색해서).*?(?:일정|회의).*(?:찾아|추출|캘린더|달력|추가|등록|넣어)/u.test(normalized) ||
    /메일(?:에|에서|안에|의).*?(?:일정|회의).*(?:찾아|추출|추가|등록|넣어)/u.test(normalized) ||
    /메일.*?(?:일정|회의).*?(?:캘린더|달력).*(?:추가|등록|넣어)/u.test(normalized);
  const asksCalendarCreate =
    /(?:캘린더|달력).*(?:추가|등록|넣어)/u.test(normalized);

  if (mentionsMail && asksMailCalendarWork) {
    const steps = [
      buildStep(1, "mail.search", "조건에 맞는 메일을 찾는다."),
      buildStep(2, "mail.read", "선택한 메일 본문을 읽는다."),
      buildStep(3, "mail.calendar.extract", "메일에서 일정 후보를 추출한다."),
    ];

    if (asksCalendarCreate) {
      steps.push(
        buildStep(4, "calendar.create", "사용자가 선택한 일정 후보를 Calendar에 등록한다."),
      );
    }

    return steps;
  }

  if (mentionsMail && asksDraft && /(?:파일|문서|drive|드라이브)/iu.test(normalized)) {
    return [
      buildStep(1, "drive.search", "초안의 근거가 될 Drive 파일을 찾는다."),
      buildStep(2, "drive.read", "Drive 파일 내용을 읽는다."),
      buildStep(3, "drive.summary", "메일에 사용할 핵심 내용을 정리한다."),
      buildStep(4, "mail.draft", "정리한 내용으로 메일 초안을 만든다."),
    ];
  }

  if (mentionsMail && asksDraft && /(?:일정|회의|캘린더|calendar)/iu.test(normalized)) {
    return [
      buildStep(1, "calendar.get", "메일에 사용할 Calendar 일정을 조회한다."),
      buildStep(2, "mail.draft", "일정 내용으로 메일 초안을 만든다."),
    ];
  }

const isContinuationSelection =
  /^\s*\d+\s*번(?:\s*(?:추가|등록|넣어|선택))?/u.test(
    normalized,
  ) ||
  /^(?:전부|모두|전체)\s*(?:추가|등록|넣어)/u.test(
    normalized,
  ) ||
  /^(?:취소|그만|안\s*할래)/u.test(
    normalized,
  );

if (isContinuationSelection) {
  return [
    buildStep(
      1,
      "calendar.create",
      "사용자가 이전 작업에서 대기 중인 일정 후보의 후속 선택 또는 등록 명령을 보냈다.",
    ),
  ];
}

  const mentionsDrive =
    /(?:드라이브|drive|파일|문서)/u.test(
      normalized,
    );

  const mentionsCalendar =
    /(?:캘린더|calendar|일정|달력)/u.test(
      normalized,
    );

  const asksExtraction =
    /(?:찾아|추출|뽑아)/u.test(
      normalized,
    );

  const asksAdd =
    /(?:추가|등록|넣어|만들어)/u.test(
      normalized,
    );

  /*
   * Drive → Calendar 복합 작업
   */
  if (
    mentionsDrive &&
    mentionsCalendar &&
    asksExtraction
  ) {
    const steps: PlannerStep[] = [
      buildStep(
        1,
        "drive.read",
        "일정 정보를 찾기 위해 Drive 파일 내용을 읽는다.",
      ),

      buildStep(
        2,
        "drive.calendar.extract",
        "파일 내용에서 Calendar 일정 후보를 추출한다.",
      ),
    ];

    if (asksAdd) {
      steps.push(
        buildStep(
          3,
          "calendar.create",
          "추출된 일정 중 사용자가 승인한 일정을 Calendar에 등록한다.",
        ),
      );
    }

    return steps;
  }

  /*
   * 파일 요약
   */
  if (
    mentionsDrive &&
    /요약/u.test(normalized)
  ) {
    return [
      buildStep(
        1,
        "drive.read",
        "요약할 파일의 내용을 읽는다.",
      ),

      buildStep(
        2,
        "drive.summary",
        "읽은 파일 내용을 요약한다.",
      ),
    ];
  }

  /*
   * Calendar 조회
   */
  if (
    mentionsCalendar &&
    /(?:알려|조회|보여|뭐\s*있)/u.test(
      normalized,
    )
  ) {
    return [
      buildStep(
        1,
        "calendar.get",
        "사용자가 Calendar 일정 확인을 요청했다.",
      ),
    ];
  }

  /*
   * 안전한 fallback
   */
  return [
    buildStep(
      1,
      "ai.respond",
      "현재 등록된 도구 중 명확히 일치하는 작업이 없어 일반 AI 응답을 사용한다.",
    ),
  ];
}

export function createPlan(
  input: PlannerInput,
): PlannerResult {
  const routerSteps =
    planFromIntent(input);

  const steps =
    routerSteps ??
    planFromMessage(input.message);

  const source =
    routerSteps
      ? "router"
      : steps.some(
            (step) =>
              step.toolId !==
              "ai.respond",
          )
        ? "heuristic"
        : "fallback";

  const confidence =
    typeof input.confidence ===
      "number"
      ? input.confidence
      : source === "router"
        ? 0.9
        : source === "heuristic"
          ? 0.75
          : 0.5;

  return {
    goal: input.message,

    steps,

    risk:
      calculatePlanRisk(steps),

    requiresConfirmation:
      requiresPlanConfirmation(
        steps,
      ),

    confidence,

    source,
  };
}
