import {
  getLocalAgentHealth,
  LocalAgentConfigurationError,
} from "@/lib/local-agent/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getLocalAgentHealth();
    return Response.json(health, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const configured = !(error instanceof LocalAgentConfigurationError);

    return Response.json(
      {
        ok: false,
        status: configured ? "offline" : "not_configured",
        message:
          error instanceof Error
            ? error.message
            : "Windows Local Agent 상태를 확인하지 못했어.",
      },
      {
        status: configured ? 503 : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
