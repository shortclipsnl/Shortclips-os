import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requirePermission, isOwner } from "@/server/auth/context";
import { listAnalyses, assignableClients } from "@/server/video-intelligence/queries";
import { getIntelligenceOverview, getToolStatus } from "@/server/video-intelligence/intelligence";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { PLATFORM } from "@/lib/statuses";
import { AddVideo } from "./add-video";
import { AnalysisList } from "./analysis-list";
import { VI_STATUS, msToClock } from "./labels";

export const metadata: Metadata = { title: "Video Intelligence" };
export const dynamic = "force-dynamic";

export default async function VideoIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ klant?: string; platform?: string; status?: string }>;
}) {
  const viewer = await requirePermission("video_intelligence:read");
  const canRun = viewer.permissions.has("video_intelligence:run");
  const sp = await searchParams;
  const filters = { clientSlug: sp.klant, platform: sp.platform, status: sp.status };
  const [rows, clients, toolStatus, intel] = await Promise.all([
    listAnalyses(viewer, filters),
    assignableClients(viewer),
    getToolStatus(),
    getIntelligenceOverview(viewer, filters.clientSlug),
  ]);
  const hasFilter = Boolean(sp.klant || sp.platform || sp.status);
  const selectedClientName = sp.klant ? clients.find((c) => c.slug === sp.klant)?.name ?? null : null;

  const total = rows.length;
  const complete = rows.filter((r) => r.status === "complete").length;
  const processing = rows.filter((r) => ["queued", "downloading", "processing"].includes(r.status)).length;
  const needsAi = rows.filter((r) => r.status === "needs_ai" || r.status === "partial").length;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Video Intelligence"
        description="Analyseer organische short video's: shots, hooks, spraak, montage en AI-conclusies. Begrijp wáárom een video werkt."
      />

      {/* Alleen de eigenaar ziet de technische inrichting ("Analyse-onderdelen
          instellen"); teamleden hebben hier niets aan en kunnen het niet zelf. */}
      {isOwner(viewer) ? <ToolStatusPanel status={toolStatus} /> : null}

      {canRun ? <AddVideo clients={clients} /> : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Video's" value={String(total)} />
        <Stat label="Klaar" value={String(complete)} tone={complete > 0 ? "good" : undefined} />
        <Stat label="In verwerking" value={String(processing)} />
        <Stat label="Wacht op AI/tools" value={String(needsAi)} tone={needsAi > 0 ? "warn" : undefined} />
      </div>

      <PatternsCard intel={intel} clientName={selectedClientName} />

      {selectedClientName ? <ScriptHintsCard intel={intel} clientName={selectedClientName} /> : null}

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-2xs text-[var(--color-ink-faint)]">Klant</span>
          <select name="klant" defaultValue={sp.klant ?? ""} className="sc-input">
            <option value="">Alle klanten</option>
            {clients.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs text-[var(--color-ink-faint)]">Platform</span>
          <select name="platform" defaultValue={sp.platform ?? ""} className="sc-input">
            <option value="">Alle</option>
            {Object.entries(PLATFORM).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs text-[var(--color-ink-faint)]">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="sc-input">
            <option value="">Alle</option>
            {Object.entries(VI_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-2 text-sm font-medium text-white">Filter</button>
        {hasFilter ? <Link href="/video-intelligence" className="px-2 py-2 text-sm text-[var(--color-ink-muted)] hover:underline">wissen</Link> : null}
      </form>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilter ? "Geen video's voor deze filter" : "Nog geen video's geanalyseerd"}
            description={hasFilter ? "Pas de filters aan of wis ze." : canRun ? "Voeg hierboven een platform-URL toe of upload een MP4 om te beginnen." : "Er zijn nog geen analyses voor jouw klanten."}
            icon={<Sparkles className="size-6" />}
          />
        ) : (
          <AnalysisList rows={rows} canRun={canRun} />
        )}
      </Card>
    </div>
  );
}

type ToolStatus = { ffmpeg: boolean; ffprobe: boolean; ytdlp: boolean; whisper: boolean; ocr: boolean; anthropic: boolean };

function ToolStatusPanel({ status }: { status: ToolStatus }) {
  const items = [
    { ok: status.ffmpeg && status.ffprobe, label: "ffmpeg / ffprobe", need: "Duur, shotdetectie, thumbnails, montagetempo", fix: "meegeleverd (ffmpeg-static)" },
    { ok: status.ytdlp, label: "yt-dlp", need: "Video's ophalen via platform-URL", fix: "uv tool install yt-dlp" },
    { ok: status.whisper, label: "Whisper (transcriptie)", need: "Transcriptie met woordtijden", fix: "uv pip install -p .venv-vi/bin/python faster-whisper" },
    { ok: status.ocr, label: "OCR (teksten in beeld)", need: "Herkent tekst/ondertiteling in beeld", fix: "uv pip install -p .venv-vi/bin/python rapidocr-onnxruntime" },
    { ok: status.anthropic, label: "Anthropic-sleutel", need: "Visuele duiding + AI-conclusies", fix: "ANTHROPIC_API_KEY in .env.local" },
  ];
  if (items.every((i) => i.ok)) return null;
  return (
    <Card padded={false} className="mb-5 border-[var(--color-warn)]/30">
      <div className="p-4 pb-2">
        <CardHeader title="Analyse-onderdelen instellen" subtitle="De module werkt; deze stappen draaien zodra de bijbehorende tool/sleutel beschikbaar is. Tot die tijd worden ze eerlijk als 'nog niet beschikbaar' gemarkeerd." />
      </div>
      <ul className="divide-y divide-[var(--color-line)]">
        {items.map((i) => (
          <li key={i.label} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <Badge tone={i.ok ? "good" : "warn"}>{i.ok ? "gevonden" : "ontbreekt"}</Badge>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{i.label}</span>
              <span className="block text-2xs text-[var(--color-ink-faint)]">{i.need}</span>
            </span>
            {!i.ok ? (
              <code className="rounded bg-[var(--color-surface-sunken)] px-2 py-1 text-2xs">{i.fix}</code>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Intel = Awaited<ReturnType<typeof getIntelligenceOverview>>;

function PatternsCard({ intel, clientName }: { intel: Intel; clientName: string | null }) {
  return (
    <Card padded={false} className="mb-5">
      <div className="p-5 pb-2">
        <CardHeader title={clientName ? `Patronen — ${clientName}` : "Patronen over alle video's"} subtitle="Gemiddelden over je geanalyseerde video's. Elk cijfer toont op hoeveel video's het is gebaseerd — bij weinig data zijn conclusies nog niet betrouwbaar." />
      </div>
      {intel.total === 0 ? (
        <EmptyState title="Nog geen data" description="Zodra er video's geanalyseerd zijn, verschijnen hier de patronen (hooktypes, montagetempo, spreeksnelheid)." />
      ) : (
        <div className="grid gap-px bg-[var(--color-line)] sm:grid-cols-3">
          <PatternGroup title="Montage" n={intel.samples.editing} rows={[
            ["Gem. shots", intel.editing?.avgShots != null ? String(intel.editing.avgShots) : "—"],
            ["Gem. shotlengte", intel.editing?.avgShotMs != null ? `${(intel.editing.avgShotMs / 1000).toFixed(1)}s` : "—"],
            ["Cuts per 10s", intel.editing?.avgCutsPer10s != null ? String(intel.editing.avgCutsPer10s) : "—"],
            ["Gem. duur", intel.editing?.avgDurationMs != null ? msToClock(intel.editing.avgDurationMs) : "—"],
          ]} />
          <PatternGroup title="Spraak" n={intel.samples.speech} rows={[
            ["Woorden/min", intel.speech?.avgWpm != null ? String(intel.speech.avgWpm) : "—"],
            ["1e woord na", intel.speech?.avgFirstWordMs != null ? `${(intel.speech.avgFirstWordMs / 1000).toFixed(1)}s` : "—"],
            ["Woorden in 3s", intel.speech?.avgWords3s != null ? String(intel.speech.avgWords3s) : "—"],
          ]} />
          <div className="bg-[var(--color-surface)] p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">Hooktypes</span>
              <span className="text-2xs text-[var(--color-ink-faint)]">{intel.samples.hooks} video&apos;s</span>
            </div>
            {intel.hooks.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Nog geen hookclassificatie (vereist AI-duiding).</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {intel.hooks.slice(0, 8).map((h) => <Badge key={h.key} tone="info">{h.key} · {h.n}</Badge>)}
              </div>
            )}
          </div>
        </div>
      )}
      {intel.byPlatform.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-5 py-3">
          <span className="text-2xs text-[var(--color-ink-faint)]">Platforms:</span>
          {intel.byPlatform.map((p) => (
            <Badge key={p.key} tone="neutral">{(p.key !== "onbekend" && PLATFORM[p.key]?.label) || p.key} · {p.n}</Badge>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function scriptHints(intel: Intel): string[] {
  const h: string[] = [];
  const e = intel.editing;
  const s = intel.speech;
  if (e?.avgDurationMs != null) h.push(`Gemiddelde lengte van deze klant: ${msToClock(e.avgDurationMs)} — houd nieuwe video's in die buurt.`);
  if (e?.avgShots != null && e.avgShotMs != null) h.push(`Gemiddeld ${e.avgShots} shots (~${(e.avgShotMs / 1000).toFixed(1)}s per shot) — stem je shotlist daarop af.`);
  if (s?.avgFirstWordMs != null) {
    const sec = (s.avgFirstWordMs / 1000).toFixed(1);
    h.push(s.avgFirstWordMs < 1000
      ? `Video's beginnen vrijwel direct met spreken (~${sec}s) — open met je belangrijkste zin.`
      : `Eerste woord valt gemiddeld na ~${sec}s — overweeg een snellere opening.`);
  }
  if (s?.avgWords3s != null) h.push(`Gemiddeld ${s.avgWords3s} woorden in de eerste 3 seconden.`);
  return h;
}

function ScriptHintsCard({ intel, clientName }: { intel: Intel; clientName: string }) {
  const hints = scriptHints(intel);
  if (hints.length === 0) return null;
  return (
    <Card padded={false} className="mb-5">
      <div className="p-5 pb-2">
        <CardHeader title={`Voor je volgende script — ${clientName}`} subtitle="Kenmerken uit de geanalyseerde video's van deze klant, als vertrekpunt voor een nieuw script. Beschrijvend (nog niet gewogen op prestaties); prestatie-weging volgt zodra cijfers/AI gekoppeld zijn." />
      </div>
      <ul className="list-disc space-y-1.5 px-9 pb-5 text-sm text-[var(--color-ink-muted)]">
        {hints.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </Card>
  );
}

function PatternGroup({ title, n, rows }: { title: string; n: number; rows: Array<[string, string]> }) {
  return (
    <div className="bg-[var(--color-surface)] p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-2xs text-[var(--color-ink-faint)]">{n} video&apos;s</span>
      </div>
      {n === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Nog geen data.</p>
      ) : (
        <dl className="mt-2 space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <dt className="text-[var(--color-ink-muted)]">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
