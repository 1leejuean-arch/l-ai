export type PlannerRisk =
  | "low"
  | "medium"
  | "high";

export type PlannerStep = {
  order: number;
  toolId: string;
  reason: string;
};

export type PlannerResult = {
  goal: string;

  steps: PlannerStep[];

  risk: PlannerRisk;

  requiresConfirmation: boolean;

  confidence: number;

  source:
    | "router"
    | "heuristic"
    | "fallback";
};

export type PlannerInput = {
  message: string;

  intent?: string | null;

  confidence?: number | null;
};