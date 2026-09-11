export const dynamic = "force-dynamic";

export async function GET() {
  const driveUrl =
    process.env.N8N_DRIVE_SEARCH_URL;

  const calendarUrl =
    process.env.N8N_CALENDAR_URL;

  if (!driveUrl || !calendarUrl) {
    return Response.json(
      {
        ok: false,
        status: "env_missing",
        message:
          "n8n 연결 환경변수가 설정되지 않았어.",
      },
      { status: 500 },
    );
  }

  const targets = [
    {
      name: "drive",
      url: driveUrl,
    },
    {
      name: "calendar",
      url: calendarUrl,
    },
  ];

  const results: Record<
    string,
    {
      reachable: boolean;
      status?: number;
    }
  > = {};

  for (const target of targets) {
    try {
      const controller =
        new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        5000,
      );

      const response = await fetch(
        target.url,
        {
          method: "HEAD",
          signal: controller.signal,
          cache: "no-store",
        },
      );

      clearTimeout(timeout);

      /*
       * 404 / 405여도 서버 자체가 응답했다면
       * n8n은 살아있는 것으로 판단.
       */
      results[target.name] = {
        reachable: true,
        status: response.status,
      };
    } catch {
      results[target.name] = {
        reachable: false,
      };
    }
  }

  const ok = Object.values(
    results,
  ).every(
    (result) => result.reachable,
  );

  return Response.json(
    {
      ok,
      status: ok
        ? "online"
        : "offline",
      services: results,
      message: ok
        ? "n8n 연결 정상"
        : "n8n 또는 Cloudflare Tunnel 연결을 확인해야 해.",
    },
    {
      status: ok ? 200 : 503,
    },
  );
}