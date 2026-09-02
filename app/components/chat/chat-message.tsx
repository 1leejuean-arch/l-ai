import type { ChatMessage as ChatMessageType } from "@/app/types/chat";
import type { ReactNode } from "react";

type ChatMessageProps = {
  message: ChatMessageType;
};

const DRIVE_LINK_PATTERN =
  /\[((?:\\.|[^\]\\])+)\]\((https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9._~%+-]+)\)/gu;

function renderMessageContent(content: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(DRIVE_LINK_PATTERN)) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    parts.push(
      <a
        key={`${match.index}-${match[2]}`}
        href={match[2]}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-sky-300 underline decoration-sky-400/40 underline-offset-4 transition hover:text-sky-200"
      >
        {match[1].replace(/\\([\\\[\]])/gu, "$1")}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) {
    return content;
  }

  parts.push(content.slice(lastIndex));
  return parts;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <article
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-[11px] font-bold tracking-tight text-sky-300 shadow-[0_0_24px_rgba(56,189,248,0.08)]">
          L
        </div>
      )}

      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap shadow-sm sm:max-w-[75%] sm:text-[15px] ${
          isUser
            ? "rounded-br-md bg-sky-500 text-white"
            : message.isError
              ? "rounded-bl-md border border-red-400/20 bg-red-400/10 text-red-200"
              : "rounded-bl-md border border-white/[0.07] bg-white/[0.055] text-zinc-200"
        }`}
      >
        {isUser ? message.content : renderMessageContent(message.content)}
      </div>
    </article>
  );
}

export function LoadingMessage() {
  return (
    <div className="flex items-start gap-3" role="status" aria-live="polite">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-[11px] font-bold text-sky-300">
        L
      </div>
      <div className="flex h-11 items-center gap-1.5 rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.055] px-4">
        <span className="sr-only">L-AI가 응답을 작성하고 있습니다.</span>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1.5 animate-pulse rounded-full bg-sky-300"
            style={{ animationDelay: `${index * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
