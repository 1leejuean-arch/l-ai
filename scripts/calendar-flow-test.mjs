import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const MOCK_PORT = 43117;
const APP_PORT = 43118;
const TODAY_START = "2026-08-31T00:00:00+09:00";
const TOMORROW_START = "2026-09-01T00:00:00+09:00";
const DAY_AFTER_TOMORROW_START = "2026-09-02T00:00:00+09:00";
const EVENT = {
  id: "event-broadcast-club",
  summary: "방송부 회의",
  start: { dateTime: "2026-08-31T18:00:00+09:00" },
  end: { dateTime: "2026-08-31T19:00:00+09:00" },
};

const calendarCalls = [];
let openAiCalls = 0;

function calendarIntent(overrides) {
  return {
    action: "not_calendar_request",
    title: null,
    start: null,
    end: null,
    rangeLabel: null,
    targetTitle: null,
    targetStart: null,
    newTitle: null,
    newStart: null,
    newEnd: null,
    timeHour: null,
    timeMinute: null,
    missingField: null,
    clarification: null,
    ...overrides,
  };
}

function responseJson(res, value) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const mockServer = http.createServer(async (req, res) => {
  const body = await readJson(req);

  if (req.url === "/v1/responses") {
    openAiCalls += 1;
    const input = String(body.input);
    let intent;

    if (input.includes("내일 일정 뭐 있어")) {
      intent = calendarIntent({
        action: "get_calendar_events",
        start: TOMORROW_START,
        end: DAY_AFTER_TOMORROW_START,
        rangeLabel: "내일",
      });
    } else if (input.includes("오늘 일정 뭐 있어")) {
      intent = calendarIntent({
        action: "get_calendar_events",
        start: TODAY_START,
        end: TOMORROW_START,
        rangeLabel: "오늘",
      });
    } else if (input.includes("8시로 바꿔줘")) {
      intent = calendarIntent({
        action: "update_calendar_event",
        start: TODAY_START,
        end: TOMORROW_START,
        targetTitle: "방송부 회의",
        timeHour: 8,
        timeMinute: 0,
        missingField: "ampm",
        clarification: "'방송부 회의'를 오전 8시로 변경할까요, 오후 8시로 변경할까요?",
      });
    } else if (input.includes("삭제해줘")) {
      intent = calendarIntent({
        action: "delete_calendar_event",
        start: TODAY_START,
        end: TOMORROW_START,
        targetTitle: "방송부 회의",
      });
    } else {
      throw new Error(`Unexpected OpenAI input: ${input}`);
    }

    const outputText = JSON.stringify(intent);
    responseJson(res, {
      id: `resp-test-${openAiCalls}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: "test-model",
      output: [
        {
          id: `msg-test-${openAiCalls}`,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: outputText,
              annotations: [],
            },
          ],
        },
      ],
      output_text: outputText,
    });
    return;
  }

  if (req.url === "/calendar") {
    calendarCalls.push(body);
    if (
      body.action === "calendar_get" &&
      body.data.start === TOMORROW_START
    ) {
      res.writeHead(200).end("");
      return;
    }
    responseJson(res, body.action === "calendar_get" ? [EVENT] : { success: true });
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

function createConversation() {
  let cookie = "";

  return async (message) => {
    const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ message }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    const body = await response.json();
    assert.equal(response.ok, true, JSON.stringify(body));
    return body.reply;
  };
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
nextProcess.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
nextProcess.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

try {
  await waitForServer(`http://127.0.0.1:${APP_PORT}`);

  const emptyDayConversation = createConversation();
  assert.match(
    await emptyDayConversation("내일 일정 뭐 있어?"),
    /내일은 등록된 일정이 없어/u,
  );

  const updateConversation = createConversation();
  assert.match(await updateConversation("오늘 일정 뭐 있어?"), /방송부 회의/u);
  assert.match(
    await updateConversation("방송부 회의 8시로 바꿔줘"),
    /오전 8시.*오후 8시/u,
  );
  const callsBeforeClarification = openAiCalls;
  const confirmation = await updateConversation("오후 8시");
  assert.equal(openAiCalls, callsBeforeClarification);
  assert.match(confirmation, /수정할까요/u);
  assert.match(confirmation, /오후 6:00/u);
  assert.match(confirmation, /오후 8:00/u);
  assert.match(confirmation, /오후 9:00/u);
  assert.match(await updateConversation("수정"), /일정을 수정했어/u);

  const updateCall = calendarCalls.find(
    ({ action }) => action === "calendar_update",
  );
  assert.deepEqual(updateCall, {
    action: "calendar_update",
    data: {
      eventId: EVENT.id,
      title: EVENT.summary,
      start: "2026-08-31T20:00:00+09:00",
      end: "2026-08-31T21:00:00+09:00",
    },
  });

  const deleteConversation = createConversation();
  assert.match(
    await deleteConversation("방송부 회의 삭제해줘"),
    /삭제할까요/u,
  );
  assert.match(await deleteConversation("삭제"), /일정을 삭제했어/u);
  const deleteCall = calendarCalls.find(
    ({ action }) => action === "calendar_delete",
  );
  assert.deepEqual(deleteCall, {
    action: "calendar_delete",
    data: { eventId: EVENT.id },
  });

  const cancelConversation = createConversation();
  const updateCountBeforeCancel = calendarCalls.filter(
    ({ action }) => action === "calendar_update",
  ).length;
  await cancelConversation("방송부 회의 8시로 바꿔줘");
  await cancelConversation("오후 8시");
  assert.match(await cancelConversation("취소"), /취소했어/u);
  assert.equal(
    calendarCalls.filter(({ action }) => action === "calendar_update").length,
    updateCountBeforeCancel,
  );

  console.log("Calendar flow tests passed (empty result + multi-step 3/3).");
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  nextProcess.kill();
  await new Promise((resolve) => mockServer.close(resolve));
}
