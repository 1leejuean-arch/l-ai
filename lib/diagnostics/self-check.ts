import "server-only";

import {
  getOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";

import {
  getRecentGoogleDriveFiles,
} from "@/lib/drive/n8n";

import {
  callCalendarN8n,
} from "@/lib/calendar/n8n";

import {
  parseCalendarRequest,
} from "@/lib/calendar/parse";

import {
  searchLJmail,
} from "@/lib/mail/client";

import {
  deleteMemory,
  getMemory,
  saveMemoryAndWait,
} from "@/lib/memory/context";

import {
  getLearningFacts,
} from "@/lib/memory/learning";

import {
  createPlan,
} from "@/lib/brain/planner";

import {
  getAvailableToolIds,
} from "@/lib/brain/tools";

export type SelfCheckStatus =
  | "ok"
  | "warning"
  | "error";

export type SelfCheckItem = {
  id: string;
  name: string;
  status: SelfCheckStatus;
  message: string;
  durationMs: number;
};

export type SelfCheckReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;

  summary: {
    ok: number;
    warning: number;
    error: number;
  };

  items: SelfCheckItem[];
};

async function runCheck(
  id: string,
  name: string,
  check: () => Promise<{
    status?: SelfCheckStatus;
    message: string;
  }>,
): Promise<SelfCheckItem> {
  const startedAt = Date.now();

  try {
    const result =
      await check();

    return {
      id,
      name,
      status:
        result.status ?? "ok",
      message:
        result.message,
      durationMs:
        Date.now() - startedAt,
    };
  } catch (error) {
    console.error(
      `[L-AI Self Check] ${id} failed:`,
      error,
    );

    return {
      id,
      name,
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "알 수 없는 오류가 발생했어.",
      durationMs:
        Date.now() - startedAt,
    };
  }
}

async function checkOpenAI() {
  const openai =
    getOpenAIClient();

  const response =
    await openai.responses.create({
      model:
        getOpenAIModel(),

      instructions:
        "너는 연결 상태 점검용 응답기다. 반드시 OK라고만 답해.",

      input:
        "연결 상태를 확인해.",
    });

  const reply =
    response.output_text
      .trim()
      .toUpperCase();

  if (!reply) {
    throw new Error(
      "OpenAI 응답이 비어 있어.",
    );
  }

  return {
    message:
      "OpenAI API 응답 정상",
  };
}

async function checkMemory(
  sessionId: string,
) {
  const key =
    `self_check_${crypto.randomUUID()}`;

  const expectedValue = {
    ok: true,
    createdAt:
      Date.now(),
  };

  const saveStatus =
    await saveMemoryAndWait(
      sessionId,
      "conversation",
      key,
      expectedValue,
    );

  if (
    saveStatus === "failed"
  ) {
    throw new Error(
      "Supabase Memory 저장 실패",
    );
  }

  try {
    const loaded =
      await getMemory<{
        ok: boolean;
        createdAt: number;
      }>(
        sessionId,
        "conversation",
        key,
      );

    if (
      !loaded ||
      loaded.ok !== true
    ) {
      throw new Error(
        "저장한 Memory를 다시 읽지 못했어.",
      );
    }

    return {
      status:
        saveStatus ===
        "memory_only"
          ? "warning" as const
          : "ok" as const,

      message:
        saveStatus ===
        "memory_only"
          ? "메모리 캐시는 동작하지만 Supabase 영구 저장은 사용되지 않고 있어."
          : "Supabase Memory 저장 / 조회 정상",
    };
  } finally {
    await deleteMemory(
      sessionId,
      "conversation",
      key,
    );
  }
}

async function checkDrive() {
  const files =
    await getRecentGoogleDriveFiles();

  return {
    message:
      `Google Drive 조회 정상 · 최근 파일 ${files.length}개 응답`,
  };
}

async function checkCalendar() {
  const parsed =
    await parseCalendarRequest(
      "오늘 일정 보여줘",
      new Date(),
    );

  if (
    parsed.kind !== "get"
  ) {
    throw new Error(
      "Calendar 조회 요청 parser가 get 요청을 만들지 못했어.",
    );
  }

  const events =
    await callCalendarN8n(
      "calendar_get",
      parsed.range,
    );

  return {
    message:
      `Google Calendar 조회 정상 · 일정 ${events.length}개 응답`,
  };
}

