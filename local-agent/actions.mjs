import { spawn, execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createSafeDestination,
  createSafeSiblingDestination,
  getScopeRoot,
  resolveAllowedFile,
  toFileInfo,
  validateBrowserUrl,
  validateFileName,
} from "./security.mjs";

const execFileAsync = promisify(execFile);
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const CAPABILITIES = [
  "app.open",
  "app.close",
  "browser.open",
  "browser.search",
  "file.search",
  "file.open",
  "file.reveal",
  "file.rename",
  "file.move",
  "file.copy",
  "file.delete",
];

const APP_IDS = new Set([
  "chrome",
  "edge",
  "vscode",
  "explorer",
  "notepad",
  "calculator",
]);

export const APP_PROCESS_ALIASES = Object.freeze({
  chrome: Object.freeze(["chrome"]),
  edge: Object.freeze(["msedge"]),
  vscode: Object.freeze(["Code"]),
  notepad: Object.freeze(["Notepad"]),
});

const CALCULATOR_WINDOW_TITLES = new Set(["계산기", "calculator"]);

async function moveWithoutOverwrite(source, destination) {
  await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
  try {
    await fs.unlink(source);
  } catch (error) {
    await fs.unlink(destination).catch(() => {});
    throw error;
  }
}

function assertObject(value, allowedKeys, requiredKeys = allowedKeys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("action input은 객체여야 해.");
  }

  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    throw new Error("action input에 허용되지 않은 필드가 있어.");
  }

  if (requiredKeys.some((key) => !(key in value))) {
    throw new Error("action input의 필수 필드가 없어.");
  }

  return value;
}

async function firstExisting(paths) {
  for (const candidate of paths.filter(Boolean)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }
  return null;
}

function windowsSystemExecutable(name) {
  const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return path.join(root, "System32", name);
}

export async function resolveAppExecutable(app) {
  if (!APP_IDS.has(app)) {
    throw new Error("지원하지 않는 프로그램이야.");
  }

  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];

  const candidates = {
    chrome: [
      localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      programFilesX86 && path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    ],
    edge: [
      programFilesX86 && path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      programFiles && path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    ],
    vscode: [
      localAppData && path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
      programFiles && path.join(programFiles, "Microsoft VS Code", "Code.exe"),
    ],
    explorer: [path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe")],
    notepad: [windowsSystemExecutable("notepad.exe")],
    calculator: [windowsSystemExecutable("calc.exe")],
  };

  return firstExisting(candidates[app]);
}

async function launchExecutable(executable, args = []) {
  if (process.platform !== "win32") {
    throw new Error("프로그램 실행은 Windows에서만 지원해.");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function defaultOpenApp(app) {
  const executable = await resolveAppExecutable(app);
  if (!executable) {
    throw new Error("현재 실행 경로를 찾지 못했어.");
  }
  await launchExecutable(executable);
}

async function defaultCloseProcessWindows(processNames) {
  const { stdout } = await execFileAsync(
    windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(CURRENT_DIR, "close-app.ps1"),
    ],
    {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        L_AI_APP_PROCESS_NAMES: processNames.join(","),
      },
    },
  );

  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    throw new Error("프로그램 종료 상태를 확인하지 못했어.");
  }

  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.processFound !== "boolean" ||
    typeof result.windowFound !== "boolean" ||
    typeof result.closeRequested !== "boolean" ||
    typeof result.stillRunning !== "boolean"
  ) {
    throw new Error("프로그램 종료 상태를 확인하지 못했어.");
  }

  return result;
}

function normalizeWindowTitle(title) {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export function selectCalculatorWindows(windows) {
  if (!Array.isArray(windows)) return [];

  return windows.filter((window) =>
    typeof window === "object" &&
    window !== null &&
    window.visible === true &&
    window.className === "ApplicationFrameWindow" &&
    typeof window.title === "string" &&
    CALCULATOR_WINDOW_TITLES.has(normalizeWindowTitle(window.title)) &&
    typeof window.hwnd === "string" &&
    /^0x[0-9a-f]+$/iu.test(window.hwnd)
  );
}

async function runCalculatorWindowScript(action) {
  const { stdout } = await execFileAsync(
    windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(CURRENT_DIR, "calculator-window.ps1"),
    ],
    {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        L_AI_CALCULATOR_WINDOW_ACTION: action,
      },
    },
  );

  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error("계산기 창 상태를 확인하지 못했어.");
  }
}

