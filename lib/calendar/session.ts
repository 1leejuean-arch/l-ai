import "server-only";

const SESSION_COOKIE_NAME = "l_ai_session";
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CalendarSession = {
  id: string;
  isNew: boolean;
};

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");

    if (cookieName === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

export function getCalendarSession(request: Request): CalendarSession {
  const existingId = readCookie(
    request.headers.get("cookie"),
    SESSION_COOKIE_NAME,
  );

  if (existingId && SESSION_ID_PATTERN.test(existingId)) {
    return { id: existingId, isNew: false };
  }

  return { id: crypto.randomUUID(), isNew: true };
}

export function attachCalendarSession(
  response: Response,
  request: Request,
  session: CalendarSession,
) {
  if (!session.isNew) {
    return response;
  }

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
  );

  return response;
}
