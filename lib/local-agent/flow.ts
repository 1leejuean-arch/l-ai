import "server-only";

import { saveLastAction } from "@/lib/memory/action";

import {
  callLocalAgent,
  LocalAgentConfigurationError,
  LocalAgentUnavailableError,
} from "./client";
import {
  getLocalFileContext,
  removeLocalFile,
  saveLocalFileSearch,
  selectLocalFile,
  updateSelectedLocalFile,
} from "./context";
import {
  isLocalConfirmationReply,
  parseLocalIntent,
} from "./intent";
import {
  clearPendingLocalAction,
  getPendingLocalAction,
  setPendingLocalAction,
} from "./pending";
import type {
  LocalActionName,
  LocalAppId,
  LocalAppCloseResult,
  LocalFileInfo,
  LocalFileScope,
  LocalIntent,
  LocalPendingAction,
} from "./types";

const APP_LABELS: Record<LocalAppId, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  vscode: "VS Code",
  explorer: "파일 탐색기",
  notepad: "메모장",
  calculator: "계산기",
};

const SCOPE_LABELS: Record<LocalFileScope, string> = {
  Desktop: "바탕화면",
  Documents: "문서",
  Downloads: "다운로드",
  Pictures: "사진",
  Videos: "동영상",
  Music: "음악",
  Project: "L-AI 프로젝트",
};

const SCOPE_DESTINATION_LABELS: Record<LocalFileScope, string> = {
  Desktop: "바탕화면으로",
  Documents: "문서 폴더로",
  Downloads: "다운로드 폴더로",
  Pictures: "사진 폴더로",
  Videos: "동영상 폴더로",
  Music: "음악 폴더로",
  Project: "L-AI 프로젝트 폴더로",
};

