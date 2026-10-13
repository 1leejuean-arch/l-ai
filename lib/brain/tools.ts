export type ToolRiskLevel =
  | "low"
  | "medium"
  | "high";

export type LAlTool = {
  id: string;
  domain:
  | "calendar"
  | "drive"
  | "mail"
  | "local"
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
    id: "mail.search",
    domain: "mail",
    name: "L-JMAIL 메일 검색",
    description:
      "L-JMAIL에서 제목, 본문, 발신자 등을 기준으로 메일을 검색한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "mail.read",
    domain: "mail",
    name: "L-JMAIL 메일 읽기",
    description: "선택한 L-JMAIL 메일의 내용을 읽는다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "mail.summary",
    domain: "mail",
    name: "L-JMAIL 메일 요약",
    description: "선택한 메일의 본문을 요약한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "mail.calendar.extract",
    domain: "mail",
    name: "메일 일정 추출",
    description: "선택한 메일에서 Calendar 일정 후보를 추출한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "mail.draft",
    domain: "mail",
    name: "메일 초안 작성",
    description: "Calendar, Drive 또는 메일 내용을 바탕으로 발송 전 초안을 만든다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "mail.send",
    domain: "mail",
    name: "메일 발송",
    description: "확정된 메일을 발송한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "mail.reply.send",
    domain: "mail",
    name: "답장 발송",
    description: "확정된 답장을 발송한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "mail.forward.send",
    domain: "mail",
    name: "전달 발송",
    description: "확정된 전달 메일을 발송한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "local.app.open",
    domain: "local",
    name: "Windows 프로그램 실행",
    description: "허용 목록에 등록된 Windows 프로그램을 실행한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "local.app.close",
    domain: "local",
    name: "Windows 프로그램 종료",
    description: "허용 목록에 등록된 Windows 프로그램에 정상 종료를 요청한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "local.browser.open",
    domain: "local",
    name: "웹사이트 열기",
    description: "검증된 http 또는 https 웹사이트를 브라우저로 연다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "local.browser.search",
    domain: "local",
    name: "브라우저 검색",
    description: "지원 사이트의 검증된 검색 URL을 브라우저로 연다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "local.file.search",
    domain: "local",
    name: "로컬 파일 검색",
    description: "허용된 사용자 폴더에서 로컬 파일을 검색한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "local.file.open",
    domain: "local",
    name: "로컬 파일 열기",
    description: "실행 파일을 제외한 로컬 파일을 기본 연결 프로그램으로 연다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "local.file.reveal",
    domain: "local",
    name: "탐색기에서 파일 보기",
    description: "로컬 파일의 위치를 Windows 탐색기에서 표시한다.",
    risk: "low",
    requiresConfirmation: false,
  },

  {
    id: "local.file.rename",
    domain: "local",
    name: "로컬 파일 이름 변경",
    description: "선택한 로컬 파일의 이름을 변경한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "local.file.move",
    domain: "local",
    name: "로컬 파일 이동",
    description: "선택한 파일을 허용된 사용자 폴더로 이동한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "local.file.copy",
    domain: "local",
    name: "로컬 파일 복사",
    description: "선택한 파일을 허용된 사용자 폴더로 복사한다.",
    risk: "medium",
    requiresConfirmation: true,
  },

  {
    id: "local.file.delete",
    domain: "local",
    name: "로컬 파일 휴지통 이동",
    description: "선택한 일반 파일을 Windows 휴지통으로 이동한다.",
    risk: "high",
    requiresConfirmation: true,
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
