import type { FormEvent, KeyboardEvent } from "react";

type ChatComposerProps = {
  value: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function ChatComposer({
  value,
  isLoading,
  onChange,
  onSubmit,
}: ChatComposerProps) {
  const canSubmit = value.trim().length > 0 && !isLoading;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
      <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#11151d]/95 p-2 shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition focus-within:border-sky-400/40 focus-within:ring-4 focus-within:ring-sky-400/[0.06] sm:gap-3 sm:p-3">
        <label htmlFor="message" className="sr-only">
          메시지 입력
        </label>
        <textarea
          id="message"
          name="message"
          value={value}
          rows={1}
          maxLength={4000}
          disabled={isLoading}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="L-AI에게 메시지를 보내세요"
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed sm:px-3 sm:text-[15px]"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="메시지 전송"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white transition hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          {isLoading ? (
            <span className="size-4 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-200" />
          ) : (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12 7-7 7 7" />
              <path d="M12 19V5" />
            </svg>
          )}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-zinc-600 sm:text-xs">
        Enter로 전송 · Shift + Enter로 줄바꿈
      </p>
    </form>
  );
}
