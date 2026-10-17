import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ExternalLink, MessageSquare } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getReviewQueue, getVideoHighlights, listEditorOptions, listVideos, type ReviewQueueItem } from "@/server/videos";
import { EditorFilter } from "./editor-filter";
import { Badge, Card, ClientLogo, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import {
  daysSince,
  formatDate,
} from "@/lib/format";
import { VIDEO_STATUS, VIDEO_WAITING_ON, videoPhase, stageOverdue, type VideoStage } from "@/lib/statuses";

const WAITING_ON: Record<string, { label: string; color: string }> = {
  client: { label: "Klant", color: "var(--color-warn)" },
  editor: { label: "Editor", color: "var(--color-brand-600)" },
  shortclips: { label: "Eigen team", color: "var(--color-indigo-ink)" },
  none: { label: "—", color: "var(--color-ink-faint)" },
};
import { ViewSwitch } from "./view-switch";
import { Kanban } from "./kanban";

export const metadata: Metadata = { title: "Video's" };
export const dynamic = "force-dynamic";

const PRESETS = [
  { value: "actief", label: "In productie" },
  { value: "bij-klant", label: "Bij de klant" },
  { value: "te-laat", label: "Te laat" },
  { value: "mijn-werk", label: "Mijn werk" },
  { value: "alles", label: "Alles" },
];

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ weergave?: string; filter?: string; status?: string; klant?: string; editor?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;

  const preset = params.filter && params.filter !== "alles"
    ? (params.filter as "te-laat" | "bij-klant" | "mijn-werk" | "actief")
    : params.filter === "alles"
      ? undefined
      : "actief";

  const [rows, highlights, reviewQueue, editors] = await Promise.all([
    listVideos(viewer, {
      preset,
      status: params.status,
      clientSlug: params.klant,
      editorId: params.editor,
    }),
    getVideoHighlights(viewer),
    getReviewQueue(viewer),
    listEditorOptions(),
  ]);
  const canEdit = viewer.permissions.has("videos:write");

  const view = params.weergave === "kanban" ? "kanban" : "lijst";

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title="Video's"
        description={`${rows.length} video's${params.status ? ` in de stap ${VIDEO_STATUS[params.status as VideoStage]?.label ?? params.status}` : ""}`}
        actions={
          <Suspense fallback={null}>
            <ViewSwitch
              param="weergave"
              fallback="lijst"
              options={[
                { value: "lijst", label: "Lijst" },
                { value: "kanban", label: "Kanban" },
              ]}
            />
          </Suspense>
        }
      />

      {/* Aandachtsblokken: automatisch uit Monday (fase + deadline). */}
      {highlights.late > 0 || highlights.atClient > 0 ? (
        <Card className="mb-4 border-[var(--color-bad)]/25 bg-[var(--color-bad-soft)]/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-bad)]" strokeWidth={1.75} />
            <div className="text-sm">
              <p className="font-semibold">Vraagt nu aandacht</p>
              <ul className="mt-1 space-y-0.5 text-[var(--color-ink-muted)]">
                {highlights.late > 0 ? (
                  <li>
                    <Link href="/videos?filter=te-laat" className="font-medium text-[var(--color-bad)] hover:underline">
                      {highlights.late} video&apos;s over de deadline
                    </Link>{" "}
                    — moeten met voorrang afgerond worden.
                  </li>
                ) : null}
                {highlights.atClient > 0 ? (
                  <li>
                    <Link href="/videos?filter=bij-klant" className="font-medium text-[var(--color-ink)] hover:underline">
                      {highlights.atClient} video&apos;s wachten op klantfeedback
                    </Link>
                    {highlights.oldestAtClientDays > 0 ? ` — langst wachtende: ${highlights.oldestAtClientDays} dagen.` : "."}
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <DrillCard title="Te laat" count={highlights.late} accent="var(--color-bad)" href="/videos?filter=te-laat"
          items={highlights.lateList.map((v) => ({ id: v.id, primary: v.clientName, secondary: v.title, meta: `${Number(v.days)} d te laat` }))} empty="Niets te laat" />
        <DrillCard title="Wacht op klant" count={highlights.atClient} accent="var(--color-warn)" href="/videos?filter=bij-klant"
          items={highlights.atClientList.map((v) => ({ id: v.id, primary: v.clientName, secondary: v.title, meta: `${Number(v.days)} d geen reactie` }))} empty="Niets bij de klant" />
        <DrillCard title="Wacht op editor" count={highlights.awaitingEditor} accent="var(--color-info)" href="/videos?status=awaiting_editor"
          items={highlights.awaitingEditorList.map((v) => ({ id: v.id, primary: v.editorName ?? "Geen editor", secondary: v.title, meta: `${Number(v.days)} d bij editor` }))} empty="Niets bij een editor" />
      </div>

      {/* Video's om te checken — interne controle, automatisch gevuld uit de pipeline. */}
      <ReviewQueue queue={reviewQueue} />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="min-w-48">
          <Stat label="In productie" value={highlights.inProduction} hint={`${highlights.awaitingEditor} wacht op editor`} href="/videos?filter=actief" />
        </div>
        {/* Vaste statuskleuren — consequent door het hele Editing Dashboard. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--color-ink-muted)]">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--color-bad)]" />Te laat</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--color-warn)]" />Wacht op klant</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--color-brand-600)]" />Wacht op editor</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--color-good)]" />Afgerond</span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = (params.filter ?? "actief") === p.value;
          const qs = new URLSearchParams();
          if (p.value !== "actief") qs.set("filter", p.value);
          if (params.weergave) qs.set("weergave", params.weergave);
          return (
            <Link
              key={p.value}
              href={qs.toString() ? `/videos?${qs}` : "/videos"}
              className={
                active
                  ? "rounded-full bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                  : "rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }
            >
              {p.label}
            </Link>
          );
        })}
        {params.status ? (
          <Link
            href="/videos"
            className="rounded-full bg-[var(--color-info-soft)] px-3 py-1.5 text-xs font-medium text-[#0060a8]"
          >
            {VIDEO_STATUS[params.status as VideoStage]?.label} ✕
          </Link>
        ) : null}
        <span className="ml-auto"><EditorFilter editors={editors} current={params.editor} /></span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Geen video's in deze selectie"
            description="Pas het filter aan of bekijk alle video's."
          />
        </Card>
      ) : view === "kanban" ? (
        <Kanban rows={rows} canEdit={canEdit} />
      ) : (
        <Card padded={false}>
          <Table
            head={
              <>
                <th className="sc-th">Video</th>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Fase</th>
                <th className="sc-th">Wacht op</th>
                <th className="sc-th">In fase</th>
                <th className="sc-th">Editor</th>
                <th className="sc-th">Deadline</th>
                <th className="sc-th">Status</th>
              </>
            }
          >
            {rows.map((v) => {
              const today = new Date().toISOString().slice(0, 10);
              const soon = new Date();
              soon.setDate(soon.getDate() + 3);
              const soonStr = soon.toISOString().slice(0, 10);
              const overdue = v.dueOn && v.dueOn < today;
              const nearing = v.dueOn && v.dueOn >= today && v.dueOn <= soonStr;
              const waiting = v.status === "client_review" || v.status === "client_revision";
              const inPhase = daysSince(v.statusChangedAt);
              const stuck = stageOverdue(v.status, inPhase);
              const waitOn = WAITING_ON[VIDEO_WAITING_ON[v.status as VideoStage] ?? "none"];
              const fase = videoPhase(v.status);
              const health = overdue
                ? { label: "Te laat", tone: "bad" as const }
                : waiting
                  ? { label: "Wacht op klant", tone: "warn" as const }
                  : stuck
                    ? { label: "Loopt vast", tone: "bad" as const }
                    : nearing
                      ? { label: "Deadline nadert", tone: "warn" as const }
                      : { label: "Op schema", tone: "neutral" as const };
              return (
                <tr key={v.id} className="sc-row-link">
                  <td className="sc-td">
                    <Link href={`/videos/${v.id}`} className="font-medium hover:underline">
                      {v.title}
                    </Link>
                  </td>
                  <td className="sc-td">
                    <Link href={`/clients/${v.clientSlug}`} className="flex items-center gap-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                      <ClientLogo name={v.clientName} logoUrl={v.clientLogo} color={v.clientColor} size={20} />
                      {v.clientName}
                    </Link>
                  </td>
                  <td className="sc-td">
                    {/* Lijst is alleen-lezen; status wijzig je op de detailpagina via "Volgende stap". */}
                    <Badge tone={fase.tone}>{fase.label}</Badge>
                  </td>
                  <td className="sc-td">
                    {waitOn.label === "—" ? (
                      <span className="text-[var(--color-ink-faint)]">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: waitOn.color }}>
                        <span className="size-2 rounded-full" style={{ background: waitOn.color }} />
                        {waitOn.label}
                      </span>
                    )}
                  </td>
                  <td className={`sc-td tabular-nums ${stuck ? "font-semibold text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>
                    {inPhase} d
                  </td>
                  <td className="sc-td text-[var(--color-ink-muted)]">
                    {v.editorName ?? "—"}
                  </td>
                  <td className={`sc-td ${overdue ? "font-medium text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>
                    {v.dueOn ? formatDate(v.dueOn) : "—"}
                  </td>
                  <td className="sc-td">
                    <Badge tone={health.tone}>{health.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </div>
  );
}

function ReviewQueue({ queue }: { queue: { teControleren: ReviewQueueItem[]; feedbackOntvangen: ReviewQueueItem[]; goedgekeurd: ReviewQueueItem[] } }) {
  const groups = [
    { key: "check", title: "Te controleren", hint: "klaar voor interne controle", accent: "var(--color-brand-600)", items: queue.teControleren, empty: "Niets te controleren" },
    { key: "feedback", title: "Feedback ontvangen", hint: "editor verwerkt de interne feedback", accent: "var(--color-warn)", items: queue.feedbackOntvangen, empty: "Geen feedback openstaand" },
    { key: "approved", title: "Goedgekeurd", hint: "intern akkoord", accent: "var(--color-good)", items: queue.goedgekeurd, empty: "Nog niets goedgekeurd" },
  ] as const;
  const total = queue.teControleren.length + queue.feedbackOntvangen.length + queue.goedgekeurd.length;

  return (
    <Card padded={false} className="mb-5 overflow-hidden ring-1 ring-[var(--color-violet)]/25">
      <div className="flex items-center justify-between gap-2 bg-[var(--color-violet)] px-5 py-3 text-white">
        <div>
          <h2 className="text-base font-bold tracking-tight">Video&apos;s om te checken</h2>
          <p className="text-xs text-white/70">Automatisch gevuld zodra een video klaarstaat voor controle. Klik door naar Frame.io.</p>
        </div>
        <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-0.5 text-sm font-semibold">{total}</span>
      </div>
      <div className="grid gap-px bg-[var(--color-line)] lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.key} className="bg-[var(--color-surface)]">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="size-2.5 rounded-full" style={{ background: g.accent }} />
                {g.title}
              </span>
              <span className="text-2xs text-[var(--color-ink-faint)]">{g.items.length}</span>
            </div>
            <p className="px-4 pb-2 text-2xs text-[var(--color-ink-faint)]">{g.hint}</p>
            {g.items.length === 0 ? (
              <p className="px-4 pb-4 text-xs text-[var(--color-ink-faint)]">{g.empty}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
                {g.items.map((v) => <ReviewRow key={v.id} v={v} accent={g.accent} />)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ReviewRow({ v, accent }: { v: ReviewQueueItem; accent: string }) {
  const comments = Number(v.openComments);
  const days = Number(v.days);
  return (
    <li className="flex items-center gap-2 px-4 py-2.5">
      <Link href={`/videos/${v.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
        <ClientLogo name={v.clientName} logoUrl={v.clientLogo} color={v.clientColor} size={24} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{v.title}</span>
          <span className="block truncate text-xs text-[var(--color-ink-muted)]">
            {v.clientName}{v.editorName ? ` · ${v.editorName}` : ""} · {days} d
          </span>
        </span>
      </Link>
      {comments > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]" title={`${comments} open opmerkingen`}>
          <MessageSquare className="size-3" /> {comments}
        </span>
      ) : null}
      {v.frameUrl ? (
        <a
          href={v.frameUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-brand-600)] hover:bg-[var(--color-surface-sunken)]"
          title="Open in Frame.io"
        >
          Frame.io <ExternalLink className="size-3" />
        </a>
      ) : (
        <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">geen Frame.io</span>
      )}
    </li>
  );
}

function DrillCard({
  title,
  count,
  accent,
  href,
  items,
  empty,
}: {
  title: string;
  count: number;
  accent: string;
  href: string;
  items: { id: string; primary: string; secondary: string; meta?: string }[];
  empty: string;
}) {
  const active = count > 0;
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)]"
      style={{ borderColor: active ? `color-mix(in srgb, ${accent} 35%, var(--color-line))` : "var(--color-line)" }}
    >
      <Link
        href={href}
        className="flex items-center justify-between gap-2 px-4 py-2.5 transition-[filter] hover:brightness-[0.98]"
        style={{
          background: active ? `color-mix(in srgb, ${accent} 13%, var(--color-surface))` : "var(--color-surface-sunken)",
          color: active ? accent : "var(--color-ink-muted)",
          borderBottom: `2px solid ${active ? accent : "var(--color-line)"}`,
        }}
      >
        <span className="text-sm font-bold">{title}</span>
        <span className="text-2xl font-bold tabular-nums">{count}</span>
      </Link>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={`/videos/${it.id}`} className="block px-4 py-2 hover:bg-[var(--color-surface-2)]">
                <span className="flex items-center justify-between gap-2" style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>
                  <span className="truncate text-sm font-medium">{it.primary}</span>
                  {it.meta ? <span className="shrink-0 text-xs font-semibold" style={{ color: accent }}>{it.meta}</span> : null}
                </span>
                <span className="mt-0.5 block truncate pl-[11px] text-xs text-[var(--color-ink-muted)]">{it.secondary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
