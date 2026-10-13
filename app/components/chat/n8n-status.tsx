"use client";

import { useEffect, useState } from "react";


export function N8nStatus() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let disposed = false;
    let requestInFlight = false;

    const check = async () => {
      if (requestInFlight || document.visibilityState === "hidden") {
        return;
      }

      requestInFlight = true;

      try {
        const response = await fetch("/api/health/n8n", {
          cache: "no-store",
        });

        const data: { ok?: boolean } = await response.json();

        if (!disposed) {
          setOnline(Boolean(data.ok));
        }
      } catch {
        if (!disposed) {
          setOnline(false);
        }
      } finally {
        requestInFlight = false;
      }
    };

    void check();

    const timer = setInterval(() => {
      void check();
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
      <span
        className={`size-1.5 rounded-full ${
          online === true
            ? "bg-emerald-400"
            : online === false
              ? "bg-red-400"
              : "bg-zinc-500"
        }`}
      />

      {online === true
        ? "n8n 연결됨"
        : online === false
          ? "n8n 연결 끊김"
          : "n8n 확인 중"}
    </div>
  );
}
