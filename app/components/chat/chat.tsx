"use client";

import { N8nStatus } from "./n8n-status";
import { useEffect, useRef, useState } from "react";
import type {
  ChatApiError,
  ChatApiResponse,
  ChatMessage as Message,
} from "@/app/types/chat";
import { ChatComposer } from "./chat-composer";
import { ChatMessage, LoadingMessage } from "./chat-message";

const INITIAL_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content:
    "안녕하세요. L-AI Core v0.1입니다.\n무엇을 함께 시작해 볼까요?",
};

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isChatApiResponse(value: unknown): value is ChatApiResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "reply" in value &&
    typeof value.reply === "string"
  );
}

function isChatApiError(value: unknown): value is ChatApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage() {
    const message = input.trim();

    if (!message || isLoading) {
      return;
    }

    setMessages((current) => [
      ...current,
      { id: createMessageId(), role: "user", content: message },
    ]);
    setInput("");
    setIsLoading(true);

    try {
      let sessionId = localStorage.getItem("l-ai-session-id")

if (!sessionId) {
  sessionId = crypto.randomUUID();
  localStorage.setItem("l-ai-session-id", sessionId);
}

const response = await fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-session-id": sessionId,
  },
  body: JSON.stringify({ message }),
});
    const rawText = await response.text();

let data: unknown = {};

if (rawText) {
  try {
    data = JSON.parse(rawText);
  } catch {
    data = {};
  }
}

if (!response.ok) {
  throw new Error(
    isChatApiError(data)
      ? data.error
      : "L-AI 서버에서 요청을 처리하지 못했어. n8n 연결 상태를 확인해줘.",
  );
}

if (!isChatApiResponse(data)) {
  throw new Error(
    "서버에서 응답을 받지 못했어. n8n 연결 상태를 확인해줘.",
  );
}

      setMessages((current) => [
        ...current,
        { id: createMessageId(), role: "assistant", content: data.reply },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          isError: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="relative z-10 flex h-dvh min-h-0 flex-col">
      <header className="shrink-0 border-b border-white/[0.06] bg-[#070a0f]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:h-[72px] sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-sky-500 text-sm font-black text-white shadow-[0_0_28px_rgba(14,165,233,0.22)]">
              L
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white sm:text-lg">
                L-AI
              </h1>
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                Personal Assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-xs text-zinc-400">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
            Core v0.1
          </div>

          <N8nStatus />
        </div>
      </header>

      <section
        aria-label="채팅 메시지"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-5 px-4 py-6 sm:gap-6 sm:px-6 sm:py-10">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {isLoading && <LoadingMessage />}
          <div ref={messagesEndRef} />
        </div>
      </section>

      <footer className="shrink-0 border-t border-white/[0.04] bg-gradient-to-t from-[#070a0f] via-[#070a0f] to-[#070a0f]/90 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-4">
        <ChatComposer
          value={input}
          isLoading={isLoading}
          onChange={setInput}
          onSubmit={sendMessage}
        />
      </footer>
    </div>
  );
}
