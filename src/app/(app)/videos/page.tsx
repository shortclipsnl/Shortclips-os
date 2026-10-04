import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireInternal } from "@/server/auth/context";
import { listVideos } from "@/server/videos";
import { Avatar, Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import {
  daysSince,
  formatDate,
} from "@/lib/format";
import { VIDEO_STATUS, stageOverdue, type VideoStage } from "@/lib/statuses";
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

  const rows = await listVideos(viewer, {
    preset,
    status: params.status,
    clientSlug: params.klant,
  });

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
                <th className="sc-th">Status</th>
                <th className="sc-th">Editor</th>
                <th className="sc-th text-right">In stap</th>
                <th className="sc-th">Deadline</th>
                <th className="sc-th text-right">Feedback</th>
              </>
            }
          >
            {rows.map((v) => {
              const days = daysSince(v.statusChangedAt);
              const late = stageOverdue(v.status, days);
              const overdue = v.dueOn && v.dueOn < new Date().toISOString().slice(0, 10);
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
                  <td className="sc-td">
                    <Badge tone={VIDEO_STATUS[v.status as VideoStage]?.tone ?? "neutral"}>
                      {VIDEO_STATUS[v.status as VideoStage]?.label ?? v.status}
                    </Badge>
                  </td>
                  <td className="sc-td text-[var(--color-ink-muted)]">{v.editorName ?? "—"}</td>
                  <td className={`sc-td text-right tabular-nums ${late ? "font-semibold text-[var(--color-warn)]" : "text-[var(--color-ink-muted)]"}`}>
                    {days} d
                  </td>
                  <td className={`sc-td ${overdue ? "font-medium text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>
                    {v.dueOn ? formatDate(v.dueOn) : "—"}
                  </td>
                  <td className="sc-td text-right">
                    {Number(v.openComments) > 0 ? (
                      <Badge tone="warn">{Number(v.openComments)}</Badge>
                    ) : (
                      <span className="text-[var(--color-ink-faint)]">–</span>
                    )}
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
