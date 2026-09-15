export type ToolRiskLevel =
  | "low"
  | "medium"
  | "high";

export type LAlTool = {
  id: string;
  domain:
    | "calendar"
    | "drive"
    | "system"
    | "ai";
  name: string;
  description: string;
  risk: ToolRiskLevel;
  requiresConfirmation: boolean;
};

export const L_AI_TOOLS: LAlTool[] = [
  {
    id: "calendar.get",
    domain: "calendar",
    name: "Calendar 일정 조회",
    description:
      "Google Calendar에서 일정 목록을 조회한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "calendar.create",
    domain: "calendar",
    name: "Calendar 일정 생성",
    description:
      "Google Calendar에 새로운 일정을 생성한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "calendar.update",
    domain: "calendar",
    name: "Calendar 일정 수정",
    description:
      "기존 Google Calendar 일정을 수정한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "calendar.delete",
    domain: "calendar",
    name: "Calendar 일정 삭제",
    description:
      "Google Calendar에서 일정을 삭제한다.",
    risk: "high",
    requiresConfirmation: true,
  },

  {
    id: "drive.search",
    domain: "drive",
    name: "Drive 파일 검색",
    description:
      "Google Drive에서 파일을 검색한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "drive.list",
    domain: "drive",
    name: "Drive 파일 목록",
    description:
      "Google Drive의 최근 파일이나 파일 목록을 확인한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "drive.read",
    domain: "drive",
    name: "Drive 파일 읽기",
    description:
      "Google Drive 파일의 내용을 읽는다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "drive.summary",
    domain: "drive",
    name: "Drive 파일 요약",
    description:
      "Google Drive 파일 내용을 분석하고 요약한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "drive.calendar.extract",
    domain: "drive",
    name: "Drive 일정 추출",
    description:
      "Drive 파일 내용에서 Calendar 일정 후보를 추출한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "ai.respond",
    domain: "ai",
    name: "일반 AI 응답",
    description:
      "특정 도구가 필요하지 않은 일반적인 질문에 답한다.",
    risk: "low",
    requiresConfirmation: false,
  },
];

export function getTool(
  toolId: string,
) {
  return (
    L_AI_TOOLS.find(
      (tool) => tool.id === toolId,
    ) ?? null
  );
}

export function getAvailableToolIds() {
  return L_AI_TOOLS.map(
    (tool) => tool.id,
  );
}