import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const MOCK_PORT = 43121;
const APP_PORT = 43122;
const mailCalls = [];
const driveCalls = [];
const calendarCalls = [];
let openAiCalls = 0;

function json(res, value) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function openAiResponse(text) {
  return {
    id: "resp-mail-test",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: "test-model",
    output: [{
      id: "msg-mail-test",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    }],
    output_text: text,
  };
}

const mockServer = http.createServer(async (req, res) => {
  const body = await readJson(req);

  if (req.url === "/mail/search") {
    mailCalls.push(body);
    const singleResult = {
      id: "mail-single",
      folder: "inbox",
      direction: "inbound",
      from_email: "qa@example.com",
      from_name: "QA",
      to_emails: ["me@example.com"],
      subject: "L-AI 메일 일정 테스트",
      body_text: "방송부 회의 안내\n단일 검색 결과의 번호 선택 회귀 테스트 본문입니다.",
      preview: "단일 검색 결과 테스트",
      status: "received",
      is_read: false,
      is_starred: false,
      sent_at: null,
      received_at: "2026-10-12T10:00:00+09:00",
      created_at: "2026-10-12T10:00:00+09:00",
    };
    const existingReplyResult = {
      ...singleResult,
      id: "mail-existing-reply",
      subject: "Re: 회의 안내",
      body_text: "원본 제목과 다른 본문 첫 줄\n답장 prefix 회귀 테스트입니다.",
    };
    json(res, {
      ok: true,
      emails: body.query === "L-AI 메일 일정 테스트"
        ? [singleResult]
        : body.query === "답장 제목 중복 테스트"
          ? [existingReplyResult]
        : [
        {
          id: "mail-1",
          folder: "inbox",
          direction: "inbound",
          from_email: "club@example.com",
          from_name: "방송부",
          to_emails: ["me@example.com"],
          subject: "방송부 정기 회의 안내",
          body_text: "10월 15일 오후 6시부터 7시까지 방송실에서 정기 회의를 합니다.",
          preview: "10월 15일 오후 6시 정기 회의",
          status: "received",
          is_read: false,
          is_starred: false,
          sent_at: null,
          received_at: "2026-10-12T09:00:00+09:00",
          created_at: "2026-10-12T09:00:00+09:00",
        },
        {
          id: "mail-2",
          folder: "inbox",
          direction: "inbound",
          from_email: "club@example.com",
          from_name: "방송부",
          to_emails: ["me@example.com"],
          subject: "방송 장비 점검",
          body_text: "다음 주 장비 점검 안내입니다.",
          preview: "장비 점검 안내",
          status: "received",
          is_read: false,
          is_starred: false,
          sent_at: null,
          received_at: "2026-10-11T09:00:00+09:00",
          created_at: "2026-10-11T09:00:00+09:00",
        },
        ],
    });
    return;
  }

  if (req.url === "/v1/responses") {
    openAiCalls += 1;
    const schemaName = body.text?.format?.name;
    if (String(body.instructions).includes("Google Drive 문서 일정 추출 엔진")) {
      json(res, openAiResponse(JSON.stringify({ events: [
        {
          title: "Drive 첫 번째 일정",
          start: "2026-10-21T10:00:00+09:00",
          end: "2026-10-21T11:00:00+09:00",
          location: null,
          description: "Drive 후보 1",
          allDay: false,
        },
        {
          title: "Drive 두 번째 일정",
          start: "2026-10-22T14:00:00+09:00",
          end: "2026-10-22T15:00:00+09:00",
          location: null,
          description: "Drive 후보 2",
          allDay: false,
        },
      ] })));
      return;
    }
    if (schemaName === "mail_calendar_candidates") {
      json(res, openAiResponse(JSON.stringify({ events: [{
        title: "방송부 정기 회의",
        start: "2026-10-15T18:00:00+09:00",
        end: "2026-10-15T19:00:00+09:00",
        location: "방송실",
        description: "방송부원 전원 참석",
        allDay: false,
      }] })));
      return;
    }
    if (schemaName === "mail_draft") {
      json(res, openAiResponse(JSON.stringify({
        subject: "Re: 방송부 정기 회의 안내",
        body: "안녕하세요. 방송부 정기 회의에 참석하겠습니다. 감사합니다.",
      })));
      return;
    }
    json(res, openAiResponse("방송부 정기 회의는 10월 15일 오후 6시 방송실에서 열린다."));
    return;
  }

  if (req.url === "/calendar") {
    calendarCalls.push(body);
    if (body.action === "calendar_get" && String(body.data?.start).startsWith("2026-10-20")) {
      json(res, [{
        id: "event-1",
        summary: "방송부 회의",
        start: { dateTime: "2026-10-20T18:00:00+09:00" },
        end: { dateTime: "2026-10-20T19:00:00+09:00" },
      }]);
      return;
    }
    json(res, body.action === "calendar_get" ? [] : { success: true });
    return;
  }

  if (req.url === "/drive") {
    driveCalls.push(body);
    json(res, body.action === "read"
      ? { text: "방송부 회의 준비 자료와 참석 안내 내용" }
      : [{ id: "drive-1", name: "방송부 정기 회의 자료.pdf" }]);
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
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error("Next.js test server did not start"));
      setTimeout(poll, 200);
    };
    void poll();
  });
}

