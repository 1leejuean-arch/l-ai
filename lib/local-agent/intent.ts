import type {
  LocalAppId,
  LocalFileScope,
  LocalIntent,
} from "./types";

const APP_ALIASES: Array<{
  app: LocalAppId;
  pattern: RegExp;
}> = [
  { app: "chrome", pattern: /(?:구글\s*)?크롬|chrome/iu },
  { app: "edge", pattern: /(?:마이크로소프트\s*)?엣지|edge/iu },
  { app: "vscode", pattern: /(?:vs\s*code|vscode|비주얼\s*스튜디오\s*코드|코드\s*에디터)/iu },
  { app: "explorer", pattern: /(?:파일\s*)?탐색기|explorer/iu },
  { app: "notepad", pattern: /메모장|notepad/iu },
  { app: "calculator", pattern: /계산기|calculator|calc/iu },
];

const SITE_ALIASES: Array<{
  label: string;
  pattern: RegExp;
  home: string;
  search?: (query: string) => string;
}> = [
  {
    label: "유튜브",
    pattern: /유튜브|youtube/iu,
    home: "https://www.youtube.com/",
    search: (query) =>
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  },
  {
    label: "네이버",
    pattern: /네이버|naver/iu,
    home: "https://www.naver.com/",
    search: (query) =>
      `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`,
  },
  {
    label: "구글",
    pattern: /구글|google/iu,
    home: "https://www.google.com/",
    search: (query) =>
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    label: "GitHub",
    pattern: /깃허브|github/iu,
    home: "https://github.com/",
  },
  {
    label: "ChatGPT",
    pattern: /챗지피티|chatgpt/iu,
    home: "https://chatgpt.com/",
  },
];

const SCOPE_ALIASES: Array<{
  scope: LocalFileScope;
  pattern: RegExp;
}> = [
  { scope: "Desktop", pattern: /바탕\s*화면|데스크톱|desktop/iu },
  {
    scope: "Documents",
    pattern: /(?:^|\s)문서(?:\s*폴더)?(?=\s*(?:에서|에|안|내부|$))|documents?/iu,
  },
  { scope: "Downloads", pattern: /다운로드(?:\s*폴더)?|downloads?/iu },
  { scope: "Pictures", pattern: /사진(?:\s*폴더)?|그림(?:\s*폴더)?|pictures?/iu },
  { scope: "Videos", pattern: /동영상(?:\s*폴더)?|videos?/iu },
  { scope: "Music", pattern: /음악(?:\s*폴더)?|music/iu },
  { scope: "Project", pattern: /(?:현재\s*)?(?:l-ai|엘에이아이)\s*프로젝트|프로젝트\s*폴더/iu },
];

const SEARCH_EXTENSIONS =
  /\b(pdf|docx?|xlsx?|pptx?|txt|md|csv|jpe?g|png|gif|webp|mp3|mp4|zip)\b/iu;

function findApp(message: string) {
  return APP_ALIASES.find(({ pattern }) => pattern.test(message))?.app ?? null;
}

function findSite(message: string) {
  return SITE_ALIASES.find(({ pattern }) => pattern.test(message)) ?? null;
}

function findScope(message: string) {
  return SCOPE_ALIASES.find(({ pattern }) => pattern.test(message))?.scope ?? null;
}

function parseSelectionIndex(message: string) {
  const match = /(?:^|\s)(\d+)\s*번/u.exec(message);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0
    ? number - 1
    : null;
}

