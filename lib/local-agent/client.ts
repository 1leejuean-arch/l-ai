import "server-only";

import type {
  LocalActionRequest,
  LocalAgentHealth,
} from "./types";

const DEFAULT_LOCAL_AGENT_URL =
  "http://127.0.0.1:43140";

const LOCAL_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

export class LocalAgentConfigurationError extends Error {}
export class LocalAgentUnavailableError extends Error {}

function getLocalAgentConfig() {
  const rawUrl =
    process.env.L_AI_LOCAL_AGENT_URL?.trim() ||
    DEFAULT_LOCAL_AGENT_URL;
  const token =
    process.env.L_AI_LOCAL_AGENT_TOKEN?.trim();

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new LocalAgentConfigurationError(
      "L_AI_LOCAL_AGENT_URL 형식이 올바르지 않아.",
    );
  }

  if (
    url.protocol !== "http:" ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new LocalAgentConfigurationError(
      "Local Agent URL은 localhost HTTP 주소만 사용할 수 있어.",
    );
  }

  if (!token || token.length < 16) {
    throw new LocalAgentConfigurationError(
      "L_AI_LOCAL_AGENT_TOKEN을 16자 이상으로 설정해줘.",
    );
  }

  return {
    baseUrl: url.toString().replace(/\/+$/u, ""),
    token,
  };
}

async function localAgentFetch(
  pathname: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const config = getLocalAgentConfig();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    return await fetch(`${config.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...init.headers,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new LocalAgentUnavailableError(
      error instanceof Error && error.name === "AbortError"
        ? "Windows Local Agent 응답 시간이 초과됐어."
        : "Windows Local Agent에 연결할 수 없어.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLocalAgentHealth() {
  const response = await localAgentFetch(
    "/health",
    { method: "GET" },
    2500,
  );

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new LocalAgentUnavailableError(
      "Windows Local Agent health 응답을 읽지 못했어.",
    );
  }

  if (!response.ok) {
    throw new LocalAgentUnavailableError(
      "Windows Local Agent 인증 또는 연결 상태를 확인해줘.",
    );
  }

  const health = body as Partial<LocalAgentHealth>;

  if (
    health.ok !== true ||
    typeof health.platform !== "string" ||
    typeof health.version !== "string" ||
    !Array.isArray(health.capabilities)
  ) {
    throw new LocalAgentUnavailableError(
      "Windows Local Agent health 응답 형식이 올바르지 않아.",
    );
  }

  return health as LocalAgentHealth;
}

export async function callLocalAgent<T = unknown>(
  request: LocalActionRequest,
): Promise<T> {
  const startedAt = Date.now();

  try {
    const response = await localAgentFetch(
      "/action",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
      10_000,
    );

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new LocalAgentUnavailableError(
        "Windows Local Agent 응답을 읽지 못했어.",
      );
    }

    const result = body as {
      ok?: boolean;
      result?: T;
      error?: string;
    };

    if (!response.ok || result.ok !== true) {
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "Windows Local Agent 작업에 실패했어.",
      );
    }

    return result.result as T;
  } finally {
    console.log(
      "[L-AI Perf] Local Agent API:",
      `${Date.now() - startedAt}ms`,
      { action: request.action },
    );
  }
}
