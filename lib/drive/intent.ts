import type { DriveSearchIntent } from "./types";

const DRIVE_CONTEXT_PATTERN =
  /(?:내\s*)?(?:구글\s*)?드라이브|google\s*drive/iu;

const FILE_SEARCH_CONTEXT_PATTERN =
  /(?:파일|문서).*(?:찾아|검색|보여|있어|알려|요약)/u;

const RECENT_FILE_PATTERN =
  /(?:최근|최근에|최신).*(?:수정|업데이트|파일|문서)|(?:최근\s*수정한?\s*(?:파일|문서))/u;

const SUMMARY_PATTERN =
  /(?:요약해\s*줘|요약해줘|요약\s*해줘|요약해|요약|내용\s*요약|정리해\s*줘|정리해줘)/u;

const QUESTION_PATTERN =
  /(?:찾아서|찾고|열어서|읽어서).*(?:알려\s*줘|알려줘|말해\s*줘|말해줘|뭐야|어때|언제야|누구야|어디야)/u;

const SEARCH_COMMAND_PATTERN =
  /\s*(?:찾아\s*줘|찾아줘|검색해\s*줘|검색해줘|보여\s*줘|보여줘|있어)\s*[?.!。！？]*$/u;

const SUMMARY_COMMAND_PATTERN =
  /\s*(?:찾아서\s*)?(?:내용을?\s*)?(?:요약해\s*줘|요약해줘|요약\s*해줘|요약해|요약|정리해\s*줘|정리해줘)\s*[?.!。！？]*$/u;

function removeDriveContext(message: string) {
  return message
    .replace(/(?:내\s*)?(?:구글\s*)?드라이브|google\s*drive/giu, " ")
    .replace(/^\s*(?:에서|에)\s*/u, "")
    .trim();
}

function cleanDriveQuery(message: string) {
  return removeDriveContext(message)
    .replace(SUMMARY_COMMAND_PATTERN, "")
    .replace(SEARCH_COMMAND_PATTERN, "")
    .replace(/\s+(?:관련\s*)?(?:파일|문서)(?:을|를)?\s*$/u, "")
    .replace(/^[\s'"]+|[\s?'".!。！？]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseDriveQuestion(message: string) {
  const cleaned = removeDriveContext(message);

  const match = cleaned.match(
    /^(.+?\.(?:pdf|txt|xlsx|csv|docx|pptx))\s*(?:파일을?\s*)?(?:찾아서|찾고|열어서|읽어서)\s*(.+)$/iu,
  );

  if (!match) {
    return null;
  }

  return {
    query: match[1].trim(),
    question: match[2].trim(),
  };
}

export function parseDriveSearchIntent(
  message: string,
): DriveSearchIntent | null {
  const hasDriveContext = DRIVE_CONTEXT_PATTERN.test(message);
  const hasFileSearchContext = FILE_SEARCH_CONTEXT_PATTERN.test(message);

  if (!hasDriveContext && !hasFileSearchContext) {
    return null;
  }

  if (RECENT_FILE_PATTERN.test(message)) {
    return {
      action: "recent",
      query: null,
    };
  }

  if (SUMMARY_PATTERN.test(message)) {
    const query = cleanDriveQuery(message);

    return {
      action: "summarize",
      query:
        query && query !== "파일" && query !== "문서"
          ? query
          : null,
    };
  }

  if (QUESTION_PATTERN.test(message)) {
    const parsed = parseDriveQuestion(message);

    if (parsed) {
      return {
        action: "ask",
        query: parsed.query,
        question: parsed.question,
      };
    }
  }

  const query = cleanDriveQuery(message);

  return {
    action: "search",
    query:
      query && query !== "파일" && query !== "문서"
        ? query
        : null,
  };
}