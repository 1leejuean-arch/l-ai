export type AiRouterIntent =
  | "general_chat"
  | "drive_list"
  | "drive_recent"
  | "drive_search"
  | "drive_read"
  | "drive_summarize"
  | "drive_ask"
  | "drive_calendar_extract"
  | "calendar_get"
  | "calendar_create"
  | "calendar_update"
  | "calendar_delete"
  | "drive_calendar_compound"
  | "follow_up"
  | "clarification";

export type AiRouterResult = {
  intent: AiRouterIntent;

  normalizedMessage: string;

  confidence: number;

  target: {
    fileName?: string | null;
    searchQuery?: string | null;
    eventTitle?: string | null;
  };

  filters: {
    grade?: string | null;
    date?: string | null;
    dateRange?: string | null;
    keyword?: string | null;
  };

  action: {
    addToCalendar?: boolean;
    updateCalendar?: boolean;
    deleteCalendar?: boolean;
    summarize?: boolean;
    read?: boolean;
  };

  context: {
    usePreviousFile?: boolean;
    usePreviousEvent?: boolean;
    usePreviousResult?: boolean;
  };

  needsClarification: boolean;

  clarificationQuestion?: string | null;
};