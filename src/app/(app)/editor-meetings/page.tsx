import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Repeat2, Sparkles, Users } from "lucide-react";
import { isEditorRole, requireInternal } from "@/server/auth/context";
import { canUseEditorMeetings, getEditorPage, getInsights, getOverview, syncPlanTasksIfStale } from "@/server/editor-meetings";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { todayAmsterdam } from "@/lib/planning-deadline";
import { FIRST_MEETING_PERIOD, dateToAmsterdam, isPeriod, meetingMomentShort, monthLabel, monthTitle, nextPeriod, periodOf, planningPeriods, prevPeriod } from "@/lib/editor-meetings";
import { EditorOwnView } from "./editor-view";
import { OverviewTable, type OverviewRowData } from "./ui";

export const metadata: Metadata = { title: "Editor Meetings" };
export const dynamic = "force-dynamic";

export default async function EditorMeetingsPage({ searchParams }: { searchParams: Promise<{ maand?: string }> }) {
  const viewer = await requireInternal();
  if (!canUseEditorMeetings(viewer)) redirect("/dashboard");

  // Editors: uitsluitend de eigen meetings, verslagen en actiepunten.
  if (isEditorRole(viewer)) {
    const data = await getEditorPage(viewer);
    return <EditorOwnView data={data} firstName={viewer.fullName.split(" ")[0] ?? ""} />;
  }

  // Vangnet naast de dagelijkse job: plantaken en herinneringen bijwerken.
  await syncPlanTasksIfStale();

  const today = todayAmsterdam();
  const current = periodOf(today);
  const planFor = planningPeriods(today).create;
  const sp = (await searchParams).maand;
  const period = isPeriod(sp) ? sp : current;
  const [overview, insights] = await Promise.all([getOverview(viewer, period), getInsights(viewer)]);

  const mine = overview.viewerIsOwner ? overview.rows.filter((r) => r.owner?.id === viewer.id) : overview.rows;
  const toPlan = mine.filter((r) => r.status === "te_plannen" || r.status === "opnieuw_plannen");
  const overdue = overview.rows.filter((r) => r.overdue);
  const noReport = mine.filter((r) => r.status === "verslag_nodig" || r.status === "verslag_concept");

  // Voorstel voor het planformulier: de eerste werkdag van de maand om 10:00.
  const firstWorkday = (() => {
    const start = period === current ? today : `${period}-01`;
    const d = new Date(`${start}T12:00:00Z`);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const rows: OverviewRowData[] = overview.rows.map((r) => {
    const at = r.scheduledAt ? dateToAmsterdam(r.scheduledAt) : null;
    return {
      editorId: r.editor.id,
      editorName: r.editor.fullName,
      editorAvatar: r.editor.avatarUrl,
      ownerId: r.owner?.id ?? null,
      ownerName: r.owner?.fullName ?? null,
      ownerSource: r.ownerSource,
      canManage: r.canManage,
      meetingId: r.meetingId,
      scheduledLabel: r.scheduledAt ? meetingMomentShort(r.scheduledAt) : null,
      status: r.status,
      overdue: r.overdue,
      reportPublished: r.reportPublished,
      lastLabel: r.lastMeeting ? meetingMomentShort(r.lastMeeting.at) : null,
      lastId: r.lastMeeting?.id ?? null,
      nextLabel: r.nextMeeting ? meetingMomentShort(r.nextMeeting.at) : null,
      nextId: r.nextMeeting?.id ?? null,
      openActions: r.openActions,
      defaults: { meetingId: r.meetingId, editorId: r.editor.id, date: at?.date ?? firstWorkday, time: at?.time ?? "10:00", location: "", meetingUrl: "", topics: [] },
    };
  });

  const canPlanPast = period >= current && period >= FIRST_MEETING_PERIOD;
  return (
    <div className="mx-auto max-w-[1180px] space-y-6">
      <PageHeader
        title="Editor Meetings"
        description="Iedere editor heeft elke maand een persoonlijk gesprek met de verantwoordelijke content creator, bij voorkeur in de eerste week."
        actions={
          <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-1">
            <Link href={`/editor-meetings?maand=${prevPeriod(period)}`} className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]" aria-label="Vorige maand">
              <ChevronLeft className="size-4" />
            </Link>
            <span className="min-w-36 text-center text-sm font-semibold text-[var(--color-ink)]">{monthTitle(period)}</span>
            <Link href={`/editor-meetings?maand=${nextPeriod(period)}`} className="rounded p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]" aria-label="Volgende maand">
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
      />

      {/* Zeven dagen voor het maandeinde: direct door naar de maand die gepland moet worden. */}
      {planFor && period !== planFor ? (
        <Link href={`/editor-meetings?maand=${planFor}`} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] px-5 py-4 text-white transition-opacity hover:opacity-95">
          <CalendarClock className="size-5 shrink-0" />
          <span className="text-sm font-semibold">Plan de editor meetings voor {monthLabel(planFor)}.</span>
          <span className="ml-auto text-sm text-white/80">Naar {monthLabel(planFor)} →</span>
        </Link>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Actieve editors" value={overview.rows.length} icon={<Users className="size-4" />} compact />
        <Stat label={overview.viewerIsOwner ? "Door jou te plannen" : "Nog te plannen"} value={canPlanPast ? toPlan.length : 0} tone={canPlanPast && toPlan.length ? "warn" : "good"} compact />
        <Stat label="Verslag ontbreekt" value={noReport.length} tone={noReport.length ? "warn" : "good"} compact />
        <Stat label="Over tijd" value={overdue.length} tone={overdue.length ? "bad" : "good"} icon={<AlertTriangle className="size-4" />} compact />
      </div>

      <Card padded={false} className="overflow-hidden">
        {overview.rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--color-ink-muted)]">Er zijn nog geen actieve editors met een portaalaccount.</p>
        ) : (
          <OverviewTable rows={rows} owners={overview.owners.map((o) => ({ id: o.id, fullName: o.fullName }))} viewerId={viewer.id} isManagement={overview.isManagement} defaultOwner={overview.viewerIsOwner ? viewer.id : ""} monthName={monthLabel(period)} />
        )}
      </Card>

      {insights.recurring.length || insights.shared.length || insights.strengths.length ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Repeat2 className="size-4 text-[var(--color-warn)]" /> Terugkerende verbeterpunten</span>} subtitle="Hetzelfde thema in meerdere maanden." />
            {insights.recurring.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Geen terugkerende punten.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {insights.recurring.map((r) => (
                  <li key={r.editor.id}>
                    <div className="text-sm font-semibold text-[var(--color-ink)]">{r.editor.fullName}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {r.themes.map((t) => (
                        <Badge key={t.theme} tone="warn">{t.label} · {t.months} maanden</Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-[var(--color-violet)]" /> Intern verbeterpunt</span>} subtitle="Feedback op Shortclips van meerdere editors." />
            {insights.shared.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen feedback die van meerdere editors komt.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {insights.shared.map((s) => (
                  <li key={s.theme}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--color-ink)]">{s.label}</span>
                      <Badge tone="violet">{s.editors} editors</Badge>
                    </div>
                    {s.examples.map((e, i) => (
                      <p key={i} className="mt-1 text-sm text-[var(--color-ink-muted)]">{e}</p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-[var(--color-good)]" /> Sterke punten</span>} subtitle="Recent vastgelegd in de verslagen." />
            {insights.strengths.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen sterke punten vastgelegd.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {insights.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-[var(--color-ink)]">
                    <span className="font-semibold">{s.editor.fullName.split(" ")[0]}:</span> {s.body}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
