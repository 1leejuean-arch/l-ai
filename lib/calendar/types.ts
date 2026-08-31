export type CalendarEvent = {
  title: string;
  start: string;
  end: string;
};

export type CalendarRange = {
  start: string;
  end: string;
};

export type CalendarUpdateData = CalendarEvent & {
  eventId: string;
};

export type CalendarDeleteData = {
  eventId: string;
};

export type CalendarAction =
  | "calendar_create"
  | "calendar_get"
  | "calendar_update"
  | "calendar_delete";

export type CalendarActionData = {
  calendar_create: CalendarEvent;
  calendar_get: CalendarRange;
  calendar_update: CalendarUpdateData;
  calendar_delete: CalendarDeleteData;
};

export type CalendarIntent = {
  action:
    | "create_calendar_event"
    | "get_calendar_events"
    | "update_calendar_event"
    | "delete_calendar_event"
    | "clarify_calendar_request"
    | "not_calendar_request";
  title: string | null;
  start: string | null;
  end: string | null;
  rangeLabel: string | null;
  targetTitle: string | null;
  targetStart: string | null;
  newTitle: string | null;
  newStart: string | null;
  newEnd: string | null;
  timeHour: number | null;
  timeMinute: number | null;
  missingField: CalendarMissingField | null;
  clarification: string | null;
};

export type CalendarMissingField = "ampm" | "date" | "time" | "target";

export type CalendarUnresolvedTime = {
  hour: number;
  minute: number;
};

export type CalendarMutationTarget = {
  title: string | null;
  start: string | null;
};

export type CalendarUpdatePatch = {
  title: string | null;
  start: string | null;
  end: string | null;
};

export type CalendarUpdateRequest = {
  range: CalendarRange;
  target: CalendarMutationTarget;
  patch: CalendarUpdatePatch;
  unresolvedTime: CalendarUnresolvedTime | null;
  missingField: CalendarMissingField | null;
  clarification: string | null;
};

export type CalendarDeleteRequest = {
  range: CalendarRange;
  target: CalendarMutationTarget;
};

export type CalendarParseResult =
  | { kind: "create"; event: CalendarEvent }
  | { kind: "get"; range: CalendarRange; rangeLabel: string }
  | { kind: "update"; request: CalendarUpdateRequest }
  | { kind: "delete"; request: CalendarDeleteRequest }
  | {
      kind: "clarify";
      message: string;
      operation?: "update" | "delete";
    }
  | { kind: "not_calendar" };

export type GoogleCalendarEventTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  start: GoogleCalendarEventTime;
  end: GoogleCalendarEventTime;
};

export type CalendarEventCandidate = {
  eventId: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
};

export type CalendarMutationMatch =
  | { kind: "none" }
  | { kind: "one"; candidate: CalendarEventCandidate }
  | { kind: "multiple"; candidates: CalendarEventCandidate[] };

export type PendingCalendarAction =
  | { kind: "create"; event: CalendarEvent }
  | {
      kind: "update";
      eventId: string;
      before: CalendarEvent;
      after: CalendarEvent;
    }
  | { kind: "delete"; candidate: CalendarEventCandidate }
  | {
      kind: "select_update";
      candidates: CalendarEventCandidate[];
      patch: CalendarUpdatePatch;
      unresolvedTime: CalendarUnresolvedTime | null;
      missingField: CalendarMissingField | null;
      clarification: string | null;
      originalMessage: string;
    }
  | {
      kind: "select_delete";
      candidates: CalendarEventCandidate[];
    }
  | {
      kind: "clarify_update";
      targetEvent: CalendarEventCandidate;
      requestedChanges: CalendarUpdatePatch;
      unresolvedTime: CalendarUnresolvedTime;
      missingField: "ampm";
      stage: "clarification";
    }
  | {
      kind: "clarify_request";
      operation: "update" | "delete";
      originalMessage: string;
      question: string;
      missingField: CalendarMissingField | null;
      stage: "clarification";
    };