async function checkMail() {
  /*
   * 존재 여부와 무관하게 검색 요청 자체가
   * 성공적으로 Worker / Supabase까지 왕복하는지 확인한다.
   *
   * 검색 결과 0개도 정상으로 처리한다.
   */
  const emails =
    await searchLJmail(
      "__l_ai_self_check__",
      {
        limit: 1,
      },
    );

  return {
    message:
      `L-JMAIL API 연결 정상 · 검색 응답 ${emails.length}개`,
  };
}

async function checkLearning(
  sessionId: string,
) {
  const facts =
    await getLearningFacts(
      sessionId,
    );

  return {
    message:
      `Learning 장기기억 조회 정상 · 저장된 구조화 정보 ${facts.length}개`,
  };
}

async function checkBrain() {
  const toolIds =
    getAvailableToolIds();

  const requiredTools = [
    "calendar.get",
    "calendar.create",
    "calendar.update",
    "calendar.delete",
    "drive.search",
    "drive.list",
    "drive.read",
    "drive.summary",
    "drive.calendar.extract",
    "mail.search",
    "ai.respond",
  ];

  const missingTools =
    requiredTools.filter(
      (toolId) =>
        !toolIds.includes(
          toolId,
        ),
    );

  if (
    missingTools.length > 0
  ) {
    return {
      status:
        "warning" as const,

      message:
        `Brain Tool 등록 누락: ${missingTools.join(", ")}`,
    };
  }

  const mailPlan =
    createPlan({
      message:
        "내 메일에서 구글 관련 메일 찾아줘",

      intent:
        "mail_search",

      confidence:
        0.99,
    });

  const hasMailSearch =
    mailPlan.steps.some(
      (step) =>
        step.toolId ===
        "mail.search",
    );

  if (!hasMailSearch) {
    throw new Error(
      "Brain Planner가 mail_search를 mail.search로 계획하지 못했어.",
    );
  }

  return {
    message:
      `Brain Planner / Tool Registry 정상 · 도구 ${toolIds.length}개 등록`,
  };
}

export async function runSelfCheck(
  sessionId: string,
): Promise<SelfCheckReport> {
  const startedAt =
    Date.now();

  console.log(
    "[L-AI Self Check] Started",
    {
      sessionId,
    },
  );

  /*
   * 읽기 전용 점검 중심.
   *
   * Calendar 생성 / 수정 / 삭제,
   * Drive 수정,
   * 메일 발송 등 실제 사용자 데이터를
   * 변경하는 작업은 실행하지 않는다.
   */
  const items =
    await Promise.all([
      runCheck(
        "openai",
        "OpenAI",
        checkOpenAI,
      ),

      runCheck(
        "memory",
        "Supabase Memory",
        () =>
          checkMemory(
            sessionId,
          ),
      ),

      runCheck(
        "drive",
        "Google Drive",
        checkDrive,
      ),

      runCheck(
        "calendar",
        "Google Calendar",
        checkCalendar,
      ),

      runCheck(
        "mail",
        "L-JMAIL",
        checkMail,
      ),

      runCheck(
        "learning",
        "Learning Memory",
        () =>
          checkLearning(
            sessionId,
          ),
      ),

      runCheck(
        "brain",
        "L-AI Brain",
        checkBrain,
      ),
    ]);

  const summary = {
    ok:
      items.filter(
        (item) =>
          item.status ===
          "ok",
      ).length,

    warning:
      items.filter(
        (item) =>
          item.status ===
          "warning",
      ).length,

    error:
      items.filter(
        (item) =>
          item.status ===
          "error",
      ).length,
  };

  const finishedAt =
    Date.now();

  console.log(
    "[L-AI Self Check] Completed",
    {
      sessionId,
      summary,
      durationMs:
        finishedAt -
        startedAt,
    },
  );

  return {
    startedAt:
      new Date(
        startedAt,
      ).toISOString(),

    finishedAt:
      new Date(
        finishedAt,
      ).toISOString(),

    durationMs:
      finishedAt -
      startedAt,

    summary,
    items,
  };
}