function localAgentErrorMessage(error: unknown) {
  if (
    error instanceof LocalAgentConfigurationError ||
    error instanceof LocalAgentUnavailableError
  ) {
    return [
      "현재 Windows Local Agent에 연결할 수 없어.",
      "PC 제어 기능을 사용하려면 Local Agent를 실행하고 로컬 토큰 설정을 확인해줘.",
    ].join("\n");
  }

  return error instanceof Error
    ? error.message
    : "Windows Local Agent 작업에 실패했어.";
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatModifiedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "알 수 없음";

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatSearchResults(
  scope: LocalFileScope,
  files: LocalFileInfo[],
  truncated: boolean,
) {
  if (files.length === 0) {
    return `${SCOPE_LABELS[scope]}에서 조건에 맞는 파일을 찾지 못했어.`;
  }

  const lines = files.map((file, index) =>
    [
      `${index + 1}. ${file.name}`,
      `경로: ${file.path}`,
      `형식: ${file.extension || "확장자 없음"}`,
      `크기: ${formatSize(file.size)}`,
      `수정: ${formatModifiedAt(file.modifiedAt)}`,
    ].join("  \n"),
  );

  return [
    `${SCOPE_LABELS[scope]}에서 파일 ${files.length}개를 찾았어${truncated ? " (상위 결과만 표시)" : ""}.`,
    "",
    ...lines.flatMap((line) => [line, ""]),
    '원하는 파일을 "1번 열어줘" 또는 "1번 파일 탐색기에서 보여줘"라고 말해줘.',
  ].join("\n");
}

function getSelectedFile(
  sessionId: string,
  selectionIndex: number | null = null,
) {
  if (selectionIndex !== null) {
    return selectLocalFile(sessionId, selectionIndex);
  }

  return getLocalFileContext(sessionId)?.selectedFile ?? null;
}

function pendingConfirmation(action: LocalPendingAction) {
  if (action.action === "app.close") {
    return [
      `${APP_LABELS[action.app]}을 종료할까요?`,
      "열려 있는 작업이 저장되지 않았을 수 있어.",
      "",
      "확인 / 취소",
    ].join("\n");
  }

  if (action.action === "file.rename") {
    const currentExtension = action.file.extension.toLowerCase();
    const dot = action.newName.lastIndexOf(".");
    const nextExtension = dot >= 0
      ? action.newName.slice(dot).toLowerCase()
      : "";
    const extensionWarning = currentExtension !== nextExtension
      ? "\n확장자가 변경돼 파일을 열지 못할 수 있어."
      : "";

    return [
      `'${action.file.name}'의 이름을 '${action.newName}'으로 바꿀까요?${extensionWarning}`,
      "",
      "확인 / 취소",
    ].join("\n");
  }

  if (action.action === "file.move" || action.action === "file.copy") {
    const verb = action.action === "file.move" ? "옮길까요" : "복사할까요";
    return [
      `'${action.file.name}'을 ${SCOPE_DESTINATION_LABELS[action.destinationScope]} ${verb}?`,
      "같은 이름의 파일이 있으면 덮어쓰지 않고 중단해.",
      "",
      "확인 / 취소",
    ].join("\n");
  }

  return [
    `'${action.file.name}'을 Windows 휴지통으로 이동할까요?`,
    "영구 삭제는 하지 않아.",
    "",
    "확인 / 취소",
  ].join("\n");
}

async function saveLocalAction(
  sessionId: string,
  type:
    | "local_app_open"
    | "local_app_close"
    | "local_browser_open"
    | "local_file_search"
    | "local_file_open"
    | "local_file_reveal"
    | "local_file_rename"
    | "local_file_move"
    | "local_file_copy"
    | "local_file_delete",
  label: string,
  data?: Record<string, unknown>,
) {
  await saveLastAction(sessionId, { type, label, data });
}

async function executePendingAction(
  sessionId: string,
  pending: LocalPendingAction,
) {
  if (pending.action === "app.close") {
    const result = await callLocalAgent<LocalAppCloseResult>({
      action: "app.close",
      input: { app: pending.app },
    });

    if (result.status === "not_running") {
      return `${APP_LABELS[pending.app]}가 현재 실행 중이지 않아.`;
    }

    if (result.status === "failed") {
      return `${APP_LABELS[pending.app]} 종료 요청을 보냈지만 아직 실행 중이야.`;
    }

    await saveLocalAction(
      sessionId,
      "local_app_close",
      `${APP_LABELS[pending.app]} 종료`,
      { app: pending.app },
    );
    return `${APP_LABELS[pending.app]}를 종료했어.`;
  }

  if (pending.action === "file.rename") {
    const renamed = await callLocalAgent<LocalFileInfo>({
      action: "file.rename",
      input: {
        path: pending.file.path,
        newName: pending.newName,
      },
    });
    updateSelectedLocalFile(sessionId, pending.file.path, renamed);
    await saveLocalAction(
      sessionId,
      "local_file_rename",
      `${pending.file.name} → ${renamed.name} 이름 변경`,
      { fileName: renamed.name },
    );
    return `'${renamed.name}'으로 이름을 바꿨어.`;
  }

  if (pending.action === "file.move") {
    const moved = await callLocalAgent<LocalFileInfo>({
      action: "file.move",
      input: {
        path: pending.file.path,
        destinationScope: pending.destinationScope,
      },
    });
    updateSelectedLocalFile(sessionId, pending.file.path, moved);
    await saveLocalAction(
      sessionId,
      "local_file_move",
      `${pending.file.name} ${SCOPE_LABELS[pending.destinationScope]} 이동`,
      { fileName: moved.name, destination: pending.destinationScope },
    );
    return `'${moved.name}'을 ${SCOPE_DESTINATION_LABELS[pending.destinationScope]} 옮겼어.`;
  }

  if (pending.action === "file.copy") {
    const copied = await callLocalAgent<LocalFileInfo>({
      action: "file.copy",
      input: {
        path: pending.file.path,
        destinationScope: pending.destinationScope,
      },
    });
    await saveLocalAction(
      sessionId,
      "local_file_copy",
      `${pending.file.name} ${SCOPE_LABELS[pending.destinationScope]} 복사`,
      { fileName: copied.name, destination: pending.destinationScope },
    );
    return `'${copied.name}'을 ${SCOPE_LABELS[pending.destinationScope]}에 복사했어. 원본은 그대로 있어.`;
  }

  await callLocalAgent({
    action: "file.delete",
    input: { path: pending.file.path },
  });
  removeLocalFile(sessionId, pending.file.path);
  await saveLocalAction(
    sessionId,
    "local_file_delete",
    `${pending.file.name} 휴지통 이동`,
    { fileName: pending.file.name },
  );
  return `'${pending.file.name}'을 Windows 휴지통으로 이동했어.`;
}

export async function handlePendingLocalAction(
  sessionId: string,
  message: string,
) {
  const pending = getPendingLocalAction(sessionId);
  if (!pending) return null;

  const reply = isLocalConfirmationReply(message);
  if (!reply) return null;

  if (reply === "reject") {
    clearPendingLocalAction(sessionId);
    return "알겠어. 로컬 PC 작업을 취소했어.";
  }

  try {
    const result = await executePendingAction(sessionId, pending);
    clearPendingLocalAction(sessionId);
    return result;
  } catch (error) {
    return localAgentErrorMessage(error);
  }
}

function startPending(
  sessionId: string,
  action: LocalPendingAction,
) {
  setPendingLocalAction(sessionId, action);
  return pendingConfirmation(action);
}

async function executeLowRiskIntent(
  sessionId: string,
  intent: LocalIntent,
) {
  if (intent.action === "app.open") {
    console.log("[L-AI Local] app.open", { app: intent.app });
    await callLocalAgent({ action: "app.open", input: { app: intent.app } });
    await saveLocalAction(
      sessionId,
      "local_app_open",
      `${APP_LABELS[intent.app]} 실행`,
      { app: intent.app },
    );
    return `${APP_LABELS[intent.app]}을 열었어.`;
  }

  if (intent.action === "browser.open" || intent.action === "browser.search") {
    console.log("[L-AI Local] browser", { action: intent.action });
    await callLocalAgent({
      action: intent.action,
      input: { url: intent.url },
    });
    await saveLocalAction(
      sessionId,
      "local_browser_open",
      intent.label,
      { action: intent.action },
    );
    return `${intent.label} 창을 열었어.`;
  }

  if (intent.action === "file.search") {
    const result = await callLocalAgent<{
      files: LocalFileInfo[];
      truncated: boolean;
    }>({
      action: "file.search",
      input: {
        scope: intent.scope,
        query: intent.query,
        extension: intent.extension,
        limit: 10,
      },
    });

    saveLocalFileSearch(
      sessionId,
      intent.query || intent.extension || "파일",
      result.files,
    );
    console.log("[L-AI Local] file.search", {
      scope: intent.scope,
      query: intent.query,
      count: result.files.length,
    });
    await saveLocalAction(
      sessionId,
      "local_file_search",
      `${SCOPE_LABELS[intent.scope]} 파일 검색`,
      {
        scope: intent.scope,
        query: intent.query,
        resultCount: result.files.length,
      },
    );
    return formatSearchResults(intent.scope, result.files, result.truncated);
  }

  if (intent.action === "file.open" || intent.action === "file.reveal") {
    const file = getSelectedFile(sessionId, intent.selectionIndex);
    if (!file) {
      return "먼저 허용된 로컬 폴더에서 파일을 검색하고 번호로 선택해줘.";
    }

    await callLocalAgent({
      action: intent.action,
      input: { path: file.path },
    });
    await saveLocalAction(
      sessionId,
      intent.action === "file.open"
        ? "local_file_open"
        : "local_file_reveal",
      `${file.name} ${intent.action === "file.open" ? "열기" : "위치 보기"}`,
      { fileName: file.name },
    );
    return intent.action === "file.open"
      ? `'${file.name}'을 기본 연결 프로그램으로 열었어.`
      : `'${file.name}' 위치를 파일 탐색기에서 열었어.`;
  }

  return null;
}

export async function handleLocalAction(
  sessionId: string,
  message: string,
) {
  const intent = parseLocalIntent(message);
  if (!intent) return null;

  console.log("[L-AI Fast Path] Local action", {
    action: intent.action satisfies LocalActionName,
  });

  if (intent.action === "app.close") {
    return startPending(sessionId, {
      action: "app.close",
      app: intent.app,
    });
  }

  if (
    intent.action === "file.rename" ||
    intent.action === "file.move" ||
    intent.action === "file.copy" ||
    intent.action === "file.delete"
  ) {
    const file = getSelectedFile(
      sessionId,
      "selectionIndex" in intent ? intent.selectionIndex : null,
    );

    if (!file) {
      return "먼저 허용된 로컬 폴더에서 파일을 검색하고 번호로 선택해줘.";
    }

    if (intent.action === "file.rename") {
      return startPending(sessionId, {
        action: "file.rename",
        file,
        newName: intent.newName,
      });
    }

    if (intent.action === "file.move" || intent.action === "file.copy") {
      return startPending(sessionId, {
        action: intent.action,
        file,
        destinationScope: intent.destinationScope,
      });
    }

    return startPending(sessionId, {
      action: "file.delete",
      file,
    });
  }

  try {
    return await executeLowRiskIntent(sessionId, intent);
  } catch (error) {
    return localAgentErrorMessage(error);
  }
}
