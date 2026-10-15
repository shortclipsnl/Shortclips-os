import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Film, Lock, Users } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getVideo } from "@/server/videos";
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import {
  daysSince,
  euro,
  formatDate,
  formatDateFull,
  formatDateTime,
  relativeDays,
} from "@/lib/format";
import { videoPhase, stageOverdue } from "@/lib/statuses";
import { getQcChecklist } from "@/server/qc";
import { StatusControl, EditorPicker } from "./status-control";
import { CommentForm, ResolveButton } from "./comment-form";
import { QcPanel } from "./qc-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireInternal();
  const { video } = await getVideo(viewer, id);
  return { title: video.title };
}

function timecode(ms: number | null): string {
  if (ms === null) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireInternal();
  const { id } = await params;
  const detail = await getVideo(viewer, id);
  const v = detail.video;
  const qc = await getQcChecklist(viewer, id);
  const canWriteVideo = viewer.permissions.has("videos:write");

  const days = daysSince(v.statusChangedAt);
  const late = stageOverdue(v.status, days);
  const meta = videoPhase(v.status);

  const internalThreads = detail.threads.filter((t) => t.visibility === "internal");
  const clientThreads = detail.threads.filter((t) => t.visibility === "client");
  const pendingApproval = detail.approvals.find((a) => a.status === "pending");

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        breadcrumb={
          <Link
            href={`/clients/${v.clientSlug}?tab=videos`}
            className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            ← {v.clientName}
          </Link>
        }
        title={v.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? v.status}</Badge>
            <span className={late ? "text-[var(--color-warn)]" : undefined}>
              {days} dagen in deze stap
            </span>
            <span>· versie {v.currentVersion}</span>
            {v.dueOn ? <span>· deadline {formatDate(v.dueOn)}</span> : null}
          </span>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Statusbesturing */}
          <Card>
            <CardHeader
              title="Volgende stap"
              subtitle="De pipeline gaat verder zodra je hier een stap kiest."
            />
            <div className="mt-4">
              <StatusControl
                videoId={v.id}
                status={v.status}
                canWrite={viewer.permissions.has("videos:write")}
              />
            </div>
          </Card>

          {pendingApproval ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-3 text-sm">
              <strong className="font-semibold">Wacht op goedkeuring van de klant</strong> —
              aangevraagd {relativeDays(pendingApproval.requestedAt)}.
            </div>
          ) : null}

          {/* Kwaliteitscontrole */}
          {detail.canSeeInternal ? <QcPanel items={qc.items} canWrite={canWriteVideo} /> : null}

          {/* Feedback */}
          {detail.canSeeInternal ? (
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader
                  title="Interne feedback"
                  subtitle="Alleen zichtbaar voor het ShortClips-team."
                  action={<Lock className="size-4 text-[var(--color-ink-faint)]" />}
                />
              </div>
              <ThreadList threads={internalThreads} canResolve />
              <div className="border-t border-[var(--color-line)] p-5">
                <CommentForm
                  videoId={v.id}
                  canInternal={viewer.permissions.has("comments:write_internal")}
                  canClient={false}
                />
              </div>
            </Card>
          ) : null}

          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader
                title="Feedback met de klant"
                subtitle="Deze opmerkingen zijn zichtbaar in het klantportaal."
                action={<Users className="size-4 text-[var(--color-ink-faint)]" />}
              />
            </div>
            <ThreadList threads={clientThreads} canResolve={detail.canSeeInternal} />
            {viewer.permissions.has("comments:write_client") ? (
              <div className="border-t border-[var(--color-line)] p-5">
                <CommentForm videoId={v.id} canInternal={false} canClient />
              </div>
            ) : null}
          </Card>

          {/* Versies */}
          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title="Versies" subtitle="Bestanden blijven in Frame.io staan." />
            </div>
            {detail.versions.length === 0 ? (
              <EmptyState
                title="Nog geen versie geüpload"
                icon={<Film className="size-6" />}
                description="Zodra de editor een versie in Frame.io plaatst, verschijnt die hier."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {detail.versions.map((ver) => (
                  <li key={ver.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">
                      v{ver.versionNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {ver.label ?? `Versie ${ver.versionNumber}`}
                      </span>
                      <span className="block text-xs text-[var(--color-ink-muted)]">
                        {formatDateTime(ver.uploadedAt)}
                        {ver.durationSeconds ? ` · ${ver.durationSeconds}s` : ""}
                      </span>
                    </span>
                    {ver.isCurrent ? <Badge tone="good">huidig</Badge> : null}
                    {ver.fileUrl ? (
                      <a
                        href={ver.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-brand-600)]"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Zijkolom */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="mt-4 space-y-3 text-sm">
              <Field label="Klant">
                <Link href={`/clients/${v.clientSlug}`} className="flex items-center gap-2 hover:underline">
                  <Avatar name={v.clientName} color={v.clientColor} size={20} />
                  {v.clientName}
                </Link>
              </Field>
              <Field label="Script">
                {v.scriptId ? (
                  <Link href={`/scripts/${v.scriptId}`} className="hover:underline">
                    {v.scriptTitle}
                  </Link>
                ) : "—"}
              </Field>
              <Field label="Opnamedag">
                {v.productionDayId ? (
                  <Link href={`/productions/${v.productionDayId}`} className="hover:underline">
                    {formatDate(v.shootOn)}
                  </Link>
                ) : "—"}
              </Field>
              <Field label="Deadline">{v.dueOn ? formatDateFull(v.dueOn) : "—"}</Field>
              <Field label="Publicatiedatum">
                {v.plannedPublishOn ? formatDateFull(v.plannedPublishOn) : "—"}
              </Field>
              <Field label="Revisierondes">
                {v.internalRevisionRounds} intern · {v.clientRevisionRounds} klant
              </Field>
              {viewer.permissions.has("finance:read_costs") ? (
                <Field label="Editkosten">{euro(v.editCost, true)}</Field>
              ) : null}
              <Field label="Beeldverhouding">{v.aspectRatio}</Field>
            </dl>
          </Card>

          {viewer.permissions.has("videos:assign") ? (
            <Card>
              <CardHeader title="Toewijzing" />
              <div className="mt-4">
                <EditorPicker
                  videoId={v.id}
                  editorId={v.editorId}
                  options={detail.editorOptions}
                />
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Editor" />
              <p className="mt-3 text-sm">{v.editorName ?? "Nog niet toegewezen"}</p>
            </Card>
          )}

          {v.briefing ? (
            <Card>
              <CardHeader title="Briefing" />
              <p className="mt-3 text-sm whitespace-pre-line text-[var(--color-ink-muted)]">
                {v.briefing}
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Externe systemen" />
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-ink-muted)]">Frame.io</span>
                {v.frameUrl ? (
                  <a href={v.frameUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">
                    openen <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-[var(--color-ink-faint)]">niet gekoppeld</span>
                )}
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-ink-muted)]">Drive-map</span>
                {v.driveFolderId ? (
                  <a
                    href={`https://drive.google.com/drive/folders/${v.driveFolderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline"
                  >
                    openen <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-[var(--color-ink-faint)]">niet gekoppeld</span>
                )}
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function ThreadList({
  threads,
  canResolve,
}: {
  threads: Array<{
    id: string;
    isResolved: boolean;
    timecodeMs: number | null;
    comments: Array<{
      id: string;
      body: string;
      authorName: string | null;
      createdAt: Date;
      source: string;
    }>;
  }>;
  canResolve: boolean;
}) {
  if (threads.length === 0) {
    return <EmptyState title="Nog geen opmerkingen" />;
  }
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {threads.map((t) => (
        <li key={t.id} className={t.isResolved ? "opacity-60" : undefined}>
          <div className="px-5 py-3">
            {t.comments.map((c) => (
              <div key={c.id} className="mb-2 last:mb-0">
                <div className="flex items-center gap-2">
                  <Avatar name={c.authorName ?? "?"} size={22} />
                  <span className="text-sm font-medium">{c.authorName ?? "Onbekend"}</span>
                  {t.timecodeMs !== null ? (
                    <Badge tone="neutral">{timecode(t.timecodeMs)}</Badge>
                  ) : null}
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {formatDateTime(c.createdAt)}
                  </span>
                  {c.source === "frameio" ? <Badge tone="info">via Frame.io</Badge> : null}
                </div>
                <p className="mt-1 pl-8 text-sm text-[var(--color-ink-muted)]">{c.body}</p>
              </div>
            ))}
            {canResolve ? (
              <div className="mt-1.5 pl-8">
                <ResolveButton threadId={t.id} isResolved={t.isResolved} />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
