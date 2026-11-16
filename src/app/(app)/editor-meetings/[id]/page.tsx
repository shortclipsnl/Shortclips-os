import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarPlus, ClipboardList, History, Lock, MapPin, MessageSquarePlus, Repeat2, Video } from "lucide-react";
import { ForbiddenError, requireInternal } from "@/server/auth/context";
import { canUseEditorMeetings, getMeetingDetail, type MeetingDetail } from "@/server/editor-meetings";
import { Badge, Card, CardHeader, InfoNote, PageHeader, Stat, TeamAvatar } from "@/components/ui";
import { formatDateFull } from "@/lib/format";
import { EDIT_PHASE_LABEL_FALLBACK } from "./labels";
import { ITEM_OUTCOME_LABEL, OWNER_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, dateToAmsterdam, editorStatusLabel, meetingMoment, meetingMomentShort, monthLabel, monthTitle, prevPeriod } from "@/lib/editor-meetings";
import { ActionLine, HandledItemLine, PointLine } from "../editor-view";
import { MeetingControls, PointToggle, ReportForm, TopicsEditor } from "../ui";

export const metadata: Metadata = { title: "Editor meeting" };
export const dynamic = "force-dynamic";

const nl = (v: number) => String(v).replace(".", ",");

export default async function EditorMeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInternal();
  if (!canUseEditorMeetings(viewer)) redirect("/dashboard");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let detail: MeetingDetail | null;
  try {
    detail = await getMeetingDetail(viewer, id);
  } catch (error) {
    // Geen toegang tot deze meeting: terug naar het eigen overzicht, zonder iets te tonen.
    if (error instanceof ForbiddenError) redirect("/editor-meetings");
    throw error;
  }
  if (!detail) notFound();

  return detail.mode === "editor" ? <EditorDetail d={detail} /> : <TeamDetail d={detail} />;
}

function Back() {
  return (
    <Link href="/editor-meetings" className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
      <ArrowLeft className="size-3.5" /> Editor Meetings
    </Link>
  );
}

function Where({ d }: { d: MeetingDetail }) {
  const m = d.meeting;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--color-ink-muted)]">
      {m.location ? <span className="flex items-center gap-1.5"><MapPin className="size-4" /> {m.location}</span> : null}
      {m.meetingUrl ? (
        <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-medium text-[var(--color-brand-600)] hover:underline"><Video className="size-4" /> Vergaderlink</a>
      ) : null}
      {d.calendarUrl ? (
        <a href={d.calendarUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-[var(--color-ink)]"><CalendarPlus className="size-4" /> Zet in Google Agenda</a>
      ) : null}
    </div>
  );
}

function ReportBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--color-line)] px-5 py-4 first:border-t-0">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

/* ------------------------------- editor ------------------------------- */

