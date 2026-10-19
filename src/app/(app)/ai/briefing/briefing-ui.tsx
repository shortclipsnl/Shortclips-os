"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Check, FileText, Link2, Loader2, Sparkles, X } from "lucide-react";
import { generateBriefing, type EditorBriefing } from "@/server/actions/ai-tools";
import { attachBriefingToProject, listClientEditProjects } from "@/server/actions/videos";
import { Button, Card, ErrorNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, SaveInsight, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";

type ClientOption = { id: string; name: string };
type EditProject = { id: string; title: string; statusLabel: string; hasBriefing: boolean };

const isDoc = (n: string) => /\.(pdf|docx)$/i.test(n);

export function BriefingMaker({
  clients,
  aiReady,
  recent,
  canAttach,
}: {
  clients: ClientOption[];
  aiReady: boolean;
  recent: HistoryEntry<EditorBriefing>[];
  canAttach: boolean;
}) {
  const [clientId, setClientId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<EditorBriefing | null>(null);
  // De klant waarvoor dit resultaat is gemaakt — nodig om de juiste projecten
  // te tonen bij het koppelen (bij laden uit geschiedenis onbekend → null).
  const [resultClientId, setResultClientId] = useState<string | null>(null);
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
      if (res.ok) {
        setResult(res.data);
        setResultClientId(clientId);
      } else setErr(res.message);
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
      <HistoryPanel
        items={recent}
        onLoad={(o, entry) => {
          setResult(o);
          // Klant uit de geschiedenis terugzoeken, zodat ook een eerder
          // gemaakte briefing aan een project gekoppeld kan worden.
          setResultClientId(clients.find((c) => c.name === entry.clientName)?.id ?? null);
        }}
      />

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

      {result ? (
        <BriefingView
          briefing={result}
          clientId={resultClientId ?? clientId}
          canAttach={canAttach && !!resultClientId}
        />
      ) : null}
    </div>
  );
}

function BriefingView({ briefing, clientId, canAttach }: { briefing: EditorBriefing; clientId: string; canAttach: boolean }) {
  const intro = briefing.projectIntro;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Briefing</h2>
        <div className="flex items-center gap-2">
          <SaveInsight clientId={clientId} defaultCategory="editing_style" />
          <CopyButton label="Hele briefing kopiëren" text={briefingToText(briefing)} />
        </div>
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

      {canAttach ? <AttachToProject clientId={clientId} briefingText={briefingToText(briefing)} /> : null}
    </div>
  );
}

/** Koppel de gemaakte briefing aan het editing-project waar hij bij hoort.
 *  Hij verschijnt dan op de projectpagina en bij de editor — één systeem. */
function AttachToProject({ clientId, briefingText }: { clientId: string; briefingText: string }) {
  const [projects, setProjects] = useState<EditProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [done, setDone] = useState<{ id: string; title: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDone(null);
    listClientEditProjects(clientId).then((res) => {
      if (!active) return;
      setProjects(res.ok ? res.projects : []);
      if (!res.ok) setErr(res.message ?? "Kon projecten niet laden.");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [clientId]);

  function attach() {
    if (!projectId) {
      setErr("Kies eerst een project.");
      return;
    }
    setErr(null);
    const chosen = projects.find((p) => p.id === projectId);
    start(async () => {
      const res = await attachBriefingToProject({ videoId: projectId, briefing: briefingText });
      if (res.ok) setDone({ id: projectId, title: chosen?.title ?? "project" });
      else setErr(res.message ?? "Koppelen mislukt.");
    });
  }

  return (
    <Card className="border-[var(--color-brand-500)]/30 bg-[color-mix(in_srgb,var(--color-brand-500)_4%,var(--color-surface))]">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-[var(--color-brand-600)]" />
        <h3 className="text-sm font-semibold">Koppel aan project</h3>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Zet de briefing bij het editing-project waar hij bij hoort. Hij staat dan meteen op de projectpagina en bij de editor.
      </p>

      {done ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)]/50 px-3 py-2 text-sm text-[#1d6b4c]">
          <Check className="size-4 shrink-0" />
          <span>Gekoppeld aan <strong>{done.title}</strong>.</span>
          <Link href={`/videos/${done.id}`} className="inline-flex items-center gap-1 font-semibold text-[var(--color-brand-600)] hover:underline">
            Open project <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            className="sc-input min-w-56 flex-1"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={loading || pending}
            aria-label="Project"
          >
            <option value="">{loading ? "Projecten laden…" : projects.length ? "Kies een project…" : "Geen projecten gevonden"}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.statusLabel}{p.hasBriefing ? " · heeft al een briefing" : ""}
              </option>
            ))}
          </select>
          <Button onClick={attach} disabled={pending || loading || !projectId} size="sm">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Koppel aan project
          </Button>
        </div>
      )}
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
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
