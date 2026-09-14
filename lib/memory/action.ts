import "server-only";

import {
  deleteMemory,
  getMemory,
  saveMemoryAndWait,
} from "@/lib/memory/context";

const LAST_ACTION_TTL_MS =
  1000 * 60 * 60 * 24 * 7;

const LAST_ACTION_REFERENCE_TTL_MS = {
  immediate: 1000 * 60 * 60,
  earlier: 1000 * 60 * 60 * 24,
  recent: LAST_ACTION_TTL_MS,
  default: LAST_ACTION_TTL_MS,
} as const;

export type LastActionRecency =
  keyof typeof LAST_ACTION_REFERENCE_TTL_MS;

export type LastActionType =
  | "calendar_create"
  | "calendar_update"
  | "calendar_delete"
  | "calendar_get"
  | "drive_search"
  | "drive_read"
  | "drive_summary"
  | "drive_calendar"
  | "drive_calendar_extract";

export type LastActionMemory = {
  type: LastActionType;

  /*
   * 사람이 볼 수 있는 설명
   *
   * 예:
   * "1학년 프로그램 일정 추가"
   * "대의원회의.pdf 검색"
   */
  label: string;

  /*
   * 작업과 관련된 추가 데이터.
   *
   * Calendar eventId,
   * Drive fileId,
   * 파일명 등을 자유롭게 저장.
   */
  data?: Record<
    string,
    unknown
  >;

  createdAt: number;
};

export async function saveLastAction(
  sessionId: string,
  action: Omit<
    LastActionMemory,
    "createdAt"
  >,
) {
  const memory: LastActionMemory = {
    ...action,
    createdAt: Date.now(),
  };

  const persistence =
    await saveMemoryAndWait(
      sessionId,
      "action",
      "last_action",
      memory,
    );

  const details = {
    sessionId,
    type: memory.type,
    label: memory.label,
  };

  if (persistence === "persisted") {
    console.log(
      "[L-AI Memory] Saved last action:",
      details,
    );
  } else if (
    persistence === "memory_only"
  ) {
    console.log(
      "[L-AI Memory] Last action cached in memory:",
      details,
    );
  } else {
    console.warn(
      "[L-AI Memory] Last action cached, but persistence failed:",
      details,
    );
  }
}

export function getLastActionRecency(
  message: string,
): LastActionRecency {
  if (/방금/u.test(message)) {
    return "immediate";
  }

  if (/아까/u.test(message)) {
    return "earlier";
  }

  if (/최근/u.test(message)) {
    return "recent";
  }

  return "default";
}

export async function getLastAction(
  sessionId: string,
  recency: LastActionRecency =
    "default",
) {
  const action =
    await getMemory<LastActionMemory>(
      sessionId,
      "action",
      "last_action",
      LAST_ACTION_TTL_MS,
    );

  console.log(
    "[L-AI Memory] Last action get:",
    {
      sessionId,
      result: action
        ? {
            type: action.type,
            label: action.label,
          }
        : null,
    },
  );

  if (!action) {
    return null;
  }

  const maxAge =
    LAST_ACTION_REFERENCE_TTL_MS[
      recency
    ];

  if (
    !Number.isFinite(action.createdAt) ||
    Date.now() - action.createdAt >
      maxAge
  ) {
    console.log(
      "[L-AI Memory] Ignored expired memory:",
      {
        sessionId,
        memoryType: "action",
        memoryKey: "last_action",
        recency,
      },
    );

    if (
      !Number.isFinite(action.createdAt) ||
      Date.now() - action.createdAt >
        LAST_ACTION_TTL_MS
    ) {
      await clearLastAction(sessionId);
    }

    return null;
  }

  return action;
}

export async function clearLastAction(
  sessionId: string,
) {
  await deleteMemory(
    sessionId,
    "action",
    "last_action",
  );

  console.log(
    "[L-AI Memory] Cleared last action:",
    {
      sessionId,
    },
  );
}
