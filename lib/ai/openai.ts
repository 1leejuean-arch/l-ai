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
