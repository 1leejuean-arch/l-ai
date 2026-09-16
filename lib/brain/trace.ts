import {
  deleteMemory,
  getMemory,
  saveMemory,
  saveMemoryAndWait,
} from "@/lib/memory/context";

import type {
  PlannerResult,
} from "./types";

import type {
  ReflectionResult,
} from "./reflection";

export type BrainTraceState =
  | "planning"
  | "waiting"
  | "executing"
  | "success"
  | "failed";

  export type BrainTraceHistoryEntry = {
  state: BrainTraceState;

  waitingFor:
    | "user_confirmation"
    | "user_selection"
    | "user_clarification"
    | null;

  at: string;
};
export type BrainTrace = {
  traceId: string;

  goal: string;

  state: BrainTraceState;

  plan: PlannerResult;

  reflection:
    | ReflectionResult
    | null;

  waitingFor:
    | "user_confirmation"
    | "user_selection"
    | "user_clarification"
    | null;

  startedAt: string;

history: BrainTraceHistoryEntry[];

  updatedAt: string;
};

const BRAIN_TRACE_TTL_MS =
  1000 * 60 * 60 * 24 * 7;

export async function createBrainTrace(
  sessionId: string,
  plan: PlannerResult,
) {
  const now =
    new Date().toISOString();

  const trace: BrainTrace = {
    traceId:
      `brain_${crypto.randomUUID()}`,

    goal: plan.goal,

    state: "planning",

    plan,

    reflection: null,

    waitingFor: null,

    startedAt: now,

history: [
  {
    state: "planning",
    waitingFor: null,
    at: now,
  },
],
    
    updatedAt: now,
  };

  await saveMemory(
    sessionId,
    "brain",
    "active_trace",
    trace,
  );

  return trace;
}

export async function getActiveBrainTrace(
  sessionId: string,
) {
  return getMemory<BrainTrace>(
    sessionId,
    "brain",
    "active_trace",
    BRAIN_TRACE_TTL_MS,
  );
}

export async function updateBrainTrace(
  sessionId: string,
  patch: Partial<
    Omit<
      BrainTrace,
      | "traceId"
      | "startedAt"
    >
  >,
) {
  const current =
    await getActiveBrainTrace(
      sessionId,
    );

  if (!current) {
    return null;
  }

  const updatedAt =
  new Date().toISOString();

const nextState =
  patch.state ?? current.state;

const nextWaitingFor =
  patch.waitingFor !== undefined
    ? patch.waitingFor
    : current.waitingFor;

const stateChanged =
  nextState !== current.state ||
  nextWaitingFor !==
    current.waitingFor;

const updated: BrainTrace = {
  ...current,
  ...patch,

  history: stateChanged
    ? [
        ...current.history,
        {
          state: nextState,
          waitingFor:
            nextWaitingFor,
          at: updatedAt,
        },
      ]
    : current.history,

  updatedAt,
};

  await saveMemory(
    sessionId,
    "brain",
    "active_trace",
    updated,
  );

  return updated;
}

export async function completeBrainTrace(
  sessionId: string,
  reflection?: ReflectionResult,
) {
  const completed =
    await updateBrainTrace(
      sessionId,
      {
        state: "success",
        waitingFor: null,
        ...(reflection
          ? { reflection }
          : {}),
      },
    );

  if (!completed) {
    return null;
  }

  await saveMemoryAndWait(
  sessionId,
  "brain",
  "last_trace",
  completed,
);

  await deleteMemory(
    sessionId,
    "brain",
    "active_trace",
  );

  console.log(
    "[L-AI Brain] Trace archived",
    {
      traceId:
        completed.traceId,
      state:
        completed.state,
    },
  );

  return completed;
}  

export async function getLastBrainTrace(
  sessionId: string,
) {
  return getMemory<BrainTrace>(
    sessionId,
    "brain",
    "last_trace",
    BRAIN_TRACE_TTL_MS,
  );
}