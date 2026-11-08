import type { Tone } from "@/components/ui";
import type { DisplayStatus } from "@/lib/contracts";

export const eur = (v: number | null | undefined) =>
  v == null ? "Onbekend" : `€ ${Math.round(v).toLocaleString("nl-NL")}`;

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(".", "") : "Onbekend";

export const longDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "Onbekend";

export const monthsLabel = (m: number | null) =>
  m == null ? "Onbekend" : `${String(m).replace(".", ",")} ${m === 1 ? "maand" : "maanden"}`;

export const STATUS_TONE: Record<DisplayStatus, Tone> = {
  actief: "good",
  loopt_af: "warn",
  verlengd: "info",
  stopt: "bad",
  verlopen: "bad",
  gepauzeerd: "neutral",
  beeindigd: "neutral",
  geen_contract: "violet",
};

export const ATTENTION_COLOR = {
  info: "var(--color-ink-faint)",
  aandacht: "var(--color-warn)",
  urgent: "var(--color-bad)",
  kritiek: "var(--color-bad)",
} as const;
