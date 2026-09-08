export type DriveCalendarCommand = {
  query: string | null;
};

const CALENDAR_COMMAND_PATTERN =
  /(?:일정|스케줄).*(?:찾아|추출|뽑아|캘린더|달력)|(?:캘린더|달력).*(?:추가|등록|넣어)/u;

const FILE_PATTERN =
  /([^,\n]+?\.(?:pdf|pptx|docx|xlsx))/iu;

export function parseDriveCalendarCommand(
  message: string,
): DriveCalendarCommand | null {
  if (!CALENDAR_COMMAND_PATTERN.test(message)) {
    return null;
  }

  const fileMatch = message.match(FILE_PATTERN);

  if (fileMatch) {
    return {
      query: fileMatch[1]
        .replace(
          /^(?:내\s*)?(?:구글\s*)?드라이브(?:에서|에)?\s*/u,
          "",
        )
        .trim(),
    };
  }

  if (
    /(?:그\s*파일|그\s*문서|거기|거기서|그중|이\s*파일|이\s*문서)/u.test(
      message,
    )
  ) {
    return {
      query: null,
    };
  }

  return null;
}