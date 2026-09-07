import "server-only";

import OpenAI from "openai";
import { L_AI_SYSTEM_INSTRUCTION } from "./system-instruction";

const DEFAULT_MODEL = "gpt-5-mini";

export class OpenAIConfigurationError extends Error {
  constructor() {
    super("OpenAI is not configured");
    this.name = "OpenAIConfigurationError";
  }
}

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new OpenAIConfigurationError();
  }

  return new OpenAI({ apiKey });
}

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export async function generateAssistantReply(message: string) {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: L_AI_SYSTEM_INSTRUCTION,
    input: message,
  });
  const reply = response.output_text.trim();

  if (!reply) {
    throw new Error("OpenAI returned an empty response");
  }

  return reply;
}
export async function summarizeDriveFile(
  fileName: string,
  text: string,
) {
  const openai = getOpenAIClient();

  const trimmedText = text.slice(0, 30_000);

  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: `
너는 L-AI의 Google Drive 문서 요약 기능이다.

사용자가 Google Drive에 저장한 파일에서 추출된 텍스트를 읽고,
핵심 내용을 한국어로 이해하기 쉽게 요약해야 한다.

규칙:
- 파일의 핵심 목적과 내용을 먼저 설명한다.
- 날짜, 일정, 인물, 장소, 해야 할 일 등 중요한 정보는 빠뜨리지 않는다.
- 표에서 추출된 텍스트는 행/열 구조가 깨져 있을 수 있으므로 문맥을 최대한 복원한다.
- 구조를 확실히 판단할 수 없는 부분은 임의로 단정하지 않는다.
- 불확실한 내용이 있다면 "원본 표 확인이 필요할 수 있음"이라고 알려준다.
- 원문을 그대로 길게 복사하지 말고 실제 요약을 한다.
- 간단한 문서는 짧게, 내용이 많은 문서는 항목별로 정리한다.
- 답변은 자연스러운 한국어로 작성한다.
`,
    input: `
파일명: ${fileName}

아래는 파일에서 추출한 텍스트다.

--- 파일 내용 시작 ---
${trimmedText}
--- 파일 내용 끝 ---

이 파일을 핵심 위주로 요약해줘.
`,
  });

  const summary = response.output_text.trim();

  if (!summary) {
    throw new Error("OpenAI returned an empty Drive summary");
  }

  return summary;
}
export async function answerDriveFileQuestion(
  fileName: string,
  text: string,
  question: string,
) {
  const openai = getOpenAIClient();

  const trimmedText = text.slice(0, 30_000);

  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: `
너는 L-AI의 Google Drive 문서 질의응답 기능이다.

사용자가 Google Drive 파일의 내용에 대해 질문하면,
파일에서 추출된 텍스트만 근거로 답변해야 한다.

규칙:
- 질문에 직접 필요한 내용 위주로 답한다.
- 문서에 없는 내용은 추측하지 않는다.
- 표에서 추출된 텍스트는 행/열 구조가 깨질 수 있으므로 문맥을 최대한 복원한다.
- 구조가 명확하지 않다면 그 사실을 짧게 알려준다.
- 날짜, 시간, 대상, 장소, 일정 등 구체적인 정보가 있으면 명확히 정리한다.
- 답변은 자연스러운 한국어로 작성한다.
- 필요하면 목록 형태로 정리한다.
- 파일 전체를 다시 요약하지 말고 사용자의 질문에 집중한다.
`,
    input: `
파일명: ${fileName}

사용자 질문:
${question}

--- 파일 내용 시작 ---
${trimmedText}
--- 파일 내용 끝 ---

위 파일 내용만 근거로 사용자의 질문에 답해줘.
`,
  });

  const answer = response.output_text.trim();

  if (!answer) {
    throw new Error("OpenAI returned an empty Drive answer");
  }

  return answer;
}
export async function compareDriveFiles(
  firstFileName: string,
  firstText: string,
  secondFileName: string,
  secondText: string,
  compareQuestion?: string | null,
) {
  const openai = getOpenAIClient();

  const firstTrimmed = firstText.slice(0, 25_000);
  const secondTrimmed = secondText.slice(0, 25_000);

  const response = await openai.responses.create({
    model: getOpenAIModel(),
    instructions: `
너는 L-AI의 Google Drive 문서 비교 기능이다.

사용자가 Google Drive의 두 파일을 비교해달라고 하면,
두 파일의 실제 내용만 근거로 공통점과 차이점을 정리해야 한다.

규칙:
- 두 파일의 핵심 목적을 먼저 짧게 설명한다.
- 공통점과 차이점을 구분해서 정리한다.
- 날짜, 일정, 담당자, 장소, 해야 할 일, 수치 등 중요한 차이를 놓치지 않는다.
- 한쪽 파일에만 있는 내용은 명확히 구분한다.
- 문서에 없는 내용은 추측하지 않는다.
- 표나 슬라이드에서 추출된 텍스트 구조가 불명확하면 단정하지 않는다.
- 비교 질문이 있으면 그 질문을 우선해서 비교한다.
- 답변은 자연스러운 한국어로 작성한다.
`,
    input: `
첫 번째 파일명: ${firstFileName}

--- 첫 번째 파일 내용 ---
${firstTrimmed}
--- 첫 번째 파일 끝 ---

두 번째 파일명: ${secondFileName}

--- 두 번째 파일 내용 ---
${secondTrimmed}
--- 두 번째 파일 끝 ---

사용자 비교 요청:
${compareQuestion || "두 파일의 핵심 내용과 차이점을 비교해줘."}

두 파일을 비교해서 정리해줘.
`,
  });

  const answer = response.output_text.trim();

  if (!answer) {
    throw new Error("OpenAI returned an empty Drive comparison");
  }

  return answer;
}