async function defaultCloseCalculator() {
  const result = await runCalculatorWindowScript("close");
  if (
    typeof result !== "object" ||
    result === null ||
    !["success", "failed", "not_running"].includes(result.status) ||
    (result.status === "failed" &&
      !["window_still_open", "close_request_failed"].includes(result.reason))
  ) {
    throw new Error("계산기 종료 결과를 확인하지 못했어.");
  }
  return result;
}

export function createCalculatorCloser(
  windowLayer,
  { pollIntervalMs = 150, timeoutMs = 1500 } = {},
) {
  return async function closeCalculator() {
    const targetWindows = selectCalculatorWindows(
      await windowLayer.enumerateWindows(),
    );

    if (targetWindows.length === 0) {
      return { status: "not_running" };
    }

    const targetHandles = new Set(targetWindows.map((window) => window.hwnd));
    let closeRequested = false;

    for (const window of targetWindows) {
      closeRequested = await windowLayer.postClose(window.hwnd) || closeRequested;
    }

    const pollCount = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
    for (let attempt = 0; attempt < pollCount; attempt += 1) {
      await windowLayer.wait(pollIntervalMs);
      const windows = await windowLayer.enumerateWindows();
      const stillOpen = windows.some((window) =>
        typeof window === "object" &&
        window !== null &&
        targetHandles.has(window.hwnd)
      );

      if (!stillOpen && closeRequested) {
        return { status: "success" };
      }
    }

    return {
      status: "failed",
      reason: closeRequested ? "window_still_open" : "close_request_failed",
    };
  };
}

export function createAppCloser({
  closeProcessWindows = defaultCloseProcessWindows,
  closeCalculator = defaultCloseCalculator,
  platform = process.platform,
} = {}) {
  return async function closeApp(app) {
    if (platform !== "win32") {
      throw new Error("프로그램 종료는 Windows에서만 지원해.");
    }

    if (app === "explorer") {
      throw new Error("Windows 바탕화면 셸 보호를 위해 파일 탐색기 종료는 지원하지 않아.");
    }

    if (app === "calculator") {
      return closeCalculator();
    }

    const processNames = APP_PROCESS_ALIASES[app];
    if (!processNames) {
      throw new Error("이 프로그램은 안전 종료를 지원하지 않아.");
    }

    const result = await closeProcessWindows([...processNames]);

    if (!result.processFound || !result.windowFound) {
      return { status: "not_running" };
    }

    if (result.closeRequested && !result.stillRunning) {
      return { status: "success" };
    }

    return { status: "failed", reason: "window_still_open" };
  };
}

const defaultCloseApp = createAppCloser();

async function defaultOpenUrl(url) {
  const chrome = await resolveAppExecutable("chrome");
  const executable = chrome || path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe");
  await launchExecutable(executable, [url]);
}

async function defaultOpenFile(filePath) {
  await launchExecutable(path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), [filePath]);
}

async function defaultRevealFile(filePath) {
  await launchExecutable(
    path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"),
    [`/select,${filePath}`],
  );
}

async function defaultRecycleFile(filePath) {
  if (process.platform !== "win32") {
    throw new Error("휴지통 이동은 Windows에서만 지원해.");
  }

  await execFileAsync(
    windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(CURRENT_DIR, "recycle-file.ps1"),
    ],
    {
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        L_AI_RECYCLE_TARGET: filePath,
      },
    },
  );
}

async function searchFiles(config, input) {
  const scope = getScopeRoot(config, input.scope);
  const rootStat = await fs.stat(scope).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error("검색할 폴더를 찾지 못했어.");
  }

  const query = input.query.toLocaleLowerCase("ko-KR");
  const extension = input.extension?.toLowerCase() || null;
  const limit = input.limit;
  const matches = [];
  const queue = [{ directory: scope, depth: 0 }];
  let visited = 0;

  while (queue.length > 0 && matches.length < limit + 1 && visited < 1000) {
    const current = queue.shift();
    if (!current) break;

    let entries;
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visited += 1;
      if (entry.isSymbolicLink()) continue;
      if (
        [".git", ".ssh", ".gnupg", "node_modules"].includes(entry.name.toLowerCase()) ||
        /^(?:credentials?|passwords?|passwd|secrets?)$/iu.test(entry.name)
      ) {
        continue;
      }

      const fullPath = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 5) {
          queue.push({ directory: fullPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase().startsWith(".env")) {
        continue;
      }

      const nameMatches = !query || entry.name.toLocaleLowerCase("ko-KR").includes(query);
      const extensionMatches = !extension || path.extname(entry.name).toLowerCase() === extension;
      if (!nameMatches || !extensionMatches) continue;

      const safePath = await resolveAllowedFile(config, fullPath, {
        allowExecutable: true,
        operation: "search",
      }).catch(() => null);
      if (!safePath) continue;
      matches.push(await toFileInfo(safePath));
    }
  }

  matches.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return {
    files: matches.slice(0, limit),
    truncated: matches.length > limit || queue.length > 0,
  };
}

