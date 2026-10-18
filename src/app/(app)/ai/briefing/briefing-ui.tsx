"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { generateBriefing, type EditorBriefing } from "@/server/actions/ai-tools";
import { Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";

type ClientOption = { id: string; name: string };

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
  const [projectName, setProjectName] = useState("");
  const [editorName, setEditorName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [result, setResult] = useState<EditorBriefing | null>(null);
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
      const res = await generateBriefing({ clientId, projectName, editorName, deadline, scriptText, pdfBase64: pdfBase64 ?? undefined, docxBase64: docxBase64 ?? undefined });
      if (res.ok) setResult(res.data);
      else setErr(res.message);
    });
  }

  return (
    <div className="space-y-5">
      <ToolHowTo
        steps={[
          "Kies de klant en het script of de video.",
          "Je krijgt een complete editor-briefing met structuur, hooks en aandachtspunten.",
          "Controleer hem en deel hem met je editor.",
        ]}
      />
      {!aiReady ? <NoProviderNote /> : null}
      <HistoryPanel items={recent} onLoad={(o) => setResult(o)} />

      <Card>
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="sc-label">Klant</label>
            <select className="sc-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Kies…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="sc-label">Project / opnamesessie</label>
            <input className="sc-input" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </div>
          <div>
            <label className="sc-label">Editor (optioneel)</label>
            <input className="sc-input" value={editorName} onChange={(e) => setEditorName(e.target.value)} />
          </div>
          <div>
            <label className="sc-label">Deadline (optioneel)</label>
            <input className="sc-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
          <div>
            <label className="sc-label">Scripts (plakken)</label>
            <textarea className="sc-input resize-y font-mono text-xs" rows={10} placeholder="Plak de scripts van de opnamesessie." value={scriptText} onChange={(e) => setScriptText(e.target.value)} />
          </div>
          <div>
            <label className="sc-label">of Script-bestand (PDF/Word)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              <Upload className="size-4" />
              {fileName ?? "Bestand kiezen"}
              <input type="file" accept=".pdf,.docx,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
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
          <Row k="Project" v={intro?.project} />
          <Row k="Aantal shorts" v={String(intro?.aantalShorts ?? "")} />
          <Row k="Editor" v={intro?.editor} />
          <Row k="Deadline" v={intro?.deadline} />
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
  const head = `EDITINGBRIEFING\nKlant: ${i?.client ?? ""}\nProject: ${i?.project ?? ""}\nAantal shorts: ${i?.aantalShorts ?? ""}\nEditor: ${i?.editor ?? ""}\nDeadline: ${i?.deadline ?? ""}\n\n${i?.omschrijving ?? ""}\n\nAlgemene aandachtspunten:\n${(i?.algemeneAandachtspunten ?? []).map((a) => `- ${a}`).join("\n")}`;
  const shorts = (b.shorts ?? [])
    .map((s, n) => `\n\nSHORT ${n + 1}: ${s.titel}\n- Omschrijving: ${s.omschrijving}\n- Doel: ${s.doel}\n- Hook: ${s.hook}\n- Beelden: ${s.beelden}\n- Opbouw: ${s.opbouw}\n- Tekstelementen: ${s.tekstelementen}\n- Montagekeuzes: ${s.montagekeuzes}\n- Niet vergeten: ${s.nietVergeten}`)
    .join("");
  return head + shorts;
}
