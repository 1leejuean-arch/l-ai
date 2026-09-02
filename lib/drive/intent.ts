import type { DriveSearchIntent } from "./types";

const DRIVE_CONTEXT_PATTERN =
  /(?:내\s*)?(?:구글\s*)?드라이브|google\s*drive/iu;
const FILE_SEARCH_CONTEXT_PATTERN = /(?:파일|문서).*(?:찾아|검색|보여|있어)/u;
const SEARCH_COMMAND_PATTERN =
  /\s*(?:찾아\s*줘|찾아줘|검색해\s*줘|검색해줘|보여\s*줘|보여줘|있어)\s*[?.!。！？]*$/u;

function cleanDriveQuery(message: string) {
  return message
    .replace(/(?:내\s*)?(?:구글\s*)?드라이브|google\s*drive/giu, " ")
    .replace(/^\s*(?:에서|에)\s*/u, "")
    .replace(SEARCH_COMMAND_PATTERN, "")
    .replace(/\s+(?:관련\s*)?(?:파일|문서)(?:을|를)?\s*$/u, "")
    .replace(/^[\s'"]+|[\s?'".!。！？]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseDriveSearchIntent(
  message: string,
): DriveSearchIntent | null {
  if (
    !DRIVE_CONTEXT_PATTERN.test(message) &&
    !FILE_SEARCH_CONTEXT_PATTERN.test(message)
  ) {
    return null;
  }

  const query = cleanDriveQuery(message);
  return { query: query && query !== "파일" && query !== "문서" ? query : null };
}