export function createActionExecutor(config, adapterOverrides = {}) {
  const adapters = {
    openApp: defaultOpenApp,
    closeApp: defaultCloseApp,
    openUrl: defaultOpenUrl,
    openFile: defaultOpenFile,
    revealFile: defaultRevealFile,
    recycleFile: defaultRecycleFile,
    ...adapterOverrides,
  };

  return async function executeAction(request) {
    const body = assertObject(request, ["action", "input"]);
    if (typeof body.action !== "string" || !CAPABILITIES.includes(body.action)) {
      throw new Error("지원하지 않는 Local Agent action이야.");
    }

    if (body.action === "app.open" || body.action === "app.close") {
      const input = assertObject(body.input, ["app"]);
      if (typeof input.app !== "string" || !APP_IDS.has(input.app)) {
        throw new Error("지원하지 않는 프로그램이야.");
      }

      if (body.action === "app.open") {
        await adapters.openApp(input.app);
        return { app: input.app };
      }

      if (input.app === "explorer") {
        throw new Error("Windows 바탕화면 셸 보호를 위해 파일 탐색기 종료는 지원하지 않아.");
      }

      const result = await adapters.closeApp(input.app);
      if (
        typeof result !== "object" ||
        result === null ||
        !["success", "failed", "not_running"].includes(result.status)
      ) {
        throw new Error("프로그램 종료 결과를 확인하지 못했어.");
      }

      return {
        app: input.app,
        status: result.status,
        ...(result.status === "failed" && typeof result.reason === "string"
          ? { reason: result.reason }
          : {}),
      };
    }

    if (body.action === "browser.open" || body.action === "browser.search") {
      const input = assertObject(body.input, ["url"]);
      const url = validateBrowserUrl(input.url);
      await adapters.openUrl(url);
      return { url };
    }

    if (body.action === "file.search") {
      const input = assertObject(body.input, ["scope", "query", "extension", "limit"]);
      if (
        typeof input.scope !== "string" ||
        typeof input.query !== "string" ||
        input.query.length > 200 ||
        (input.extension !== null &&
          (typeof input.extension !== "string" || !/^\.[a-z0-9]{1,10}$/iu.test(input.extension))) ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 20
      ) {
        throw new Error("파일 검색 조건이 올바르지 않아.");
      }
      return searchFiles(config, input);
    }

    if (body.action === "file.open" || body.action === "file.reveal" || body.action === "file.delete") {
      const input = assertObject(body.input, ["path"]);
      const filePath = await resolveAllowedFile(config, input.path, {
        allowExecutable: body.action === "file.reveal",
        operation: body.action,
      });

      if (body.action === "file.open") {
        await adapters.openFile(filePath);
        return toFileInfo(filePath);
      }
      if (body.action === "file.reveal") {
        await adapters.revealFile(filePath);
        return toFileInfo(filePath);
      }

      await adapters.recycleFile(filePath);
      return { name: path.basename(filePath) };
    }

    if (body.action === "file.rename") {
      const input = assertObject(body.input, ["path", "newName"]);
      const source = await resolveAllowedFile(config, input.path, {
        allowExecutable: false,
        operation: "rename",
      });
      const newName = validateFileName(input.newName);
      const destination = await createSafeSiblingDestination(
        config,
        source,
        newName,
      );
      await moveWithoutOverwrite(source, destination);
      return toFileInfo(destination);
    }

    const input = assertObject(body.input, ["path", "destinationScope"]);
    const source = await resolveAllowedFile(config, input.path, {
      allowExecutable: false,
      operation: body.action,
    });
    const destination = await createSafeDestination(
      config,
      source,
      input.destinationScope,
    );

    if (body.action === "file.move") {
      await moveWithoutOverwrite(source, destination);
    } else {
      await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    }
    return toFileInfo(destination);
  };
}
