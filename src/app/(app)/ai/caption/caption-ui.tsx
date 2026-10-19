"use client";

import { useRef, useState, useTransition } from "react";
import { CalendarPlus, Check, FileText, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { addCaptionToPlanning, generateCaptions, regenerateOneCaption, type ShortCaption } from "@/server/actions/ai-tools";
import { Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, SaveInsight, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";

type ClientOption = { id: string; name: string };

const isDoc = (n: string) => /\.(pdf|docx)$/i.test(n);
const PLATFORMS = "Instagram · TikTok · Facebook · YouTube Shorts";

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
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<ShortCaption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!isDoc(file.name)) {
      setErr("Alleen een PDF- of Word-bestand (.pdf of .docx).");
      return;
    }
    setErr(null);
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

  function clearFile() {
    setFileName(null);
    setPdfBase64(null);
    setDocxBase64(null);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    await onFile(e.dataTransfer.files?.[0]);
  }

  function run() {
    if (!clientId) {
      setErr("Kies eerst een klant.");
      return;
    }
    if (!pdfBase64 && !docxBase64) {
      setErr("Sleep het scriptbestand erin (PDF of Word).");
      return;
    }
    setErr(null);
    start(async () => {
      const res = await generateCaptions({ clientId, pdfBase64: pdfBase64 ?? undefined, docxBase64: docxBase64 ?? undefined });
      if (res.ok) setResults(res.data);
      else setErr(res.message);
    });
  }

  return (
    <div className="space-y-5">
      <ToolHowTo
        steps={[
          "Kies de klant en sleep het scriptbestand erin (PDF of Word).",
          "Klik op Captions genereren. Je krijgt per short één caption met eventuele hashtags.",
          "De toon per klant stel je in via de AI-kennisbank.",
        ]}
      />
      {!aiReady ? <NoProviderNote /> : null}
      <HistoryPanel items={recent} onLoad={(o) => setResults(o)} />

      <Card>
        {/* Scriptbestand links (hoofdinvoer, slepen), klant rechts. */}
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <div>
            <label className="sc-label">Scriptbestand</label>
            {fileName ? (
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-4 py-5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileText className="size-6 shrink-0 text-[var(--color-brand-600)]" strokeWidth={1.75} />
                  <span className="truncate text-sm font-medium">{fileName}</span>
                </span>
                <button type="button" onClick={clearFile} aria-label="Bestand verwijderen" className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-8 text-center transition ${dragOver ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"}`}
              >
                <FileText className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
                <span className="text-sm font-medium">Sleep hier het scriptbestand naartoe</span>
                <span className="text-xs text-[var(--color-ink-faint)]">of klik om te kiezen · PDF of Word (.docx)</span>
              </div>
            )}
            <input ref={inputRef} type="file" accept=".pdf,.docx,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          <div>
            <label className="sc-label">Klant</label>
            <select className="sc-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Kies een klant…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              Eén caption per short voor {PLATFORMS}, met eventueel toepasbare hashtags.
            </p>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{results.length} shorts · captions</h2>
            <div className="flex items-center gap-2">
              <SaveInsight clientId={clientId} defaultCategory="tone_of_voice" />
              <CopyButton label="Alles kopiëren" text={results.map((r, i) => exportShort(r, i)).join("\n\n———\n\n")} />
            </div>
          </div>
          {results.map((short, i) => (
            <ShortBlock
              key={i}
              index={i}
              short={short}
              clientId={clientId}
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
  const tags = (s.hashtags ?? []).join(" ");
  return `SHORT ${i + 1}: ${s.shortTitle}\n\n${s.caption}${tags ? `\n\n${tags}` : ""}`;
}

function ShortBlock({
  index,
  short,
  clientId,
  pdfBase64,
  onChange,
}: {
  index: number;
  short: ShortCaption;
  clientId: string;
  pdfBase64: string | null;
  onChange: (s: ShortCaption) => void;
}) {
  const [pending, start] = useTransition();
  const [planning, startPlanning] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const full = `${short.caption}${short.hashtags?.length ? `\n\n${short.hashtags.join(" ")}` : ""}`.trim();

  function regen() {
    start(async () => {
      const res = await regenerateOneCaption({
        clientId,
        shortTitle: short.shortTitle,
        hook: short.hook,
        pdfBase64: pdfBase64 ?? undefined,
      });
      if (res.ok) onChange(res.data);
      else setErr(res.message);
    });
  }

  function toPlanning() {
    setErr(null);
    startPlanning(async () => {
      const res = await addCaptionToPlanning({ clientId, shortTitle: short.shortTitle, caption: short.caption });
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

      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Caption · {PLATFORMS}</span>
          <CopyButton text={full} />
        </div>
        <textarea
          className="sc-input resize-y text-sm"
          rows={5}
          value={short.caption}
          onChange={(e) => onChange({ ...short, caption: e.target.value })}
        />
        <div className="mt-3">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Eventueel toepasbare hashtags</span>
          {short.hashtags?.length ? (
            <p className="mt-1 text-sm text-[var(--color-brand-600)]">{short.hashtags.join(" ")}</p>
          ) : (
            <p className="mt-1 text-sm text-[var(--color-ink-faint)]">Geen hashtags voorgesteld.</p>
          )}
        </div>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
  );
}
