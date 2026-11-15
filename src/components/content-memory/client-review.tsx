"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Pencil } from "lucide-react";
import { setInsightReviewAction } from "@/server/actions/content-memory";

type Decision = "tonen" | "verbergen";
type Tier = "bewezen" | "voorlopig" | "hypothese";
const TIER: Record<Tier, { label: string; cls: string }> = {
  bewezen: { label: "Bewezen", cls: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  voorlopig: { label: "Voorlopig", cls: "bg-[var(--color-warn-soft)] text-[#8a5a00]" },
  hypothese: { label: "Hypothese", cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
};

/**
 * Per inzicht: bepaalt het team of de klant het ziet in "Wat werkt bij jouw
 * bedrijf?" en met welke tekst. Standaard ziet de klant niets.
 */
export function ClientReviewControl({
  clientId,
  itemKey,
  decision,
  tier,
  defaultTitle,
  defaultText,
  clientTitle,
  clientText,
}: {
  clientId: string;
  itemKey: string;
  decision: Decision | null;
  tier: Tier;
  defaultTitle: string;
  defaultText: string;
  clientTitle: string | null;
  clientText: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<Decision | null>(decision);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(clientTitle ?? defaultTitle);
  const [text, setText] = useState(clientText ?? defaultText);
  const [error, setError] = useState<string | null>(null);

  const save = (next: Decision) =>
    start(async () => {
      setError(null);
      const r = await setInsightReviewAction(clientId, {
        key: itemKey,
        decision: next,
        // Alleen een afwijkende tekst opslaan; de standaardtekst blijft met de cijfers meebewegen.
        clientTitle: title.trim() && title.trim() !== defaultTitle ? title : null,
        clientText: text.trim() && text.trim() !== defaultText ? text : null,
      });
      if (r.ok) { setCurrent(next); setEditing(false); router.refresh(); } else setError(r.message);
    });

  const btn = "inline-flex items-center gap-1 rounded-md border border-[var(--color-line)] px-2 py-1 text-[11.5px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-50";
  const t = TIER[tier];
  return (
    <div className="mt-2.5 rounded-md border border-dashed border-[var(--color-line-strong)] px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Klantportaal</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${current === "tonen" ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
          {current === "tonen" ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          {current === "tonen" ? "Zichtbaar voor klant" : current === "verbergen" ? "Bewust verborgen" : "Nog niet beoordeeld"}
        </span>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.cls}`} title="Niveau zoals de klant het ziet">{t.label} voor klant</span>
        {current !== "tonen" ? <button type="button" disabled={pending} onClick={() => save("tonen")} className={btn}><Eye className="size-3" />Goedkeuren voor klant</button> : null}
        <button type="button" disabled={pending} onClick={() => setEditing((v) => !v)} className={btn}><Pencil className="size-3" />Tekst aanpassen</button>
        {current !== "verbergen" ? <button type="button" disabled={pending} onClick={() => save("verbergen")} className={`${btn} opacity-80`}><EyeOff className="size-3" />{current === "tonen" ? "Verbergen" : "Afwijzen"}</button> : null}
        {error ? <span className="text-[11.5px] text-[var(--color-bad)]">{error}</span> : null}
      </div>
      {editing ? (
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1 text-[11.5px] font-medium text-[var(--color-ink-muted)]">
            Titel voor de klant
            <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-ink)]" />
          </label>
          <label className="grid gap-1 text-[11.5px] font-medium text-[var(--color-ink-muted)]">
            Toelichting voor de klant
            <textarea value={text} maxLength={600} rows={2} onChange={(e) => setText(e.target.value)} className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-ink)]" />
          </label>
          <p className="text-[11.5px] text-[var(--color-ink-muted)]">Het aantal video&apos;s en het bewijs komen altijd uit de actuele resultaten en zijn niet aan te passen.</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={pending} onClick={() => save("tonen")} className={`${btn} border-transparent bg-[var(--color-indigo-ink)] text-white hover:bg-[var(--color-indigo-soft)]`}>Opslaan en tonen aan klant</button>
            <button type="button" disabled={pending} onClick={() => { setTitle(defaultTitle); setText(defaultText); }} className={btn}>Standaardtekst terugzetten</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
