export type MailFollowUpAction =
  | "read"
  | "summary"
  | "calendar"
  | "drive"
  | "reply_draft"
  | "forward_draft"
  | "send";

const ORDINAL_INDEXES: Record<string, number> = {
  첫번째: 0,
  첫째: 0,
  두번째: 1,
  둘째: 1,
  세번째: 2,
  셋째: 2,
  네번째: 3,
  넷째: 3,
  다섯번째: 4,
  다섯째: 4,
};

export function parseMailSelectionIndex(
  message: string,
  count: number,
) {
  const normalized = message
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .replace(/\s+/gu, "");

  const numeric = /^(\d+)번?(?:메일)?(?:열어줘|열어|보여줘|보여|읽어줘|읽어|선택)?$/u.exec(
    normalized,
  );
  const ordinal = /^((?:첫|두|세|네|다섯)(?:번째|째))(?:메일)?(?:열어줘|열어|보여줘|보여|읽어줘|읽어|선택)?$/u.exec(
    normalized,
  );

  const index = numeric
    ? Number(numeric[1]) - 1
    : ordinal
      ? ORDINAL_INDEXES[ordinal[1]]
      : null;

  return Number.isInteger(index) && index! >= 0 && index! < count
    ? index
    : null;
}

export function parseDirectMailSearchQuery(message: string) {
  if (
    !/(?:메일|받은편지함|보낸편지함|메일함)/u.test(message) ||
    !/(?:찾아|검색|보여)/u.test(message) ||
    /(?:그\s*메일|이\s*메일|아까\s*메일)/u.test(message)
  ) {
    return null;
  }

  const query = message
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .replace(/^(?:내\s*)?(?:L-JMAIL|엘제이메일|메일함|받은편지함|보낸편지함)(?:에서|에)?\s*/iu, "")
    .replace(/^(?:내\s*)?(?:메일에서|메일에|메일)\s*/u, "")
    .replace(/(?:에서\s*)?(?:온|보낸)\s*메일\s*(?:좀\s*)?(?:찾아|검색|보여)(?:줘|주세요)?$/u, "")
    .replace(/(?:관련(?:된)?\s*)?메일\s*(?:좀\s*)?(?:찾아|검색|보여)(?:줘|주세요)?$/u, "")
    .replace(/메일\s*(?:좀\s*)?(?:찾아|검색|보여)(?:줘|주세요)?$/u, "")
    .trim();

  return query || null;
}

export function getMailFollowUpAction(
  message: string,
): MailFollowUpAction | null {
  const referencesMail =
    /(?:그\s*메일|이\s*메일|아까\s*메일|방금\s*메일|메일에|메일에서)/u.test(
      message,
    );

  if (/^(?:(?:메일|답장|전달)\s*)?(?:전송|전송해|전송해줘|보내|보내줘)$/u.test(message.trim())) {
    return "send";
  }

  if (!referencesMail) return null;

  if (/(?:전달|포워드).*(?:초안|작성|해줘|만들)/u.test(message)) {
    return "forward_draft";
  }

  if (/(?:답장|회신).*(?:초안|작성|써|만들)/u.test(message)) {
    return "reply_draft";
  }

  if (
    /(?:일정|회의).*(?:찾아|추출|캘린더|달력|추가|등록|넣어)|(?:캘린더|달력).*(?:추가|등록|넣어)/u.test(
      message,
    )
  ) {
    return "calendar";
  }

  if (/(?:관련|언급|첨부).*(?:파일|문서|자료).*(?:찾아|검색|보여)/u.test(message)) {
    return "drive";
  }

  if (/(?:요약|정리)/u.test(message)) return "summary";
  if (/(?:열어|보여|읽어|내용|다시)/u.test(message)) return "read";

  return null;
}

export function isCalendarMailDraftRequest(message: string) {
  return /(?:(?:그\s*)?일정\s*(?:내용)?|회의\s*내용)(?:으로|을|에\s*관한)?.*(?:메일).*(?:초안|작성|써|만들)/u.test(
    message,
  );
}

export function isDriveMailDraftRequest(message: string) {
  return /(?:그\s*파일|그\s*문서|아까\s*파일|방금\s*파일).*(?:메일).*(?:초안|작성|써|만들|보내)/u.test(
    message,
  );
}

export function isGenericMailDraftRequest(message: string) {
  return /(?:메일|이메일).*(?:초안|작성|써\s*줘|만들)/u.test(message);
}
