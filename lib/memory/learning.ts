import "server-only";

import {
  deleteMemory,
  getMemory,
  saveMemoryAndWait,
} from "./context";

import type {
  LearnedProfileFact,
} from "./learning-ai";

type LearningModeState = {
  enabled: boolean;
  startedAt: number | null;
};

export type LearningProfileEntry = {
  id: string;
  content: string;
  createdAt: number;
};

export type StoredProfileFact = {
  category: string;
  key: string;
  value: string;
  updatedAt: number;
};

const LEARNING_MODE_KEY =
  "learning_mode";

const USER_PROFILE_KEY =
  "user_profile";

const USER_PROFILE_FACTS_KEY =
  "user_profile_facts";

const LEARNING_MEMORY_TTL_MS =
  1000 * 60 * 60 * 24 * 365 * 10;

/*
 * ============================================================
 * LEARNING MODE
 * ============================================================
 */

export async function getLearningMode(
  sessionId: string,
): Promise<LearningModeState> {
  const stored =
    await getMemory<LearningModeState>(
      sessionId,
      "profile",
      LEARNING_MODE_KEY,
      LEARNING_MEMORY_TTL_MS,
    );

  return (
    stored ?? {
      enabled: false,
      startedAt: null,
    }
  );
}

export async function setLearningMode(
  sessionId: string,
  enabled: boolean,
) {
  const state: LearningModeState = {
    enabled,
    startedAt:
      enabled
        ? Date.now()
        : null,
  };

  return saveMemoryAndWait(
    sessionId,
    "profile",
    LEARNING_MODE_KEY,
    state,
  );
}

/*
 * ============================================================
 * RAW USER PROFILE
 * ============================================================
 *
 * 초기 단계에서 사용하던
 * 사용자의 원문 기억 저장소.
 *
 * 기존 기능 호환을 위해 유지한다.
 */

export async function getLearningProfile(
  sessionId: string,
): Promise<LearningProfileEntry[]> {
  const stored =
    await getMemory<LearningProfileEntry[]>(
      sessionId,
      "profile",
      USER_PROFILE_KEY,
      LEARNING_MEMORY_TTL_MS,
    );

  return Array.isArray(stored)
    ? stored
    : [];
}

export async function appendLearningProfileEntry(
  sessionId: string,
  content: string,
) {
  const profile =
    await getLearningProfile(
      sessionId,
    );

  const entry: LearningProfileEntry = {
    id: crypto.randomUUID(),
    content: content.trim(),
    createdAt: Date.now(),
  };

  const updatedProfile = [
    ...profile,
    entry,
  ];

  const status =
    await saveMemoryAndWait(
      sessionId,
      "profile",
      USER_PROFILE_KEY,
      updatedProfile,
    );

  return {
    status,
    entry,
    profile: updatedProfile,
  };
}

/*
 * ============================================================
 * STRUCTURED PROFILE FACTS
 * ============================================================
 */

export async function getLearningFacts(
  sessionId: string,
): Promise<StoredProfileFact[]> {
  const stored =
    await getMemory<StoredProfileFact[]>(
      sessionId,
      "profile",
      USER_PROFILE_FACTS_KEY,
      LEARNING_MEMORY_TTL_MS,
    );

  if (!Array.isArray(stored)) {
    return [];
  }

  return stored.filter(
    (fact) =>
      typeof fact === "object" &&
      fact !== null &&
      typeof fact.category === "string" &&
      typeof fact.key === "string" &&
      typeof fact.value === "string" &&
      typeof fact.updatedAt === "number",
  );
}

/*
 * 같은 의미인데 AI가 서로 다른 key를 만들 수 있으므로
 * 안정적인 key로 표준화한다.
 *
 * 예:
 *
 * school
 * school_name
 * schoolName
 *
 * 전부 school_name으로 통일한다.
 */
function normalizeLearningKey(
  category: string,
  key: string,
) {
  const normalizedCategory =
    category.trim().toLowerCase();

  const normalizedKey =
    key.trim().toLowerCase();

  if (
    normalizedCategory === "school" &&
    (
      normalizedKey === "school" ||
      normalizedKey === "school_name" ||
      normalizedKey === "schoolname"
    )
  ) {
    return "school_name";
  }

  return normalizedKey;
}

/*
 * ============================================================
 * LEARNING HISTORY
 * ============================================================
 *
 * 사용자 정보가 변경될 때
 * 이전 값과 새로운 값을 기록한다.
 *
 * 추후:
 * - 다시 원래대로
 * - 아까처럼
 * - 이전 정보로 돌려줘
 *
 * 같은 요청을 처리할 때 사용한다.
 */

