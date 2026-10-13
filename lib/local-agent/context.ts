import "server-only";

import type { LocalFileInfo } from "./types";

type LocalFileContext = {
  recentQuery: string;
  results: LocalFileInfo[];
  selectedFile: LocalFileInfo | null;
  updatedAt: number;
};

const CONTEXT_TTL_MS = 60 * 60 * 1000;

const globalLocalContext = globalThis as typeof globalThis & {
  lAiLocalFileContexts?: Map<string, LocalFileContext>;
};

const contexts =
  globalLocalContext.lAiLocalFileContexts ??
  new Map<string, LocalFileContext>();

globalLocalContext.lAiLocalFileContexts = contexts;

export function saveLocalFileSearch(
  sessionId: string,
  recentQuery: string,
  results: LocalFileInfo[],
) {
  contexts.set(sessionId, {
    recentQuery,
    results: results.slice(0, 20),
    selectedFile: results.length === 1 ? results[0] : null,
    updatedAt: Date.now(),
  });
}

export function getLocalFileContext(sessionId: string) {
  const context = contexts.get(sessionId);
  if (!context) return null;

  if (Date.now() - context.updatedAt > CONTEXT_TTL_MS) {
    contexts.delete(sessionId);
    return null;
  }

  return context;
}

export function selectLocalFile(sessionId: string, index: number) {
  const context = getLocalFileContext(sessionId);
  const file = context?.results[index] ?? null;
  if (!context || !file) return null;

  contexts.set(sessionId, {
    ...context,
    selectedFile: file,
    updatedAt: Date.now(),
  });

  return file;
}

export function updateSelectedLocalFile(
  sessionId: string,
  previousPath: string,
  nextFile: LocalFileInfo,
) {
  const context = getLocalFileContext(sessionId);
  if (!context) return;

  contexts.set(sessionId, {
    ...context,
    results: context.results.map((file) =>
      file.path === previousPath ? nextFile : file,
    ),
    selectedFile: nextFile,
    updatedAt: Date.now(),
  });
}

export function removeLocalFile(
  sessionId: string,
  path: string,
) {
  const context = getLocalFileContext(sessionId);
  if (!context) return;

  contexts.set(sessionId, {
    ...context,
    results: context.results.filter((file) => file.path !== path),
    selectedFile:
      context.selectedFile?.path === path
        ? null
        : context.selectedFile,
    updatedAt: Date.now(),
  });
}
