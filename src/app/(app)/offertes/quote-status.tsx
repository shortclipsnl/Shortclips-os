import type { QuoteListRow } from "@/server/quotes";

/** Gedeelde statusweergave (server én client) voor de Offertepagina. */
export const QUOTE_STATUS_META: Record<string, { label: string; color: string }> = {
  concept: { label: "Concept", color: "var(--color-ink-muted)" },
  verzonden: { label: "Verzonden", color: "var(--color-info)" },
  bekeken: { label: "Bekeken door klant", color: "var(--color-violet)" },
  geaccepteerd: { label: "Ondertekend", color: "var(--color-good)" },
  ondertekend: { label: "Ondertekend", color: "var(--color-good)" },
  afgewezen: { label: "Afgewezen", color: "var(--color-bad)" },
  verlopen: { label: "Verlopen", color: "var(--color-warn)" },
};

const DAY = 24 * 60 * 60 * 1000;

export function fmtDate(d: Date | string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "2-digit" });
}

/** Opvolgsignaal: verzonden maar na 3 dagen niet geopend, of bekeken en na 5 dagen niet getekend. */
export function followUpHint(r: Pick<QuoteListRow, "status" | "sentAt" | "lastOpenedAt">): string | null {
  const now = Date.now();
  if (r.status === "verzonden" && r.sentAt && now - new Date(r.sentAt).getTime() > 3 * DAY) return "Nog niet geopend";
  if (r.status === "bekeken" && r.lastOpenedAt && now - new Date(r.lastOpenedAt).getTime() > 5 * DAY) return "Opvolgen";
  return null;
}

export function StatusPill({ status }: { status: string }) {
  const meta = QUOTE_STATUS_META[status] ?? QUOTE_STATUS_META.concept!;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-2xs font-semibold" style={{ background: `color-mix(in srgb, ${meta.color} 12%, var(--color-surface))`, color: meta.color }}>
      <span className="size-1.5 rounded-full" style={{ background: meta.color }} /> {meta.label}
    </span>
  );
}

