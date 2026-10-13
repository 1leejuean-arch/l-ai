import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".msi",
  ".msp",
  ".scr",
  ".vbs",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".lnk",
]);

const RESERVED_WINDOWS_NAMES =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function comparable(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function isPathInside(candidate, root) {
  const child = comparable(candidate);
  const parent = comparable(root);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

export function validateFileName(name) {
  if (typeof name !== "string" || !name.trim() || name.length > 255) {
    throw new Error("새 파일 이름이 올바르지 않아.");
  }

  const trimmed = name.trim();

  if (
    trimmed === "." ||
    trimmed === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/u.test(trimmed) ||
    /[. ]$/u.test(trimmed) ||
    RESERVED_WINDOWS_NAMES.test(trimmed)
  ) {
    throw new Error("Windows에서 사용할 수 없는 파일 이름이야.");
  }

  return trimmed;
}

export function validateBrowserUrl(value) {
  if (typeof value !== "string" || value.length > 4096) {
    throw new Error("URL 형식이 올바르지 않아.");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL 형식이 올바르지 않아.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error("http 또는 https URL만 열 수 있어.");
  }

  return url.toString();
}

export function createSecurityConfig(overrides = {}) {
  const userProfile = canonicalPath(
    overrides.userProfile || process.env.USERPROFILE || os.homedir(),
  );
  const projectRoot = canonicalPath(
    overrides.projectRoot ||
      process.env.L_AI_LOCAL_AGENT_PROJECT_ROOT ||
      process.cwd(),
  );

  const scopeRoots = overrides.scopeRoots || {
    Desktop: path.join(userProfile, "Desktop"),
    Documents: path.join(userProfile, "Documents"),
    Downloads: path.join(userProfile, "Downloads"),
    Pictures: path.join(userProfile, "Pictures"),
    Videos: path.join(userProfile, "Videos"),
    Music: path.join(userProfile, "Music"),
    Project: projectRoot,
  };

  const systemRoots = (
    overrides.systemRoots || [
      process.env.SystemRoot,
      process.env.WINDIR,
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.ProgramData,
    ]
  )
    .filter(Boolean)
    .map((item) => canonicalPath(item));

  return {
    projectRoot,
    scopeRoots: Object.fromEntries(
      Object.entries(scopeRoots).map(([key, value]) => [key, canonicalPath(value)]),
    ),
    systemRoots,
  };
}

export function getScopeRoot(config, scope) {
  if (
    typeof scope !== "string" ||
    !Object.hasOwn(config.scopeRoots, scope)
  ) {
    throw new Error("허용되지 않은 로컬 폴더 범위야.");
  }

  return config.scopeRoots[scope];
}

function assertNotProtected(config, candidate, operation) {
  if (config.systemRoots.some((root) => isPathInside(candidate, root))) {
    throw new Error("시스템 폴더는 로컬 작업 대상이 될 수 없어.");
  }

  const relativeProjectPath = path.relative(config.projectRoot, candidate);
  const segments = candidate
    .split(/[\\/]+/u)
    .map((segment) => segment.toLowerCase());
  const baseName = path.basename(candidate).toLowerCase();

  if (
    segments.includes(".git") ||
    segments.includes(".ssh") ||
    segments.includes(".gnupg") ||
    segments.some((segment) =>
      /^(?:credentials?|passwords?|passwd|secrets?)$/iu.test(segment),
    ) ||
    baseName.startsWith(".env") ||
    /(?:credential|password|passwd|secret)/iu.test(baseName)
  ) {
    throw new Error("보호된 설정 또는 자격 증명 파일은 조작할 수 없어.");
  }

  if (
    operation !== "search" &&
    (relativeProjectPath === "" || relativeProjectPath === ".")
  ) {
    throw new Error("L-AI 프로젝트 루트는 조작할 수 없어.");
  }
}

export async function resolveAllowedFile(
  config,
  candidate,
  { allowExecutable = false, operation = "read" } = {},
) {
  if (
    typeof candidate !== "string" ||
    !candidate.trim() ||
    candidate.length > 4096 ||
    !path.isAbsolute(candidate)
  ) {
    throw new Error("절대 경로 형식의 파일 경로가 필요해.");
  }

  const requestedPath = path.resolve(candidate);
  const requestedStat = await fs.lstat(requestedPath);

  if (requestedStat.isSymbolicLink()) {
    throw new Error("심볼릭 링크 파일은 조작할 수 없어.");
  }

  if (!requestedStat.isFile()) {
    throw new Error("일반 파일만 조작할 수 있어.");
  }

  const realPath = await fs.realpath(requestedPath);
  const allowed = Object.values(config.scopeRoots).some((root) =>
    isPathInside(realPath, root),
  );

  if (!allowed) {
    throw new Error("허용된 사용자 폴더 밖의 파일은 조작할 수 없어.");
  }

  assertNotProtected(config, realPath, operation);

  if (
    !allowExecutable &&
    EXECUTABLE_EXTENSIONS.has(path.extname(realPath).toLowerCase())
  ) {
    throw new Error("실행 가능한 파일은 일반 파일 열기로 실행할 수 없어.");
  }

  return realPath;
}

export async function createSafeDestination(
  config,
  sourcePath,
  destinationScope,
  newName = path.basename(sourcePath),
) {
  const safeName = validateFileName(newName);
  const root = getScopeRoot(config, destinationScope);
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root);
  const destination = path.resolve(realRoot, safeName);

  if (!isPathInside(destination, realRoot)) {
    throw new Error("대상 경로가 허용된 폴더를 벗어났어.");
  }

  assertNotProtected(config, destination, "write");

  try {
    await fs.access(destination);
    throw new Error("대상 폴더에 같은 이름의 파일이 이미 있어. 덮어쓰지 않았어.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("같은 이름")) {
      throw error;
    }
  }

  return destination;
}

export async function createSafeSiblingDestination(
  config,
  sourcePath,
  newName,
) {
  const safeName = validateFileName(newName);
  const parent = await fs.realpath(path.dirname(sourcePath));
  const destination = path.resolve(parent, safeName);

  if (!isPathInside(destination, parent)) {
    throw new Error("새 파일 이름이 현재 폴더를 벗어났어.");
  }

  const allowed = Object.values(config.scopeRoots).some((root) =>
    isPathInside(destination, root),
  );
  if (!allowed) {
    throw new Error("허용된 사용자 폴더 밖으로 이름을 변경할 수 없어.");
  }

  assertNotProtected(config, destination, "rename");

  try {
    await fs.access(destination);
    throw new Error("같은 이름의 파일이 이미 있어. 덮어쓰지 않았어.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("같은 이름")) {
      throw error;
    }
  }

  return destination;
}

export async function toFileInfo(filePath) {
  const stat = await fs.stat(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    extension: path.extname(filePath).toLowerCase(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}