function getSearchQuery(
  message: string,
  scope: LocalFileScope,
  extension: string | null,
) {
  let query = message;
  const scopeAlias = SCOPE_ALIASES.find((item) => item.scope === scope);

  if (scopeAlias) {
    query = query.replace(scopeAlias.pattern, " ");
  }

  if (extension) {
    query = query.replace(new RegExp(`\\b${extension.slice(1)}\\b`, "iu"), " ");
  }

  return query
    .replace(/(?:폴더|파일|문서|안|내부|에서|에|중|중에서|이름에|제목에|들어간|포함된)/gu, " ")
    .replace(/(?:찾아\s*줘|찾아줘|검색해\s*줘|검색해줘|검색|찾아|보여\s*줘|보여줘)/gu, " ")
    .replace(/["']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isLocalConfirmationReply(message: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[.!?。！？]+$/u, "");

  if (/^(?:ㅇㅇ|응|웅|어|그래|좋아|확인|진행|진행해|실행|해\s*줘|네|넵|예|ㄱㄱ|오케이|ok|okay)$/iu.test(normalized)) {
    return "approve" as const;
  }

  if (/^(?:취소|아니|아니야|아니요|안\s*해|하지\s*마|그만|ㄴㄴ|no)$/iu.test(normalized)) {
    return "reject" as const;
  }

  return null;
}

export function parseLocalIntent(message: string): LocalIntent | null {
  const normalized = message.trim();
  if (!normalized) return null;

  const app = findApp(normalized);
  if (app && /(?:닫아|꺼\s*줘|꺼줘|종료|끄기)/u.test(normalized)) {
    return { action: "app.close", app };
  }

  if (app && /(?:열어|실행|켜\s*줘|켜줘|시작)/u.test(normalized)) {
    return { action: "app.open", app };
  }

  const site = findSite(normalized);
  const referencesCloudFileDomain =
    /(?:구글\s*)?드라이브|google\s*drive|메일|받은\s*편지함|보낸\s*편지함/iu.test(
      normalized,
    );

  if (site && !referencesCloudFileDomain) {
    const searchMatch = /(?:에서|로)\s+(.+?)\s*(?:검색해\s*줘|검색해줘|검색|찾아\s*줘|찾아줘)$/u.exec(normalized);

    if (searchMatch && site.search) {
      const query = searchMatch[1].trim();
      if (query) {
        return {
          action: "browser.search",
          url: site.search(query),
          label: `${site.label}에서 '${query}' 검색`,
        };
      }
    }

    if (/(?:열어|접속|들어가|보여\s*줘|보여줘)/u.test(normalized)) {
      return {
        action: "browser.open",
        url: site.home,
        label: `${site.label} 열기`,
      };
    }
  }

  const directUrl = /(https?:\/\/[^\s]+)\s*(?:열어|접속|들어가)/iu.exec(normalized);
  if (directUrl) {
    try {
      const url = new URL(directUrl[1]);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return {
          action: "browser.open",
          url: url.toString(),
          label: `${url.hostname} 열기`,
        };
      }
    } catch {
      return null;
    }
  }

  const renameMatch = /(?:그|이|선택한)\s*파일(?:의)?\s*이름(?:을)?\s+(.+?)\s*(?:바꿔\s*줘|바꿔줘|변경해\s*줘|변경해줘)$/u.exec(normalized);
  if (renameMatch) {
    const newName = renameMatch[1].trim().replace(/(?:으로|로)$/u, "").trim();
    if (newName) return { action: "file.rename", newName };
  }

  const destinationScope = findScope(normalized);
  if (
    destinationScope &&
    /(?:그|이|선택한)\s*파일/u.test(normalized) &&
    /(?:옮겨|이동)/u.test(normalized)
  ) {
    return { action: "file.move", destinationScope };
  }

  if (
    destinationScope &&
    /(?:그|이|선택한)\s*파일/u.test(normalized) &&
    /(?:복사|복제)/u.test(normalized)
  ) {
    return { action: "file.copy", destinationScope };
  }

  const selectionIndex = parseSelectionIndex(normalized);
  if (
    /(?:그|이|선택한)\s*파일.*(?:삭제|지워)|(?:삭제|지워).*(?:그|이|선택한)\s*파일/u.test(normalized) ||
    (selectionIndex !== null && /(?:파일\s*)?(?:삭제|지워)/u.test(normalized))
  ) {
    return { action: "file.delete", selectionIndex };
  }

  if (
    /(?:탐색기에서\s*(?:보여|열어)|위치\s*(?:열어|보여)|폴더\s*(?:열어|보여))/u.test(normalized) &&
    (
      selectionIndex !== null ||
      /(?:그|이|선택한)\s*파일/u.test(normalized) ||
      /^폴더\s*(?:열어\s*줘|열어줘|보여\s*줘|보여줘)$/u.test(normalized)
    )
  ) {
    return { action: "file.reveal", selectionIndex };
  }

  if (
    /(?:열어\s*줘|열어줘|실행해\s*줘|실행해줘)$/u.test(normalized) &&
    (selectionIndex !== null || /(?:그|이|선택한)\s*파일/u.test(normalized))
  ) {
    return { action: "file.open", selectionIndex };
  }

  const searchScope = findScope(normalized);
  if (
    searchScope &&
    !referencesCloudFileDomain &&
    /(?:파일|문서|pdf|docx?|xlsx?|pptx?|txt|md|csv|jpe?g|png)/iu.test(normalized) &&
    /(?:찾아|검색|보여)/u.test(normalized)
  ) {
    const extensionMatch = SEARCH_EXTENSIONS.exec(normalized);
    const extension = extensionMatch
      ? `.${extensionMatch[1].toLowerCase()}`
      : null;

    return {
      action: "file.search",
      scope: searchScope,
      query: getSearchQuery(normalized, searchScope, extension),
      extension,
    };
  }

  return null;
}
