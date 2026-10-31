import type { Tone } from "@/components/ui";

export const VI_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "In wachtrij", tone: "info" },
  downloading: { label: "Downloaden", tone: "info" },
  processing: { label: "Verwerken", tone: "info" },
  needs_ai: { label: "Wacht op AI/tools", tone: "warn" },
  partial: { label: "Deels verwerkt", tone: "warn" },
  complete: { label: "Klaar", tone: "good" },
  failed: { label: "Mislukt", tone: "bad" },
};

export const STEP_LABEL: Record<string, string> = {
  download: "Bron ophalen",
  probe: "Video uitlezen",
  shots: "Shots detecteren",
  editing: "Montage meten",
  ocr: "Teksten in beeld (OCR)",
  transcribe: "Transcriptie (woordtijden)",
  vision: "Visuele AI-duiding",
  insights: "AI-conclusies",
};

export const STEP_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Wacht", tone: "neutral" },
  running: { label: "Bezig", tone: "info" },
  done: { label: "Klaar", tone: "good" },
  skipped: { label: "Nog niet beschikbaar", tone: "warn" },
  failed: { label: "Mislukt", tone: "bad" },
};

/** ms → "m:ss". */
export function msToClock(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
