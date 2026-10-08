import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getVideoHighlights, listVideos } from "@/server/videos";
import { Avatar, Badge, Card, EmptyState, PageHeader, Stat, Table } from "@/components/ui";
import {
  formatDate,
} from "@/lib/format";
import { VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
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
  searchParams: Promise<{ weergave?: string; filter?: string; status?: string; klant?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;

  const preset = params.filter && params.filter !== "alles"
    ? (params.filter as "te-laat" | "bij-klant" | "mijn-werk" | "actief")
    : params.filter === "alles"
      ? undefined
      : "actief";

  const [rows, highlights] = await Promise.all([
    listVideos(viewer, {
      preset,
      status: params.status,
      clientSlug: params.klant,
    }),
    getVideoHighlights(viewer),
  ]);

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
          items={highlights.lateList.map((v) => ({ id: v.id, primary: v.clientName, secondary: v.title }))} empty="Niets te laat" />
        <DrillCard title="Wacht op klant" count={highlights.atClient} accent="var(--color-warn)" href="/videos?filter=bij-klant"
          items={highlights.atClientList.map((v) => ({ id: v.id, primary: v.clientName, secondary: v.title }))} empty="Niets bij de klant" />
        <DrillCard title="Wacht op editor" count={highlights.awaitingEditor} accent="var(--color-info)" href="/videos?status=awaiting_editor"
          items={highlights.awaitingEditorList.map((v) => ({ id: v.id, primary: v.editorName ?? "Geen editor", secondary: v.title }))} empty="Niets bij een editor" />
      </div>

      <div className="mb-5">
        <Stat label="In productie" value={highlights.inProduction} hint={`${highlights.awaitingEditor} wacht op editor`} href="/videos?filter=actief" />
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
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Geen video's in deze selectie"
            description="Pas het filter aan of bekijk alle video's."
          />
        </Card>
      ) : view === "kanban" ? (
        <Kanban rows={rows} />
      ) : (
        <Card padded={false}>
          <Table
            head={
              <>
                <th className="sc-th">Video</th>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Editor</th>
                <th className="sc-th">Fase</th>
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
              const health = overdue
                ? { label: "Te laat", tone: "bad" as const }
                : waiting
                  ? { label: "Wacht op feedback", tone: "neutral" as const }
                  : nearing
                    ? { label: "Deadline nadert", tone: "warn" as const }
                    : { label: "Op schema", tone: "good" as const };
              return (
                <tr key={v.id} className="sc-row-link">
                  <td className="sc-td">
                    <Link href={`/videos/${v.id}`} className="font-medium hover:underline">
                      {v.title}
                    </Link>
                  </td>
                  <td className="sc-td">
                    <Link href={`/clients/${v.clientSlug}`} className="flex items-center gap-2 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                      <Avatar name={v.clientName} color={v.clientColor} size={20} />
                      {v.clientName}
                    </Link>
                  </td>
                  <td className="sc-td text-[var(--color-ink-muted)]">{v.editorName ?? "—"}</td>
                  <td className="sc-td text-[var(--color-ink-muted)]">{VIDEO_STATUS[v.status as VideoStage]?.short ?? v.status}</td>
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
  items: { id: string; primary: string; secondary: string }[];
  empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <Link href={href} className="flex items-center justify-between gap-2 bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white hover:bg-[var(--color-indigo-soft)]">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-2xl font-bold tabular-nums" style={{ color: count > 0 ? accent : "rgba(255,255,255,.6)" }}>{count}</span>
      </Link>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={`/videos/${it.id}`} className="block px-4 py-2 hover:bg-[var(--color-surface-2)]">
                <span className="block truncate text-sm font-medium" style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>{it.primary}</span>
                <span className="mt-0.5 block truncate pl-[11px] text-xs text-[var(--color-ink-muted)]">{it.secondary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
