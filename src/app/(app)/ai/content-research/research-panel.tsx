"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { StartResearchButton } from "./start-research-button";

export type RunView = {
  id: string;
  status: string;
  phase: string;
  summary: string | null;
  trends: string[];
  sources: { label: string; url: string }[];
  ideasCount: number;
  newCount: number;
  errorMessage: string | null;
  finishedAt: string | null;
  createdAt: string;
};

const PHASE_LABEL: Record<string, string> = {
  zoeken: "Web-onderzoek…",
  ideeen: "Ideeën bedenken…",
  opslaan: "Opslaan…",
  klaar: "Klaar",
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  bezig: { label: "Bezig", tone: "info" },
  klaar: { label: "Klaar", tone: "good" },
  mislukt: { label: "Mislukt", tone: "bad" },
};

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ResearchPanel({ clientId, runs }: { clientId: string; runs: RunView[] }) {
  const router = useRouter();
  const running = runs.some((r) => r.status === "bezig");

  // Terwijl een onderzoek loopt: ververs de echte voortgang automatisch.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [running, router]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-ink-muted)]">
          Elk onderzoek doorzoekt actuele, échte bronnen en vertaalt die naar nieuwe ideeën. Bestaande ideeën blijven bewaard.
        </p>
        <StartResearchButton clientId={clientId} running={running} variant="primary" label="Onderzoek opnieuw" />
      </div>

      {runs.length === 0 ? (
        <div className="sc-card p-5 text-sm text-[var(--color-ink-muted)]">Nog geen onderzoek gedaan. Start de eerste ronde.</div>
      ) : (
        <ul className="space-y-3">
          {runs.map((r) => {
            const st = STATUS[r.status] ?? STATUS.bezig;
            return (
              <li key={r.id} className="sc-card space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {r.status === "bezig" ? <Loader2 className="size-4 animate-spin text-[var(--color-info)]" /> : r.status === "klaar" ? <CheckCircle2 className="size-4 text-[var(--color-good)]" /> : <AlertTriangle className="size-4 text-[var(--color-bad)]" />}
                    <Badge tone={st.tone}>{r.status === "bezig" ? PHASE_LABEL[r.phase] ?? "Bezig" : st.label}</Badge>
                    <span className="text-xs text-[var(--color-ink-faint)]">{fmt(r.finishedAt ?? r.createdAt)}</span>
                  </div>
                  {r.status === "klaar" ? (
                    <span className="text-xs text-[var(--color-ink-muted)]">{r.newCount} nieuw · {r.ideasCount} totaal</span>
                  ) : null}
                </div>

                {r.status === "mislukt" && r.errorMessage ? (
                  <p className="text-xs text-[var(--color-bad)]">{r.errorMessage}</p>
                ) : null}

                {r.trends.length > 0 ? (
                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Gevonden trends</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">
                      {r.trends.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                ) : null}

                {r.sources.length > 0 ? (
                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Bronnen</p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {r.sources.map((s, i) => (
                        <li key={i}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">
                            {s.label} <ExternalLink className="size-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
