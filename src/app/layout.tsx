import type { Metadata, Viewport } from "next";
import catalog from "@/content/games.json";
import "./globals.css";

export const metadata: Metadata = {
  title: catalog.site.name,
  description: catalog.site.tagline,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e1a2e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
