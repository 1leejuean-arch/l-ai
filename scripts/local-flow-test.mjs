import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const MOCK_PORT = 43133;
const APP_PORT = 43134;
const TOKEN = "local-flow-test-token-1234";
const actionCalls = [];

const files = [
  {
    name: "과제.pdf",
    path: "C:\\Users\\Test\\Downloads\\과제.pdf",
    extension: ".pdf",
    size: 1024,
    modifiedAt: "2026-10-13T01:00:00.000Z",
  },
  {
    name: "과제_최종.pdf",
    path: "C:\\Users\\Test\\Downloads\\과제_최종.pdf",
    extension: ".pdf",
    size: 2048,
    modifiedAt: "2026-10-13T02:00:00.000Z",
  },
];

function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const mockAgent = http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    json(response, { ok: false, error: "unauthorized" }, 401);
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    json(response, {
      ok: true,
      platform: "win32",
      version: "0.4.0-test",
      capabilities: ["app.open", "app.close", "browser.search", "file.search"],
    });
    return;
  }

  if (request.method === "POST" && request.url === "/action") {
    const body = await readJson(request);
    actionCalls.push(body);

    if (body.action === "app.close") {
      const statuses = {
        calculator: "success",
        notepad: "failed",
        chrome: "not_running",
      };
      json(response, {
        ok: true,
        result: {
          app: body.input.app,
          status: statuses[body.input.app] || "not_running",
          ...(statuses[body.input.app] === "failed"
            ? { reason: "window_still_open" }
            : {}),
        },
      });
      return;
    }

    if (body.action === "file.search") {
      json(response, { ok: true, result: { files, truncated: false } });
      return;
    }

    if (body.action === "file.rename") {
      json(response, {
        ok: true,
        result: {
          ...files[1],
          name: body.input.newName,
          path: `C:\\Users\\Test\\Downloads\\${body.input.newName}`,
        },
      });
      return;
    }

    if (body.action === "file.move" || body.action === "file.copy") {
      const name = body.input.path.split("\\").at(-1);
      json(response, {
        ok: true,
        result: {
          ...files[1],
          name,
          path: `C:\\Users\\Test\\${body.input.destinationScope}\\${name}`,
        },
      });
      return;
    }

    json(response, { ok: true, result: {} });
    return;
  }

  response.writeHead(404).end();
});

function waitForServer(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolve();
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Next.js test server did not start"));
        return;
      }
      setTimeout(poll, 200);
    };
    void poll();
  });
}

async function chat(message, sessionId = "local-flow-test") {
  const { response, body } = await requestChat(message, sessionId);
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.reply;
}

async function requestChat(message, sessionId = "local-flow-test") {
  const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    },
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  return { response, body };
}

await new Promise((resolve) => mockAgent.listen(MOCK_PORT, "127.0.0.1", resolve));
let mockAgentClosed = false;

const nextProcess = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      L_AI_LOCAL_AGENT_URL: `http://127.0.0.1:${MOCK_PORT}`,
      L_AI_LOCAL_AGENT_TOKEN: TOKEN,
      OPENAI_API_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
nextProcess.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
nextProcess.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

