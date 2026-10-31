"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Heading, Image as ImageIcon, Loader2, Plus, Save, Table2, Text, Trash2 } from "lucide-react";
import { updateTemplate } from "@/server/actions/quotes";
import type { QuoteBlock, QuoteContent } from "@/lib/quotes";

export function TemplateEditor({ id, name: initialName, content: initial }: { id: string; name: string; content: QuoteContent }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [intro, setIntro] = useState(initial.intro ?? "");
  const [blocks, setBlocks] = useState<QuoteBlock[]>(initial.blocks ?? []);

  const setBlock = (i: number, b: QuoteBlock) => setBlocks((bs) => bs.map((x, j) => (j === i ? b : x)));
  const move = (i: number, dir: -1 | 1) => setBlocks((bs) => { const j = i + dir; if (j < 0 || j >= bs.length) return bs; const c = [...bs]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  const add = (b: QuoteBlock) => setBlocks((bs) => [...bs, b]);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateTemplate({ id, name, content: { intro, blocks } });
      setMsg(res.ok ? "Opgeslagen als nieuwe versie." : res.message ?? "Mislukt.");
      if (res.ok) router.refresh();
    });
  }

  const hasLineItems = blocks.some((b) => b.type === "lineItems");
  const hasCover = blocks.some((b) => b.type === "cover");

  return (
    <div className="space-y-4">
      <div className="sc-card flex flex-wrap items-center gap-2 p-3">
        <button type="button" disabled={pending} onClick={save} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Opslaan</button>
        {msg ? <span className="text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
        <span className="ml-auto text-2xs text-[var(--color-ink-faint)]">Tip: gebruik {"{{bedrijf}}"} en {"{{contactpersoon}}"} als variabelen.</span>
      </div>

      <div className="sc-card space-y-3 p-4">
        <div><label className="sc-label">Naam sjabloon</label><input className="sc-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="sc-label">Introtekst</label><textarea className="sc-input min-h-[90px]" value={intro} onChange={(e) => setIntro(e.target.value)} /></div>
      </div>

      <div className="space-y-2">
        {blocks.map((b, i) => (
          <div key={i} className="sc-card p-3">
            <div className="mb-1.5 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {b.type === "cover" ? "Cover" : b.type === "heading" ? "Kop" : b.type === "paragraph" ? "Tekst" : b.type === "terms" ? "Voorwaarden" : b.type === "lineItems" ? "Prijstabel" : "Afbeelding"}
              <span className="ml-auto flex items-center gap-0.5">
                <button type="button" onClick={() => move(i, -1)} className="grid size-6 place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><ArrowUp className="size-3.5" /></button>
                <button type="button" onClick={() => move(i, 1)} className="grid size-6 place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><ArrowDown className="size-3.5" /></button>
                <button type="button" onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))} className="grid size-6 place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"><Trash2 className="size-3.5" /></button>
              </span>
            </div>
            {b.type === "cover" ? (
              <div className="space-y-1.5">
                <input className="sc-input" placeholder="Eyebrow (bijv. Offerte 2026)" value={b.eyebrow ?? ""} onChange={(e) => setBlock(i, { ...b, eyebrow: e.target.value })} />
                <input className="sc-input font-semibold" placeholder="Grote titel" value={b.title} onChange={(e) => setBlock(i, { ...b, title: e.target.value })} />
                <textarea className="sc-input min-h-[60px]" placeholder="Ondertitel" value={b.subtitle ?? ""} onChange={(e) => setBlock(i, { ...b, subtitle: e.target.value })} />
                {b.stats && b.stats.length ? <p className="text-2xs text-[var(--color-ink-faint)]">Statistieken op de cover: {b.stats.map((s) => `${s.value} ${s.label}`).join(" · ")}</p> : null}
              </div>
            ) : b.type === "heading" ? (
              <input className="sc-input" value={b.text} onChange={(e) => setBlock(i, { type: "heading", text: e.target.value })} />
            ) : b.type === "paragraph" ? (
              <textarea className="sc-input min-h-[70px]" value={b.text} onChange={(e) => setBlock(i, { type: "paragraph", text: e.target.value })} />
            ) : b.type === "terms" ? (
              <>
                <input className="sc-input mb-1.5" placeholder="Titel" value={b.title ?? ""} onChange={(e) => setBlock(i, { type: "terms", title: e.target.value, text: b.text })} />
                <textarea className="sc-input min-h-[70px]" value={b.text} onChange={(e) => setBlock(i, { type: "terms", title: b.title, text: e.target.value })} />
              </>
            ) : b.type === "image" ? (
              <input className="sc-input" placeholder="Afbeelding-URL" value={b.url} onChange={(e) => setBlock(i, { type: "image", url: e.target.value, alt: b.alt })} />
            ) : b.type === "lineItems" ? (
              <input className="sc-input" placeholder="Titel boven de prijstabel" value={b.title ?? ""} onChange={(e) => setBlock(i, { type: "lineItems", title: e.target.value })} />
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {!hasCover ? <button type="button" onClick={() => setBlocks((bs) => [{ type: "cover", eyebrow: "Offerte 2026", title: "De short content afdeling van jouw merk.", subtitle: "" }, ...bs])} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"><Plus className="size-3.5" /> Cover</button> : null}
        <button type="button" onClick={() => add({ type: "heading", text: "Nieuwe kop" })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"><Heading className="size-3.5" /> Kop</button>
        <button type="button" onClick={() => add({ type: "paragraph", text: "" })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"><Text className="size-3.5" /> Tekst</button>
        <button type="button" onClick={() => add({ type: "image", url: "" })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"><ImageIcon className="size-3.5" /> Afbeelding</button>
        {!hasLineItems ? <button type="button" onClick={() => add({ type: "lineItems", title: "Investering" })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"><Table2 className="size-3.5" /> Prijstabel</button> : null}
        <button type="button" onClick={() => add({ type: "terms", title: "Voorwaarden", text: "" })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"><Plus className="size-3.5" /> Voorwaarden</button>
      </div>
    </div>
  );
}
