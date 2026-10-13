import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  APP_PROCESS_ALIASES,
  createAppCloser,
  createCalculatorCloser,
  createActionExecutor,
  selectCalculatorWindows,
} from "../local-agent/actions.mjs";
import {
  createLocalAgentServer,
  LOCAL_AGENT_HOST,
} from "../local-agent/server.mjs";
import {
  createSecurityConfig,
  validateBrowserUrl,
} from "../local-agent/security.mjs";

const token = "local-agent-test-token-1234";
const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "l-ai-local-agent-"),
);
const outsideRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "l-ai-local-agent-outside-"),
);

const scopes = {
  Desktop: path.join(temporaryRoot, "Desktop"),
  Documents: path.join(temporaryRoot, "Documents"),
  Downloads: path.join(temporaryRoot, "Downloads"),
  Pictures: path.join(temporaryRoot, "Pictures"),
  Videos: path.join(temporaryRoot, "Videos"),
  Music: path.join(temporaryRoot, "Music"),
  Project: path.join(temporaryRoot, "Project"),
};

await Promise.all(
  Object.values(scopes).map((directory) =>
    fs.mkdir(directory, { recursive: true }),
  ),
);

const reportPath = path.join(scopes.Downloads, "방송부 보고서.pdf");
const executablePath = path.join(scopes.Downloads, "unsafe.exe");
const envPath = path.join(scopes.Project, ".env.local");
const outsidePath = path.join(outsideRoot, "outside.pdf");

await Promise.all([
  fs.writeFile(reportPath, "temporary pdf fixture"),
  fs.writeFile(executablePath, "not an executable"),
  fs.writeFile(envPath, "TEST_ONLY=1"),
  fs.writeFile(outsidePath, "outside"),
]);

const security = createSecurityConfig({
  userProfile: temporaryRoot,
  projectRoot: scopes.Project,
  scopeRoots: scopes,
  systemRoots: [],
});

const adapterCalls = [];
const adapters = {
  openApp: async (app) => adapterCalls.push(["openApp", app]),
  closeApp: async (app) => {
    adapterCalls.push(["closeApp", app]);
    return { status: "success" };
  },
  openUrl: async (url) => adapterCalls.push(["openUrl", url]),
  openFile: async (file) => adapterCalls.push(["openFile", path.basename(file)]),
  revealFile: async (file) => adapterCalls.push(["revealFile", path.basename(file)]),
  recycleFile: async (file) => adapterCalls.push(["recycleFile", path.basename(file)]),
};

const execute = createActionExecutor(security, adapters);

