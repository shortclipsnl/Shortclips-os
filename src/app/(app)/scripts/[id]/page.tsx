import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { getScript } from "@/server/scripts";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import {
  formatDate,
  formatDateFull,
  formatDateTime,
} from "@/lib/format";
import { SCRIPT_STATUS, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import { getLatestScriptControl } from "@/server/script-control";
import type { ScriptControlResult } from "@/server/actions/script-control";
import { ScriptEditor, ScriptStatusControl } from "./editor";
import { ScriptControlPanel } from "./script-control-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireInternal();
  const { script } = await getScript(viewer, id);
  return { title: script.title };
}

export default async function ScriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireInternal();
  const { id } = await params;
  const { script, versions, videos } = await getScript(viewer, id);
  const canWrite = viewer.permissions.has("scripts:write");
  const canControl = viewer.permissions.has("ai:read");
  const latestControl = canControl
    ? ((await getLatestScriptControl(script.id, script.clientId)) as ScriptControlResult | null)
    : null;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        breadcrumb={
          <Link
            href={`/clients/${script.clientSlug}?tab=scripts`}
            className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            ← {script.clientName}
          </Link>
        }
        title={script.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={SCRIPT_STATUS[script.status]?.tone ?? "neutral"}>
              {SCRIPT_STATUS[script.status]?.label ?? script.status}
            </Badge>
            <span>versie {script.currentVersion}</span>
            {script.pillar ? <span>· {script.pillar}</span> : null}
            {script.shootOn ? <span>· opname {formatDate(script.shootOn)}</span> : null}
          </span>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Volgende stap" />
            <div className="mt-3">
              <ScriptStatusControl scriptId={script.id} status={script.status} canWrite={canWrite} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Script"
              subtitle={canWrite ? "Elke keer opslaan maakt automatisch een nieuwe versie." : "Alleen-lezen."}
            />
            <div className="mt-5">
              <ScriptEditor
                scriptId={script.id}
                canWrite={canWrite}
                initial={{
                  title: script.title,
                  hook: script.hook ?? "",
                  body: script.body ?? "",
                  cta: script.cta ?? "",
                  shotList: script.shotList ?? "",
                  requirements: script.requirements ?? "",
                  internalNotes: script.internalNotes ?? "",
                }}
              />
            </div>
          </Card>

          {canControl ? (
            <ScriptControlPanel
              scriptId={script.id}
              orig={{ hook: script.hook ?? "", body: script.body ?? "", cta: script.cta ?? "" }}
              canApply={canWrite}
              initial={latestControl}
            />
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Klant">
                <Link href={`/clients/${script.clientSlug}`} className="flex items-center gap-2 hover:underline">
                  <Avatar name={script.clientName} color={script.clientColor} size={20} />
                  {script.clientName}
                </Link>
              </Row>
              <Row label="Format">{script.format ?? "—"}</Row>
              <Row label="Locatie">{script.locationName ?? "—"}</Row>
              <Row label="Presentator">{script.presenter ?? "—"}</Row>
              <Row label="Geschreven door">{script.creatorName ?? "—"}</Row>
              <Row label="Opnamedag">
                {script.productionDayId ? (
                  <Link href={`/productions/${script.productionDayId}`} className="hover:underline">
                    {formatDateFull(script.shootOn)}
                  </Link>
                ) : "niet gekoppeld"}
              </Row>
              <Row label="Goedgekeurd">
                {script.approvedAt ? formatDate(script.approvedAt) : "nog niet"}
              </Row>
            </dl>
          </Card>

          {videos.length > 0 ? (
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader title="Video's uit dit script" />
              </div>
              <ul className="divide-y divide-[var(--color-line)]">
                {videos.map((v) => (
                  <li key={v.id}>
                    <Link href={`/videos/${v.id}`} className="sc-row-link flex items-center gap-2 px-5 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                      <Badge tone={VIDEO_STATUS[v.status as VideoStage]?.tone ?? "neutral"}>
                        {VIDEO_STATUS[v.status as VideoStage]?.short ?? v.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title="Versiegeschiedenis" subtitle={`${versions.length} versies`} />
            </div>
            {versions.length === 0 ? (
              <EmptyState title="Nog geen versies" />
            ) : (
              <ol className="divide-y divide-[var(--color-line)]">
                {versions.map((v) => (
                  <li key={v.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">v{v.versionNumber}</span>
                      <Badge tone={SCRIPT_STATUS[v.status]?.tone ?? "neutral"}>
                        {SCRIPT_STATUS[v.status]?.label ?? v.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                      {v.changeSummary ?? "—"}
                    </p>
                    <p className="text-xs text-[var(--color-ink-faint)]">
                      {formatDateTime(v.createdAt)}
                      {v.authorName ? ` · ${v.authorName}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {script.clientNotes ? (
            <Card>
              <CardHeader title="Opmerkingen van de klant" />
              <p className="mt-3 text-sm whitespace-pre-line text-[var(--color-ink-muted)]">
                {script.clientNotes}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
