import {
  getMemory,
  saveMemory,
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

  const updated: BrainTrace = {
    ...current,
    ...patch,

    updatedAt:
      new Date().toISOString(),
  };

  await saveMemory(
    sessionId,
    "brain",
    "active_trace",
    updated,
  );

  return updated;
}