try {
  assert.equal(LOCAL_AGENT_HOST, "127.0.0.1");
  assert.throws(
    () => validateBrowserUrl("javascript:alert(1)"),
    /http 또는 https/u,
  );

  const calculatorWindowScript = await fs.readFile(
    path.join(process.cwd(), "local-agent", "calculator-window.ps1"),
    "utf8",
  );
  assert.match(calculatorWindowScript, /EnumWindows/u);
  assert.match(calculatorWindowScript, /ApplicationFrameWindow/u);
  assert.match(calculatorWindowScript, /PostMessageW/u);
  assert.match(calculatorWindowScript, /0x0010/u);
  assert.doesNotMatch(
    calculatorWindowScript,
    /taskkill|Stop-Process|TerminateProcess|ApplicationFrameHost\.exe|CALCULATOR_WINDOW_HANDLE/iu,
  );

  assert.equal(Object.hasOwn(APP_PROCESS_ALIASES, "calculator"), false);

  const discoveredHwnd = `0x${process.hrtime.bigint().toString(16)}`;
  const calculatorWindow = {
    hwnd: discoveredHwnd,
    visible: true,
    title: " 계산기 ",
    className: "ApplicationFrameWindow",
  };
  const englishCalculatorWindow = {
    hwnd: "0xCA1C",
    visible: true,
    title: "Calculator",
    className: "ApplicationFrameWindow",
  };
  const selectedCalculatorWindows = selectCalculatorWindows([
    calculatorWindow,
    englishCalculatorWindow,
    {
      hwnd: "0xC0DE",
      visible: true,
      title: "계산기",
      className: "Windows.UI.Core.CoreWindow",
    },
    {
      hwnd: "0xBEEF",
      visible: true,
      title: "",
      className: "ApplicationFrameWindow",
    },
    {
      hwnd: "0xFACE",
      visible: true,
      title: "설정",
      className: "ApplicationFrameWindow",
    },
    {
      hwnd: "0xD00D",
      visible: false,
      title: "계산기",
      className: "ApplicationFrameWindow",
    },
  ]);
  assert.deepEqual(
    selectedCalculatorWindows.map((window) => window.hwnd),
    [discoveredHwnd, "0xCA1C"],
  );

  const postedHandles = [];
  let successEnumeration = 0;
  const closeCalculator = createCalculatorCloser({
    enumerateWindows: async () =>
      successEnumeration++ === 0 ? [calculatorWindow] : [],
    postClose: async (hwnd) => {
      postedHandles.push(hwnd);
      return true;
    },
    wait: async () => {},
  }, { pollIntervalMs: 1, timeoutMs: 2 });
  assert.deepEqual(await closeCalculator(), { status: "success" });
  assert.deepEqual(postedHandles, [discoveredHwnd]);

  const closeStillOpenCalculator = createCalculatorCloser({
    enumerateWindows: async () => [calculatorWindow],
    postClose: async () => true,
    wait: async () => {},
  }, { pollIntervalMs: 1, timeoutMs: 2 });
  assert.deepEqual(await closeStillOpenCalculator(), {
    status: "failed",
    reason: "window_still_open",
  });

  let postWithoutWindow = false;
  const closeStoppedCalculator = createCalculatorCloser({
    enumerateWindows: async () => [],
    postClose: async () => {
      postWithoutWindow = true;
      return true;
    },
    wait: async () => {},
  }, { pollIntervalMs: 1, timeoutMs: 2 });
  assert.deepEqual(await closeStoppedCalculator(), {
    status: "not_running",
  });
  assert.equal(postWithoutWindow, false);

  const closeLayerCalls = [];
  const closeApp = createAppCloser({
    closeProcessWindows: async (processNames) => {
      closeLayerCalls.push(processNames);
      return {
        processFound: true,
        windowFound: true,
        closeRequested: true,
        stillRunning: false,
      };
    },
    platform: "win32",
  });
  assert.deepEqual(await closeApp("chrome"), { status: "success" });
  assert.deepEqual(closeLayerCalls, [["chrome"]]);

  await assert.rejects(
    closeApp("explorer"),
    /파일 탐색기 종료는 지원하지 않아/u,
  );
  await assert.rejects(
    closeApp("powershell"),
    /안전 종료를 지원하지 않아/u,
  );
  assert.throws(
    () => validateBrowserUrl("file:///C:/Windows/System32"),
    /http 또는 https/u,
  );

  const search = await execute({
    action: "file.search",
    input: {
      scope: "Downloads",
      query: "방송부",
      extension: ".pdf",
      limit: 10,
    },
  });
  assert.equal(search.files.length, 1);
  assert.equal(search.files[0].name, "방송부 보고서.pdf");

  await assert.rejects(
    execute({
      action: "file.search",
      input: {
        scope: "toString",
        query: "",
        extension: null,
        limit: 10,
      },
    }),
    /허용되지 않은 로컬 폴더/u,
  );

  await assert.rejects(
    execute({ action: "file.open", input: { path: outsidePath } }),
    /허용된 사용자 폴더 밖/u,
  );
  await assert.rejects(
    execute({ action: "file.open", input: { path: executablePath } }),
    /실행 가능한 파일/u,
  );
  await assert.rejects(
    execute({ action: "file.open", input: { path: envPath } }),
    /보호된 설정/u,
  );
  await assert.rejects(
    execute({
      action: "file.rename",
      input: { path: reportPath, newName: "../escape.pdf" },
    }),
    /사용할 수 없는 파일 이름/u,
  );

  const renamed = await execute({
    action: "file.rename",
    input: { path: reportPath, newName: "방송부 보고서 최종.pdf" },
  });
  assert.equal(renamed.name, "방송부 보고서 최종.pdf");

  const copied = await execute({
    action: "file.copy",
    input: { path: renamed.path, destinationScope: "Desktop" },
  });
  assert.equal(
    copied.path,
    path.join(await fs.realpath(scopes.Desktop), renamed.name),
  );

  const moved = await execute({
    action: "file.move",
    input: { path: renamed.path, destinationScope: "Documents" },
  });
  assert.equal(
    moved.path,
    path.join(await fs.realpath(scopes.Documents), renamed.name),
  );

  await execute({ action: "file.delete", input: { path: moved.path } });
  assert.deepEqual(adapterCalls.at(-1), ["recycleFile", renamed.name]);
  assert.equal(await fs.readFile(moved.path, "utf8"), "temporary pdf fixture");

  await execute({ action: "app.open", input: { app: "calculator" } });
  assert.deepEqual(
    await execute({ action: "app.close", input: { app: "calculator" } }),
    { app: "calculator", status: "success" },
  );
  await execute({
    action: "browser.search",
    input: { url: "https://www.youtube.com/results?search_query=IU" },
  });
  assert.deepEqual(adapterCalls.slice(-3), [
    ["openApp", "calculator"],
    ["closeApp", "calculator"],
    ["openUrl", "https://www.youtube.com/results?search_query=IU"],
  ]);

  await assert.rejects(
    execute({ action: "shell.execute", input: { command: "whoami" } }),
    /지원하지 않는/u,
  );
  await assert.rejects(
    execute({
      action: "app.open",
      input: { app: "calculator", command: "whoami" },
    }),
    /허용되지 않은 필드/u,
  );
  await assert.rejects(
    execute({ action: "app.close", input: { app: "explorer" } }),
    /파일 탐색기 종료는 지원하지 않아/u,
  );
  await assert.rejects(
    execute({ action: "app.close", input: { app: "powershell" } }),
    /지원하지 않는 프로그램/u,
  );

  const server = createLocalAgentServer({
    token,
    security: {
      userProfile: temporaryRoot,
      projectRoot: scopes.Project,
      scopeRoots: scopes,
      systemRoots: [],
    },
    adapters,
  });

  await new Promise((resolve) => server.listen(0, LOCAL_AGENT_HOST, resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const baseUrl = `http://${LOCAL_AGENT_HOST}:${address.port}`;

  try {
    const unauthorized = await fetch(`${baseUrl}/health`);
    assert.equal(unauthorized.status, 401);

    const health = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(health.ok, true);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.capabilities.includes("file.delete"), true);

    const rejectedOrigin = await fetch(`${baseUrl}/health`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://evil.example",
      },
    });
    assert.equal(rejectedOrigin.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(
    "Local Agent tests passed (localhost/auth/schema/url/path/temp file operations).",
  );
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
  await fs.rm(outsideRoot, { recursive: true, force: true });
}
