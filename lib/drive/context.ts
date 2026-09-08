import "server-only";

type DriveConversationContext = {
  fileId: string;
  fileName: string;
  webViewLink?: string;
  updatedAt: number;
};

const driveContexts = new Map<string, DriveConversationContext>();

const CONTEXT_TTL_MS = 1000 * 60 * 60 * 6;

const DRIVE_FOLLOW_UP_PATTERN =
  /(?:그\s*파일|그\s*문서|그거|거기|거기서|거기에서|그중|그\s*내용|방금\s*(?:파일|문서)|아까\s*(?:파일|문서))/u;

export function saveDriveContext(
  sessionId: string,
  context: Omit<DriveConversationContext, "updatedAt">,
) {
  driveContexts.set(sessionId, {
    ...context,
    updatedAt: Date.now(),
  });
}

export function getDriveContext(
  sessionId: string,
): DriveConversationContext | null {
  const context = driveContexts.get(sessionId);

  if (!context) {
    return null;
  }

  if (Date.now() - context.updatedAt > CONTEXT_TTL_MS) {
    driveContexts.delete(sessionId);
    return null;
  }

  return context;
}

export function isDriveContextFollowUp(message: string) {
  return DRIVE_FOLLOW_UP_PATTERN.test(message);
}

export function clearDriveContext(sessionId: string) {
  driveContexts.delete(sessionId);
}