"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FolderInput, Loader2, MessageSquare, Play, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorNote, InfoNote } from "@/components/ui";
import { addDriveSources, chooseTake, exportFinal, generate, removeSource, setSourceRole, submitFeedback, updateProject, markAsStyleReference } from "@/server/actions/ai-editor";
import { FORMATS, bytes, euro, secs } from "../labels";

type QcFinding = { code: string; message: string; atS?: number };

export type EditorData = {
  id: string;
  title: string;
  script: string;
  status: string;
  phase: string | null;
  progress: number;
  error: string | null;
  planVersion: number;
  styleProfileId: string | null;
  hasPreview: boolean;
  hasFinal: boolean;
  finalFormat: string | null;
  explanation: string[];
  qc: { passed: boolean; technical: QcFinding[]; creative: QcFinding[]; metrics: Record<string, number | string | null> } | null;
  costs: { aiCents?: number; aiInputTokens?: number; aiOutputTokens?: number; renderSeconds?: number; renderCents?: number; storageBytes?: number; storageCentsPerMonth?: number; transcribeSeconds?: number; renders?: number; totalCents?: number };
  takes: Array<{ sentenceIdx: number; sentenceText: string; needsUser: boolean; userChosen: boolean; chosenTakeId: string | null; options: Array<{ takeId: string; text: string; score: number; inS: number; outS: number; sourceId: string }> }>;
  sources: Array<{ id: string; filename: string; origin: string; status: string; sizeBytes: number | null; durationMs: number | null; role: string | null; roleOverride: string | null; speechRatio: number | null; log: { isLog: boolean; reason: string } | null; resolution: string | null }>;
  feedback: Array<{ id: string; text: string; status: string; response: string | null; createdAt: string; version: number | null }>;
  versions: Array<{ id: string; version: number; isActive: boolean }>;
  canRun: boolean;
  canStyle: boolean;
  sourceNames: Record<string, string>;
};

const PHASES = [
  { at: 0, label: "Wachtrij" },
  { at: 3, label: "Bestanden ophalen" },
  { at: 5, label: "Analyseren en transcriberen" },
  { at: 40, label: "Montage plannen" },
  { at: 55, label: "Kleur gelijktrekken" },
  { at: 65, label: "Renderen" },
  { at: 95, label: "Kwaliteitscontrole" },
];

function uploadWithProgress(url: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload mislukt (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload mislukt (netwerk)."));
    xhr.send(file);
  });
}

