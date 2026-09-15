import "server-only";

export type MemoryType =
  | "calendar"
  | "drive"
  | "action"
  | "conversation"
  | "brain";

export type MemoryRecord<T = unknown> = {
  sessionId: string;
  memoryType: MemoryType;
  memoryKey: string;
  memoryValue: T;
  updatedAt: number;
};

type StoredMemoryRow = {
  session_id: string;
  memory_type: MemoryType;
  memory_key: string;
  memory_value: unknown;
  updated_at: string;
};

const memoryCache =
  new Map<string, MemoryRecord>();

const DEFAULT_MEMORY_TTL_MS =
  1000 * 60 * 60 * 24 * 7;

export type MemoryPersistenceStatus =
  | "persisted"
  | "memory_only"
  | "failed";

function getCacheKey(
  sessionId: string,
  memoryType: MemoryType,
  memoryKey: string,
) {
  return `${sessionId}:${memoryType}:${memoryKey}`;
}

function getSupabaseConfig() {
  const url =
    process.env.SUPABASE_URL?.trim();

  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !secretKey) {
    return null;
  }

  return {
    url: url.replace(/\/+$/u, ""),
    secretKey,
  };
}

function isStoredMemoryRow(
  value: unknown,
): value is StoredMemoryRow {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    typeof record.session_id === "string" &&
    (
      record.memory_type === "calendar" ||
      record.memory_type === "drive" ||
      record.memory_type === "action" ||
      record.memory_type === "conversation"
    ) &&
    typeof record.memory_key === "string" &&
    typeof record.updated_at === "string"
  );
}

async function persistMemory<T>(
  record: MemoryRecord<T>,
): Promise<MemoryPersistenceStatus> {
  const config = getSupabaseConfig();

  if (!config) {
    console.warn(
      "[L-AI Memory] Supabase configuration missing. Using memory only.",
    );
    return "memory_only";
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_memory?on_conflict=session_id,memory_type,memory_key`,
      {
        method: "POST",
        headers: {
          apikey: config.secretKey,
          "Content-Type": "application/json",
          Prefer:
            "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          session_id: record.sessionId,
          memory_type: record.memoryType,
          memory_key: record.memoryKey,
          memory_value: record.memoryValue,
          updated_at:
            new Date(
              record.updatedAt,
            ).toISOString(),
        }),
      },
    );

    if (!response.ok) {
      console.error(
        "[L-AI Memory] Save failed:",
        response.status,
        await response.text(),
      );

      return "failed";
    }

    return "persisted";
  } catch (error) {
    console.error(
      "[L-AI Memory] Save request failed:",
      error,
    );

    return "failed";
  }
}

function cacheMemory<T>(
  sessionId: string,
  memoryType: MemoryType,
  memoryKey: string,
  memoryValue: T,
) {
  const record: MemoryRecord<T> = {
    sessionId,
    memoryType,
    memoryKey,
    memoryValue,
    updatedAt: Date.now(),
  };

  memoryCache.set(
    getCacheKey(
      sessionId,
      memoryType,
      memoryKey,
    ),
    record,
  );

  return record;
}

export function saveMemory<T>(
  sessionId: string,
  memoryType: MemoryType,
  memoryKey: string,
  memoryValue: T,
) {
  const record = cacheMemory(
    sessionId,
    memoryType,
    memoryKey,
    memoryValue,
  );

  void persistMemory(record);
}

export async function saveMemoryAndWait<T>(
  sessionId: string,
  memoryType: MemoryType,
  memoryKey: string,
  memoryValue: T,
) {
  const record = cacheMemory(
    sessionId,
    memoryType,
    memoryKey,
    memoryValue,
  );

  return persistMemory(record);
}

export async function getMemory<T>(
  sessionId: string,
  memoryType: MemoryType,
  memoryKey: string,
  ttlMs = DEFAULT_MEMORY_TTL_MS,
): Promise<T | null> {
  const cacheKey =
    getCacheKey(
      sessionId,
      memoryType,
      memoryKey,
    );

  const cached =
    memoryCache.get(cacheKey);

  if (cached) {
    if (
      Date.now() - cached.updatedAt <=
      ttlMs
    ) {
      return cached.memoryValue as T;
    }

    console.log(
      "[L-AI Memory] Ignored expired memory:",
      {
        sessionId,
        memoryType,
        memoryKey,
      },
    );

    await deleteMemory(
      sessionId,
      memoryType,
      memoryKey,
    );

    return null;
  }

  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_memory?session_id=eq.${encodeURIComponent(
        sessionId,
      )}&memory_type=eq.${encodeURIComponent(
        memoryType,
      )}&memory_key=eq.${encodeURIComponent(
        memoryKey,
      )}&select=session_id,memory_type,memory_key,memory_value,updated_at&limit=1`,
      {
        headers: {
          apikey: config.secretKey,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        "[L-AI Memory] Load failed:",
        response.status,
        await response.text(),
      );

      return null;
    }

    const result: unknown =
      await response.json();

    if (
      !Array.isArray(result) ||
      result.length === 0 ||
      !isStoredMemoryRow(result[0])
    ) {
      return null;
    }

    const row = result[0];

    const updatedAt =
      new Date(
        row.updated_at,
      ).getTime();

    if (
      !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt >
        ttlMs
    ) {
      console.log(
        "[L-AI Memory] Ignored expired memory:",
        {
          sessionId,
          memoryType,
          memoryKey,
        },
      );

      await deleteMemory(
        sessionId,
        memoryType,
        memoryKey,
      );

      return null;
    }

    memoryCache.set(cacheKey, {
      sessionId: row.session_id,
      memoryType: row.memory_type,
      memoryKey: row.memory_key,
      memoryValue: row.memory_value,
      updatedAt,
    });

    return row.memory_value as T;
  } catch (error) {
    console.error(
      "[L-AI Memory] Load request failed:",
      error,
    );

    return null;
  }
}

export async function deleteMemory(
  sessionId: string,
  memoryType: MemoryType,
  memoryKey: string,
) {
  const cacheKey =
    getCacheKey(
      sessionId,
      memoryType,
      memoryKey,
    );

  memoryCache.delete(cacheKey);

  const config = getSupabaseConfig();

  if (!config) {
    return;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_memory?session_id=eq.${encodeURIComponent(
        sessionId,
      )}&memory_type=eq.${encodeURIComponent(
        memoryType,
      )}&memory_key=eq.${encodeURIComponent(
        memoryKey,
      )}`,
      {
        method: "DELETE",
        headers: {
          apikey: config.secretKey,
          Prefer: "return=minimal",
        },
      },
    );

    if (!response.ok) {
      console.error(
        "[L-AI Memory] Delete failed:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error(
      "[L-AI Memory] Delete request failed:",
      error,
    );
  }
}
