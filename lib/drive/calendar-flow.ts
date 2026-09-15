import {
  getActiveBrainTrace,
  updateBrainTrace,
} from "@/lib/brain/trace";

import { createPlan } from "@/lib/brain/planner";
import { createReflection } from "@/lib/brain/reflection";
import "server-only";

import { callCalendarN8n } from "@/lib/calendar/n8n";
import {
  deleteMemory,
  getMemory,
  saveMemory,
} from "@/lib/memory/context";
import { saveLastAction } from "@/lib/memory/action";

import {
  extractCalendarEventsFromDriveFile,
  formatDriveCalendarCandidates,
} from "./calendar-extract";

import {
  clearPendingDriveCalendar,
  DRIVE_CALENDAR_PENDING_TTL_MS,
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

type DriveCalendarPendingMemory = {
  fileId: string;
  fileName: string;
  webViewLink?: string;
  events: Awaited<
    ReturnType<
      typeof extractCalendarEventsFromDriveFile
    >
  >;
};

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

  let pending =
    getPendingDriveCalendar(sessionId);

  /*
   * 서버 재시작 등으로 RAM의 후보가 사라졌다면
   * Supabase 통합 Memory에서 다시 복원한다.
   */
  if (!pending) {
    const persistedPending =
      await getMemory<DriveCalendarPendingMemory>(
        sessionId,
        "action",
        "pending_calendar_candidates",
        DRIVE_CALENDAR_PENDING_TTL_MS,
      );

    if (persistedPending) {
      setPendingDriveCalendar(
        sessionId,
        persistedPending,
      );

      pending =
  getPendingDriveCalendar(
    sessionId,
  );

      console.log(
        "[L-AI Memory] Restored Drive Calendar candidates:",
        {
          sessionId,
          fileName:
            persistedPending.fileName,
          events:
            persistedPending.events.length,
        },
      );
    }
  }

  if (
    pending &&
    isDriveCalendarCancelCommand(message)
  ) {
    clearPendingDriveCalendar(
      sessionId,
    );

    await deleteMemory(
      sessionId,
      "action",
      "pending_calendar_candidates",
    );

    return reply(
      "Drive 문서의 Calendar 일정 추가를 취소했어.",
    );
  }

  const addCommand =
    parseDriveCalendarAddCommand(message);

  if (pending && addCommand) {
  console.log(
    "[L-AI Memory] Priority selected: pending_calendar_candidates",
    {
      sessionId,
      fileName: pending.fileName,
    },
  );

  let selectedIndexes: number[];

  if (addCommand.kind === "all") {
    selectedIndexes =
      pending.events.map(
        (_, index) => index,
      );
  } else {
    const invalidIndexes =
      addCommand.indexes.filter(
        (index) =>
          index < 0 ||
          index >=
            pending.events.length,
      );

    if (
      invalidIndexes.length > 0
    ) {
      return reply(
        `선택할 수 있는 일정은 1번부터 ${pending.events.length}번까지야.`,
      );
    }

    selectedIndexes =
      addCommand.indexes;
  }

const activeBrainTrace =
  await getActiveBrainTrace(
    sessionId,
  );

if (activeBrainTrace) {
  await updateBrainTrace(
    sessionId,
    {
      state: "executing",
      waitingFor: null,
    },
  );

  console.log(
    "[L-AI Brain] Trace executing",
    {
      traceId:
        activeBrainTrace.traceId,
    },
  );
}

  const added: string[] = [];
  const duplicates: string[] = [];
  const failed: string[] = [];

  /*
   * 처리 완료된 후보의 기존 index.
   *
   * 성공적으로 추가됐거나
   * 이미 Calendar에 존재하는 후보는
   * pending 목록에서 제거한다.
   *
   * 실패한 후보는 다시 시도할 수 있도록 유지한다.
   */
  const resolvedIndexes =
    new Set<number>();

  for (
    const index of selectedIndexes
  ) {
    const candidate =
      pending.events[index];

    const calendarEvent =
      driveCandidateToCalendarEvent(
        candidate,
      );

    try {
      /*
       * 해당 날짜의 기존 일정 조회
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
       * 이미 존재하는 일정이면
       * 중복으로 처리하고 후보에서는 제거.
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

        resolvedIndexes.add(
          index,
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

      await saveLastAction(
        sessionId,
        {
          type: "calendar_create",
          label:
            `${calendarEvent.title} 일정 추가`,
          data: {
            title:
              calendarEvent.title,
            start:
              calendarEvent.start,
            end:
              calendarEvent.end,
          },
        },
      );

      added.push(
        calendarEvent.title,
      );

      resolvedIndexes.add(
        index,
      );
    } catch (error) {
      console.error(
        "[Drive Calendar] Failed:",
        candidate.title,
        error,
      );

      /*
       * 실패한 후보는 제거하지 않는다.
       * 나중에 다시 추가할 수 있다.
       */
      failed.push(
        candidate.title,
      );
    }
  }

  /*
   * 성공 또는 중복 처리된 후보 제거
   */
  const remainingEvents =
    pending.events.filter(
      (_, index) =>
        !resolvedIndexes.has(index),
    );

  /*
   * 남은 후보가 없으면
   * RAM + Supabase Memory 모두 정리
   */
  if (
    remainingEvents.length === 0
  ) {
    clearPendingDriveCalendar(
      sessionId,
    );

    await deleteMemory(
      sessionId,
      "action",
      "pending_calendar_candidates",
    );

    console.log(
      "[L-AI Memory] Cleared Drive Calendar candidates:",
      {
        sessionId,
        fileName:
          pending.fileName,
      },
    );
  } else {
    /*
     * 아직 후보가 남아있으면
     * 남은 목록으로 RAM 갱신
     */
    setPendingDriveCalendar(
      sessionId,
      {
        fileId:
          pending.fileId,
        fileName:
          pending.fileName,
        webViewLink:
          pending.webViewLink,
        events:
          remainingEvents,
      },
    );

    /*
     * Supabase 통합 Memory도
     * 동일하게 갱신
     */
    saveMemory(
      sessionId,
      "action",
      "pending_calendar_candidates",
      {
        fileId:
          pending.fileId,
        fileName:
          pending.fileName,
        webViewLink:
          pending.webViewLink,
        events:
          remainingEvents,
      },
    );

    console.log(
      "[L-AI Memory] Updated Drive Calendar candidates:",
      {
        sessionId,
        fileName:
          pending.fileName,
        remaining:
          remainingEvents.length,
      },
    );
  }

  const output: string[] = [];

  if (added.length > 0) {
    output.push(
      `**${added.length}개의 일정을 Calendar에 추가했어 ✅**`,
      "",
      ...added.map(
        (title) =>
          `- ${title}`,
      ),
    );
  }

  if (
    duplicates.length > 0
  ) {
    if (output.length > 0) {
      output.push("");
    }

    output.push(
      `**이미 등록되어 있어서 건너뛴 일정 ${duplicates.length}개**`,
      "",
      ...duplicates.map(
        (title) =>
          `- ${title}`,
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
        (title) =>
          `- ${title}`,
      ),
    );
  }

  /*
   * 남은 후보가 있다면
   * 새 번호 기준으로 알려준다.
   */
  if (
    remainingEvents.length > 0
  ) {
    if (output.length > 0) {
      output.push("");
    }

    output.push(
      `남은 일정 후보는 **${remainingEvents.length}개**야.`,
      "남은 후보는 다시 1번부터 번호가 매겨져.",
    );
  } else {
    if (output.length > 0) {
      output.push("");
    }

    output.push(
      "처리할 일정 후보가 모두 끝났어.",
    );
  }

  if (
    output.length === 0
  ) {
    return reply(
      "추가할 일정이 없었어.",
    );
  }

const completionPlan =
  createPlan({
    message:
      `${pending.fileName} 파일에서 추출한 일정을 캘린더에 등록해줘`,
    intent: null,
    confidence: null,
  });

const completedToolIds =
  added.length > 0 ||
  duplicates.length > 0
    ? [
        "drive.read",
        "drive.calendar.extract",
        "calendar.create",
      ]
    : [
        "drive.read",
        "drive.calendar.extract",
      ];

const completionReflection =
  createReflection(
    completionPlan,
    {
      completedToolIds,
      failed:
        added.length === 0 &&
        failed.length > 0,
    },
  );

console.log(
  "[L-AI Brain] Execution Reflection",
  {
    ...completionReflection,
    added: added.length,
    duplicates:
      duplicates.length,
    failed:
      failed.length,
    remaining:
      remainingEvents.length,
  },
);

const traceState =
  added.length === 0 &&
  duplicates.length === 0 &&
  failed.length > 0
    ? "failed"
    : remainingEvents.length > 0
      ? "waiting"
      : "success";

const updatedTrace =
  await updateBrainTrace(
    sessionId,
    {
      state: traceState,

      reflection:
        completionReflection,

      waitingFor:
        traceState === "waiting"
          ? "user_selection"
          : null,
    },
  );

if (updatedTrace) {
  console.log(
    "[L-AI Brain] Trace completed",
    {
      traceId:
        updatedTrace.traceId,
      state:
        updatedTrace.state,
      waitingFor:
        updatedTrace.waitingFor,
      remaining:
        remainingEvents.length,
    },
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
    parseDriveCalendarCommand(
      message,
    );

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
      files.find(
        (file) =>
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
    saveDriveContext(
      sessionId,
      {
        fileId,
        fileName,
        webViewLink,
      },
    );
  } else {
    /*
     * "그 문서에서 일정 찾아줘" 같은 후속 명령
     */
    const context =
      getDriveContext(
        sessionId,
      );

    if (!context) {
      return reply(
        "어떤 Drive 문서에서 일정을 찾을지 파일명을 알려줘.",
      );
    }

    fileId =
      context.fileId;

    fileName =
      context.fileName;

    webViewLink =
      context.webViewLink;
  }

  /*
   * 실제 Drive 파일 읽기
   */
  const text =
    await readGoogleDriveFile(
      fileId,
    );

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

  if (
    events.length === 0
  ) {
    return reply(
      formatDriveCalendarCandidates(
        fileName,
        events,
      ),
    );
  }

  /*
   * 사용자가 번호를 선택할 수 있도록
   * RAM에 후보 저장
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

  /*
   * 서버를 재시작해도 후보를 복원할 수 있도록
   * Supabase 통합 Memory에도 저장
   */
  saveMemory(
    sessionId,
    "action",
    "pending_calendar_candidates",
    {
      fileId,
      fileName,
      webViewLink,
      events,
    },
  );

  console.log(
    "[L-AI Memory] Saved Drive Calendar candidates:",
    {
      sessionId,
      fileName,
      events:
        events.length,
    },
  );

  await saveLastAction(
    sessionId,
    {
      type:
        "drive_calendar_extract",
      label:
        `${fileName} 일정 후보 추출`,
      data: {
        fileId,
        fileName,
        candidateCount:
          events.length,
      },
    },
  );

const reflection =
  createReflection(
    createPlan({
      message:
        `${fileName} 파일에서 일정 찾아서 캘린더에 넣어줘`,
      intent: null,
      confidence: null,
    }),
    {
      completedToolIds: [
        "drive.read",
        "drive.calendar.extract",
      ],
      waitingFor:
        "user_confirmation",
    },
  );

console.log(
  "[L-AI Brain] Reflection",
  reflection,
);

const waitingTrace =
  await updateBrainTrace(
    sessionId,
    {
      state: "waiting",
      reflection,
      waitingFor:
        "user_selection",
    },
  );

if (waitingTrace) {
  console.log(
    "[L-AI Brain] Trace state",
    {
      traceId:
        waitingTrace.traceId,
      state:
        waitingTrace.state,
      waitingFor:
        waitingTrace.waitingFor,
    },
  );
}

  return reply(
    `${formatDriveCalendarCandidates(
      fileName,
      events,
    )}

원하면 **"1번 추가해줘"**, **"1번이랑 3번 추가해줘"**, **"전부 추가해줘"**라고 말해줘.`,
  );
}