export type LearningHistoryItem = {
  category: string;
  key: string;
  previousValue: string | null;
  nextValue: string | null;
  changedAt: number;
};

const LEARNING_HISTORY_KEY =
  "learning_history";

export async function getLearningHistory(
  sessionId: string,
) {
  return (
    await getMemory<LearningHistoryItem[]>(
      sessionId,
      "profile",
      LEARNING_HISTORY_KEY,
    )
  ) ?? [];
}

export async function appendLearningHistory(
  sessionId: string,
  item: LearningHistoryItem,
) {
  const existing =
    await getLearningHistory(
      sessionId,
    );

  const nextHistory = [
    item,
    ...existing,
  ].slice(0, 20);

  return saveMemoryAndWait(
    sessionId,
    "profile",
    LEARNING_HISTORY_KEY,
    nextHistory,
  );
}

export async function clearLearningHistory(
  sessionId: string,
) {
  await deleteMemory(
    sessionId,
    "profile",
    LEARNING_HISTORY_KEY,
  );
}

export async function undoLatestLearningChange(
  sessionId: string,
) {
  const history =
    await getLearningHistory(
      sessionId,
    );

  if (history.length === 0) {
    return {
      status: "persisted" as const,
      undone: null,
    };
  }

  const latest =
    history[0];

  const existingFacts =
    await getLearningFacts(
      sessionId,
    );

  const normalizedKey =
    normalizeLearningKey(
      latest.category,
      latest.key,
    );

  let updatedFacts =
    [...existingFacts];

  /*
   * 이전 값이 null이면
   * 최근 작업은 "새 정보 추가"였다는 뜻.
   *
   * → undo 시 해당 정보를 삭제한다.
   */
  if (latest.previousValue === null) {
    updatedFacts =
      updatedFacts.filter(
        (fact) =>
          !(
            fact.category ===
              latest.category &&
            normalizeLearningKey(
              fact.category,
              fact.key,
            ) ===
              normalizedKey
          ),
      );
  } else {
    /*
     * 기존 값이 있었다면
     * 이전 값으로 복구한다.
     */
    const existingIndex =
      updatedFacts.findIndex(
        (fact) =>
          fact.category ===
            latest.category &&
          normalizeLearningKey(
            fact.category,
            fact.key,
          ) ===
            normalizedKey,
      );

    const restoredFact: StoredProfileFact = {
      category:
        latest.category,
      key:
        normalizedKey,
      value:
        latest.previousValue,
      updatedAt:
        Date.now(),
    };

    if (existingIndex >= 0) {
      updatedFacts[
        existingIndex
      ] = restoredFact;
    } else {
      updatedFacts.push(
        restoredFact,
      );
    }
  }

  const factStatus =
    await saveMemoryAndWait(
      sessionId,
      "profile",
      USER_PROFILE_FACTS_KEY,
      updatedFacts,
    );

  if (factStatus === "failed") {
    return {
      status: "failed" as const,
      undone: null,
    };
  }

  /*
   * 성공적으로 되돌렸으면
   * 사용한 history 한 건을 제거한다.
   */
  const remainingHistory =
    history.slice(1);

  const historyStatus =
    await saveMemoryAndWait(
      sessionId,
      "profile",
      LEARNING_HISTORY_KEY,
      remainingHistory,
    );

  if (historyStatus === "failed") {
    return {
      status: "failed" as const,
      undone: latest,
    };
  }

  return {
    status: "persisted" as const,
    undone: latest,
  };
}

/*
 * ============================================================
 * UPSERT PROFILE FACTS
 * ============================================================
 *
 * 기능:
 *
 * 1. 같은 key 중복 제거
 * 2. key 표준화
 * 3. 같은 값 중복 방지
 * 4. 기존 값 변경
 * 5. 변경 이력 저장
 */