const sessionId = "mail-flow-test";
async function chat(message, requestSessionId = sessionId) {
  const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-session-id": requestSessionId },
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.reply;
}

await new Promise((resolve) => mockServer.listen(MOCK_PORT, "127.0.0.1", resolve));
const nextProcess = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "test-model",
    OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
    L_JMAIL_AI_API_URL: `http://127.0.0.1:${MOCK_PORT}`,
    L_JMAIL_AI_API_KEY: "test-mail-key",
    N8N_CALENDAR_URL: `http://127.0.0.1:${MOCK_PORT}/calendar`,
    N8N_DRIVE_SEARCH_URL: `http://127.0.0.1:${MOCK_PORT}/drive`,
    SUPABASE_URL: "",
    SUPABASE_SECRET_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
nextProcess.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
nextProcess.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));

const settleLogs = () => new Promise((resolve) => setTimeout(resolve, 50));

try {
  await waitForServer(`http://127.0.0.1:${APP_PORT}`);

  const singleSession = "mail-single-result-test";
  const singlePlanLogStart = serverOutput.length;
  const openAiBeforeSingle = openAiCalls;
  assert.match(
    await chat("L-AI 메일 일정 테스트 메일 찾아줘", singleSession),
    /메일 1개/u,
  );
  await settleLogs();
  const singlePlanLogs = serverOutput.slice(singlePlanLogStart);
  assert.match(singlePlanLogs, /toolId: 'mail\.search'/u);
  assert.doesNotMatch(singlePlanLogs, /mail\.calendar\.extract|calendar\.create/u);

  const singleSelectionLogStart = serverOutput.length;
  assert.match(
    await chat("1번 메일 열어줘", singleSession),
    /방송부 회의 안내/u,
  );
  await settleLogs();
  const singleSelectionLogs = serverOutput.slice(singleSelectionLogStart);
  assert.doesNotMatch(
    singleSelectionLogs,
    /Semantic learning facts|Context Resolver|\[L-AI Router\]/u,
  );
  assert.match(singleSelectionLogs, /type: 'mail_read'/u);
  assert.equal(openAiCalls, openAiBeforeSingle);

  const replyDraft = await chat(
    "그 메일에 참석한다고 답장 초안 만들어줘",
    singleSession,
  );
  assert.match(replyDraft, /제목: Re: L-AI 메일 일정 테스트/u);
  assert.doesNotMatch(replyDraft, /제목: Re: 방송부 회의 안내/u);

  const forwardDraft = await chat(
    "그 메일 방송부장한테 전달해줘",
    singleSession,
  );
  assert.match(forwardDraft, /제목: Fwd: L-AI 메일 일정 테스트/u);

  const existingReplySession = "mail-existing-reply-subject-test";
  await chat("답장 제목 중복 테스트 메일 찾아줘", existingReplySession);
  await chat("1번 메일 열어줘", existingReplySession);
  const existingReplyDraft = await chat(
    "그 메일에 참석한다고 답장 초안 만들어줘",
    existingReplySession,
  );
  assert.match(existingReplyDraft, /제목: Re: 회의 안내/u);
  assert.doesNotMatch(existingReplyDraft, /제목: Re: Re:/u);

  const secondSelectionSession = "mail-second-result-test";
  await chat("방송부에서 온 메일 찾아줘", secondSelectionSession);
  assert.match(
    await chat("2번 메일 열어줘", secondSelectionSession),
    /다음 주 장비 점검 안내입니다/u,
  );

  const ordinalSelectionSession = "mail-ordinal-result-test";
  await chat("방송부에서 온 메일 찾아줘", ordinalSelectionSession);
  assert.match(
    await chat("두 번째 메일 보여줘", ordinalSelectionSession),
    /다음 주 장비 점검 안내입니다/u,
  );

  const openAiBeforeMainSearch = openAiCalls;
  assert.match(await chat("방송부에서 온 메일 찾아줘"), /메일 2개/u);
  assert.equal(openAiCalls, openAiBeforeMainSearch);
  assert.match(await chat("1번 열어줘"), /10월 15일 오후 6시/u);
  assert.equal(openAiCalls, openAiBeforeMainSearch);
  assert.match(await chat("그 메일 요약해줘"), /방송부 정기 회의는/u);
  assert.match(await chat("그 메일 관련 파일 찾아줘"), /방송부 정기 회의 자료\.pdf/u);
  assert.equal(driveCalls.at(-1).query, "방송부 정기 회의 안내");
  assert.match(await chat("그 파일 내용으로 메일 초안 만들어줘"), /아직 전송하지 않았어/u);
  const mailCalendarCandidates = await chat("그 메일에서 일정 찾아줘");
  assert.match(
    mailCalendarCandidates,
    /1\. 방송부 정기 회의\n\n시작: 2026년 10월 15일 오후 6:00 {2}\n종료: 2026년 10월 15일 오후 7:00 {2}\n장소: 방송실 {2}\n추가 내용: 방송부원 전원 참석/u,
  );
  assert.doesNotMatch(mailCalendarCandidates, /2026-10-15T/u);

  const calendarCallsBefore = calendarCalls.length;
  assert.match(await chat("캘린더에 넣어줘"), /Calendar에 추가/u);
  assert.equal(calendarCalls.length, calendarCallsBefore + 2);
  assert.equal(calendarCalls.at(-1).action, "calendar_create");

  const drivePendingSession = "drive-calendar-priority-test";
  await chat("방송부에서 온 메일 찾아줘", drivePendingSession);
  await chat("드라이브에서 일정 자료 찾아줘", drivePendingSession);
  assert.match(
    await chat("그 파일에서 일정 찾아줘", drivePendingSession),
    /Drive 두 번째 일정/u,
  );
  assert.match(
    await chat("2번 추가해줘", drivePendingSession),
    /Drive 두 번째 일정/u,
  );
  assert.equal(calendarCalls.at(-1).action, "calendar_create");
  assert.equal(calendarCalls.at(-1).data.title, "Drive 두 번째 일정");

  assert.match(await chat("그 메일에 참석한다고 답장 초안 만들어줘"), /아직 전송하지 않았어/u);
  assert.match(await chat("전송"), /실제 발송은 하지 않았어/u);

  assert.match(
    await chat("홍길동에게 내일 회의에 참석한다고 메일 써줘", "mail-generic-draft-test"),
    /받는 사람: 지정 필요/u,
  );

  const calendarDraftSession = "mail-calendar-draft-test";
  assert.match(await chat("2026년 10월 20일 일정 보여줘", calendarDraftSession), /방송부 회의/u);
  assert.match(await chat("그 일정 내용으로 메일 초안 만들어줘", calendarDraftSession), /아직 전송하지 않았어/u);
  assert.equal(
    mailCalls.some(({ query }) => query === "L-AI 메일 일정 테스트"),
    true,
  );

  console.log("Mail flow tests passed (search/select/summary/calendar/drive/draft safety).")
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  nextProcess.kill();
  await new Promise((resolve) => mockServer.close(resolve));
}
