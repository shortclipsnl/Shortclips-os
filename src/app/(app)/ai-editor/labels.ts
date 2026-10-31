import type { Tone } from "@/components/ui";

export const PROJECT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Concept", tone: "neutral" },
  queued: { label: "In de wachtrij", tone: "info" },
  processing: { label: "Bezig", tone: "info" },
  review: { label: "Klaar voor controle", tone: "violet" },
  needs_choice: { label: "Take kiezen", tone: "warn" },
  failed: { label: "Mislukt", tone: "bad" },
  exported: { label: "Geëxporteerd", tone: "good" },
};

export const FORMATS = [
  { value: "9x16", label: "9:16 (1080×1920) Reels, TikTok, Meta Ads" },
  { value: "4x5", label: "4:5 (1080×1350) feed" },
  { value: "1x1", label: "1:1 (1080×1080) feed" },
] as const;

export function euro(cents: number | null | undefined): string {
  const c = Number(cents ?? 0);
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(c / 100);
}

export function bytes(n: number | null | undefined): string {
  const b = Number(n ?? 0);
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} kB`;
  return `${b} B`;
}

export function secs(ms: number | null | undefined): string {
  const s = Math.round(Number(ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