export async function upsertLearningFacts(
  sessionId: string,
  facts: LearnedProfileFact[],
) {
  const existingFacts =
    await getLearningFacts(
      sessionId,
    );

  /*
   * 기존 기억 안에 이미 같은 key가 여러 개 있으면
   * 가장 최근 정보 하나만 남긴다.
   *
   * 예:
   *
   * activity / broadcasting_activity
   * work / broadcasting_activity
   *
   * → broadcasting_activity 하나만 유지
   */
  const existingByKey =
    new Map<string, StoredProfileFact>();

  for (const fact of existingFacts) {
    const normalizedKey =
      normalizeLearningKey(
        fact.category,
        fact.key,
      );

    if (!normalizedKey) {
      continue;
    }

    const previous =
      existingByKey.get(
        normalizedKey,
      );

    if (
      !previous ||
      fact.updatedAt >=
        previous.updatedAt
    ) {
      existingByKey.set(
        normalizedKey,
        fact,
      );
    }
  }

  const updatedFacts =
    Array.from(
      existingByKey.values(),
    );

  for (const fact of facts) {
    const category =
      fact.category.trim();

    const key =
      normalizeLearningKey(
        category,
        fact.key,
      );

    const value =
      fact.value.trim();

    if (
      !category ||
      !key ||
      !value
    ) {
      continue;
    }

    const normalizedKey =
      key.toLowerCase();

    const normalizedValue =
      value
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase();

    /*
     * category가 조금 달라도
     * 같은 안정적 key면 같은 정보로 본다.
     */
    const existingIndex =
      updatedFacts.findIndex(
        (storedFact) =>
          normalizeLearningKey(
            storedFact.category,
            storedFact.key,
          ) === normalizedKey,
      );

    const nextFact: StoredProfileFact = {
      category,
      key,
      value,
      updatedAt: Date.now(),
    };

    /*
     * 기존 정보가 있는 경우
     */
    if (existingIndex >= 0) {
      const existing =
        updatedFacts[
          existingIndex
        ];

      const existingValue =
        existing.value
          .replace(/\s+/gu, " ")
          .trim()
          .toLowerCase();

      /*
       * key도 같고 value도 같으면
       * 아무 작업도 하지 않는다.
       */
      if (
        existingValue ===
        normalizedValue
      ) {
        continue;
      }

      /*
       * 값이 실제로 달라졌다면
       * 변경 이력을 먼저 저장한다.
       */
      await appendLearningHistory(
        sessionId,
        {
          category,
          key,
          previousValue:
            existing.value,
          nextValue:
            value,
          changedAt:
            Date.now(),
        },
      );

      /*
       * 기존 정보 업데이트
       */
      updatedFacts[
        existingIndex
      ] = nextFact;

      continue;
    }

    /*
     * key는 다르지만
     * 내용이 완전히 같은 기억이 이미 있으면
     * 중복 저장하지 않는다.
     */
    const sameValueExists =
      updatedFacts.some(
        (storedFact) =>
          storedFact.value
            .replace(/\s+/gu, " ")
            .trim()
            .toLowerCase() ===
          normalizedValue,
      );

    if (sameValueExists) {
      continue;
    }

    /*
     * 완전히 새로운 정보도
     * history에 기록한다.
     */
    await appendLearningHistory(
      sessionId,
      {
        category,
        key,
        previousValue: null,
        nextValue: value,
        changedAt:
          Date.now(),
      },
    );

    updatedFacts.push(
      nextFact,
    );
  }

  const status =
    await saveMemoryAndWait(
      sessionId,
      "profile",
      USER_PROFILE_FACTS_KEY,
      updatedFacts,
    );

  return {
    status,
    facts: updatedFacts,
  };
}

/*
 * ============================================================
 * DELETE PROFILE FACT
 * ============================================================
 */

export async function deleteLearningFact(
  sessionId: string,
  category: string,
  key: string,
) {
  const existingFacts =
    await getLearningFacts(
      sessionId,
    );

  const normalizedTargetKey =
    normalizeLearningKey(
      category,
      key,
    );

  const filteredFacts =
    existingFacts.filter(
      (fact) =>
        !(
          fact.category === category &&
          normalizeLearningKey(
            fact.category,
            fact.key,
          ) === normalizedTargetKey
        ),
    );

  const deleted =
    filteredFacts.length !==
    existingFacts.length;

  if (!deleted) {
    return {
      status: "persisted" as const,
      deleted: false,
      facts: existingFacts,
    };
  }

  const status =
    await saveMemoryAndWait(
      sessionId,
      "profile",
      USER_PROFILE_FACTS_KEY,
      filteredFacts,
    );

  return {
    status,
    deleted: true,
    facts: filteredFacts,
  };
}

/*
 * ============================================================
 * DELETE MOST RECENT FACT
 * ============================================================
 */

