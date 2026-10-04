import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-poppins",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: {
    default: "ShortClips OS",
    template: "%s · ShortClips OS",
  },
  description:
    "Eén platform voor de complete videoworkflow van ShortClips: klanten, scripts, opnames, edit, goedkeuring, planning, publicatie en resultaten.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#00003B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl" className={poppins.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
