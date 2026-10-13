import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

const MOCK_PORT = 43131;
const APP_PORT = 43132;
let healthProbeCalls = 0;

const mockServer = http.createServer((req, res) => {
  if (req.url === "/drive" || req.url === "/calendar") {
    healthProbeCalls += 1;
    res.writeHead(200).end();
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
        if (response.ok) {
          resolve();
          return;
        }
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

async function stopApp(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function requestHealth() {
  const response = await fetch(
    `http://127.0.0.1:${APP_PORT}/api/health/n8n`,
    { cache: "no-store" },
  );
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  assert.equal(body.status, "online");
  return response;
}

await new Promise((resolve) =>
  mockServer.listen(MOCK_PORT, "127.0.0.1", resolve),
);

const nextProcess = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
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
  await waitForServer();

  const concurrentResponses = await Promise.all([
    requestHealth(),
    requestHealth(),
    requestHealth(),
  ]);

  assert.equal(healthProbeCalls, 2);
  assert.equal(
    concurrentResponses.every(
      (response) => response.headers.get("x-l-ai-health-cache") === "miss",
    ),
    true,
  );

  const cachedResponse = await requestHealth();
  assert.equal(cachedResponse.headers.get("x-l-ai-health-cache"), "fresh");
  assert.equal(healthProbeCalls, 2);

  console.log("n8n health cache tests passed (in-flight coalescing and fresh cache).");
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  await stopApp(nextProcess);
  await new Promise((resolve) => mockServer.close(resolve));
}
