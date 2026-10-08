"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Check, Loader2, RefreshCw, Sparkles, Upload } from "lucide-react";
import { addCaptionToPlanning, generateCaptions, regenerateOneCaption, type ShortCaption } from "@/server/actions/ai-tools";
import { Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, fileToBase64, type HistoryEntry } from "../_shared";

type ClientOption = { id: string; name: string };

export function CaptionMaker({
  clients,
  aiReady,
  recent,
}: {
  clients: ClientOption[];
  aiReady: boolean;
  recent: HistoryEntry<ShortCaption[]>[];
}) {
  const [clientId, setClientId] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [results, setResults] = useState<ShortCaption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const b64 = await fileToBase64(file);
    if (file.name.toLowerCase().endsWith(".docx")) {
      setDocxBase64(b64);
      setPdfBase64(null);
    } else {
      setPdfBase64(b64);
      setDocxBase64(null);
    }
  }

  function run() {
    if (!clientId) {
      setErr("Kies eerst een klant.");
      return;
    }
    setErr(null);
    start(async () => {
      const res = await generateCaptions({ clientId, scriptText, pdfBase64: pdfBase64 ?? undefined, docxBase64: docxBase64 ?? undefined });
      if (res.ok) setResults(res.data);
      else setErr(res.message);
    });
  }

  return (
    <div className="space-y-5">
      {!aiReady ? <NoProviderNote /> : null}
      <HistoryPanel items={recent} onLoad={(o) => setResults(o)} />

      <Card>
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div>
            <label className="sc-label">Klant</label>
            <select className="sc-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Kies een klant…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label className="sc-label mt-4">Script-bestand (PDF of Word)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              <Upload className="size-4" />
              {fileName ?? "Bestand kiezen"}
              <input type="file" accept=".pdf,.docx,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          <div>
            <label className="sc-label">Of plak de scripts</label>
            <textarea
              className="sc-input resize-y font-mono text-xs leading-relaxed"
              rows={12}
              placeholder="Plak hier één of meer scripts. De AI herkent zelf hoeveel shorts erin staan."
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-[var(--color-line)] pt-4">
          <Button onClick={run} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Captions genereren
          </Button>
          {results ? (
            <Button variant="secondary" onClick={run} disabled={pending}>
              <RefreshCw className="size-4" />
              Alles opnieuw
            </Button>
          ) : null}
        </div>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>

      {results && results.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{results.length} shorts · captions</h2>
            <CopyButton label="Alles kopiëren" text={results.map((r, i) => exportShort(r, i)).join("\n\n———\n\n")} />
          </div>
          {results.map((short, i) => (
            <ShortBlock
              key={i}
              index={i}
              short={short}
              clientId={clientId}
              scriptText={scriptText}
              pdfBase64={pdfBase64}
              onChange={(next) => setResults((cur) => cur!.map((s, j) => (j === i ? next : s)))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function exportShort(s: ShortCaption, i: number): string {
  const ig = `${s.instagram.caption}\n\n${(s.instagram.hashtags ?? []).join(" ")}`.trim();
  const tt = `${s.tiktok.caption}\n\n${(s.tiktok.hashtags ?? []).join(" ")}`.trim();
  return `SHORT ${i + 1}: ${s.shortTitle}\n\n[Instagram]\n${ig}\n\n[TikTok]\n${tt}`;
}

function ShortBlock({
  index,
  short,
  clientId,
  scriptText,
  pdfBase64,
  onChange,
}: {
  index: number;
  short: ShortCaption;
  clientId: string;
  scriptText: string;
  pdfBase64: string | null;
  onChange: (s: ShortCaption) => void;
}) {
  const [pending, start] = useTransition();
  const [planning, startPlanning] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function regen() {
    start(async () => {
      const res = await regenerateOneCaption({
        clientId,
        shortTitle: short.shortTitle,
        hook: short.hook,
        scriptText,
        pdfBase64: pdfBase64 ?? undefined,
      });
      if (res.ok) onChange(res.data);
      else setErr(res.message);
    });
  }

  function toPlanning() {
    setErr(null);
    startPlanning(async () => {
      const res = await addCaptionToPlanning({
        clientId,
        shortTitle: short.shortTitle,
        instagramCaption: short.instagram.caption,
        tiktokCaption: short.tiktok.caption,
      });
      if (res.ok) setSaved(true);
      else setErr(res.message ?? "Mislukt");
    });
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Short {index + 1}: <span className="font-normal text-[var(--color-ink-muted)]">{short.shortTitle}</span>
        </h3>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={toPlanning} disabled={planning || saved}>
            {saved ? <Check className="size-3.5 text-[var(--color-good)]" /> : planning ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarPlus className="size-3.5" />}
            {saved ? "In planning" : "Naar contentplanning"}
          </Button>
          <Button size="sm" variant="ghost" onClick={regen} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Opnieuw
          </Button>
        </div>
      </div>
      {short.hook ? <p className="mb-3 text-xs text-[var(--color-ink-faint)]">Hook: {short.hook}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Platform
          label="Instagram"
          caption={short.instagram.caption}
          hashtags={short.instagram.hashtags ?? []}
          onCaption={(v) => onChange({ ...short, instagram: { ...short.instagram, caption: v } })}
        />
        <Platform
          label="TikTok"
          caption={short.tiktok.caption}
          hashtags={short.tiktok.hashtags ?? []}
          onCaption={(v) => onChange({ ...short, tiktok: { ...short.tiktok, caption: v } })}
        />
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
  );
}

function Platform({
  label,
  caption,
  hashtags,
  onCaption,
}: {
  label: string;
  caption: string;
  hashtags: string[];
  onCaption: (v: string) => void;
}) {
  const full = `${caption}\n\n${hashtags.join(" ")}`.trim();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
        <CopyButton text={full} />
      </div>
      <textarea className="sc-input resize-y text-sm" rows={5} value={caption} onChange={(e) => onCaption(e.target.value)} />
      {hashtags.length ? <p className="mt-2 text-xs text-[var(--color-brand-600)]">{hashtags.join(" ")}</p> : null}
    </div>
  );
}
