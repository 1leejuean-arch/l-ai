import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "L-AI | Personal AI Assistant",
  description: "L 서비스의 중앙 AI 어시스턴트",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full bg-[#070a0f] antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
