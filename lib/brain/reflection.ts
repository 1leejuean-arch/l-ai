import type {
  PlannerResult,
} from "./types";

export type ReflectionStatus =
  | "success"
  | "partial_success"
  | "waiting"
  | "failed";

export type ReflectionResult = {
  status: ReflectionStatus;

  completedSteps: string[];

  pendingSteps: string[];

  waitingFor:
    | "user_confirmation"
    | "user_selection"
    | "user_clarification"
    | null;

  message: string;
};

export function createReflection(
  plan: PlannerResult,
  options?: {
    completedToolIds?: string[];
    waitingFor?:
      | "user_confirmation"
      | "user_selection"
      | "user_clarification"
      | null;
    failed?: boolean;
  },
): ReflectionResult {
  const completedToolIds =
    options?.completedToolIds ?? [];

  const completedSteps =
    plan.steps
      .filter((step) =>
        completedToolIds.includes(
          step.toolId,
        ),
      )
      .map((step) => step.toolId);

  const pendingSteps =
    plan.steps
      .filter(
        (step) =>
          !completedToolIds.includes(
            step.toolId,
          ),
      )
      .map((step) => step.toolId);

  if (options?.failed) {
    return {
      status: "failed",
      completedSteps,
      pendingSteps,
      waitingFor: null,
      message:
        "계획 실행 중 오류가 발생했다.",
    };
  }

  if (options?.waitingFor) {
    return {
      status: "waiting",
      completedSteps,
      pendingSteps,
      waitingFor:
        options.waitingFor,
      message:
        "다음 단계를 위해 사용자 입력을 기다리고 있다.",
    };
  }

  if (pendingSteps.length === 0) {
    return {
      status: "success",
      completedSteps,
      pendingSteps,
      waitingFor: null,
      message:
        "계획한 작업이 모두 완료되었다.",
    };
  }

  return {
    status: "partial_success",
    completedSteps,
    pendingSteps,
    waitingFor: null,
    message:
      "계획 일부가 완료되었고 남은 단계가 있다.",
  };
}