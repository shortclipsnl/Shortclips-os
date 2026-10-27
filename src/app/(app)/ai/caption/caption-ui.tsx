"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarPlus, Check, FileText, Film, Languages, Loader2, RefreshCw, Sparkles, Tag, X } from "lucide-react";
import { addCaptionToPlanning, createCaptionPdfUploadUrl, generateCaptions, regenerateOneCaption, getShootVideoSummary, type ShortCaption } from "@/server/actions/ai-tools";
import { listShootDaysForClient } from "@/server/actions/script-generate";
import { getCaptionFooter, setCaptionFooter } from "@/server/actions/caption-footer";
import { Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, SaveInsight, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";
import { ClientPicker } from "../client-picker";

/** Caption + de vaste footer van de klant eronder (de standaard dingetjes). */
function withFooter(caption: string, footer: string): string {
  const c = caption.trimEnd();
  const f = footer.trim();
  return f ? `${c}\n\n${f}` : c;
}

type ClientOption = { id: string; name: string; logoUrl?: string | null; color?: string | null };

const isDoc = (n: string) => /\.(pdf|docx)$/i.test(n);
const PLATFORMS = "Instagram · TikTok · Facebook · YouTube Shorts";

/** ISO-datum → korte NL-datum (bijv. "9 nov 2026"). */
function fmtNl(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

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
  // Het gekozen PDF-bestand blijft als File bewaard; de upload naar de opslag
  // gebeurt pas bij 'genereren' (dan is de klant gekozen). `pdfRef` is de
  // resolved verwijzing (opslagpad of base64-terugval), herbruikt bij regenereren.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfRef, setPdfRef] = useState<{ storagePath?: string; base64?: string } | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<ShortCaption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Taal van de captions: Nederlands (standaard) of Engels — direct schakelbaar.
  const [language, setLanguage] = useState<"nl" | "en">("nl");
  // Opname koppelen: zo weet je welke captions bij welke opname horen en hoeveel
  // video's van die opname uiteindelijk gebruikt/ingezet zijn.
  const [shootDays, setShootDays] = useState<Array<{ id: string; scheduledOn: string; title: string }>>([]);
  const [shootDayId, setShootDayId] = useState("");
  const [shootSummary, setShootSummary] = useState<{ videosTotal: number; videosPublished: number } | null>(null);

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

  // Opnames van de klant laden om aan te kunnen koppelen (opnamedag = sessie).
  useEffect(() => {
    setShootDayId("");
    setShootSummary(null);
    if (!clientId) { setShootDays([]); return; }
    let active = true;
    void listShootDaysForClient(clientId).then((days) => { if (active) setShootDays(days); }).catch(() => { if (active) setShootDays([]); });
    return () => { active = false; };
  }, [clientId]);

  // Samenvatting van de gekozen opname: hoeveel video's gekoppeld/ingezet.
  useEffect(() => {
    if (!shootDayId) { setShootSummary(null); return; }
    let active = true;
    void getShootVideoSummary(shootDayId).then((r) => { if (active) setShootSummary(r.ok ? { videosTotal: r.videosTotal, videosPublished: r.videosPublished } : null); }).catch(() => { if (active) setShootSummary(null); });
    return () => { active = false; };
  }, [shootDayId]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!isDoc(file.name)) {
      setErr("Alleen een PDF- of Word-bestand (.pdf of .docx).");
      return;
    }
    setErr(null);
    setFileName(file.name);
    setPdfRef(null);
    if (file.name.toLowerCase().endsWith(".docx")) {
      // Word-bestanden zijn klein → gewoon base64 (geen uploadlimiet-probleem).
      setPdfFile(null);
      setDocxBase64(await fileToBase64(file));
    } else {
      // PDF: pas bij genereren uploaden (klant dan bekend), dus hier alleen bewaren.
      setDocxBase64(null);
      setPdfFile(file);
    }
  }

  function clearFile() {
    setFileName(null);
    setPdfFile(null);
    setPdfRef(null);
    setDocxBase64(null);
  }

  // Lost het PDF-bestand op tot een verwijzing: upload groot bestand direct naar
  // de opslag (langs Vercel's ~4,5MB request-limiet) en geef het opslagpad terug;
  // lukt dat niet, val terug op base64 (werkt voor kleine bestanden). Eenmaal
  // opgelost wordt de verwijzing hergebruikt (ook bij regenereren).
  async function resolvePdf(): Promise<{ storagePath?: string; base64?: string } | null> {
    if (!pdfFile) return null;
    if (pdfRef) return pdfRef;
    let ref: { storagePath?: string; base64?: string };
    try {
      const up = await createCaptionPdfUploadUrl(clientId);
      if (up.ok && up.uploadUrl && up.key) {
        const put = await fetch(up.uploadUrl, { method: "PUT", headers: up.headers, body: pdfFile });
        ref = put.ok ? { storagePath: up.key } : { base64: await fileToBase64(pdfFile) };
      } else {
        ref = { base64: await fileToBase64(pdfFile) };
      }
    } catch {
      ref = { base64: await fileToBase64(pdfFile) };
    }
    setPdfRef(ref);
    return ref;
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
    if (!pdfFile && !docxBase64) {
      setErr("Sleep het scriptbestand erin (PDF of Word).");
      return;
    }
    setErr(null);
    start(async () => {
      const ref = await resolvePdf();
      const res = await generateCaptions({ clientId, pdfBase64: ref?.base64, pdfStoragePath: ref?.storagePath, docxBase64: docxBase64 ?? undefined, language, productionDayId: shootDayId || undefined });
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
            <ClientPicker clients={clients} value={clientId} onChange={setClientId} />


            {/* Taal: Nederlands of Engels — direct schakelbaar, zonder zelf te vertalen. */}
            <label className="sc-label mt-3 flex items-center gap-1.5"><Languages className="size-3.5" /> Taal</label>
            <div className="inline-flex w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5 text-sm">
              <button type="button" onClick={() => setLanguage("nl")} className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1 font-medium transition ${language === "nl" ? "bg-[var(--color-brand-600)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>Nederlands</button>
              <button type="button" onClick={() => setLanguage("en")} className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1 font-medium transition ${language === "en" ? "bg-[var(--color-brand-600)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>Engels</button>
            </div>

            {/* Opname koppelen (optioneel): zo weet je welke captions bij welke opname horen. */}
            {clientId ? (
              <>
                <label className="sc-label mt-3 flex items-center gap-1.5"><Film className="size-3.5" /> Opname koppelen <span className="font-normal normal-case text-[var(--color-ink-faint)]">— optioneel</span></label>
                <select className="sc-input" value={shootDayId} onChange={(e) => setShootDayId(e.target.value)} disabled={shootDays.length === 0}>
                  <option value="">{shootDays.length === 0 ? "Geen aankomende opnames" : "Geen opname koppelen"}</option>
                  {shootDays.map((d) => (
                    <option key={d.id} value={d.id}>{fmtNl(d.scheduledOn)} — {d.title}</option>
                  ))}
                </select>
                {shootDayId && shootSummary ? (
                  <p className="mt-1.5 text-2xs text-[var(--color-ink-muted)]">
                    Deze opname: <strong>{shootSummary.videosTotal}</strong> video{shootSummary.videosTotal === 1 ? "" : "'s"} gekoppeld · <strong>{shootSummary.videosPublished}</strong> gepubliceerd (ingezet).
                  </p>
                ) : null}
              </>
            ) : null}

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
              pdfRef={pdfRef}
              language={language}
              productionDayId={shootDayId || undefined}
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
  pdfRef,
  language,
  productionDayId,
  onChange,
}: {
  index: number;
  short: ShortCaption;
  clientId: string;
  footer: string;
  pdfRef: { storagePath?: string; base64?: string } | null;
  language: "nl" | "en";
  productionDayId?: string;
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

  function regen(variant?: "variatie" | "met_cta" | "zonder_cta" | "korter" | "langer") {
    setErr(null);
    start(async () => {
      const res = await regenerateOneCaption({
        clientId,
        shortTitle: short.shortTitle,
        hook: short.hook,
        pdfBase64: pdfRef?.base64,
        pdfStoragePath: pdfRef?.storagePath,
        variant,
        language,
      });
      if (res.ok) onChange(res.data);
      else setErr(res.message);
    });
  }

  const VARIANTS: { key: "met_cta" | "zonder_cta" | "korter" | "langer"; label: string }[] = [
    { key: "met_cta", label: "Met CTA" },
    { key: "zonder_cta", label: "Zonder CTA" },
    { key: "korter", label: "Korter" },
    { key: "langer", label: "Langer" },
  ];

  function toPlanning() {
    setErr(null);
    startPlanning(async () => {
      const res = await addCaptionToPlanning({ clientId, shortTitle: short.shortTitle, caption: hasFooter ? withFooter(short.caption, footer) : short.caption, productionDayId });
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
          <Button size="sm" variant="ghost" onClick={() => regen()} disabled={pending}>
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
        {/* Snel een andere versie: met/zonder CTA, korter of langer. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          <span className="text-2xs text-[var(--color-ink-faint)]">Andere versie:</span>
          {VARIANTS.map((v) => (
            <button
              key={v.key}
              type="button"
              disabled={pending}
              onClick={() => regen(v.key)}
              className="rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
            >
              {v.label}
            </button>
          ))}
        </div>
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
