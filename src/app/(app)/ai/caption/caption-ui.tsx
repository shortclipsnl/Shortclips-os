"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarPlus, Check, FileText, Loader2, RefreshCw, Sparkles, Tag, X } from "lucide-react";
import { addCaptionToPlanning, generateCaptions, regenerateOneCaption, type ShortCaption } from "@/server/actions/ai-tools";
import { getCaptionFooter, setCaptionFooter } from "@/server/actions/caption-footer";
import { Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, SaveInsight, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";

/** Caption + de vaste footer van de klant eronder (de standaard dingetjes). */
function withFooter(caption: string, footer: string): string {
  const c = caption.trimEnd();
  const f = footer.trim();
  return f ? `${c}\n\n${f}` : c;
}

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

  // Standaard footer van de gekozen klant (contact + hashtags) — komt
  // automatisch onder elke caption. Laadt bij het kiezen van een klant.
  const [footer, setFooter] = useState("");
  const [footerLoading, setFooterLoading] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setFooter("");
      return;
    }
    let active = true;
    setFooterLoading(true);
    void getCaptionFooter(clientId).then((res) => {
      if (!active) return;
      setFooter(res.ok ? res.footer ?? "" : "");
      setFooterLoading(false);
    });
    return () => {
      active = false;
    };
  }, [clientId]);

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

      {clientId ? <FooterEditor clientId={clientId} footer={footer} setFooter={setFooter} loading={footerLoading} /> : null}

      {results && results.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{results.length} shorts · captions</h2>
            <div className="flex items-center gap-2">
              <SaveInsight clientId={clientId} defaultCategory="tone_of_voice" />
              <CopyButton label="Alles kopiëren" text={results.map((r, i) => exportShort(r, i, footer)).join("\n\n———\n\n")} />
            </div>
          </div>
          {results.map((short, i) => (
            <ShortBlock
              key={i}
              index={i}
              short={short}
              clientId={clientId}
              footer={footer}
              pdfBase64={pdfBase64}
              onChange={(next) => setResults((cur) => cur!.map((s, j) => (j === i ? next : s)))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function exportShort(s: ShortCaption, i: number, footer: string): string {
  const body = footer.trim()
    ? withFooter(s.caption, footer)
    : `${s.caption}${(s.hashtags ?? []).length ? `\n\n${(s.hashtags ?? []).join(" ")}` : ""}`;
  return `SHORT ${i + 1}: ${s.shortTitle}\n\n${body}`;
}

function ShortBlock({
  index,
  short,
  clientId,
  footer,
  pdfBase64,
  onChange,
}: {
  index: number;
  short: ShortCaption;
  clientId: string;
  footer: string;
  pdfBase64: string | null;
  onChange: (s: ShortCaption) => void;
}) {
  const [pending, start] = useTransition();
  const [planning, startPlanning] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasFooter = footer.trim().length > 0;
  const full = (hasFooter
    ? withFooter(short.caption, footer)
    : `${short.caption}${short.hashtags?.length ? `\n\n${short.hashtags.join(" ")}` : ""}`
  ).trim();

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
      const res = await addCaptionToPlanning({ clientId, shortTitle: short.shortTitle, caption: hasFooter ? withFooter(short.caption, footer) : short.caption });
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
        {hasFooter ? (
          <div className="mt-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)]/60 p-2.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Standaard footer — komt hier automatisch onder</span>
            <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-ink-muted)]">{footer}</p>
          </div>
        ) : (
          <div className="mt-3">
            <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Eventueel toepasbare hashtags</span>
            {short.hashtags?.length ? (
              <p className="mt-1 text-sm text-[var(--color-brand-600)]">{short.hashtags.join(" ")}</p>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-ink-faint)]">Geen hashtags voorgesteld.</p>
            )}
          </div>
        )}
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
  );
}

/**
 * Bewerkbare standaard footer per klant: het vaste contactblok + hashtags dat
 * automatisch onder elke caption komt. Vooraf gevuld uit de contentplanning.
 */
function FooterEditor({ clientId, footer, setFooter, loading }: { clientId: string; footer: string; setFooter: (s: string) => void; loading: boolean }) {
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    startSave(async () => {
      const res = await setCaptionFooter({ clientId, footer });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } else setErr(res.message ?? "Opslaan mislukt.");
    });
  }

  return (
    <Card className="border-[var(--color-brand-500)]/25 bg-[color-mix(in_srgb,var(--color-brand-500)_4%,var(--color-surface))]">
      <div className="flex items-center gap-2">
        <Tag className="size-4 text-[var(--color-brand-600)]" />
        <h3 className="text-sm font-semibold">Standaard footer voor deze klant</h3>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Het vaste contactblok en de hashtags die onder élke post van deze klant komen — automatisch onder elke caption. Je schrijft dus alleen de bovenste tekst. Aanpassen mag.
      </p>
      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"><Loader2 className="size-4 animate-spin" /> Footer laden…</p>
      ) : (
        <>
          <textarea
            className="sc-input mt-3 resize-y text-sm leading-relaxed"
            rows={7}
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            placeholder="Nog geen standaard footer voor deze klant. Plak hier het vaste contactblok + hashtags, of laat leeg."
          />
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={save} disabled={saving} size="sm" variant="secondary">
              {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4 text-[var(--color-good)]" /> : null}
              {saved ? "Opgeslagen" : "Footer opslaan"}
            </Button>
            <span className="text-xs text-[var(--color-ink-faint)]">Komt automatisch onder elke caption.</span>
          </div>
          {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
        </>
      )}
    </Card>
  );
}
