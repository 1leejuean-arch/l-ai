import {
  deleteMemory,
  saveMemory,
} from "@/lib/memory/context";
import "server-only";
type DriveConversationContext = {
  fileId: string;
  fileName: string;
  webViewLink?: string;
  updatedAt: number;
};

type StoredDriveContextRow = {
  session_id: string;
  file_id: string;
  file_name: string;
  web_view_link: string | null;
  updated_at: string;
};

const driveContexts =
  new Map<string, DriveConversationContext>();

const CONTEXT_TTL_MS =
  1000 * 60 * 60 * 24 * 7;

const DRIVE_FOLLOW_UP_PATTERN =
  /(?:그\s*파일|그\s*문서|그거|거기|거기서|거기에서|그중|그\s*내용|방금\s*(?:파일|문서)|아까\s*(?:파일|문서))/u;

function getSupabaseConfig() {
  const url =
    process.env.SUPABASE_URL?.trim();

  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !secretKey) {
    return null;
  }

  return {
    url: url.replace(/\/+$/u, ""),
    secretKey,
  };
}

function isStoredDriveContextRow(
  value: unknown,
): value is StoredDriveContextRow {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const record =
    value as Record<string, unknown>;

  return (
    typeof record.session_id === "string" &&
    typeof record.file_id === "string" &&
    typeof record.file_name === "string" &&
    (
      record.web_view_link === null ||
      typeof record.web_view_link === "string"
    ) &&
    typeof record.updated_at === "string"
  );
}

async function persistDriveContext(
  sessionId: string,
  context: DriveConversationContext,
) {
  const config = getSupabaseConfig();

  if (!config) {
    console.warn(
      "[Drive Context] Supabase configuration is missing. Using memory only.",
    );
    return;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_drive_context?on_conflict=session_id`,
      {
        method: "POST",
        headers: {
          apikey: config.secretKey,
          "Content-Type": "application/json",
          Prefer:
            "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          session_id: sessionId,
          file_id: context.fileId,
          file_name: context.fileName,
          web_view_link:
            context.webViewLink ?? null,
          updated_at:
            new Date(
              context.updatedAt,
            ).toISOString(),
        }),
      },
    );

    if (!response.ok) {
      console.error(
        "[Drive Context] Supabase save failed:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error(
      "[Drive Context] Supabase save request failed:",
      error,
    );
  }
}

async function deletePersistedDriveContext(
  sessionId: string,
) {
  const config = getSupabaseConfig();

  if (!config) {
    return;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_drive_context?session_id=eq.${encodeURIComponent(
        sessionId,
      )}`,
      {
        method: "DELETE",
        headers: {
          apikey: config.secretKey,
          Prefer: "return=minimal",
        },
      },
    );

    if (!response.ok) {
      console.error(
        "[Drive Context] Supabase delete failed:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error(
      "[Drive Context] Supabase delete request failed:",
      error,
    );
  }
}

export async function hydrateDriveContext(
  sessionId: string,
) {
  if (driveContexts.has(sessionId)) {
    return;
  }

  const config = getSupabaseConfig();

  if (!config) {
    return;
  }

  try {
    const response = await fetch(
      `${config.url}/rest/v1/l_ai_drive_context?session_id=eq.${encodeURIComponent(
        sessionId,
      )}&select=session_id,file_id,file_name,web_view_link,updated_at&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: config.secretKey,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error(
        "[Drive Context] Supabase load failed:",
        response.status,
        await response.text(),
      );
      return;
    }

    const result: unknown =
      await response.json();

    if (
      !Array.isArray(result) ||
      result.length === 0 ||
      !isStoredDriveContextRow(result[0])
    ) {
      return;
    }

    const row = result[0];

    const updatedAt =
      new Date(row.updated_at).getTime();

    if (
      !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt >
        CONTEXT_TTL_MS
    ) {
      console.log(
        "[L-AI Memory] Ignored expired memory:",
        {
          sessionId,
          memoryType: "drive",
          memoryKey: "recent_file",
        },
      );

      void deletePersistedDriveContext(
        sessionId,
      );

      void deleteMemory(
        sessionId,
        "drive",
        "recent_file",
      );

      return;
    }

    driveContexts.set(
      sessionId,
      {
        fileId: row.file_id,
        fileName: row.file_name,
        webViewLink:
          row.web_view_link ?? undefined,
        updatedAt,
      },
    );

    console.log(
      "[Drive Context] Restored from Supabase:",
      {
        sessionId,
        fileName:
          row.file_name,
      },
    );
  } catch (error) {
    console.error(
      "[Drive Context] Supabase load request failed:",
      error,
    );
  }
}

export function saveDriveContext(
  sessionId: string,
  context: Omit<
    DriveConversationContext,
    "updatedAt"
  >,
) {
  const savedContext: DriveConversationContext = {
    ...context,
    updatedAt: Date.now(),
  };

  driveContexts.set(
  sessionId,
  savedContext,
);

saveMemory(
  sessionId,
  "drive",
  "recent_file",
  {
    fileId: savedContext.fileId,
    fileName: savedContext.fileName,
    webViewLink: savedContext.webViewLink,
  },
);

void persistDriveContext(
  sessionId,
  savedContext,
);
}

export function getDriveContext(
  sessionId: string,
): DriveConversationContext | null {
  const context =
    driveContexts.get(sessionId);

  if (!context) {
    return null;
  }

  if (
    Date.now() -
      context.updatedAt >
    CONTEXT_TTL_MS
  ) {
    console.log(
      "[L-AI Memory] Ignored expired memory:",
      {
        sessionId,
        memoryType: "drive",
        memoryKey: "recent_file",
      },
    );

    driveContexts.delete(
      sessionId,
    );

    void deletePersistedDriveContext(
      sessionId,
    );

    void deleteMemory(
      sessionId,
      "drive",
      "recent_file",
    );

    return null;
  }

  return context;
}

export function isDriveContextFollowUp(
  message: string,
) {
  return DRIVE_FOLLOW_UP_PATTERN.test(
    message,
  );
}

export function clearDriveContext(
  sessionId: string,
) {
  driveContexts.delete(
    sessionId,
  );

  void deletePersistedDriveContext(
    sessionId,
  );

  void deleteMemory(
    sessionId,
    "drive",
    "recent_file",
  );
}
