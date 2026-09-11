import "server-only";

import { callCalendarN8n } from "@/lib/calendar/n8n";

import {
  extractCalendarEventsFromDriveFile,
  formatDriveCalendarCandidates,
} from "./calendar-extract";

import {
  clearPendingDriveCalendar,
  getPendingDriveCalendar,
  setPendingDriveCalendar,
} from "./calendar-pending";

import {
  driveCandidateToCalendarEvent,
  getCalendarCheckRange,
  isDriveCalendarCancelCommand,
  isDuplicateCalendarEvent,
  parseDriveCalendarAddCommand,
} from "./calendar-register";

import {
  parseDriveCalendarCommand,
} from "./calendar-command";

import {
  getDriveContext,
  saveDriveContext,
} from "./context";

import {
  readGoogleDriveFile,
  searchGoogleDrive,
} from "./n8n";

function reply(message: string) {
  return Response.json({
    reply: message,
  });
}

export async function handleDriveCalendarFlow(
  message: string,
  sessionId: string,
): Promise<Response | null> {
  /*
   * 1. 이미 추출해둔 일정 후보 처리
   *    - 1번 추가
   *    - 1,3번 추가
   *    - 전부 추가
   *    - 취소
   */

  const pending =
    getPendingDriveCalendar(sessionId);

  if (
    pending &&
    isDriveCalendarCancelCommand(message)
  ) {
    clearPendingDriveCalendar(sessionId);

    return reply(
      "Drive 문서의 Calendar 일정 추가를 취소했어.",
    );
  }

  const addCommand =
    parseDriveCalendarAddCommand(message);

  if (pending && addCommand) {
    let selectedEvents = pending.events;

    if (addCommand.kind === "selected") {
      const invalidIndexes =
        addCommand.indexes.filter(
          (index) =>
            index < 0 ||
            index >= pending.events.length,
        );

      if (invalidIndexes.length > 0) {
        return reply(
          `선택할 수 있는 일정은 1번부터 ${pending.events.length}번까지야.`,
        );
      }

      selectedEvents =
        addCommand.indexes.map(
          (index) => pending.events[index],
        );
    }

    const added: string[] = [];
    const duplicates: string[] = [];
    const failed: string[] = [];

    for (const candidate of selectedEvents) {
      const calendarEvent =
        driveCandidateToCalendarEvent(
          candidate,
        );

      try {
        /*
         * 먼저 해당 날짜의 기존 일정 조회
         */
        const range =
          getCalendarCheckRange(
            calendarEvent,
          );

        const existingEvents =
          await callCalendarN8n(
            "calendar_get",
            range,
          );

        /*
         * 같은 제목 + 같은 시작시간이면 중복
         */
        if (
          isDuplicateCalendarEvent(
            calendarEvent,
            existingEvents,
          )
        ) {
          duplicates.push(
            calendarEvent.title,
          );

          continue;
        }

        /*
         * 실제 Google Calendar 등록
         */
        await callCalendarN8n(
          "calendar_create",
          calendarEvent,
        );

        added.push(calendarEvent.title);
      } catch (error) {
        console.error(
          "[Drive Calendar] Failed:",
          candidate.title,
          error,
        );

        failed.push(candidate.title);
      }
    }

    /*
     * 전체 등록이면 후보 작업 종료.
     * 번호 선택은 추가 선택을 이어서 할 수 있도록 유지.
     */
    if (addCommand.kind === "all") {
      clearPendingDriveCalendar(
        sessionId,
      );
    }

    const output: string[] = [];

    if (added.length > 0) {
      output.push(
        `**${added.length}개의 일정을 Calendar에 추가했어 ✅**`,
        "",
        ...added.map(
          (title) => `- ${title}`,
        ),
      );
    }

    if (duplicates.length > 0) {
      if (output.length > 0) {
        output.push("");
      }

      output.push(
        `**이미 등록되어 있어서 건너뛴 일정 ${duplicates.length}개**`,
        "",
        ...duplicates.map(
          (title) => `- ${title}`,
        ),
      );
    }

    if (failed.length > 0) {
      if (output.length > 0) {
        output.push("");
      }

      output.push(
        `**등록에 실패한 일정 ${failed.length}개**`,
        "",
        ...failed.map(
          (title) => `- ${title}`,
        ),
      );
    }

    if (output.length === 0) {
      return reply(
        "추가할 일정이 없었어.",
      );
    }

    return reply(
      output.join("\n"),
    );
  }

  /*
   * 2. Drive 문서에서 일정 찾기 명령
   */

  const command =
    parseDriveCalendarCommand(message);

  if (!command) {
    /*
     * 이 요청은 Drive→Calendar 요청이 아님.
     * route.ts의 기존 Drive/Calendar 기능으로 넘긴다.
     */
    return null;
  }

  let fileId: string;
  let fileName: string;
  let webViewLink:
    | string
    | undefined;

  /*
   * 파일명이 명령에 포함된 경우
   */
  if (command.query) {
    const files =
      await searchGoogleDrive(
        command.query,
      );

    if (files.length === 0) {
      return reply(
        `Google Drive에서 '${command.query}' 파일을 찾지 못했어.`,
      );
    }

    const normalizedQuery =
      command.query
        .toLowerCase()
        .trim();

    const exactMatch =
      files.find(
        (file) =>
          file.name
            .toLowerCase()
            .trim() ===
          normalizedQuery,
      );

    const partialMatch =
      files.find((file) =>
        file.name
          .toLowerCase()
          .includes(
            normalizedQuery,
          ),
      );

    const file =
      exactMatch ??
      partialMatch ??
      files[0];

    fileId = file.id;
    fileName = file.name;
    webViewLink =
      file.webViewLink;

    /*
     * 이후 "그 문서" 질문도 가능하게 저장
     */
    saveDriveContext(sessionId, {
      fileId,
      fileName,
      webViewLink,
    });
  } else {
    /*
     * "그 문서에서 일정 찾아줘" 같은 후속 명령
     */
    const context =
      getDriveContext(sessionId);

    if (!context) {
      return reply(
        "어떤 Drive 문서에서 일정을 찾을지 파일명을 알려줘.",
      );
    }

    fileId = context.fileId;
    fileName = context.fileName;
    webViewLink =
      context.webViewLink;
  }

  /*
   * 실제 Drive 파일 읽기
   */
  const text =
    await readGoogleDriveFile(fileId);

  if (!text) {
    return reply(
      `'${fileName}' 파일에서 읽을 수 있는 내용을 찾지 못했어.`,
    );
  }

  /*
   * AI 일정 추출
   */
  const events =
    await extractCalendarEventsFromDriveFile(
      fileName,
      text,
    );

  if (events.length === 0) {
    return reply(
      formatDriveCalendarCandidates(
        fileName,
        events,
      ),
    );
  }

  /*
   * 사용자가 번호를 선택할 수 있도록 세션에 저장
   */
  setPendingDriveCalendar(
    sessionId,
    {
      fileId,
      fileName,
      webViewLink,
      events,
    },
  );

  return reply(
    `${formatDriveCalendarCandidates(
      fileName,
      events,
    )}

원하면 **"1번 추가해줘"**, **"1번이랑 3번 추가해줘"**, **"전부 추가해줘"**라고 말해줘.`,
  );
}