function EditorDetail({ d }: { d: MeetingDetail }) {
  const m = d.meeting;
  const published = m.reportStatus === "gepubliceerd";
  const by = (kind: string) => d.points.filter((p) => p.kind === kind);
  const ownerFirst = d.owner?.fullName.split(" ")[0] ?? "Shortclips";
  return (
    <div className="mx-auto max-w-[860px] space-y-6">
      <PageHeader
        breadcrumb={<Back />}
        title={`Editor meeting ${monthLabel(m.period)}`}
        description={m.scheduledAt && m.status === "gepland" ? `${meetingMoment(m.scheduledAt)} · met ${ownerFirst}` : `Met ${ownerFirst}`}
        actions={<Badge tone={STATUS_TONE[m.display]}>{editorStatusLabel(m.display)}</Badge>}
      />
      <Where d={d} />

      {m.topics.length ? (
        <Card>
          <CardHeader title="Bespreekpunten" />
          <ul className="mt-3 space-y-1.5">
            {m.topics.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-[var(--color-ink)]"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-500)]" />{t}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!published ? (
        <InfoNote>Het verslag van deze meeting is er nog niet. Je krijgt een melding zodra {ownerFirst} het heeft gepubliceerd.</InfoNote>
      ) : (
        <Card padded={false}>
          <div className="px-5 py-4">
            <CardHeader title="Verslag" subtitle={`Besproken periode: ${monthLabel(prevPeriod(m.period))}${m.publishedAt ? ` · gepubliceerd op ${formatDateFull(m.publishedAt)}` : ""}`} />
          </div>
          <ReportBlock title="Wat ging goed?">
            {by("sterk").length ? <ul className="divide-y divide-[var(--color-line)]">{by("sterk").map((p) => <PointLine key={p.id} point={p} />)}</ul> : <p className="text-sm text-[var(--color-ink-muted)]">Niets vastgelegd.</p>}
          </ReportBlock>
          <ReportBlock title="Wat kan beter?">
            {by("verbeterpunt").length ? (
              <ul className="divide-y divide-[var(--color-line)]">
                {by("verbeterpunt").map((p) => (
                  <PointLine key={p.id} point={p}>{p.status === "behaald" ? <Badge tone="good">Behaald</Badge> : null}</PointLine>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">Geen verbeterpunten.</p>
            )}
          </ReportBlock>
          {by("vaardigheid").length ? (
            <ReportBlock title="Nieuwe vaardigheden">
              <ul className="divide-y divide-[var(--color-line)]">{by("vaardigheid").map((p) => <PointLine key={p.id} point={p} />)}</ul>
            </ReportBlock>
          ) : null}
          {d.items.length ? (
            <ReportBlock title="Wat jij wilde bespreken">
              <ul className="divide-y divide-[var(--color-line)]">{d.items.map((i) => <HandledItemLine key={i.id} item={i} />)}</ul>
            </ReportBlock>
          ) : null}
          <ReportBlock title="Jouw feedback aan Shortclips">
            {by("shortclips").length ? <ul className="divide-y divide-[var(--color-line)]">{by("shortclips").map((p) => <PointLine key={p.id} point={p} />)}</ul> : <p className="text-sm text-[var(--color-ink-muted)]">Niets vastgelegd.</p>}
          </ReportBlock>
          {m.report.insights ? (
            <ReportBlock title="Belangrijkste inzichten"><p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">{m.report.insights}</p></ReportBlock>
          ) : null}
          <ReportBlock title="Actiepunten">
            {d.actions.length ? <ul className="divide-y divide-[var(--color-line)]">{d.actions.map((a) => <ActionLine key={a.id} action={a} showOwner />)}</ul> : <p className="text-sm text-[var(--color-ink-muted)]">Geen actiepunten.</p>}
          </ReportBlock>
          {m.report.focusNext ? (
            <ReportBlock title="Aandachtspunten voor komende maand"><p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">{m.report.focusNext}</p></ReportBlock>
          ) : null}
        </Card>
      )}
    </div>
  );
}

/* -------------------------------- team -------------------------------- */

function TeamDetail({ d }: { d: MeetingDetail }) {
  const m = d.meeting;
  const editorFirst = d.editor.fullName.split(" ")[0] ?? d.editor.fullName;
  const planned = m.status === "gepland" && !!m.scheduledAt;
  const published = m.reportStatus === "gepubliceerd";
  const at = m.scheduledAt ? dateToAmsterdam(m.scheduledAt) : null;
  const prep = d.preparation!;
  const review = monthLabel(prep.reviewPeriod);

  return (
    <div className="mx-auto max-w-[980px] space-y-6">
      <PageHeader
        breadcrumb={<Back />}
        title={
          <span className="flex items-center gap-3">
            <TeamAvatar name={d.editor.fullName} avatarUrl={d.editor.avatarUrl} size={34} />
            Editor meeting {editorFirst} · {monthTitle(m.period)}
          </span>
        }
        description={planned ? `${meetingMoment(m.scheduledAt!)}${d.owner ? ` · met ${d.owner.fullName.split(" ")[0]}` : ""}` : "Deze meeting staat niet meer gepland. Plan een nieuw moment."}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[m.display]}>{STATUS_LABEL[m.display]}</Badge>
            {m.overdue ? <Badge tone="bad">Over tijd</Badge> : null}
          </span>
        }
      />
      <Where d={d} />
      <MeetingControls
        planned={planned}
        locked={published}
        editorName={editorFirst}
        defaults={{ meetingId: m.id, editorId: m.editorId, date: at?.date ?? "", time: at?.time ?? "10:00", location: m.location ?? "", meetingUrl: m.meetingUrl ?? "", topics: m.topics }}
      />

      {d.recurring.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-4 py-3">
          <Repeat2 className="size-4 shrink-0 text-[#8a5300]" />
          <span className="text-sm font-semibold text-[#8a5300]">Terugkerend verbeterpunt:</span>
          {d.recurring.map((r) => <Badge key={r.theme} tone="warn">{r.label} · {r.months} maanden</Badge>)}
        </div>
      ) : null}

      {d.items.length && !published ? (
        <Card padded={false} className="overflow-hidden">
          <div className="border-t-[3px] border-t-[var(--color-info)] p-5">
            <CardHeader
              title={<span className="flex items-center gap-2"><MessageSquarePlus className="size-4 text-[var(--color-info)]" /> Inbreng van {editorFirst}</span>}
              subtitle={`Wat ${editorFirst} zelf wil bespreken. Leg in het verslag per punt vast wat ermee is gebeurd.`}
            />
            <ul className="mt-3 space-y-1.5">
              {d.items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 text-sm text-[var(--color-ink)]">
                  <span className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-info)]" />{i.body}</span>
                  {i.outcome ? <Badge tone={i.outcome === "besproken" ? "good" : "info"}>{ITEM_OUTCOME_LABEL[i.outcome]}</Badge> : <Badge>Open</Badge>}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bespreekpunten */}
        <Card>
          <CardHeader title="Bespreekpunten" subtitle="De agenda van deze meeting. De conceptagenda komt uit de voorbereiding hieronder." />
          <div className="mt-3">
            <TopicsEditor meetingId={m.id} topics={m.topics} draft={d.agendaDraft} editorName={editorFirst} />
          </div>
        </Card>

        {/* Terugkijken naar vorige meeting */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><History className="size-4 text-[var(--color-ink-muted)]" /> Terugkijken naar vorige meeting</span>} subtitle={d.previous ? `${monthTitle(d.previous.period)}${d.previous.scheduledAt ? ` · ${meetingMomentShort(d.previous.scheduledAt)}` : ""}` : undefined} />
          {!d.previous ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Dit is de eerste meeting met een verslag. Vanaf de volgende keer staan hier de afspraken van de vorige meeting.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {d.previous.report.insights ? <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--color-ink)]">{d.previous.report.insights}</p> : null}
              {d.previous.report.focusNext ? (
                <div>
                  <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Aandachtspunten voor deze maand</div>
                  <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-ink)]">{d.previous.report.focusNext}</p>
                </div>
              ) : null}
              <Link href={`/editor-meetings/${d.previous.id}`} className="inline-block text-xs font-medium text-[var(--color-brand-600)] hover:underline">Volledig verslag openen →</Link>
            </div>
          )}
          <div className="mt-4 border-t border-[var(--color-line)] pt-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Openstaande verbeterpunten</div>
            {d.earlierPoints.length ? (
              <ul className="divide-y divide-[var(--color-line)]">
                {d.earlierPoints.map((p) => <PointLine key={p.id} point={p}><PointToggle id={p.id} achieved={false} /></PointLine>)}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">Geen openstaande verbeterpunten.</p>
            )}
          </div>
          <div className="mt-3 border-t border-[var(--color-line)] pt-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Actiepunten die nog openstaan</div>
            {d.earlierActions.length ? (
              <ul className="divide-y divide-[var(--color-line)]">{d.earlierActions.map((a) => <ActionLine key={a.id} action={a} showOwner />)}</ul>
            ) : (
              <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">Geen openstaande actiepunten.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Voorbereiding */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><ClipboardList className="size-4 text-[var(--color-ink-muted)]" /> Voorbereiding: {review}</span>} subtitle="Automatisch samengesteld uit het portaal. Alleen gegevens die er echt zijn; ontbreekt iets, dan staat dat erbij." />
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat compact label="Afgeronde projecten" value={prep.delivered.projects} hint={prep.delivered.shorts != null ? `${prep.delivered.shorts} shorts` : "Aantal shorts niet ingevuld"} />
          <Stat compact label="Gemiste deadlines" value={prep.missedDeadlines.length} tone={prep.missedDeadlines.length ? "warn" : prep.delivered.projects ? "good" : "neutral"} />
          <Stat compact label="Gemiddelde doorlooptijd" value={prep.avgLeadDays != null ? `${nl(prep.avgLeadDays)} dagen` : "Niet beschikbaar"} hint={prep.avgLeadDays != null ? `Opname tot goedkeuring, ${prep.leadSample} ${prep.leadSample === 1 ? "project" : "projecten"}` : "Geen opname- en goedkeuringsdatum"} />
          <Stat compact label="Feedbackrondes" value={prep.avgFeedbackRounds != null ? `${nl(prep.avgFeedbackRounds)} gem.` : "Niet beschikbaar"} hint={prep.avgFeedbackRounds != null ? "Zoals bijgehouden op Editing" : "Niet bijgehouden op Editing"} />
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klanten in {review}</div>
            {prep.delivered.byClient.length ? (
              <ul className="mt-1.5 space-y-1">
                {prep.delivered.byClient.map((c) => (
                  <li key={c.name} className="flex justify-between gap-3 text-sm text-[var(--color-ink)]">
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 text-[var(--color-ink-muted)]">{c.projects} {c.projects === 1 ? "project" : "projecten"}{c.shorts != null ? ` · ${c.shorts} shorts` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">Geen afgeronde projecten gevonden in {review}.</p>
            )}
            {prep.missedDeadlines.length ? (
              <>
                <div className="mt-4 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Gemiste deadlines</div>
                <ul className="mt-1.5 space-y-1">
                  {prep.missedDeadlines.map((x, i) => (
                    <li key={i} className="text-sm text-[var(--color-ink)]">{x.client ? `${x.client}: ` : ""}{x.title} <span className="text-[var(--color-ink-muted)]">({x.daysLate} {x.daysLate === 1 ? "dag" : "dagen"} te laat)</span></li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div>
            <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Openstaande feedback (nu)</div>
            {prep.openFeedback.length ? (
              <ul className="mt-1.5 space-y-1">
                {prep.openFeedback.map((x, i) => (
                  <li key={i} className="text-sm text-[var(--color-ink)]">{x.client}: {x.title} <span className="text-[var(--color-ink-muted)]">({EDIT_PHASE_LABEL_FALLBACK[x.status] ?? x.status})</span></li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">Geen projecten met openstaande feedback.</p>
            )}
            {prep.highlights.length ? (
              <>
                <div className="mt-4 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Opvallend</div>
                <ul className="mt-1.5 space-y-1">
                  {prep.highlights.map((h, i) => <li key={i} className="text-sm text-[var(--color-ink)]">{h}</li>)}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Verslag */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink)]">Verslag</h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
              {m.scheduledAt ? formatDateFull(m.scheduledAt) : "Datum volgt"} · {d.editor.fullName} · {d.owner?.fullName ?? "Nog geen content creator"} · besproken periode {review}
            </p>
          </div>
          {published ? <Badge tone="good">Gepubliceerd{m.publishedAt ? ` op ${formatDateFull(m.publishedAt)}` : ""}</Badge> : m.reportStatus === "concept" ? <Badge tone="warn">Concept</Badge> : <Badge>Nog niet gestart</Badge>}
        </div>
        {!planned ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-[var(--color-ink-muted)]"><Lock className="size-4" /> Plan de meeting eerst opnieuw in; daarna kun je het verslag maken.</p>
        ) : (
          <>
            {published && d.actions.length ? (
              <div className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-5 py-3">
                <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Status actiepunten (gekoppeld aan Taken)</div>
                <ul className="divide-y divide-[var(--color-line)]">{d.actions.map((a) => <ActionLine key={a.id} action={a} showOwner />)}</ul>
              </div>
            ) : null}
            <ReportForm
              key={m.updatedAt.toISOString()}
              editorName={editorFirst}
              assignees={d.assignees}
              defaults={{
                meetingId: m.id,
                published,
                insights: m.report.insights ?? "",
                focusNext: m.report.focusNext ?? "",
                internalNotes: m.internalNotes ?? "",
                points: d.points.map((p) => ({ id: p.id, kind: p.kind, theme: p.theme, body: p.body, example: p.example })),
                actions: d.actions.map((a) => ({ id: a.id, body: a.body, ownerType: a.ownerType, assigneeId: a.assigneeId, dueOn: a.dueOn })),
                ownerId: d.owner?.id ?? null,
                nextPlanned: null,
                items: d.items.map((i) => ({ id: i.id, body: i.body, outcome: i.outcome })),
              }}
            />
          </>
        )}
      </Card>
      <p className="text-xs text-[var(--color-ink-faint)]">Verantwoordelijke per actiepunt: {OWNER_TYPE_LABEL.editor.toLowerCase()}, {OWNER_TYPE_LABEL.content_creator.toLowerCase()} of {OWNER_TYPE_LABEL.shortclips}. Afronden op de takenpagina, hier of in het editorportaal werkt overal door.</p>
    </div>
  );
}
