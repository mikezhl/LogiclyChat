import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import DocumentTitleSync from "@/components/document-title-sync";
import { DEFAULT_UI_LANGUAGE, toSiteTitle } from "@/lib/ui-language";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: toSiteTitle(DEFAULT_UI_LANGUAGE),
  description:
    "一个实时的AI辩论/吵架辅助+分析+总结平台。A real-time AI voice room with transcription and analysis.",
  icons: {
    icon: [{ url: "/favicon-ji.svg", type: "image/svg+xml" }],
    shortcut: "/favicon-ji.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <DocumentTitleSync />
        {children}
      </body>
    </html>
  );
}
