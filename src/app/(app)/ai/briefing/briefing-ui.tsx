"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Loader2, Sparkles, X } from "lucide-react";
import { generateBriefing, type EditorBriefing } from "@/server/actions/ai-tools";
import { Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";

type ClientOption = { id: string; name: string };

const isDoc = (n: string) => /\.(pdf|docx)$/i.test(n);

export function BriefingMaker({
  clients,
  aiReady,
  recent,
}: {
  clients: ClientOption[];
  aiReady: boolean;
  recent: HistoryEntry<EditorBriefing>[];
}) {
  const [clientId, setClientId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<EditorBriefing | null>(null);
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
      const res = await generateBriefing({ clientId, pdfBase64: pdfBase64 ?? undefined, docxBase64: docxBase64 ?? undefined });
      if (res.ok) setResult(res.data);
      else setErr(res.message);
    });
  }

  return (
    <div className="space-y-5">
      <ToolHowTo
        steps={[
          "Kies de klant en sleep het scriptbestand erin (PDF of Word).",
          "Je krijgt een compacte briefing: hoeveel video's het zijn en wat per video belangrijk is.",
          "Controleer hem en deel hem met je editor.",
        ]}
      />
      {!aiReady ? <NoProviderNote /> : null}
      <HistoryPanel items={recent} onLoad={(o) => setResult(o)} />

      <Card>
        {/* Scriptbestand staat links en is de hoofdinvoer; klant kiezen rechts. */}
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
              <option value="">Kies…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              De assistent telt zelf hoeveel video&apos;s het zijn en maakt per video een korte, scanbare omschrijving.
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <Button onClick={run} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Briefing genereren
          </Button>
        </div>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>

      {result ? <BriefingView briefing={result} /> : null}
    </div>
  );
}

function BriefingView({ briefing }: { briefing: EditorBriefing }) {
  const intro = briefing.projectIntro;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Briefing</h2>
        <CopyButton label="Hele briefing kopiëren" text={briefingToText(briefing)} />
      </div>
      {/* Compacte, scanbare briefing — één kaart die je in z'n geheel kunt kopiëren. */}
      <Card>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-sm font-semibold">{intro?.client || "Briefing"}</h3>
          <span className="text-xs text-[var(--color-ink-muted)]">{intro?.aantalShorts ?? 0} video&apos;s</span>
        </div>
        {intro?.omschrijving ? <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{intro.omschrijving}</p> : null}
        {intro?.algemeneAandachtspunten?.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {intro.algemeneAandachtspunten.map((a, i) => (
              <li key={i} className="rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-1 text-xs text-[var(--color-ink)]">{a}</li>
            ))}
          </ul>
        ) : null}

        <ol className="mt-4 space-y-3 border-t border-[var(--color-line)] pt-3">
          {(briefing.shorts ?? []).map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-2xs font-bold text-white">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-snug">{s.titel}</div>
                {s.omschrijving ? <p className="mt-0.5 text-sm leading-snug text-[var(--color-ink-muted)]">{s.omschrijving}</p> : null}
                {s.aandachtspunten?.length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--color-ink)]">
                    {s.aandachtspunten.map((a, j) => <li key={j}>{a}</li>)}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function briefingToText(b: EditorBriefing): string {
  const i = b.projectIntro;
  const algemeen = (i?.algemeneAandachtspunten ?? []).filter(Boolean);
  const head = `EDITINGBRIEFING — ${i?.client ?? ""} (${i?.aantalShorts ?? 0} video's)\n${i?.omschrijving ?? ""}${algemeen.length ? `\nLet op: ${algemeen.join(" · ")}` : ""}`;
  const shorts = (b.shorts ?? [])
    .map((s, n) => {
      const punten = (s.aandachtspunten ?? []).filter(Boolean);
      return `\n\n${n + 1}. ${s.titel}\n${s.omschrijving ?? ""}${punten.length ? `\n${punten.map((p) => `- ${p}`).join("\n")}` : ""}`;
    })
    .join("");
  return head + shorts;
}
