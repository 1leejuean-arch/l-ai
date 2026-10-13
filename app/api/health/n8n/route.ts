export const dynamic = "force-dynamic";

type HealthServiceResult = {
  reachable: boolean;
  status?: number;
};

type HealthResult = {
  payload: {
    ok: boolean;
    status: "online" | "offline" | "env_missing";
    services: Record<string, HealthServiceResult>;
    message: string;
  };
  statusCode: number;
};

const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_CACHE_TTL_MS = 15_000;
const HEALTH_STALE_TTL_MS = 90_000;

let cachedHealth:
  | {
      result: HealthResult;
      checkedAt: number;
    }
  | null = null;

let healthRequestInFlight: Promise<HealthResult> | null = null;

function healthResponse(
  result: HealthResult,
  cacheState: "fresh" | "stale" | "miss",
) {
  return Response.json(result.payload, {
    status: result.statusCode,
    headers: {
      "Cache-Control": "private, no-store",
      "X-L-AI-Health-Cache": cacheState,
    },
  });
}

async function probeN8nHealth(): Promise<HealthResult> {
  const driveUrl =
    process.env.N8N_DRIVE_SEARCH_URL;

  const calendarUrl =
    process.env.N8N_CALENDAR_URL;

  if (!driveUrl || !calendarUrl) {
    return {
      payload: {
        ok: false,
        status: "env_missing",
        services: {},
        message:
          "n8n 연결 환경변수가 설정되지 않았어.",
      },
      statusCode: 500,
    };
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

  const entries = await Promise.all(
    targets.map(async (target) => {
      const controller =
        new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_TIMEOUT_MS,
      );

      try {
        const response = await fetch(
          target.url,
          {
            method: "HEAD",
            signal: controller.signal,
            cache: "no-store",
          },
        );

        /*
         * 404 / 405여도 서버 자체가 응답했다면
         * n8n은 살아있는 것으로 판단.
         */
        return [
          target.name,
          {
            reachable: true,
            status: response.status,
          },
        ] as const;
      } catch {
        return [
          target.name,
          { reachable: false },
        ] as const;
      } finally {
        clearTimeout(timeout);
      }
    }),
  );

  const results = Object.fromEntries(
    entries,
  ) as Record<
    string,
    {
      reachable: boolean;
      status?: number;
    }
  >;

  const ok = Object.values(
    results,
  ).every(
    (result) => result.reachable,
  );

  return {
    payload: {
      ok,
      status: ok
        ? "online"
        : "offline",
      services: results,
      message: ok
        ? "n8n 연결 정상"
        : "n8n 또는 Cloudflare Tunnel 연결을 확인해야 해.",
    },
    statusCode: ok ? 200 : 503,
  };
}

function startHealthProbe() {
  if (healthRequestInFlight) {
    return healthRequestInFlight;
  }

  healthRequestInFlight = probeN8nHealth()
    .then((result) => {
      cachedHealth = {
        result,
        checkedAt: Date.now(),
      };
      return result;
    })
    .finally(() => {
      healthRequestInFlight = null;
    });

  return healthRequestInFlight;
}

export async function GET() {
  const cacheAge = cachedHealth
    ? Date.now() - cachedHealth.checkedAt
    : Number.POSITIVE_INFINITY;

  if (cachedHealth && cacheAge <= HEALTH_CACHE_TTL_MS) {
    return healthResponse(cachedHealth.result, "fresh");
  }

  if (cachedHealth && cacheAge <= HEALTH_STALE_TTL_MS) {
    void startHealthProbe();
    return healthResponse(cachedHealth.result, "stale");
  }

  const result = await startHealthProbe();
  return healthResponse(result, "miss");
}
