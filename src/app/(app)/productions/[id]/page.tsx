import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarDays, Clock, ExternalLink, ListChecks, MapPin, User, Video } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getProductionDay } from "@/server/productions";
import { getBriefingForShoot } from "@/server/briefing/service";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { BriefingView } from "@/components/briefing-view";
import { daysUntil, formatDateFull, plural, relativeDays } from "@/lib/format";
import { PRODUCTION_STATUS, SCRIPT_STATUS, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import { ChecklistItem } from "./checklist";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const viewer = await requireInternal();
  const { day } = await getProductionDay(viewer, id);
  return { title: day.title };
}

export default async function ProductionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireInternal();
  const { id } = await params;
  const { day, checklist, scripts, videos } = await getProductionDay(viewer, id);
  const briefing = await getBriefingForShoot(viewer, id);
  const canEdit = viewer.permissions.has("productions:write");

  const days = daysUntil(day.scheduledOn);
  const openBlockers = checklist.filter((c) => c.isBlocking && !c.isDone);
  const unapproved = scripts.filter(
    (s) => !["approved", "ready_to_shoot", "shot"].includes(s.status),
  );
  const atRisk = days >= 0 && days <= 2 && (openBlockers.length > 0 || unapproved.length > 0);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        breadcrumb={
          <Link href="/productions" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            ← Opnames
          </Link>
        }
        title={day.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={PRODUCTION_STATUS[day.status]?.tone ?? "neutral"}>
              {PRODUCTION_STATUS[day.status]?.label ?? day.status}
            </Badge>
            <span>{formatDateFull(day.scheduledOn)}</span>
            {days >= 0 ? <span>· {relativeDays(day.scheduledOn)}</span> : null}
          </span>
        }
      />

      {atRisk ? (
        <div className="mb-5 flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-bad)]/25 bg-[var(--color-bad-soft)] px-4 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-bad)]" strokeWidth={2} />
          <div className="text-sm">
            <p className="font-semibold text-[var(--color-ink)]">
              Deze opname staat {relativeDays(day.scheduledOn)} en is nog niet rond
            </p>
            <p className="mt-0.5 text-[#a3271c]">
              {unapproved.length > 0
                ? `${plural(unapproved.length, "script is", "scripts zijn")} nog niet goedgekeurd. `
                : ""}
              {openBlockers.length > 0
                ? `${plural(openBlockers.length, "blokkerend punt staat", "blokkerende punten staan")} nog open.`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader
                title="Scripts voor deze dag"
                subtitle={`${plural(scripts.length, "script")} · ${unapproved.length} nog niet goedgekeurd`}
              />
            </div>
            {scripts.length === 0 ? (
              <EmptyState
                title="Nog geen scripts gekoppeld"
                description="Koppel scripts aan deze opnamedag zodat de checklist compleet is."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {scripts.map((s) => (
                  <li key={s.id}>
                    <Link href={`/scripts/${s.id}`} className="sc-row-link flex items-center gap-3 px-5 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.title}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {s.pillar ?? "—"}
                          {s.presenter ? ` · ${s.presenter}` : ""}
                        </span>
                      </span>
                      <Badge tone={SCRIPT_STATUS[s.status]?.tone ?? "neutral"}>
                        {SCRIPT_STATUS[s.status]?.label ?? s.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {scripts.length > 0 || (briefing && briefing.status !== "geen") ? (
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader
                  title="Editor Briefing"
                  subtitle="Automatisch uit de script-PDF, de Editing Guide en de projectgegevens."
                />
              </div>
              <BriefingView
                briefing={briefing?.content ?? null}
                status={briefing?.status ?? "geen"}
                pdfHref={briefing?.status === "klaar" || briefing?.status === "bijgewerkt_script" ? `/api/briefing/${id}/pdf` : undefined}
                openHref={`/briefing/${id}`}
              />
            </Card>
          ) : null}

          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader
                title="Checklist"
                subtitle="Blokkerende punten moeten af zijn voordat de opname doorgaat."
              />
            </div>
            {checklist.length === 0 ? (
              <EmptyState title="Geen checklist" />
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {checklist.map((item) => (
                  <ChecklistItem
                    key={item.id}
                    id={item.id}
                    label={item.label}
                    isDone={item.isDone}
                    isBlocking={item.isBlocking}
                    canEdit={canEdit}
                  />
                ))}
              </ul>
            )}
          </Card>

          {day.schedule ? (
            <Card>
              <CardHeader title="Dagplanning" />
              <pre className="mt-3 font-sans text-sm whitespace-pre-wrap text-[var(--color-ink-muted)]">
                {day.schedule}
              </pre>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {/* Info ter voorbereiding op de opname — scanbaar voor de videograaf:
              de kernpunten (datum, tijd, locatie) springen eruit, met icoontjes
              en duidelijke kopjes. Subtiele lichtblauwe achtergrond zodat het blok
              direct opvalt zonder dat de pagina te druk wordt. */}
          <Card className="border-[var(--st-blue)]/25 bg-[var(--st-blue-bg)]">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-[var(--st-blue)]/15 text-[var(--st-blue)]"><ListChecks className="size-4" /></span>
              <h2 className="text-sm font-semibold text-[var(--color-ink)]">Info ter voorbereiding op de opname</h2>
            </div>

            {/* Kernpunten groot: wanneer en waar — in één oogopslag. */}
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <PrepTile icon={<CalendarDays className="size-4" />} label="Datum" value={formatDateFull(day.scheduledOn)} />
              <PrepTile icon={<Clock className="size-4" />} label="Tijd" value={day.startTime ? `${day.startTime.slice(0, 5)}–${day.endTime?.slice(0, 5) ?? "?"}` : "—"} />
              <div className="col-span-2">
                <PrepTile
                  icon={<MapPin className="size-4" />}
                  label="Locatie"
                  value={day.locationName ?? (day.locationAddress ? "" : "—")}
                  sub={
                    day.locationAddress ? (
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(day.locationAddress)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
                      >
                        <MapPin className="size-3.5" /> {day.locationAddress}
                      </a>
                    ) : null
                  }
                />
              </div>
            </div>

            {/* Wie: klant + videograaf, secundair. */}
            <dl className="mt-4 space-y-2.5 border-t border-[var(--st-blue)]/20 pt-3.5 text-sm">
              <IconRow icon={<User className="size-4" />} label="Klant">
                <Link href={`/clients/${day.clientSlug}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                  <Avatar name={day.clientName} color={day.clientColor} size={20} />
                  {day.clientName}
                </Link>
              </IconRow>
              <IconRow icon={<Video className="size-4" />} label="Videograaf">
                <span className="font-medium">{day.videographerName ?? "—"}</span>
              </IconRow>
            </dl>

            {/* Aandachtspunt: alleen tonen als de opname nog niet rond is. */}
            {atRisk ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-2.5 py-2 text-xs font-medium text-[#a3271c]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Let op: {unapproved.length > 0 ? `${plural(unapproved.length, "script", "scripts")} nog niet goedgekeurd` : ""}{unapproved.length > 0 && openBlockers.length > 0 ? " · " : ""}{openBlockers.length > 0 ? `${plural(openBlockers.length, "blokkerend punt", "blokkerende punten")} open` : ""}.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Bestanden" />
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-ink-muted)]">Drive-map</span>
                {day.driveFolderId ? (
                  <a
                    href={`https://drive.google.com/drive/folders/${day.driveFolderId}`}
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
              <li className="flex items-center justify-between gap-2">
                <span className="text-[var(--color-ink-muted)]">Frame.io-project</span>
                <span className={day.frameProjectId ? "font-medium" : "text-[var(--color-ink-faint)]"}>
                  {day.frameProjectId ?? "niet gekoppeld"}
                </span>
              </li>
            </ul>
          </Card>

          {videos.length > 0 ? (
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader title="Video's uit deze dag" subtitle={plural(videos.length, "video", "video's")} />
              </div>
              <ul className="divide-y divide-[var(--color-line)]">
                {videos.slice(0, 12).map((v) => (
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
        </div>
      </div>
    </div>
  );
}

/** Groot, scanbaar kernpunt (datum/tijd/locatie) met icoon en kopje. */
function PrepTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--st-blue)]/20 bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--st-blue)]">
        {icon} {label}
      </div>
      {value ? <p className="mt-1 text-sm font-semibold leading-snug text-[var(--color-ink)]">{value}</p> : null}
      {sub}
    </div>
  );
}

/** Secundaire regel met icoon, kopje en waarde. */
function IconRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="inline-flex shrink-0 items-center gap-1.5 text-[var(--color-ink-muted)]">
        <span className="text-[var(--st-blue)]">{icon}</span> {label}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
