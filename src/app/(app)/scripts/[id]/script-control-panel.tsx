"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { controleScript, applyImprovedScript, type ScriptControlResult } from "@/server/actions/script-control";

export function ScriptControlPanel({ scriptId, orig, canApply, initial }: {
  scriptId: string;
  orig: { hook: string; body: string; cta: string };
  canApply: boolean;
  initial: ScriptControlResult | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ScriptControlResult | null>(initial);
  const [pending, startTransition] = useTransition();
  const [applying, startApply] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const res = await controleScript(scriptId);
      if (res.ok) setResult(res.data); else setMsg(res.message);
    });
  }

  function apply(field: "hook" | "body" | "cta", value: string) {
    if (!confirm(`Het ${field === "hook" ? "hook" : field === "body" ? "middenstuk" : "CTA"}-veld overschrijven met de verbeterde versie?`)) return;
    startApply(async () => {
      await applyImprovedScript({ scriptId, [field]: value });
      router.refresh();
    });
  }

  const ai = result?.ai ?? null;
  const sp = result?.speaking;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardHeader title="AI Scriptcontrole" subtitle="Beoordeelt hook, middenstuk, CTA, taalgebruik en kijkersreis volgens de Shortclips-richtlijnen." />
        <Button size="sm" disabled={pending} onClick={run}><Sparkles className="size-4" /> {pending ? "Bezig…" : result ? "Opnieuw" : "Controleer"}</Button>
      </div>
      {msg ? <p className="mt-2 text-sm text-[var(--color-bad)]">{msg}</p> : null}

      {!result ? (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Klik op “Controleer” om dit script te laten beoordelen.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Deterministisch — altijd beschikbaar */}
          <div>
            <div className="mb-1 text-sm font-semibold">Spreektijd (schatting)</div>
            <p className="text-sm text-[var(--color-ink-muted)]">
              ~<span className="font-semibold text-[var(--color-ink)]">{sp!.seconds}s</span> · {sp!.words} woorden @ {sp!.wpm} wpm
              <span className="text-2xs text-[var(--color-ink-faint)]"> (hook {sp!.perSection.hook} · midden {sp!.perSection.body} · cta {sp!.perSection.cta})</span>
            </p>
          </div>

          {result.similar.length > 0 ? (
            <div>
              <div className="mb-1 text-sm font-semibold">Mogelijke herhaling</div>
              <p className="mb-1 text-2xs text-[var(--color-ink-faint)]">Eerdere scripts van deze klant met dezelfde pijler/format — bewust (strategisch) of onbedoeld?</p>
              <ul className="space-y-0.5 text-sm">
                {result.similar.map((s) => (
                  <li key={s.id}><Link href={`/scripts/${s.id}`} className="text-[var(--color-brand-600)] hover:underline">{s.title}</Link> <span className="text-2xs text-[var(--color-ink-faint)]">· {s.pillar ?? s.format ?? ""}</span></li>
                ))}
              </ul>
            </div>
          ) : null}

          {(result.feedback.afspraken || result.feedback.recenteKlantopmerkingen.length > 0) ? (
            <div>
              <div className="mb-1 text-sm font-semibold">Eerdere klantfeedback (meegenomen)</div>
              {result.feedback.afspraken ? <p className="text-xs text-[var(--color-ink-muted)]">Afspraken: {result.feedback.afspraken}</p> : null}
              {result.feedback.recenteKlantopmerkingen.slice(0, 3).map((c, i) => <p key={i} className="text-2xs text-[var(--color-ink-faint)]">“{c}”</p>)}
            </div>
          ) : null}

          {/* AI-oordeel — gated */}
          {!result.aiReady ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)]/50 px-3 py-2 text-xs text-[var(--color-ink-muted)]">
              Het AI-oordeel (hook/CTA/kijkersreis + verbeterd script) draait zodra <code>ANTHROPIC_API_KEY</code> is ingesteld. De spreektijd en herhaling hierboven werken al zonder sleutel.
            </div>
          ) : ai ? (
            <div className="space-y-3 border-t border-[var(--color-line)] pt-3">
              {ai.hookType && ai.hookType.length > 0 ? <div className="flex flex-wrap gap-1.5">{ai.hookType.map((t) => <Badge key={t} tone="info">{t}</Badge>)}</div> : null}
              {ai.hookOordeel ? <p className="text-sm">{ai.hookOordeel}</p> : null}
              <Section title="Wat gaat goed?" items={ai.watGoed} tone="text-[var(--color-good)]" />
              <Section title="Wat kan beter?" items={ai.watBeter} tone="text-[var(--color-warn)]" />
              <Section title="Wat moet worden aangepast?" items={ai.watAanpassen} tone="text-[var(--color-ink)]" />
              <Section title="Kijkersreis" items={ai.kijkersreis} tone="text-[var(--color-ink-muted)]" />
              <Section title="Natuurlijk taalgebruik / struikelpunten" items={ai.natuurlijkTaalgebruik} tone="text-[var(--color-ink-muted)]" />
              {ai.feitenTeControleren && ai.feitenTeControleren.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-warn)]"><AlertTriangle className="size-4" /> Handmatige controle nodig</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">{ai.feitenTeControleren.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ) : null}
              {ai.alternatieveHooks && ai.alternatieveHooks.length > 0 ? (
                <div>
                  <div className="mb-1 text-sm font-semibold">Alternatieve hooks</div>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">{ai.alternatieveHooks.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ) : null}
              {ai.verbeterdScript ? (
                <div>
                  <div className="mb-1 text-sm font-semibold">Verbeterd script</div>
                  <p className="mb-2 text-2xs text-[var(--color-ink-faint)]">Origineel vs. voorstel. Je neemt elk onderdeel apart over — er wordt nooit automatisch overschreven.</p>
                  {(["hook", "body", "cta"] as const).map((f) => {
                    const improved = ai.verbeterdScript?.[f];
                    if (!improved || improved === orig[f]) return null;
                    return (
                      <div key={f} className="mb-2 rounded-[var(--radius-md)] border border-[var(--color-line)] p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{f === "hook" ? "Hook" : f === "body" ? "Middenstuk" : "CTA"}</span>
                          {canApply ? <button disabled={applying} onClick={() => apply(f, improved)} className="text-2xs font-medium text-[var(--color-brand-600)] hover:underline">overnemen</button> : null}
                        </div>
                        <p className="text-xs text-[var(--color-ink-faint)] line-through">{orig[f] || "(leeg)"}</p>
                        <p className="mt-1 text-xs text-[var(--color-ink)]">{improved}</p>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-ink-muted)]">Geen AI-oordeel ontvangen.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function Section({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className={`mb-1 text-sm font-semibold ${tone}`}>{title}</div>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}
