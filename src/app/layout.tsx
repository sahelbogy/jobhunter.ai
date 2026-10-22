import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "AI Job Hunter — Intelligent Job Discovery & Application Automation",
  description:
    "Cloud-native AI job hunting platform: CV extraction, global & Morocco job discovery, compatibility scoring, bilingual cover letters, approval queue, and Gmail delivery.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
