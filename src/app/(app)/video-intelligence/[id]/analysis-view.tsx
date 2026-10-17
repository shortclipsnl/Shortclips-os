"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, Table } from "@/components/ui";
import { compact } from "@/lib/format";
import { msToClock, STEP_LABEL, STEP_STATUS } from "../labels";
import { reprocessAnalysis, deleteAnalysis, setSections } from "@/server/actions/video-intelligence";

type Shot = { idx: number; startMs: number; endMs: number; shotType: string | null; description: string | null; transition: string | null; textOnScreen: string | null; motion: string | null; hasThumb: boolean };
type Step = { step: string; status: string; detail: string | null };
type ViewData = {
  id: string; title: string | null; status: string; platform: string | null; sourceType: string;
  sourceUrl: string | null; caption: string | null; durationMs: number; width: number | null; height: number | null;
  aspectRatio: string | null; error: string | null; hasMedia: boolean; hasThumb: boolean; clientName: string;
  steps: Step[]; shots: Shot[];
  transcript: { fullText: string | null; wpm: number | null; firstWordMs: number | null; words3s: number | null; words5s: number | null; words10s: number | null; words: Array<{ w: string; start: number; end: number }> } | null;
  editing: { totalShots: number | null; avgShotMs: number | null; minShotMs: number | null; maxShotMs: number | null; cutsPer10s: number | null; tempoHookMs: number | null; tempoMiddleMs: number | null; tempoEndMs: number | null } | null;
  hook: { startMs: number | null; endMs: number | null; hookText: string | null; types: string[]; form: string[]; elements: string[]; firstWord: string | null; timeToFirstWordMs: number | null; shotCount: number | null; correctedAt: string | null } | null;
  structure: Array<{ part: string; startMs: number; endMs: number; summary: string }> | null;
  overlays: Array<{ appearMs: number; text: string; shot?: number }>;
  manualHookEndMs: number | null;
  manualCtaStartMs: number | null;
  sectionsCorrected: boolean;
  performance: { views: number; reach: number; likes: number; comments: number; shares: number; saves: number; avgWatchSeconds: number | null } | null;
  insight: { watWerkt?: string[]; watMinder?: string[]; verbeteringen?: string[]; onzekerheden?: string[]; verbeterdScript?: string; alternatieveHooks?: string[] } | null;
  benchmarks: Array<{ key: string; label: string; unit: "s" | "count" | "n"; value: number | null; client: { mean: number | null; median: number | null; n: number }; all: { mean: number | null; median: number | null; n: number } }>;
  benchMinSample: number;
};

const TABS = ["Overzicht", "Opbouw", "Hook", "Spraak", "Shots", "Montage", "Benchmark", "AI-feedback"] as const;

/** Indeling: handmatige grenzen als die er zijn, anders heuristiek (hook = eerste ~3s, CTA = laatste ~20%). */
function sectionLabel(startMs: number, durationMs: number, hookEndMs?: number | null, ctaStartMs?: number | null): "Hook" | "Middenstuk" | "CTA" {
  const hookEnd = hookEndMs ?? Math.min(3000, durationMs * 0.25);
  const ctaStart = ctaStartMs ?? durationMs * 0.8;
  if (startMs < hookEnd) return "Hook";
  if (startMs >= ctaStart) return "CTA";
  return "Middenstuk";
}

const SECTION_TONE: Record<string, "warn" | "info" | "good"> = { Hook: "warn", Middenstuk: "info", CTA: "good" };

/** Uitgesproken woorden waarvan de start binnen [from, to) valt. */
function spokenIn(words: Array<{ w: string; start: number; end: number }>, from: number, to: number): string {
  return words.filter((x) => x.start >= from && x.start < to).map((x) => x.w).join(" ").replace(/\s+/g, " ").trim();
}
const FRAME = (id: string, name: string) => `/api/video-intelligence/${id}/frame?name=${name}`;
const NON_TERMINAL = new Set(["queued", "downloading", "processing"]);