export async function deleteMostRecentLearningFact(
  sessionId: string,
) {
  const existingFacts =
    await getLearningFacts(
      sessionId,
    );

  if (existingFacts.length === 0) {
    return {
      status: "persisted" as const,
      deleted: null,
      facts: existingFacts,
    };
  }

  const sortedFacts =
    [...existingFacts].sort(
      (a, b) =>
        b.updatedAt - a.updatedAt,
    );

  const mostRecent =
    sortedFacts[0];

  const filteredFacts =
    existingFacts.filter(
      (fact) =>
        !(
          fact.category ===
            mostRecent.category &&
          normalizeLearningKey(
            fact.category,
            fact.key,
          ) ===
            normalizeLearningKey(
              mostRecent.category,
              mostRecent.key,
            )
        ),
    );

  const status =
    await saveMemoryAndWait(
      sessionId,
      "profile",
      USER_PROFILE_FACTS_KEY,
      filteredFacts,
    );

  return {
    status,
    deleted: mostRecent,
    facts: filteredFacts,
  };
}

/*
 * ============================================================
 * GET SINGLE PROFILE FACT
 * ============================================================
 */

export async function getLearningFact(
  sessionId: string,
  category: string,
  key: string,
) {
  const facts =
    await getLearningFacts(
      sessionId,
    );

  const normalizedTargetKey =
    normalizeLearningKey(
      category,
      key,
    );

  return (
    facts.find(
      (fact) =>
        fact.category === category &&
        normalizeLearningKey(
          fact.category,
          fact.key,
        ) === normalizedTargetKey,
    ) ?? null
  );
}

/*
 * ============================================================
 * PENDING LEARNING CONFLICT
 * ============================================================
 */

export type LearningConflictItem = {
  previous: StoredProfileFact;
  next: {
    category: string;
    key: string;
    value: string;
  };
};

export type PendingLearningConflict = {
  conflicts: LearningConflictItem[];
  createdAt: number;
};

const LEARNING_CONFLICT_KEY =
  "pending_learning_conflict";

export async function getPendingLearningConflict(
  sessionId: string,
) {
  const stored =
    await getMemory<
      | PendingLearningConflict
      | {
          previous: StoredProfileFact;
          next: {
            category: string;
            key: string;
            value: string;
          };
          createdAt: number;
        }
    >(
      sessionId,
      "profile",
      LEARNING_CONFLICT_KEY,
      1000 * 60 * 10,
    );

  if (!stored) {
    return null;
  }

  /*
   * 새 다중 충돌 구조
   */
  if (
    "conflicts" in stored &&
    Array.isArray(stored.conflicts)
  ) {
    return stored;
  }

  /*
   * 예전에 저장된 단일 conflict 구조도
   * 새 구조로 변환한다.
   */
  if (
    "previous" in stored &&
    "next" in stored
  ) {
    return {
      conflicts: [
        {
          previous:
            stored.previous,
          next:
            stored.next,
        },
      ],
      createdAt:
        stored.createdAt,
    } satisfies PendingLearningConflict;
  }

  return null;
}

export async function setPendingLearningConflict(
  sessionId: string,
  conflicts: LearningConflictItem[],
) {
  const pending: PendingLearningConflict = {
    conflicts,
    createdAt: Date.now(),
  };

  return saveMemoryAndWait(
    sessionId,
    "profile",
    LEARNING_CONFLICT_KEY,
    pending,
  );
}

export async function clearPendingLearningConflict(
  sessionId: string,
) {
  await deleteMemory(
    sessionId,
    "profile",
    LEARNING_CONFLICT_KEY,
  );
}

/*
 * ============================================================
 * PENDING FILE LEARNING CANDIDATES
 * ============================================================
 */

export type PendingLearningCandidates = {
  facts: StoredProfileFact[];
  createdAt: number;
};

const LEARNING_CANDIDATES_KEY =
  "pending_learning_candidates";

export async function getPendingLearningCandidates(
  sessionId: string,
) {
  return getMemory<PendingLearningCandidates>(
    sessionId,
    "profile",
    LEARNING_CANDIDATES_KEY,
    1000 * 60 * 10,
  );
}

export async function setPendingLearningCandidates(
  sessionId: string,
  facts: StoredProfileFact[],
) {
  return saveMemoryAndWait(
    sessionId,
    "profile",
    LEARNING_CANDIDATES_KEY,
    {
      facts,
      createdAt: Date.now(),
    } satisfies PendingLearningCandidates,
  );
}

export async function clearPendingLearningCandidates(
  sessionId: string,
) {
  await deleteMemory(
    sessionId,
    "profile",
    LEARNING_CANDIDATES_KEY,
  );
}