import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const MOCK_PORT = 43119;
const APP_PORT = 43120;
const driveCalls = [];
let openAiCalls = 0;

function responseJson(res, value) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createOpenAiResponse(output) {
  const outputText = JSON.stringify(output);
  return {
    id: "resp-drive-test",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: "test-model",
    output: [
      {
        id: "msg-drive-test",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: outputText, annotations: [] }],
      },
    ],
    output_text: outputText,
  };
}

const mockServer = http.createServer(async (req, res) => {
  const body = await readJson(req);

  if (req.url === "/drive") {
    driveCalls.push(body);
    const files =
      body.query === "대의원회의"
        ? [
            { id: "drive-file-1", name: "대의원회의 자료.pptx" },
            { id: "drive-file-2", name: "대의원회의.pdf" },
          ]
        : body.query === "결재문서"
          ? [{ id: "drive-file-3", name: "결재문서.hwp" }]
          : [];
    responseJson(res, files);
    return;
  }

  if (req.url === "/v1/responses") {
    openAiCalls += 1;
    responseJson(
      res,
      createOpenAiResponse({
        action: "get_calendar_events",
        title: null,
        start: "2026-09-03T00:00:00+09:00",
        end: "2026-09-04T00:00:00+09:00",
        rangeLabel: "오늘",
        targetTitle: null,
        targetStart: null,
        newTitle: null,
        newStart: null,
        newEnd: null,
        timeHour: null,
        timeMinute: null,
        missingField: null,
        clarification: null,
      }),
    );
    return;
  }

  if (req.url === "/calendar") {
    responseJson(res, [
      {
        id: "calendar-event-1",
        summary: "Calendar 회귀 테스트",
        start: { dateTime: "2026-09-03T15:00:00+09:00" },
        end: { dateTime: "2026-09-03T16:00:00+09:00" },
      },
    ]);
    return;
  }

  res.writeHead(404).end();
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
        return reject(new Error("Next.js test server did not start"));
      }
      setTimeout(poll, 200);
    };

    void poll();
  });
}

async function sendChat(message) {
  const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.reply;
}

await new Promise((resolve) => mockServer.listen(MOCK_PORT, "127.0.0.1", resolve));

const nextProcess = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "test-model",
      OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      N8N_CALENDAR_URL: `http://127.0.0.1:${MOCK_PORT}/calendar`,
      N8N_DRIVE_SEARCH_URL: `http://127.0.0.1:${MOCK_PORT}/drive`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
nextProcess.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
nextProcess.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

try {
  await waitForServer(`http://127.0.0.1:${APP_PORT}`);

  const delegateReply = await sendChat(
    "내 드라이브에서 대의원회의 파일 찾아줘",
  );
  assert.match(delegateReply, /Google Drive에서 2개 찾았어/u);
  assert.match(delegateReply, /대의원회의 자료\.pptx/u);
  assert.match(
    delegateReply,
    /https:\/\/drive\.google\.com\/open\?id=drive-file-1/u,
  );

  const approvalReply = await sendChat("구글 드라이브에서 결재문서 찾아줘");
  assert.match(approvalReply, /Google Drive에서 1개 찾았어/u);
  assert.match(approvalReply, /결재문서\.hwp/u);

  const missingReply = await sendChat(
    "드라이브에서 존재하지않는파일123 찾아줘",
  );
  assert.equal(
    missingReply,
    "Google Drive에서 '존재하지않는파일123'와 관련된 파일을 찾지 못했어.",
  );

  assert.deepEqual(driveCalls, [
    { query: "대의원회의" },
    { query: "결재문서" },
    { query: "존재하지않는파일123" },
  ]);
  assert.equal(openAiCalls, 0);

  const calendarReply = await sendChat("오늘 일정 뭐 있어?");
  assert.match(calendarReply, /Calendar 회귀 테스트/u);
  assert.equal(openAiCalls, 1);

  console.log("Drive search tests passed (3/3 + Calendar regression).");
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  nextProcess.kill();
  await new Promise((resolve) => mockServer.close(resolve));
}
