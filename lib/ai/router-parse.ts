import type {
  AiRouterIntent,
  AiRouterResult,
} from "./router-types";

const INTENTS: AiRouterIntent[] = [
  "general_chat",
  "drive_list",
  "drive_recent",
  "drive_search",
  "drive_read",
  "drive_summarize",
  "drive_ask",
  "drive_calendar_extract",
  "calendar_get",
  "calendar_create",
  "calendar_update",
  "calendar_delete",
  "drive_calendar_compound",
  "follow_up",
  "clarification",
];

function isIntent(
  value: unknown,
): value is AiRouterIntent {
  return (
    typeof value === "string" &&
    INTENTS.includes(value as AiRouterIntent)
  );
}

function optionalString(
  value: unknown,
): string | null {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : null;
}

export function parseAiRouterResult(
  raw: string,
): AiRouterResult | null {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const value = JSON.parse(cleaned);

    if (
      typeof value !== "object" ||
      value === null ||
      !isIntent(value.intent)
    ) {
      return null;
    }

    const confidence =
      typeof value.confidence === "number"
        ? Math.max(
            0,
            Math.min(1, value.confidence),
          )
        : 0.5;

    return {
      intent: value.intent,

      normalizedMessage:
        optionalString(
          value.normalizedMessage,
        ) ?? "",

      confidence,

      target: {
        fileName: optionalString(
          value.target?.fileName,
        ),

        searchQuery: optionalString(
          value.target?.searchQuery,
        ),

        eventTitle: optionalString(
          value.target?.eventTitle,
        ),
      },

      filters: {
        grade: optionalString(
          value.filters?.grade,
        ),

        date: optionalString(
          value.filters?.date,
        ),

        dateRange: optionalString(
          value.filters?.dateRange,
        ),

        keyword: optionalString(
          value.filters?.keyword,
        ),
      },

      action: {
        addToCalendar:
          value.action?.addToCalendar === true,

        updateCalendar:
          value.action?.updateCalendar === true,

        deleteCalendar:
          value.action?.deleteCalendar === true,

        summarize:
          value.action?.summarize === true,

        read:
          value.action?.read === true,
      },

      context: {
        usePreviousFile:
          value.context?.usePreviousFile === true,

        usePreviousEvent:
          value.context?.usePreviousEvent === true,

        usePreviousResult:
          value.context?.usePreviousResult === true,
      },

      needsClarification:
        value.needsClarification === true,

      clarificationQuestion:
        optionalString(
          value.clarificationQuestion,
        ),
    };
  } catch {
    return null;
  }
}