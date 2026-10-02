import {
  useRef,
} from "react";

import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
} from "react";

type ChatComposerProps = {
  value: string;
  isLoading: boolean;
  selectedFile: File | null;
  onChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
};

export function ChatComposer({
  value,
  isLoading,
  selectedFile,
  onChange,
  onFileChange,
  onSubmit,
}: ChatComposerProps) {
  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const canSubmit =
    (value.trim().length > 0 ||
      selectedFile !== null) &&
    !isLoading;

  function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (canSubmit) {
      onSubmit();
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) {
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

  function handleFileSelect(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0] ??
      null;

    onFileChange(file);
  }

  function clearSelectedFile() {
    onFileChange(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-3xl"
    >
      {selectedFile && (
        <div className="mb-2 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {selectedFile.name}
            </p>

            <p className="text-xs text-zinc-500">
              {(
                selectedFile.size /
                1024
              ).toFixed(1)}
              KB
            </p>
          </div>

          <button
            type="button"
            onClick={
              clearSelectedFile
            }
            disabled={isLoading}
            aria-label="첨부파일 제거"
            className="ml-3 flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200 disabled:cursor-not-allowed"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#11151d]/95 p-2 shadow-[0_16px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition focus-within:border-sky-400/40 focus-within:ring-4 focus-within:ring-sky-400/[0.06] sm:gap-3 sm:p-3">
        <input
  ref={fileInputRef}
  type="file"
  className="hidden"
  disabled={isLoading}
  accept=".txt,.md,.pdf,.doc,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp"
  onChange={handleFileSelect}
/>

        <button
          type="button"
          disabled={isLoading}
          aria-label="파일 첨부"
          onClick={() =>
            fileInputRef.current?.click()
          }
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
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
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>

        <label
          htmlFor="message"
          className="sr-only"
        >
          메시지 입력
        </label>

        <textarea
          id="message"
          name="message"
          value={value}
          rows={1}
          maxLength={4000}
          disabled={isLoading}
          onChange={(event) =>
            onChange(
              event.target.value,
            )
          }
          onKeyDown={handleKeyDown}
          placeholder="L-AI에게 메시지를 보내세요"
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed sm:px-3 sm:text-[15px]"
        />

        <button
          type="submit"
          disabled={!canSubmit}
          aria-label="메시지 전송"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-zinc-200 transition hover:bg-white/[0.10] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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