export function AnalysisView({ data, canRun }: { data: ViewData; canRun: boolean }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overzicht");
  const [curMs, setCurMs] = useState(0);
  const [pending, startTransition] = useTransition();

  // Auto-ververs zolang de verwerking loopt.
  useEffect(() => {
    if (!NON_TERMINAL.has(data.status)) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [data.status, router]);

  function seekTo(ms: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, ms / 1000);
    v.play().catch(() => {});
  }

  const dur = data.durationMs || 1;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* Linker kolom: speler + tijdlijn + tabs */}
      <div className="space-y-4">
        <Card padded={false} className="overflow-hidden">
          <div className="bg-black">
            {data.hasMedia ? (
              <video
                ref={videoRef}
                controls
                playsInline
                poster={data.hasThumb ? FRAME(data.id, "thumb.jpg") : undefined}
                src={`/api/video-intelligence/${data.id}/media`}
                onTimeUpdate={(e) => setCurMs(e.currentTarget.currentTime * 1000)}
                className="mx-auto max-h-[70vh] w-auto"
              />
            ) : (
              <div className="flex h-56 items-center justify-center text-sm text-white/60">Bron nog niet opgehaald.</div>
            )}
          </div>

          {/* Interactieve tijdlijn: shots + hook */}
          {data.shots.length > 0 ? (
            <div className="p-3">
              <div className="relative h-8 w-full overflow-hidden rounded bg-[var(--color-surface-sunken)]">
                {data.shots.map((s) => {
                  const left = (s.startMs / dur) * 100;
                  const width = ((s.endMs - s.startMs) / dur) * 100;
                  return (
                    <button
                      key={s.idx}
                      title={`Shot ${s.idx + 1} · ${msToClock(s.startMs)}`}
                      onClick={() => seekTo(s.startMs)}
                      className="absolute top-0 h-full border-r border-white/40 bg-[var(--color-brand-500)]/25 hover:bg-[var(--color-brand-500)]/50"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  );
                })}
                {data.hook?.endMs ? (
                  <div className="absolute top-0 h-full border-x-2 border-[var(--color-warn)] bg-[var(--color-warn)]/15"
                    style={{ left: `${((data.hook.startMs ?? 0) / dur) * 100}%`, width: `${(((data.hook.endMs ?? 0) - (data.hook.startMs ?? 0)) / dur) * 100}%` }}
                    title="Hook" />
                ) : null}
                <div className="absolute top-0 h-full w-0.5 bg-[var(--color-ink)]" style={{ left: `${(curMs / dur) * 100}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-2xs text-[var(--color-ink-faint)]">
                <span>{msToClock(curMs)}</span>
                <span>{data.shots.length} shots · {msToClock(data.durationMs)}</span>
              </div>
            </div>
          ) : null}
        </Card>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-[var(--color-line)]">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-[var(--color-brand-500)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div>
          {tab === "Overzicht" && <OverviewTab data={data} />}
          {tab === "Opbouw" && <BreakdownTab data={data} onSeek={seekTo} curMs={curMs} canRun={canRun} />}
          {tab === "Hook" && <HookTab data={data} onSeek={seekTo} />}
          {tab === "Spraak" && <SpeechTab data={data} onSeek={seekTo} />}
          {tab === "Shots" && <ShotsTab data={data} onSeek={seekTo} />}
          {tab === "Montage" && <EditingTab data={data} />}
          {tab === "Benchmark" && <BenchmarkTab data={data} />}
          {tab === "AI-feedback" && <InsightsTab data={data} />}
        </div>
      </div>

      {/* Rechter kolom: pijplijnvoortgang + acties */}
      <div className="space-y-4">
        <Card padded={false}>
          <div className="border-b border-[var(--color-line)] px-4 py-3 text-sm font-semibold">Verwerking</div>
          <ul className="divide-y divide-[var(--color-line)]">
            {data.steps.map((s) => (
              <li key={s.step} className="flex items-start gap-2 px-4 py-2.5">
                <Badge tone={STEP_STATUS[s.status]?.tone ?? "neutral"}>{STEP_STATUS[s.status]?.label ?? s.status}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{STEP_LABEL[s.step] ?? s.step}</span>
                  {s.detail ? <span className="block text-2xs text-[var(--color-ink-faint)]">{s.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {data.error ? <p className="px-4 py-2 text-xs text-[var(--color-bad)]">{data.error}</p> : null}
        </Card>

        {canRun ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => startTransition(async () => { await reprocessAnalysis(data.id); router.refresh(); })}>
              <RefreshCw className="size-4" /> Opnieuw verwerken
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => { if (confirm("Deze analyse verwijderen?")) startTransition(async () => { await deleteAnalysis(data.id); router.push("/video-intelligence"); }); }}>
              <Trash2 className="size-4" /> Verwijderen
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Facts({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-2xs text-[var(--color-ink-faint)]">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function OverviewTab({ data }: { data: ViewData }) {
  return (
    <Card>
      <Facts items={[
        ["Platform", data.platform ?? "—"],
        ["Duur", msToClock(data.durationMs)],
        ["Resolutie", data.width && data.height ? `${data.width}×${data.height}` : "—"],
        ["Beeldverhouding", data.aspectRatio ?? "—"],
        ["Bron", data.sourceType === "upload" ? "Upload" : "Platform-URL"],
        ["Shots", data.editing?.totalShots != null ? String(data.editing.totalShots) : "—"],
      ]} />
      {data.sourceUrl ? (
        <a href={data.sourceUrl} target="_blank" rel="noopener" className="mt-3 inline-block text-xs text-[var(--color-brand-600)] hover:underline">Originele video openen →</a>
      ) : null}

      <div className="mt-4 border-t border-[var(--color-line)] pt-3">
        <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Prestatie</div>
        {data.performance ? (
          <Facts items={[
            ["Weergaven", compact(data.performance.views)],
            ["Bereik", compact(data.performance.reach)],
            ["Likes", compact(data.performance.likes)],
            ["Reacties", compact(data.performance.comments)],
            ["Shares", compact(data.performance.shares)],
            ["Opgeslagen", compact(data.performance.saves)],
          ]} />
        ) : (
          <p className="text-xs text-[var(--color-ink-muted)]">Nog niet gekoppeld aan een gepubliceerde video. Voeg de video toe via de publieke platform-URL om de echte cijfers te koppelen.</p>
        )}
      </div>
      {data.caption ? (
        <div className="mt-4">
          <div className="text-2xs text-[var(--color-ink-faint)]">Caption</div>
          <p className="whitespace-pre-wrap text-sm text-[var(--color-ink-muted)]">{data.caption}</p>
        </div>
      ) : null}
    </Card>
  );
}

function NotReady({ title, why }: { title: string; why: string }) {
  return <EmptyState title={title} description={why} />;
}

function HookTab({ data, onSeek }: { data: ViewData; onSeek: (ms: number) => void }) {
  const t = data.transcript;
  const shotsIn3s = data.shots.filter((s) => s.startMs < 3000).length;
  const hasMeasurable = Boolean(t) || data.shots.length > 0;
  const h = data.hook;
  if (!hasMeasurable && !h) return <Card padded={false}><NotReady title="Hookanalyse nog niet beschikbaar" why="Vereist shotdetectie/transcriptie, en AI-duiding voor het hooktype." /></Card>;
  return (
    <div className="space-y-4">
      {hasMeasurable ? (
        <Card className="space-y-3">
          <div className="text-sm font-semibold">Meetbare hooksignalen</div>
          <Facts items={[
            ["1e woord na", t?.firstWordMs != null ? `${(t.firstWordMs / 1000).toFixed(1)}s` : "—"],
            ["Woorden in 3s", t?.words3s != null ? String(t.words3s) : "—"],
            ["Shots in eerste 3s", String(shotsIn3s)],
          ]} />
          <Button variant="secondary" size="sm" onClick={() => onSeek(0)}>Opening afspelen</Button>
        </Card>
      ) : null}
      {h ? (
        <Card className="space-y-3">
          <div className="text-sm font-semibold">AI-classificatie</div>
          {h.hookText ? <p className="text-sm font-medium">“{h.hookText}”</p> : null}
          {h.types.length > 0 ? <div className="flex flex-wrap gap-1.5">{h.types.map((t2) => <Badge key={t2} tone="info">{t2}</Badge>)}</div> : null}
          <Facts items={[
            ["Hook start", h.startMs != null ? msToClock(h.startMs) : "—"],
            ["Hook eind", h.endMs != null ? msToClock(h.endMs) : "—"],
            ["Shots in hook", h.shotCount != null ? String(h.shotCount) : "—"],
          ]} />
          {h.correctedAt ? <p className="text-2xs text-[var(--color-ink-faint)]">Handmatig gecorrigeerd.</p> : null}
        </Card>
      ) : (
        <Card padded={false}><NotReady title="AI-hookclassificatie nog niet beschikbaar" why="Type en vorm van de hook vereisen visuele AI-duiding (ANTHROPIC_API_KEY)." /></Card>
      )}
    </div>
  );
}

function SpeechTab({ data, onSeek }: { data: ViewData; onSeek: (ms: number) => void }) {
  if (!data.transcript) return <Card padded={false}><NotReady title="Transcriptie nog niet beschikbaar" why="Deze stap vereist Whisper (lokaal) of een transcriptie-API." /></Card>;
  const t = data.transcript;
  return (
    <Card className="space-y-3">
      <Facts items={[
        ["Woorden/min", t.wpm != null ? String(t.wpm) : "—"],
        ["1e woord na", t.firstWordMs != null ? `${(t.firstWordMs / 1000).toFixed(1)}s` : "—"],
        ["Woorden in 3s", t.words3s != null ? String(t.words3s) : "—"],
        ["Woorden in 5s", t.words5s != null ? String(t.words5s) : "—"],
        ["Woorden in 10s", t.words10s != null ? String(t.words10s) : "—"],
      ]} />
      {t.words.length > 0 ? (
        <p className="text-sm leading-relaxed">
          {t.words.map((w, i) => (
            <button key={i} onClick={() => onSeek(w.start)} className="rounded px-0.5 hover:bg-[var(--color-brand-500)]/20" title={msToClock(w.start)}>{w.w} </button>
          ))}
        </p>
      ) : t.fullText ? <p className="whitespace-pre-wrap text-sm">{t.fullText}</p> : null}
    </Card>
  );
}

function ShotsTab({ data, onSeek }: { data: ViewData; onSeek: (ms: number) => void }) {
  if (data.shots.length === 0) return <Card padded={false}><NotReady title="Nog geen shots" why="Shotdetectie vereist ffmpeg." /></Card>;
  const words = data.transcript?.words ?? [];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {data.shots.map((s) => {
        const spoken = spokenIn(words, s.startMs, s.endMs);
        return (
        <button key={s.idx} onClick={() => onSeek(s.startMs)} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] text-left hover:border-[var(--color-brand-500)]">
          {s.hasThumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={FRAME(data.id, `shot_${s.idx}.jpg`)} alt={`Shot ${s.idx + 1}`} className="aspect-video w-full object-cover" />
          ) : <div className="aspect-video w-full bg-[var(--color-surface-sunken)]" />}
          <div className="p-2">
            <div className="flex items-center justify-between text-2xs text-[var(--color-ink-faint)]">
              <span>Shot {s.idx + 1}</span>
              <span className="tabular-nums">{msToClock(s.startMs)} · {((s.endMs - s.startMs) / 1000).toFixed(1)}s</span>
            </div>
            {s.shotType ? <div className="mt-0.5"><Badge tone="neutral">{s.shotType}</Badge></div> : null}
            {s.description ? <p className="mt-1 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{s.description}</p> : null}
            {spoken ? <p className="mt-1 line-clamp-2 text-2xs text-[var(--color-ink-muted)]">“{truncate(spoken, 70)}”</p> : null}
            {s.textOnScreen ? <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Tekst: {s.textOnScreen}</p> : null}
          </div>
        </button>
        );
      })}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

function BreakdownTab({ data, onSeek, curMs, canRun }: { data: ViewData; onSeek: (ms: number) => void; curMs: number; canRun: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dur = data.durationMs || 1;
  const words = data.transcript?.words ?? [];
  const shots = data.shots;
  const hookEnd = data.manualHookEndMs;
  const ctaStart = data.manualCtaStartMs;
  const label = (startMs: number) => sectionLabel(startMs, dur, hookEnd, ctaStart);

  function save(h: number | null, c: number | null) {
    startTransition(async () => { await setSections({ id: data.id, hookEndMs: h, ctaStartMs: c }); router.refresh(); });
  }

  if (shots.length === 0) return <Card padded={false}><NotReady title="Nog geen opbouw" why="Vereist shotdetectie (ffmpeg)." /></Card>;

  const sections = (["Hook", "Middenstuk", "CTA"] as const)
    .map((name) => {
      const ss = shots.filter((s) => label(s.startMs) === name);
      if (ss.length === 0) return null;
      const start = Math.min(...ss.map((s) => s.startMs));
      const end = Math.max(...ss.map((s) => s.endMs));
      const spoken = spokenIn(words, start, end);
      const wc = spoken ? spoken.split(/\s+/).length : 0;
      const mins = (end - start) / 60000;
      const wpm = mins > 0 && wc > 0 ? Math.round(wc / mins) : null;
      return { name, start, end, shots: ss.length, spoken, wc, wpm };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <div className="space-y-4">
      <Card>
        <div className="text-sm font-semibold">Script-opbouw</div>
        <p className="mb-3 mt-0.5 text-2xs text-[var(--color-ink-faint)]">
          {data.sectionsCorrected ? "Handmatig gecorrigeerde indeling." : "Automatische, heuristische indeling (hook / middenstuk / CTA). AI verfijnt dit zodra de sleutel actief is."}
        </p>
        {canRun ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs">
            <span className="text-[var(--color-ink-muted)]">Corrigeer op huidige tijd ({msToClock(curMs)}):</span>
            <button disabled={pending} onClick={() => save(Math.round(curMs), ctaStart)} className="rounded bg-[var(--color-warn)]/15 px-2 py-1 font-medium text-[#8a5a00] hover:brightness-95">Hook eindigt hier</button>
            <button disabled={pending} onClick={() => save(hookEnd, Math.round(curMs))} className="rounded bg-[var(--color-good)]/15 px-2 py-1 font-medium text-[#1a7a4a] hover:brightness-95">CTA start hier</button>
            {data.sectionsCorrected ? <button disabled={pending} onClick={() => save(null, null)} className="text-[var(--color-ink-muted)] hover:underline">herstel automatisch</button> : null}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          {sections.map((sec) => (
            <button key={sec.name} onClick={() => onSeek(sec.start)} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3 text-left hover:border-[var(--color-brand-500)]">
              <Badge tone={SECTION_TONE[sec.name]}>{sec.name}</Badge>
              <div className="mt-1 text-2xs text-[var(--color-ink-faint)]">{msToClock(sec.start)}–{msToClock(sec.end)} · {sec.shots} shots · {sec.wc} woorden{sec.wpm ? ` · ${sec.wpm} wpm` : ""}</div>
              {sec.spoken ? <p className="mt-1 line-clamp-3 text-xs text-[var(--color-ink-muted)]">“{sec.spoken}”</p> : <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">geen spraak</p>}
            </button>
          ))}
        </div>
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-2">
          <div className="text-sm font-semibold">Tijdlijn per shot</div>
          <p className="text-2xs text-[var(--color-ink-faint)]">Klik op een regel om naar dat moment in de video te springen.</p>
        </div>
        <Table head={<><th className="sc-th">Tijd</th><th className="sc-th">Onderdeel</th><th className="sc-th">Wat gebeurt er?</th></>}>
          {shots.map((s) => {
            const spoken = spokenIn(words, s.startMs, s.endMs);
            const sec = label(s.startMs);
            const primary = s.description || (spoken ? `Spraak: “${truncate(spoken, 90)}”` : s.shotType || `Shot ${s.idx + 1}`);
            return (
              <tr key={s.idx} className="sc-row-link cursor-pointer" onClick={() => onSeek(s.startMs)}>
                <td className="sc-td whitespace-nowrap tabular-nums">{msToClock(s.startMs)}–{msToClock(s.endMs)}</td>
                <td className="sc-td"><Badge tone={SECTION_TONE[sec]}>{sec}</Badge></td>
                <td className="sc-td">
                  <div className="text-sm">{primary}</div>
                  {spoken && s.description ? <div className="text-2xs text-[var(--color-ink-faint)]">“{truncate(spoken, 90)}”</div> : null}
                  {s.textOnScreen ? <div className="text-2xs text-[var(--color-ink-faint)]">Tekst in beeld: {s.textOnScreen}</div> : null}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

function EditingTab({ data }: { data: ViewData }) {
  if (!data.editing) return <Card padded={false}><NotReady title="Nog geen montagemetrieken" why="Vereist shotdetectie (ffmpeg)." /></Card>;
  const e = data.editing;
  return (
    <Card>
      <Facts items={[
        ["Totaal shots", String(e.totalShots ?? "—")],
        ["Gem. shotlengte", e.avgShotMs != null ? `${(e.avgShotMs / 1000).toFixed(1)}s` : "—"],
        ["Kortste shot", e.minShotMs != null ? `${(e.minShotMs / 1000).toFixed(1)}s` : "—"],
        ["Langste shot", e.maxShotMs != null ? `${(e.maxShotMs / 1000).toFixed(1)}s` : "—"],
        ["Cuts per 10s", String(e.cutsPer10s ?? "—")],
        ["Tempo hook", e.tempoHookMs != null ? `${(e.tempoHookMs / 1000).toFixed(1)}s/shot` : "—"],
        ["Tempo midden", e.tempoMiddleMs != null ? `${(e.tempoMiddleMs / 1000).toFixed(1)}s/shot` : "—"],
        ["Tempo eind", e.tempoEndMs != null ? `${(e.tempoEndMs / 1000).toFixed(1)}s/shot` : "—"],
      ]} />
    </Card>
  );
}

function BenchmarkTab({ data }: { data: ViewData }) {
  if (data.benchmarks.length === 0) {
    return <Card padded={false}><NotReady title="Nog geen benchmark" why="Vereist meetbare cijfers (ffmpeg/transcriptie)." /></Card>;
  }
  const fmt = (v: number | null, unit: "s" | "count" | "n") => (v == null ? "—" : unit === "s" ? `${(v / 1000).toFixed(1)}s` : String(v));
  const cohort = (c: { mean: number | null; n: number }, unit: "s" | "count" | "n") =>
    c.n < data.benchMinSample
      ? <span className="text-[var(--color-ink-faint)]">te weinig data ({c.n})</span>
      : <span>{fmt(c.mean, unit)} <span className="text-2xs text-[var(--color-ink-faint)]">({c.n})</span></span>;
  return (
    <Card padded={false}>
      <div className="p-5 pb-2">
        <div className="text-sm font-semibold">Deze video vs. vergelijkbare video&apos;s</div>
        <p className="text-2xs text-[var(--color-ink-faint)]">Alleen meetbare cijfers (geen AI nodig). Een gemiddelde is pas betrouwbaar vanaf {data.benchMinSample} vergelijkbare video&apos;s; daaronder tonen we &quot;te weinig data&quot;.</p>
      </div>
      <Table head={<><th className="sc-th">Cijfer</th><th className="sc-th text-right">Deze video</th><th className="sc-th text-right">Gem. {data.clientName}</th><th className="sc-th text-right">Gem. alle</th></>}>
        {data.benchmarks.map((b) => (
          <tr key={b.key}>
            <td className="sc-td">{b.label}</td>
            <td className="sc-td text-right font-semibold tabular-nums">{fmt(b.value, b.unit)}</td>
            <td className="sc-td text-right tabular-nums">{cohort(b.client, b.unit)}</td>
            <td className="sc-td text-right tabular-nums">{cohort(b.all, b.unit)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function InsightsTab({ data }: { data: ViewData }) {
  if (!data.insight) return <Card padded={false}><NotReady title="AI-conclusies nog niet beschikbaar" why="Deze stap vereist een ANTHROPIC_API_KEY en bij voorkeur een transcript." /></Card>;
  const i = data.insight;
  const Section = ({ title, items, tone }: { title: string; items?: string[]; tone: string }) =>
    items && items.length > 0 ? (
      <div>
        <div className={`mb-1 text-sm font-semibold ${tone}`}>{title}</div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-muted)]">{items.map((x, k) => <li key={k}>{x}</li>)}</ul>
      </div>
    ) : null;
  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <Section title="Wat gaat goed?" items={i.watWerkt} tone="text-[var(--color-good)]" />
        <Section title="Wat kan beter?" items={i.watMinder} tone="text-[var(--color-warn)]" />
        <Section title="Wat moet er aangepast worden?" items={i.verbeteringen} tone="text-[var(--color-ink)]" />
        <Section title="Onzekerheden / ontbrekende data" items={i.onzekerheden} tone="text-[var(--color-ink-faint)]" />
      </Card>
      {i.alternatieveHooks && i.alternatieveHooks.length > 0 ? (
        <Card>
          <div className="mb-1 text-sm font-semibold">Alternatieve hooks</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-muted)]">{i.alternatieveHooks.map((h, k) => <li key={k}>{h}</li>)}</ul>
        </Card>
      ) : null}
      {i.verbeterdScript ? (
        <Card>
          <div className="mb-1 text-sm font-semibold">Verbeterd script</div>
          <p className="whitespace-pre-wrap text-sm text-[var(--color-ink-muted)]">{i.verbeterdScript}</p>
        </Card>
      ) : null}
    </div>
  );
}
