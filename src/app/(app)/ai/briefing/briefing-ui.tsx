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
      <Card>
        <h3 className="text-sm font-semibold">Project</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row k="Klant" v={intro?.client} />
          <Row k="Aantal video's" v={String(intro?.aantalShorts ?? "")} />
          {intro?.project ? <Row k="Project" v={intro.project} /> : null}
        </dl>
        {intro?.omschrijving ? <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{intro.omschrijving}</p> : null}
        {intro?.algemeneAandachtspunten?.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {intro.algemeneAandachtspunten.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        ) : null}
      </Card>

      {(briefing.shorts ?? []).map((s, i) => (
        <Card key={i}>
          <h3 className="text-sm font-semibold">Short {i + 1}: <span className="font-normal text-[var(--color-ink-muted)]">{s.titel}</span></h3>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Line k="Omschrijving" v={s.omschrijving} />
            <Line k="Doel" v={s.doel} />
            <Line k="Hook" v={s.hook} />
            <Line k="Let op bij beelden" v={s.beelden} />
            <Line k="Opbouw" v={s.opbouw} />
            <Line k="Tekstelementen" v={s.tekstelementen} />
            <Line k="Montagekeuzes" v={s.montagekeuzes} />
            <Line k="Niet vergeten" v={s.nietVergeten} />
          </dl>
        </Card>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-[var(--color-ink-faint)]">{k}:</dt>
      <dd className="font-medium">{v || "—"}</dd>
    </div>
  );
}
function Line({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{k}</dt>
      <dd className="text-[var(--color-ink)]">{v}</dd>
    </div>
  );
}

function briefingToText(b: EditorBriefing): string {
  const i = b.projectIntro;
  const head = `EDITINGBRIEFING\nKlant: ${i?.client ?? ""}\nAantal video's: ${i?.aantalShorts ?? ""}${i?.project ? `\nProject: ${i.project}` : ""}\n\n${i?.omschrijving ?? ""}\n\nAlgemene aandachtspunten:\n${(i?.algemeneAandachtspunten ?? []).map((a) => `- ${a}`).join("\n")}`;
  const shorts = (b.shorts ?? [])
    .map((s, n) => `\n\nSHORT ${n + 1}: ${s.titel}\n- Omschrijving: ${s.omschrijving}\n- Doel: ${s.doel}\n- Hook: ${s.hook}\n- Beelden: ${s.beelden}\n- Opbouw: ${s.opbouw}\n- Tekstelementen: ${s.tekstelementen}\n- Montagekeuzes: ${s.montagekeuzes}\n- Niet vergeten: ${s.nietVergeten}`)
    .join("");
  return head + shorts;
}
