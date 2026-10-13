import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAPABILITIES,
  createActionExecutor,
} from "./actions.mjs";
import { createSecurityConfig } from "./security.mjs";

export const LOCAL_AGENT_HOST = "127.0.0.1";
export const LOCAL_AGENT_VERSION = "0.4.0";
const DEFAULT_PORT = 43140;
const MAX_BODY_BYTES = 64 * 1024;

function parsePort(value) {
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("L_AI_LOCAL_AGENT_PORT는 1024~65535 사이여야 해.");
  }
  return port;
}

function isAuthorized(request, token) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(token, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isLoopbackAddress(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function createCorsHeaders(origin, allowedOrigins) {
  if (!origin) return {};
  if (!allowedOrigins.has(origin)) {
    throw new Error("허용되지 않은 Origin이야.");
  }
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("요청 본문이 너무 커.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("올바른 JSON 요청이 필요해.");
  }
}

function safeLog(action, input, result) {
  if (action === "file.search") {
    console.log("[L-AI Local Agent] file.search", {
      scope: input.scope,
      query: input.query,
      count: result.files.length,
    });
    return;
  }

  if (action.startsWith("app.")) {
    console.log(`[L-AI Local Agent] ${action}`, {
      app: input.app,
      ...(action === "app.close" ? { status: result.status } : {}),
    });
    return;
  }

  if (action.startsWith("file.")) {
    console.log(`[L-AI Local Agent] ${action}`, {
      file: typeof input.path === "string" ? path.basename(input.path) : undefined,
    });
    return;
  }

  console.log(`[L-AI Local Agent] ${action}`);
}

export function createLocalAgentServer(options = {}) {
  const token = options.token || process.env.L_AI_LOCAL_AGENT_TOKEN?.trim();
  if (!token || token.length < 16) {
    throw new Error("L_AI_LOCAL_AGENT_TOKEN을 16자 이상으로 설정해야 해.");
  }

  const allowedOrigins = new Set(
    options.allowedOrigins ||
      (process.env.L_AI_LOCAL_AGENT_ALLOWED_ORIGINS ||
        "http://localhost:3000,http://127.0.0.1:3000")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
  );
  const securityConfig = createSecurityConfig(options.security);
  const executeAction = createActionExecutor(
    securityConfig,
    options.adapters,
  );

  return http.createServer(async (request, response) => {
    let corsHeaders = {};

    try {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        sendJson(response, 403, { ok: false, error: "로컬 연결만 허용해." });
        return;
      }

      corsHeaders = createCorsHeaders(request.headers.origin, allowedOrigins);

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          ...corsHeaders,
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Max-Age": "600",
        });
        response.end();
        return;
      }

      if (!isAuthorized(request, token)) {
        sendJson(response, 401, { ok: false, error: "Local Agent 인증에 실패했어." }, corsHeaders);
        return;
      }

      const url = new URL(request.url || "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          platform: process.platform,
          version: LOCAL_AGENT_VERSION,
          capabilities: CAPABILITIES,
        }, corsHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === "/action") {
        const body = await readJsonBody(request);
        const result = await executeAction(body);
        safeLog(body.action, body.input, result);
        sendJson(response, 200, { ok: true, result }, corsHeaders);
        return;
      }

      sendJson(response, 404, { ok: false, error: "지원하지 않는 endpoint야." }, corsHeaders);
    } catch (error) {
      sendJson(
        response,
        400,
        {
          ok: false,
          error: error instanceof Error ? error.message : "Local Agent 요청에 실패했어.",
        },
        corsHeaders,
      );
    }
  });
}

export async function startLocalAgent() {
  const port = parsePort(process.env.L_AI_LOCAL_AGENT_PORT);
  const server = createLocalAgentServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOCAL_AGENT_HOST, resolve);
  });

  console.log(
    `[L-AI Local Agent] listening on http://${LOCAL_AGENT_HOST}:${port}`,
  );

  return server;
}

const isEntryPoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntryPoint) {
  startLocalAgent().catch((error) => {
    console.error(
      "[L-AI Local Agent] startup failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
