import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const MOCK_PORT = 43129;
const APP_PORT = 43130;
const SESSION_ID = "last-action-regression-session";
const rows = new Map();

function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(status === 204 ? undefined : JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function memoryKey(row) {
  return `${row.session_id}:${row.memory_type}:${row.memory_key}`;
}

function openAiResponse(text) {
  return {
    id: "response-test",
    object: "response",
    status: "completed",
    output: [
      {
        id: "message-test",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text,
            annotations: [],
          },
        ],
      },
    ],
  };
}

const mockServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);

  if (url.pathname === "/rest/v1/l_ai_memory") {
    if (req.method === "POST") {
      const row = await readJson(req);
      await new Promise((resolve) => setTimeout(resolve, 150));
      rows.set(memoryKey(row), row);
      json(res, null, 204);
      return;
    }

    if (req.method === "GET") {
      const sessionId = url.searchParams.get("session_id")?.replace(/^eq\./u, "");
      const memoryType = url.searchParams.get("memory_type")?.replace(/^eq\./u, "");
      const memoryKeyValue = url.searchParams.get("memory_key")?.replace(/^eq\./u, "");
      const row = rows.get(`${sessionId}:${memoryType}:${memoryKeyValue}`);
      json(res, row ? [row] : []);
      return;
    }

    if (req.method === "DELETE") {
      json(res, null, 204);
      return;
    }
  }

  if (url.pathname === "/drive") {
    const body = await readJson(req);

    if (body.action === "search") {
      json(res, [
        {
          id: "drive-file-1",
          name: "대의원회의.pdf",
          webViewLink: "https://drive.test/drive-file-1",
        },
      ]);
      return;
    }

    if (body.action === "read") {
      json(res, { text: "대의원회의 문서의 모의 본문입니다." });
      return;
    }
  }

  if (url.pathname === "/v1/responses") {
    await readJson(req);
    json(res, openAiResponse("대의원회의 문서 요약 결과입니다."));
    return;
  }

  res.writeHead(404).end();
});

function waitForServer(timeoutMs = 20_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${APP_PORT}`);
        if (response.ok) return resolve();
      } catch {}

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Next.js test server did not start"));
        return;
      }

      setTimeout(poll, 200);
    };
    void poll();
  });
}

function startApp() {
  return spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "test-model",
        OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
        N8N_DRIVE_SEARCH_URL: `http://127.0.0.1:${MOCK_PORT}/drive`,
        SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        SUPABASE_SECRET_KEY: "test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "test-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function stopApp(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function sendChat(message) {
  const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-id": SESSION_ID,
    },
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.reply;
}

await new Promise((resolve) => mockServer.listen(MOCK_PORT, "127.0.0.1", resolve));
let app = startApp();
let serverOutput = "";
const captureOutput = (chunk) => (serverOutput += chunk.toString());
app.stdout.on("data", captureOutput);
app.stderr.on("data", captureOutput);

try {
  await waitForServer();

  assert.match(await sendChat("내 드라이브에서 대의원회의.pdf 찾아줘"), /대의원회의\.pdf/u);
  assert.match(await sendChat("방금 한 거 뭐였지?"), /대의원회의\.pdf 파일 검색/u);
  assert.match(await sendChat("그 파일 요약해줘"), /대의원회의 문서 요약 결과/u);
  assert.match(await sendChat("방금 한 거 뭐였지?"), /대의원회의\.pdf 파일 요약/u);

  await stopApp(app);
  app = startApp();
  app.stdout.on("data", captureOutput);
  app.stderr.on("data", captureOutput);
  await waitForServer();

  assert.match(await sendChat("방금 한 거 뭐였지?"), /대의원회의\.pdf 파일 요약/u);
  console.log("Last action regression tests passed (search, summary, restart restore).\n");
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  await stopApp(app);
  await new Promise((resolve) => mockServer.close(resolve));
}