export function EditorView({ data }: { data: EditorData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(data.error);
  const [script, setScript] = useState(data.script);
  const [scriptSaved, setScriptSaved] = useState(true);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const [driveLink, setDriveLink] = useState("");
  const [feedback, setFeedback] = useState("");
  const [format, setFormat] = useState<"9x16" | "4x5" | "1x1">("9x16");
  const [live, setLive] = useState({ status: data.status, phase: data.phase, progress: data.progress, waitingForWorker: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = ["queued", "processing"].includes(live.status);


  // Live voortgang zolang er verwerkt wordt.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/ai-editor/${data.id}/status`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const s = (await r.json()) as { status: string; phase: string | null; progress: number; busy: boolean; waitingForWorker: boolean };
      setLive({ status: s.status, phase: s.phase, progress: s.progress, waitingForWorker: s.waitingForWorker });
      if (!s.busy && !["queued", "processing"].includes(s.status)) { clearInterval(t); router.refresh(); }
    }, 2500);
    return () => clearInterval(t);
  }, [busy, data.id, router]);

  function act(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Er ging iets mis.");
      else { after?.(); router.refresh(); }
    });
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      const tmp = `${file.name}-${file.size}`;
      setUploads((u) => ({ ...u, [tmp]: 0 }));
      try {
        const init = await fetch("/api/ai-editor/upload-init", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "source", projectId: data.id, filename: file.name, mimeType: file.type, size: file.size }) });
        const j = (await init.json()) as { id?: string; uploadUrl?: string; headers?: Record<string, string>; error?: string };
        if (!init.ok || !j.uploadUrl || !j.id) throw new Error(j.error ?? "Upload voorbereiden mislukt.");
        await uploadWithProgress(j.uploadUrl, j.headers ?? {}, file, (pct) => setUploads((u) => ({ ...u, [tmp]: pct })));
        await fetch("/api/ai-editor/upload-complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "source", id: j.id }) });
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setUploads((u) => { const n = { ...u }; delete n[tmp]; return n; });
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  const pendingChoices = data.takes.filter((t) => t.needsUser);
  const qc = data.qc;
  const c = data.costs;
  const activePhase = [...PHASES].reverse().find((p) => live.progress >= p.at)?.label;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        {/* Stap 1 — bestanden + script */}
        <Card>
          <CardHeader title="1. Ruwe beelden en script" subtitle="Alle camerabestanden van de opnamedag: spreker-opnames en b-roll. De AI herkent zelf wat wat is." />
          <div className="mt-4 space-y-3">
            {data.sources.length ? (
              <ul className="divide-y divide-[var(--color-line)] rounded-[var(--radius-sm)] border border-[var(--color-line)]">
                {data.sources.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[var(--color-ink)]">{s.filename}</p>
                      <p className="text-2xs text-[var(--color-ink-faint)]">
                        {s.origin === "drive" ? "Google Drive" : "Upload"}{s.sizeBytes ? ` · ${bytes(s.sizeBytes)}` : ""}{s.durationMs ? ` · ${secs(s.durationMs)}` : ""}{s.resolution ? ` · ${s.resolution}` : ""}
                        {s.speechRatio != null ? ` · spraak ${Math.round(s.speechRatio * 100)}%` : ""}
                        {s.log?.isLog ? ` · log-beeld (${s.log.reason})` : ""}
                      </p>
                    </div>
                    {s.status === "uploading" ? <Badge tone="warn">Upload onvolledig</Badge> : s.status === "analyzed" ? <Badge tone="good">Geanalyseerd</Badge> : <Badge>Klaar</Badge>}
                    {data.canRun ? (
                      <select
                        className="sc-input h-8 !w-auto shrink-0 text-xs"
                        value={s.roleOverride ?? "auto"}
                        disabled={pending || busy}
                        onChange={(e) => act(() => setSourceRole({ sourceId: s.id, role: e.target.value as "auto" | "speaker" | "broll" }))}
                        title="Rol van dit bestand"
                      >
                        <option value="auto">Automatisch{s.role ? ` (${s.role === "speaker" ? "spreker" : "b-roll"})` : ""}</option>
                        <option value="speaker">Spreker</option>
                        <option value="broll">B-roll</option>
                      </select>
                    ) : null}
                    {data.canRun ? (
                      <button className="text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" disabled={pending || busy} onClick={() => act(() => removeSource(s.id))} title="Verwijderen"><Trash2 className="size-4" /></button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--color-ink-muted)]">Nog geen bestanden.</p>}

            {Object.entries(uploads).map(([k, pct]) => (
              <div key={k} className="text-xs text-[var(--color-ink-muted)]">
                <div className="flex justify-between"><span className="truncate">{k.replace(/-\d+$/, "")}</span><span>{pct}%</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-[var(--color-surface-sunken)]"><div className="h-1.5 rounded-full bg-[var(--color-brand-500)]" style={{ width: `${pct}%` }} /></div>
              </div>
            ))}

            {data.canRun ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <input ref={fileRef} type="file" accept="video/*,.mxf,.mts" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
                  <Button variant="secondary" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="size-4" /> Bestanden uploaden</Button>
                </div>
                <div className="flex gap-2">
                  <input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} placeholder="Google Drive-link (map of bestand)" className="sc-input min-w-0 flex-1" />
                  <Button variant="secondary" disabled={pending || busy || !driveLink} onClick={() => act(() => addDriveSources({ projectId: data.id, link: driveLink }), () => setDriveLink(""))}><FolderInput className="size-4" /></Button>
                </div>
              </div>
            ) : null}
            <p className="text-2xs text-[var(--color-ink-faint)]">Grote camerabestanden (meerdere GB) gaan het snelst via een Google Drive-map: de verwerk-server haalt de originelen daar zelf op, zonder upload vanuit je browser.</p>

            <label className="block pt-2">
              <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Script (optioneel)</span>
              <textarea value={script} disabled={!data.canRun} onChange={(e) => { setScript(e.target.value); setScriptSaved(false); }} rows={5} className="sc-input w-full" placeholder="Met script kiest de AI per zin de beste take, in de bedoelde volgorde, en neemt de spelling over in de ondertitels." />
            </label>
            {data.canRun && !scriptSaved ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => updateProject({ id: data.id, script }), () => setScriptSaved(true))}>Script opslaan</Button> : null}
          </div>
        </Card>

        {/* Stap 2 + 3 */}
        <Card>
          <CardHeader title="2. Montageprofiel en genereren" />
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Profiel</span>
              <select className="sc-input" value={data.styleProfileId ?? ""} disabled={!data.canRun || busy} onChange={(e) => act(() => updateProject({ id: data.id, styleProfileId: e.target.value }))}>
                {data.versions.map((v) => <option key={v.id} value={v.id}>Shortclips Ads Style v{v.version}{v.isActive ? " (actief)" : ""}</option>)}
              </select>
            </label>
            {data.canRun ? (
              <Button variant="accent" size="lg" disabled={pending || busy || !data.sources.length || Object.keys(uploads).length > 0} onClick={() => act(() => generate(data.id))}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} {data.hasPreview ? "Opnieuw genereren" : "Genereer advertentievideo"}
              </Button>
            ) : null}
          </div>
          {busy ? (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-[var(--color-ink-muted)]"><span>{live.phase ?? activePhase}</span><span>{live.progress}%</span></div>
              <div className="mt-1 h-2 rounded-full bg-[var(--color-surface-sunken)]"><div className="h-2 rounded-full bg-[var(--color-brand-500)] transition-all" style={{ width: `${Math.max(3, live.progress)}%` }} /></div>
              <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs">
                {PHASES.slice(1).map((p) => <li key={p.label} className={live.progress >= p.at ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]"}>{live.progress >= p.at ? "● " : "○ "}{p.label}</li>)}
              </ol>
              {live.waitingForWorker ? <p className="mt-2 text-xs text-[#8a5300]">Dit staat al even in de wachtrij. Draait de verwerk-server? (npm run ai-editor:worker)</p> : null}
            </div>
          ) : null}
          {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}
        </Card>

        {/* Take-keuzes */}
        {data.takes.length ? (
          <Card>
            <CardHeader title="Takes per zin" subtitle={pendingChoices.length ? `${pendingChoices.length} zin(nen) met twee vergelijkbare takes: kies zelf.` : "De AI koos per zin de beste take. Je kunt wisselen."} />
            <div className="mt-3 space-y-2">
              {data.takes.map((t) => (
                <details key={t.sentenceIdx} open={t.needsUser} className={`rounded-[var(--radius-sm)] border px-3 py-2 ${t.needsUser ? "border-[var(--color-warn)] bg-[var(--color-warn-soft)]" : "border-[var(--color-line)]"}`}>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">Zin {t.sentenceIdx + 1}</span>
                    <span className="ml-2 text-[var(--color-ink-muted)]">{t.sentenceText.slice(0, 90)}{t.sentenceText.length > 90 ? "…" : ""}</span>
                    <span className="ml-2 text-2xs text-[var(--color-ink-faint)]">{t.options.length} take(s){t.userChosen ? " · jouw keuze" : ""}{!t.chosenTakeId ? " · niet gevonden" : ""}</span>
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {t.options.map((o, i) => (
                      <li key={o.takeId} className="flex items-start gap-2 text-xs">
                        <input type="radio" name={`take-${t.sentenceIdx}`} checked={t.chosenTakeId === o.takeId} disabled={!data.canRun || pending || busy} onChange={() => act(() => chooseTake({ projectId: data.id, sentenceIdx: t.sentenceIdx, takeId: o.takeId }))} className="mt-0.5" />
                        <span className="flex-1">
                          <span className="text-[var(--color-ink)]">&ldquo;{o.text}&rdquo;</span>
                          <span className="ml-1 text-[var(--color-ink-faint)]">({data.sourceNames[o.sourceId] ?? "bron"} {o.inS.toFixed(1)}-{o.outS.toFixed(1)} s · score {Math.round(o.score * 100)}{i === 0 ? " · beste" : ""})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {t.needsUser && t.chosenTakeId && data.canRun ? (
                    <Button size="sm" className="mt-2" disabled={pending || busy} onClick={() => act(() => chooseTake({ projectId: data.id, sentenceIdx: t.sentenceIdx, takeId: t.chosenTakeId! }))}>Deze take gebruiken</Button>
                  ) : null}
                </details>
              ))}
            </div>
          </Card>
        ) : null}

        {/* Feedback */}
        {data.hasPreview ? (
          <Card>
            <CardHeader title="Feedback aan de AI" subtitle="In gewone taal. De bestaande montage wordt aangepast; alleen wat verandert wordt opnieuw gerenderd." />
            {data.canRun ? (
              <div className="mt-3 flex gap-2">
                <input value={feedback} onChange={(e) => setFeedback(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && feedback.trim()) act(() => submitFeedback({ projectId: data.id, text: feedback }), () => setFeedback("")); }} placeholder='Bijv. "De eerste drie seconden moeten sneller" of "De zoom bij seconde 12 mag eruit"' className="sc-input min-w-0 flex-1" disabled={busy} />
                <Button disabled={pending || busy || !feedback.trim()} onClick={() => act(() => submitFeedback({ projectId: data.id, text: feedback }), () => setFeedback(""))}><MessageSquare className="size-4" /> Verwerk</Button>
              </div>
            ) : null}
            {data.feedback.length ? (
              <ul className="mt-3 space-y-2">
                {data.feedback.map((f) => (
                  <li key={f.id} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs">
                    <div className="flex justify-between gap-2"><span className="font-medium text-[var(--color-ink)]">&ldquo;{f.text}&rdquo;</span>
                      <Badge tone={f.status === "applied" ? "good" : f.status === "queued" ? "info" : "warn"}>{f.status === "applied" ? `Verwerkt${f.version ? ` (v${f.version})` : ""}` : f.status === "queued" ? "In de wachtrij" : f.status === "not_understood" ? "Niet begrepen" : "Mislukt"}</Badge>
                    </div>
                    {f.response ? <p className="mt-1 text-[var(--color-ink-muted)]">{f.response}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        {/* Uitleg */}
        {data.explanation.length ? (
          <Card>
            <CardHeader title="Montagekeuzes" subtitle={`Versie ${data.planVersion}`} />
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-muted)]">
              {data.explanation.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </Card>
        ) : null}
      </div>

      {/* Rechterkolom: preview, QC, export, kosten */}
      <div className="space-y-5">
        <Card padded={false} className="overflow-hidden">
          {data.hasPreview ? (
            <video key={data.planVersion} controls playsInline className="aspect-[9/16] w-full bg-black" src={`/api/ai-editor/media?project=${data.id}&kind=preview&v=${data.planVersion}`} />
          ) : (
            <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 bg-[var(--color-surface-sunken)] text-sm text-[var(--color-ink-faint)]">
              {busy ? <Loader2 className="size-6 animate-spin" /> : <Play className="size-6" />}
              {busy ? "Bezig met monteren…" : "Hier verschijnt de preview"}
            </div>
          )}
          {data.hasPreview ? <p className="px-4 py-2 text-2xs text-[var(--color-ink-faint)]">Preview op halve resolutie. De definitieve export wordt in volle kwaliteit uit de originele bestanden gemaakt.</p> : null}
        </Card>

        {qc ? (
          <Card>
            <CardHeader title="Kwaliteitscontrole" action={qc.passed ? <Badge tone="good"><CheckCircle2 className="size-3.5" /> Technisch in orde</Badge> : <Badge tone="bad"><AlertTriangle className="size-3.5" /> Technische fouten</Badge>} />
            {qc.technical.length ? (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-[#a3271c]">Technisch (blokkeert export)</p>
                <ul className="space-y-1 text-xs text-[var(--color-ink)]">{qc.technical.map((f, i) => <li key={i}>• {f.message}{f.atS != null ? ` (${f.atS.toFixed(1)} s)` : ""}</li>)}</ul>
              </div>
            ) : null}
            {qc.creative.length ? (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-[#8a5300]">Creatief advies</p>
                <ul className="space-y-1 text-xs text-[var(--color-ink-muted)]">{qc.creative.map((f, i) => <li key={i}>• {f.message}{f.atS != null ? ` (${f.atS.toFixed(1)} s)` : ""}</li>)}</ul>
              </div>
            ) : null}
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs text-[var(--color-ink-muted)]">
              {Object.entries(qc.metrics).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt>{METRIC_LABEL[k] ?? k}</dt><dd className="font-medium text-[var(--color-ink)]">{String(v)}</dd></div>)}
            </dl>
          </Card>
        ) : null}

        {data.hasPreview ? (
          <Card>
            <CardHeader title="3. Definitief exporteren" subtitle="H.264, 25 fps, AAC 320 kbps, -16,5 LUFS." />
            <div className="mt-3 space-y-2">
              <select className="sc-input w-full" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} disabled={busy}>
                {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              {data.canRun ? (
                <Button className="w-full" variant="accent" disabled={pending || busy || pendingChoices.length > 0 || (qc ? !qc.passed : true)} onClick={() => act(() => exportFinal({ projectId: data.id, format }))}>
                  <Sparkles className="size-4" /> Exporteer in volle kwaliteit
                </Button>
              ) : null}
              {pendingChoices.length ? <p className="text-2xs text-[#8a5300]">Kies eerst de takes waarover getwijfeld wordt.</p> : null}
              {qc && !qc.passed ? <p className="text-2xs text-[#a3271c]">Exporteren kan pas als de technische punten zijn opgelost.</p> : null}
              {data.hasFinal ? (
                <a href={`/api/ai-editor/media?project=${data.id}&kind=final&download=1`} className="flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] text-sm font-medium text-white hover:bg-[var(--color-indigo-soft)]">
                  <Download className="size-4" /> Download ({data.finalFormat ?? "9x16"})
                </a>
              ) : null}
              {data.hasFinal && data.canStyle ? (
                <Button variant="secondary" className="w-full" size="sm" disabled={pending} onClick={() => act(() => markAsStyleReference(data.id))}>Gebruik deze video als stijlreferentie</Button>
              ) : null}
            </div>
          </Card>
        ) : null}

        {c.totalCents != null || c.renders ? (
          <Card>
            <CardHeader title="Kosten van deze video" subtitle="Op basis van de werkelijk verwerkte bestanden." />
            <dl className="mt-3 space-y-1 text-xs text-[var(--color-ink-muted)]">
              <Row k="AI (Claude)" v={`${euro(c.aiCents)} · ${(c.aiInputTokens ?? 0).toLocaleString("nl-NL")} in / ${(c.aiOutputTokens ?? 0).toLocaleString("nl-NL")} uit`} />
              <Row k="Transcriptie (lokaal)" v={`${c.transcribeSeconds ?? 0} s rekentijd · € 0,00`} />
              <Row k="Renderen" v={`${Math.round(c.renderSeconds ?? 0)} s · ${c.renders ?? 0} render(s) · ${euro(c.renderCents)}`} />
              <Row k="Opslag" v={`${bytes(c.storageBytes)} · ${euro(c.storageCentsPerMonth)} per maand`} />
              <div className="flex justify-between border-t border-[var(--color-line)] pt-1 font-semibold text-[var(--color-ink)]"><dt>Totaal</dt><dd>{euro(c.totalCents)}</dd></div>
            </dl>
            <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Tarieven zijn instelbaar (env); rendertijd telt € 0 zolang de eigen verwerk-server rendert.</p>
          </Card>
        ) : null}

        {!data.canRun ? <InfoNote>Je kunt meekijken; monteren vraagt het recht &ldquo;AI Editor gebruiken&rdquo;.</InfoNote> : null}
      </div>
    </div>
  );
}

const METRIC_LABEL: Record<string, string> = {
  width: "Breedte", height: "Hoogte", fps: "fps", durationS: "Duur (s)", lufs: "LUFS", truePeak: "True peak", lra: "LRA", shots: "Shots", avgShotS: "Gem. shot (s)", wpm: "Woorden/min", firstWordS: "Eerste woord (s)", lumaMean: "Helderheid", lumaMaxDev: "Max. afwijking",
};

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><dt>{k}</dt><dd className="text-right text-[var(--color-ink)]">{v}</dd></div>;
}
