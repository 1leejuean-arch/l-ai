import "server-only";

import {
  getOpenAIClient,
  getOpenAIModel,
} from "./openai";

import {
  AI_ROUTER_SYSTEM_PROMPT,
} from "./router-prompt";

import {
  parseAiRouterResult,
} from "./router-parse";

import type {
  AiRouterResult,
} from "./router-types";

type RouterContext = {
  previousFileName?: string | null;
  previousEventTitle?: string | null;
};

export async function routeUserMessage(
  message: string,
  context?: RouterContext,
): Promise<AiRouterResult | null> {
  const openai = getOpenAIClient();

  try {
    const response =
      await openai.responses.create({
        model: getOpenAIModel(),

        instructions:
          AI_ROUTER_SYSTEM_PROMPT,

        input: `
사용자 메시지:
${message}

현재 대화 문맥:
이전 Drive 파일:
${context?.previousFileName || "없음"}

이전 Calendar 일정:
${context?.previousEventTitle || "없음"}

사용자의 실제 의도를 분석해서 JSON으로 반환해.
`,
      });

    const raw =
      response.output_text.trim();

    if (!raw) {
      return null;
    }

    return parseAiRouterResult(raw);
  } catch (error) {
    /*
     * AI Router가 실패해도
     * 기존 Drive / Calendar 명령 체계는
     * 그대로 동작해야 한다.
     */
    console.error(
      "[AI Router] Failed:",
      error,
    );

    return null;
  }
}