function getSelfCheckDiagnosis(
  item: SelfCheckItem,
) {
  if (item.status === "ok") {
    return null;
  }

  switch (item.id) {
    case "openai":
      return {
        code: "OPENAI-001",
        cause:
          "OpenAI API 설정, API Key, 네트워크 또는 모델 호출에 문제가 있을 수 있어.",
        suggestion:
          "OPENAI_API_KEY와 모델 설정을 확인하고 OpenAI 요청 로그를 확인해.",
      };

    case "memory":
      return {
        code: "MEMORY-001",
        cause:
          "Supabase Memory 저장 또는 조회 과정에 문제가 있을 수 있어.",
        suggestion:
          "SUPABASE_URL, Supabase Secret Key, l_ai_memory 테이블과 서버 로그를 확인해.",
      };

    case "drive":
      return {
        code: "DRIVE-001",
        cause:
          "Google Drive n8n Webhook 또는 Google Drive Credential 연결에 문제가 있을 수 있어.",
        suggestion:
          "n8n의 L-AI Drive Search 실행 기록을 열고 실패한 Google Drive 노드와 Credential 상태를 확인해.",
      };

    case "calendar":
      return {
        code: "CALENDAR-001",
        cause:
          "Google Calendar n8n Webhook, Calendar Credential 또는 조회 흐름에 문제가 있을 수 있어.",
        suggestion:
          "n8n Calendar 워크플로우 실행 기록과 Google Calendar Credential 연결 상태를 확인해.",
      };

    case "mail":
      return {
        code: "MAIL-001",
        cause:
          "L-JMAIL Worker, 인증키 또는 Supabase 메일 조회 과정에 문제가 있을 수 있어.",
        suggestion:
          "L_JMAIL_AI_API_URL, L_JMAIL_AI_API_KEY와 Cloudflare Worker 로그를 확인해.",
      };

    case "learning":
      return {
        code: "LEARNING-001",
        cause:
          "사용자 장기기억 조회 또는 Learning Memory 데이터에 문제가 있을 수 있어.",
        suggestion:
          "profile / user_profile_facts 저장 상태와 Supabase Memory 로그를 확인해.",
      };

    case "brain":
      return {
        code: "BRAIN-001",
        cause:
          "Planner 또는 Tool Registry 구성이 현재 기능 목록과 맞지 않을 수 있어.",
        suggestion:
          "lib/brain/planner.ts와 lib/brain/tools.ts의 등록 도구를 확인해.",
      };

    default:
      return {
        code: "SYSTEM-001",
        cause:
          "알 수 없는 시스템 오류가 발생했어.",
        suggestion:
          "서버 로그에서 해당 Self Check 항목의 오류 내용을 확인해.",
      };
  }
}

export function formatSelfCheckReport(
  report: SelfCheckReport,
) {
  const iconForStatus = (
    status: SelfCheckStatus,
  ) => {
    if (status === "ok") {
      return "✅";
    }

    if (status === "warning") {
      return "⚠️";
    }

    return "❌";
  };

  const lines =
    report.items.map((item) => {
      const diagnosis =
        getSelfCheckDiagnosis(item);

      const base =
        `${iconForStatus(item.status)} **${item.name}**\n` +
        `   ${item.message}\n` +
        `   ${item.durationMs}ms`;

      if (!diagnosis) {
        return base;
      }

      return (
        `${base}\n` +
        `   오류 코드: ${diagnosis.code}\n` +
        `   원인 후보: ${diagnosis.cause}\n` +
        `   확인 방법: ${diagnosis.suggestion}`
      );
    });

  const problemItems =
    report.items.filter(
      (item) =>
        item.status === "warning" ||
        item.status === "error",
    );

  const overallMessage =
    report.summary.error > 0
      ? "문제가 발견됐어. 아래 오류 코드와 확인 방법을 참고해."
      : report.summary.warning > 0
        ? "치명적인 오류는 없지만 확인이 필요한 항목이 있어."
        : "현재 점검한 핵심 기능은 모두 정상 작동 중이야.";

  const problemSummary =
    problemItems.length > 0
      ? [
          "",
          "### 발견된 문제",
          "",
          ...problemItems.map(
            (item) => {
              const diagnosis =
                getSelfCheckDiagnosis(item);

              return diagnosis
                ? `- **${diagnosis.code}** · ${item.name}`
                : `- ${item.name}`;
            },
          ),
        ]
      : [];

  return [
    "## L-AI Self Check",
    "",
    ...lines,
    "",
    "---",
    "",
    `✅ 정상: ${report.summary.ok}`,
    `⚠️ 경고: ${report.summary.warning}`,
    `❌ 오류: ${report.summary.error}`,
    "",
    `총 점검 시간: ${(report.durationMs / 1000).toFixed(1)}초`,
    ...problemSummary,
    "",
    overallMessage,
  ].join("\n");
}