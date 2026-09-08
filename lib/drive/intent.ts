import type { DriveSearchIntent } from "./types";

const DRIVE_CONTEXT_PATTERN =
  /(?:내\s*)?(?:구글\s*)?드라이브|google\s*drive/iu;

const FILE_CONTEXT_PATTERN =
  /(?:파일|문서|pdf|pptx|docx|xlsx|드라이브)/iu;

const RECENT_FILE_PATTERN =
  /(?:최근|최근에|최신).*(?:수정|업데이트|파일|문서)|(?:최근\s*수정한?\s*(?:파일|문서))/u;

const SUMMARY_PATTERN =
  /(?:요약해\s*줘|요약해줘|요약\s*해줘|요약해|요약|내용\s*요약)/u;

const COMPARE_PATTERN =
  /(?:비교해\s*줘|비교해줘|비교해|차이점|차이\s*알려|차이\s*정리)/u;

const COMBINE_PATTERN =
  /(?:같이\s*읽|한꺼번에\s*읽|모아서|종합해|종합\s*해|합쳐서|통합해서|전체\s*읽)/u;

const QUESTION_END_PATTERN =
  /(?:알려\s*줘|알려줘|말해\s*줘|말해줘|뽑아\s*줘|뽑아줘|정리해\s*줘|정리해줘|찾아\s*줘|찾아줘|뭐야|언제야|누구야|어디야|어때|있어)/u;

const SEARCH_COMMAND_PATTERN =
  /\s*(?:찾아\s*줘|찾아줘|검색해\s*줘|검색해줘|보여\s*줘|보여줘|있어)\s*[?.!。！？]*$/u;

const SUMMARY_COMMAND_PATTERN =
  /\s*(?:찾아서\s*)?(?:내용을?\s*)?(?:요약해\s*줘|요약해줘|요약\s*해줘|요약해|요약)\s*[?.!。！？]*$/u;

function removeDriveContext(message: string) {
  return message
    .replace(/(?:내\s*)?(?:구글\s*)?드라이브|google\s*drive/giu, " ")
    .replace(/^\s*(?:에서|에|있는)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeFileQuery(query: string) {
  return query
    .replace(/^\s*(?:에서|에)\s*/u, "")
    .replace(/\s*(?:파일|문서)\s*$/u, "")
    .replace(/^[\s,'"]+|[\s,?'".!。！？]+$/gu, "")
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

function extractExplicitFileNames(message: string) {
  const cleaned = removeDriveContext(message);

  const matches = cleaned.match(
    /[^,\s]+?\.(?:pdf|pptx|docx|xlsx|csv|txt)/giu,
  );

  if (!matches) {
    return [];
  }

  return [...new Set(matches.map((name) => normalizeFileQuery(name)))];
}

function parseDriveCompare(message: string) {
  if (!COMPARE_PATTERN.test(message)) {
    return null;
  }

  const explicitFiles = extractExplicitFileNames(message);

  if (explicitFiles.length >= 2) {
    return {
      queries: explicitFiles.slice(0, 2),
      compareQuestion: "두 파일의 핵심 내용과 차이점을 비교해줘.",
    };
  }

  let cleaned = removeDriveContext(message);

  cleaned = cleaned
    .replace(
      /\s*(?:두\s*(?:파일|문서)(?:을|를)?\s*)?(?:비교해\s*줘|비교해줘|비교해|차이점(?:을)?\s*알려\s*줘|차이\s*알려\s*줘|차이\s*정리해\s*줘)\s*[?.!。！？]*$/u,
      "",
    )
    .trim();

  const match = cleaned.match(
    /^(.+?)\s*(?:랑|이랑|와|과|하고|그리고|vs\.?|VS)\s*(.+)$/u,
  );

  if (!match) {
    return null;
  }

  const first = normalizeFileQuery(match[1]);
  const second = normalizeFileQuery(match[2]);

  if (!first || !second) {
    return null;
  }

  return {
    queries: [first, second],
    compareQuestion: "두 파일의 핵심 내용과 차이점을 비교해줘.",
  };
}

function parseDriveCombine(message: string) {
  const explicitFiles = extractExplicitFileNames(message);

  const wantsCombine =
    COMBINE_PATTERN.test(message) ||
    explicitFiles.length >= 3;

  if (!wantsCombine || explicitFiles.length < 2) {
    return null;
  }

  let combineQuestion = "여러 파일의 핵심 내용을 하나로 종합해서 정리해줘.";

  if (/일정/u.test(message)) {
    combineQuestion =
      "여러 파일에서 일정, 날짜, 행사, 해야 할 일을 모아서 하나로 종합해줘.";
  } else if (/담당자|누가|인물/u.test(message)) {
    combineQuestion =
      "여러 파일에서 담당자와 역할 관련 내용을 모아서 정리해줘.";
  } else if (/차이|비교/u.test(message)) {
    combineQuestion =
      "여러 파일의 공통점과 차이점을 함께 정리해줘.";
  } else if (/중요|핵심/u.test(message)) {
    combineQuestion =
      "여러 파일에서 가장 중요한 핵심 내용만 모아서 정리해줘.";
  }

  return {
    queries: explicitFiles,
    combineQuestion,
  };
}

function parseDriveQuestion(message: string) {
  const cleaned = removeDriveContext(message);

  const patterns = [
    /^(.+?\.(?:pdf|txt|xlsx|csv|docx|pptx))\s*(?:파일을?\s*)?(?:찾아서|찾고|열어서|읽어서|에서)\s*(.+)$/iu,

    /^(.+?)\s+(?:파일|문서)(?:에서|을\s*찾아서|를\s*찾아서|에서\s*)\s*(.+)$/iu,

    /^(.+?)(?:에서)\s+(.+)$/iu,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);

    if (!match) continue;

    const query = normalizeFileQuery(match[1]);
    const question = match[2].trim();

    if (!query || !question) continue;

    if (
      !QUESTION_END_PATTERN.test(question) &&
      question.length < 3
    ) {
      continue;
    }

    return {
      query,
      question,
    };
  }

  return null;
}

export function parseDriveSearchIntent(
  message: string,
): DriveSearchIntent | null {
  const hasDriveContext =
    DRIVE_CONTEXT_PATTERN.test(message);

  const hasFileContext =
    FILE_CONTEXT_PATTERN.test(message);

  if (!hasDriveContext && !hasFileContext) {
    return null;
  }

  if (RECENT_FILE_PATTERN.test(message)) {
    return {
      action: "recent",
      query: null,
    };
  }

  // 여러 파일 종합
  const combine = parseDriveCombine(message);

  if (combine) {
    return {
      action: "combine",
      query: null,
      queries: combine.queries,
      combineQuestion: combine.combineQuestion,
    };
  }

  // 두 파일 비교
  const compare = parseDriveCompare(message);

  if (compare) {
    return {
      action: "compare",
      query: null,
      queries: compare.queries,
      compareQuestion: compare.compareQuestion,
    };
  }

  if (SUMMARY_PATTERN.test(message)) {
    const query = cleanDriveQuery(message);

    return {
      action: "summarize",
      query:
        query &&
        query !== "파일" &&
        query !== "문서"
          ? normalizeFileQuery(query)
          : null,
    };
  }

  const question = parseDriveQuestion(message);

  if (question) {
    return {
      action: "ask",
      query: question.query,
      question: question.question,
    };
  }

  const query = cleanDriveQuery(message);

  return {
    action: "search",
    query:
      query &&
      query !== "파일" &&
      query !== "문서"
        ? normalizeFileQuery(query)
        : null,
  };
}