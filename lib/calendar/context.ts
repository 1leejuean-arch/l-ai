import "server-only";
import { saveMemory } from "@/lib/memory/context";
type CalendarContextEvent = {
  title: string;
  start: string;
  end: string;
};

type CalendarConversationContext = {
  rangeLabel?: string | null;
  events: CalendarContextEvent[];
  updatedAt: number;
};

type StoredCalendarContextRow = {
  session_id: string;
  range_label: string | null;
  events: CalendarContextEvent[];
  updated_at: string;
};

const calendarContexts =
  new Map<string, CalendarConversationContext>();

/*
 * 대화 문맥 유효기간.
 * 서버를 껐다 켜도 최대 7일 동안 최근 Calendar 문맥을 복원한다.
 */
const CONTEXT_TTL_MS =
  1000 * 60 * 60 * 24 * 7;

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

function isCalendarContextEvent(
  value: unknown,
): value is CalendarContextEvent {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    typeof record.title === "string" &&
    typeof record.start === "string" &&
    typeof record.end === "string"
  );
}

function isStoredCalendarContextRow(
  value: unknown,
): value is StoredCalendarContextRow {
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
      record.range_label === null ||
      typeof record.range_label === "string"
    ) &&
    Array.isArray(record.events) &&
    record.events.every(isCalendarContextEvent) &&
    typeof record.updated_at === "string"
  );
}

async function persistCalendarContext(
  sessionId: string,
  context: CalendarConversationContext,
) {
  const config = getSupabaseConfig();

  if (!config) {
    console.warn(
      "[Calendar Context] Supabase configuration is missing. Using memory only.",
    );
    return;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_calendar_context?on_conflict=session_id`,
      {
        method: "POST",
        headers: {
          apikey: config.secretKey,
          "Content-Type": "application/json",
          Prefer:
            "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          session_id: sessionId,
          range_label:
            context.rangeLabel ?? null,
          events: context.events,
          updated_at:
            new Date(
              context.updatedAt,
            ).toISOString(),
        }),
      },
    );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "[Calendar Context] Supabase save failed:",
        response.status,
        errorText,
      );
    }
  } catch (error) {
    console.error(
      "[Calendar Context] Supabase save request failed:",
      error,
    );
  }
}

async function deletePersistedCalendarContext(
  sessionId: string,
) {
  const config = getSupabaseConfig();

  if (!config) {
    return;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_calendar_context?session_id=eq.${encodeURIComponent(
        sessionId,
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
        "[Calendar Context] Supabase delete failed:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error(
      "[Calendar Context] Supabase delete request failed:",
      error,
    );
  }
}

/*
 * 서버가 재시작된 뒤 RAM에 문맥이 없으면
 * Supabase에서 최근 Calendar 문맥을 다시 불러온다.
 */
export async function hydrateCalendarContext(
  sessionId: string,
) {
  if (calendarContexts.has(sessionId)) {
    return;
  }

  const config = getSupabaseConfig();

  if (!config) {
    return;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_calendar_context?session_id=eq.${encodeURIComponent(
        sessionId,
      )}&select=session_id,range_label,events,updated_at&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: config.secretKey,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        "[Calendar Context] Supabase load failed:",
        response.status,
        await response.text(),
      );
      return;
    }

    const result: unknown =
      await response.json();

    if (
      !Array.isArray(result) ||
      result.length === 0 ||
      !isStoredCalendarContextRow(
        result[0],
      )
    ) {
      return;
    }

    const row = result[0];

    const updatedAt =
      new Date(
        row.updated_at,
      ).getTime();

    if (
      !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt >
        CONTEXT_TTL_MS
    ) {
      void deletePersistedCalendarContext(
        sessionId,
      );

      return;
    }

    calendarContexts.set(
      sessionId,
      {
        rangeLabel:
          row.range_label,
        events:
          row.events,
        updatedAt,
      },
    );

    console.log(
      "[Calendar Context] Restored from Supabase:",
      {
        sessionId,
        events:
          row.events.length,
      },
    );
  } catch (error) {
    console.error(
      "[Calendar Context] Supabase load request failed:",
      error,
    );
  }
}

export function saveCalendarContext(
  sessionId: string,
  context: {
    rangeLabel?: string | null;
    events: CalendarContextEvent[];
  },
) {
  const savedContext: CalendarConversationContext = {
    ...context,
    updatedAt: Date.now(),
  };

  calendarContexts.set(
  sessionId,
  savedContext,
);

saveMemory(
  sessionId,
  "calendar",
  "recent_events",
  {
    rangeLabel: savedContext.rangeLabel,
    events: savedContext.events,
  },
);

/*
 * 기존 코드들을 전부 async로 바꾸지 않기 위해
 * DB 저장은 백그라운드로 진행한다.
 */
void persistCalendarContext(
  sessionId,
  savedContext,
);
}

export function getCalendarContext(
  sessionId: string,
): CalendarConversationContext | null {
  const context =
    calendarContexts.get(
      sessionId,
    );

  if (!context) {
    return null;
  }

  if (
    Date.now() -
      context.updatedAt >
    CONTEXT_TTL_MS
  ) {
    calendarContexts.delete(
      sessionId,
    );

    void deletePersistedCalendarContext(
      sessionId,
    );

    return null;
  }

  return context;
}

export function clearCalendarContext(
  sessionId: string,
) {
  calendarContexts.delete(
    sessionId,
  );

  void deletePersistedCalendarContext(
    sessionId,
  );
}