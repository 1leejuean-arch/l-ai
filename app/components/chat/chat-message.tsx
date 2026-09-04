import type { ChatMessage as ChatMessageType } from "@/app/types/chat";

import ReactMarkdown from "react-markdown";

type ChatMessageProps = {
  message: ChatMessageType;
};

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
        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[75%] sm:text-[15px] ${
          isUser
            ? "rounded-br-md bg-sky-500 text-white"
            : message.isError
              ? "rounded-bl-md border border-red-400/20 bg-red-400/10 text-red-200"
              : "rounded-bl-md border border-white/[0.07] bg-white/[0.055] text-zinc-200"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="mb-3 mt-2 text-xl font-bold text-zinc-100">
                  {children}
                </h1>
              ),

              h2: ({ children }) => (
                <h2 className="mb-2 mt-4 text-lg font-semibold text-zinc-100">
                  {children}
                </h2>
              ),

              h3: ({ children }) => (
                <h3 className="mb-2 mt-3 font-semibold text-zinc-100">
                  {children}
                </h3>
              ),

              p: ({ children }) => (
                <p className="my-2 whitespace-pre-wrap">
                  {children}
                </p>
              ),

              ul: ({ children }) => (
                <ul className="my-2 list-disc space-y-1 pl-5">
                  {children}
                </ul>
              ),

              ol: ({ children }) => (
                <ol className="my-2 list-decimal space-y-1 pl-5">
                  {children}
                </ol>
              ),

              li: ({ children }) => (
                <li className="pl-1">
                  {children}
                </li>
              ),

              strong: ({ children }) => (
                <strong className="font-semibold text-zinc-50">
                  {children}
                </strong>
              ),

              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sky-300 underline decoration-sky-400/40 underline-offset-4 transition hover:text-sky-200"
                >
                  {children}
                </a>
              ),

              code: ({ children }) => (
                <code className="rounded bg-black/30 px-1.5 py-0.5 text-[0.9em] text-sky-200">
                  {children}
                </code>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
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
        <span className="sr-only">
          L-AI가 응답을 작성하고 있습니다.
        </span>

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