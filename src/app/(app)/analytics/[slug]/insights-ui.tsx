"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ListPlus, Loader2, Sparkles } from "lucide-react";
import { generateInsights, recommendationToTask } from "@/server/actions/insights";
import type { ClientInsights, Finding, Recommendation } from "@/server/insights";

const ZEKER: Record<string, { label: string; cls: string }> = {
  bewezen: { label: "Bewezen", cls: "bg-[var(--color-good-soft)] text-[#14633a]" },
  waarschijnlijk: { label: "Waarschijnlijk", cls: "bg-[#e7f0ff] text-[#1b5fe0]" },
  hypothese: { label: "Hypothese", cls: "bg-[#fff3e0] text-[#8a5300]" },
};

function Zeker({ z }: { z: string }) {
  const m = ZEKER[z] ?? ZEKER.hypothese!;
  return <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${m.cls}`}>{m.label}</span>;
}

export function InsightsPanel({
  slug,
  days,
  available,
  insights,
  generatedAt,
}: {
  slug: string;
  days: number;
  available: boolean;
  insights: ClientInsights | null;
  generatedAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function generate() {
    setMsg(null);
    start(async () => {
      const res = await generateInsights(slug, days);
      if (res.ok) router.refresh();
      else setMsg(res.message ?? "Mislukt");
    });
  }

  return (
    <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-indigo-ink)] px-5 py-3 text-white">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight"><Sparkles className="size-4" /> AI-inzichten &amp; verbeterpunten</h2>
          <p className="text-xs text-white/70">
            {generatedAt ? `Laatst gegenereerd ${generatedAt}` : "Concrete, klantspecifieke analyse op basis van de echte cijfers."}
          </p>
        </div>
        <button type="button" onClick={generate} disabled={pending || !available}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25 disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {insights ? "Opnieuw genereren" : "Analyse genereren"}
        </button>
      </div>

      <div className="p-5">
        {!available ? (
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[#8a5300]">
            De AI-koppeling staat nog uit. Zet <code>ANTHROPIC_API_KEY</code> in de omgeving; daarna werkt de analyse meteen op de echte cijfers.
          </div>
        ) : !insights ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen analyse. Klik op “Analyse genereren”.</p>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <FindingList title="Wat werkt" tone="good" items={insights.analysis?.watWerkt ?? []} />
              <FindingList title="Wat minder werkt" tone="bad" items={insights.analysis?.watMinder ?? []} />
            </div>
            {insights.analysis?.ontwikkelingen?.length ? (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold text-[var(--color-ink)]">Ontwikkelingen</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-muted)]">
                  {insights.analysis.ontwikkelingen.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Verbeterpunten voor de volgende opnames</h3>
              <div className="space-y-2.5">
                {(insights.verbeterpunten ?? []).map((r, i) => <RecCard key={i} slug={slug} rec={r} />)}
              </div>
            </div>
          </div>
        )}
        {msg ? <p className="mt-3 text-xs text-[var(--color-bad)]">{msg}</p> : null}
      </div>
    </div>
  );
}

function FindingList({ title, tone, items }: { title: string; tone: "good" | "bad"; items: Finding[] }) {
  return (
    <div>
      <h3 className={`mb-1.5 text-sm font-semibold ${tone === "good" ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{title}</h3>
      {items?.length ? (
        <ul className="space-y-1.5">
          {items.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1 text-[var(--color-ink-muted)]">{f.punt}</span>
              <Zeker z={f.zekerheid} />
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-[var(--color-ink-faint)]">—</p>}
    </div>
  );
}

function RecCard({ slug, rec }: { slug: string; rec: Recommendation }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();
  function toTask() {
    start(async () => {
      const res = await recommendationToTask(slug, { titel: rec.titel, waarom: rec.waarom, wat: rec.wat, hoeMeten: rec.hoeMeten });
      if (res.ok) { setDone(true); router.refresh(); }
    });
  }
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{rec.titel}</span>
            <Zeker z={rec.zekerheid} />
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]"><strong>Waarom:</strong> {rec.waarom}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]"><strong>Wat:</strong> {rec.wat}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]"><strong>Hoe meten:</strong> {rec.hoeMeten}</p>
        </div>
        <button type="button" onClick={toTask} disabled={pending || done}
          className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-brand-700)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
          {done ? <><CheckCircle2 className="size-3.5" /> Taak gemaakt</> : pending ? <Loader2 className="size-3.5 animate-spin" /> : <><ListPlus className="size-3.5" /> Naar taken</>}
        </button>
      </div>
    </div>
  );
}