try {
  await waitForServer(`http://127.0.0.1:${APP_PORT}`);

  const health = await fetch(`http://127.0.0.1:${APP_PORT}/api/health/local-agent`);
  assert.equal(health.ok, true);
  assert.equal((await health.json()).platform, "win32");

  const fastPathLogStart = serverOutput.length;
  assert.match(await chat("계산기 열어줘"), /계산기.*열었어/u);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const fastPathLogs = serverOutput.slice(fastPathLogStart);
  assert.match(fastPathLogs, /\[L-AI Fast Path\] Local action/u);
  assert.doesNotMatch(
    fastPathLogs,
    /Semantic learning facts|Context Resolver|\[L-AI Router\]/u,
  );
  assert.equal(actionCalls.at(-1).action, "app.open");

  assert.match(
    await chat("유튜브에서 아이유 검색해줘"),
    /유튜브.*검색.*열었어/u,
  );
  assert.equal(actionCalls.at(-1).action, "browser.search");
  assert.match(actionCalls.at(-1).input.url, /youtube\.com\/results\?search_query=/u);

  const searchReply = await chat("다운로드 폴더에서 PDF 찾아줘");
  assert.match(searchReply, /파일 2개/u);
  assert.match(searchReply, /1\. 과제\.pdf/u);
  assert.equal(actionCalls.at(-1).action, "file.search");
  assert.equal(actionCalls.at(-1).input.scope, "Downloads");

  assert.match(
    await chat("2번 파일 탐색기에서 보여줘"),
    /과제_최종\.pdf.*탐색기/u,
  );
  assert.equal(actionCalls.at(-1).action, "file.reveal");
  assert.equal(actionCalls.at(-1).input.path, files[1].path);

  assert.match(await chat("폴더 열어줘"), /과제_최종\.pdf.*탐색기/u);
  assert.equal(actionCalls.at(-1).action, "file.reveal");

  const beforeRename = actionCalls.length;
  assert.match(
    await chat("그 파일 이름 과제제출.pdf로 바꿔줘"),
    /이름을 '과제제출\.pdf'으로 바꿀까요/u,
  );
  assert.equal(actionCalls.length, beforeRename);
  assert.match(await chat("응"), /과제제출\.pdf.*이름을 바꿨어/u);
  assert.equal(actionCalls.at(-1).action, "file.rename");

  const beforeCopy = actionCalls.length;
  assert.match(
    await chat("그 파일 바탕화면에도 복사해줘"),
    /바탕화면으로 복사할까요/u,
  );
  assert.equal(actionCalls.length, beforeCopy);
  assert.match(await chat("ㅇㅇ"), /바탕화면에 복사했어/u);
  assert.equal(actionCalls.at(-1).action, "file.copy");

  const beforeMove = actionCalls.length;
  assert.match(
    await chat("그 파일 바탕화면으로 옮겨줘"),
    /바탕화면으로 옮길까요/u,
  );
  assert.match(await chat("ㄴㄴ"), /로컬 PC 작업을 취소/u);
  assert.equal(actionCalls.length, beforeMove);

  assert.match(
    await chat("그 파일 문서 폴더에 옮겨줘"),
    /문서 폴더로 옮길까요/u,
  );
  assert.match(await chat("응"), /문서 폴더로 옮겼어/u);
  assert.equal(actionCalls.at(-1).action, "file.move");

  const beforeDelete = actionCalls.length;
  assert.match(await chat("그 파일 삭제해줘"), /휴지통으로 이동할까요/u);
  assert.equal(actionCalls.length, beforeDelete);
  assert.match(await chat("ㄱㄱ"), /휴지통으로 이동했어/u);
  assert.equal(actionCalls.at(-1).action, "file.delete");

  const beforeNoPendingReply = actionCalls.length;
  await requestChat("ㅇㅇ", "local-no-pending-test");
  assert.equal(actionCalls.length, beforeNoPendingReply);

  const beforeClose = actionCalls.length;
  assert.match(await chat("계산기 닫아줘"), /종료할까요/u);
  assert.equal(actionCalls.length, beforeClose);
  assert.match(await chat("확인"), /계산기를 종료했어/u);
  assert.equal(actionCalls.at(-1).action, "app.close");

  assert.match(await chat("메모장 닫아줘"), /종료할까요/u);
  assert.match(await chat("확인"), /종료 요청을 보냈지만 아직 실행 중/u);

  assert.match(await chat("크롬 닫아줘"), /종료할까요/u);
  assert.match(await chat("확인"), /현재 실행 중이지 않아/u);

  await new Promise((resolve) => mockAgent.close(resolve));
  mockAgentClosed = true;
  assert.match(
    await chat("메모장 열어줘", "local-agent-offline-test"),
    /현재 Windows Local Agent에 연결할 수 없어/u,
  );

  console.log(
    "Local flow tests passed (aliases/fast path/context/confirmation/health).",
  );
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  nextProcess.kill();
  if (!mockAgentClosed) {
    await new Promise((resolve) => mockAgent.close(resolve));
  }
}
