import { Chat } from "./components/chat/chat";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#070a0f] text-zinc-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_68%)]"
      />
      <Chat />
    </main>
  );
}
