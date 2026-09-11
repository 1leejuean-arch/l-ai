import "server-only";

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

const calendarContexts =
  new Map<string, CalendarConversationContext>();

const CONTEXT_TTL_MS =
  1000 * 60 * 60 * 6;

export function saveCalendarContext(
  sessionId: string,
  context: {
    rangeLabel?: string | null;
    events: CalendarContextEvent[];
  },
) {
  calendarContexts.set(sessionId, {
    ...context,
    updatedAt: Date.now(),
  });
}

export function getCalendarContext(
  sessionId: string,
): CalendarConversationContext | null {
  const context =
    calendarContexts.get(sessionId);

  if (!context) {
    return null;
  }

  if (
    Date.now() - context.updatedAt >
    CONTEXT_TTL_MS
  ) {
    calendarContexts.delete(sessionId);
    return null;
  }

  return context;
}

export function clearCalendarContext(
  sessionId: string,
) {
  calendarContexts.delete(sessionId);
}