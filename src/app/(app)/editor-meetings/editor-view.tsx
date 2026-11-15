import Link from "next/link";
import { CalendarClock, CalendarPlus, CheckCircle2, ListChecks, MapPin, Target, TrendingUp, Video } from "lucide-react";
import type { ActionView, EditorPage, PointView } from "@/server/editor-meetings";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { formatDateFull } from "@/lib/format";
import { STATUS_TONE, editorStatusLabel, meetingMoment, monthLabel, monthTitle } from "@/lib/editor-meetings";
import { ActionToggle } from "./ui";

/** Een actiepunt met afvinkvakje. Alleen eigen actiepunten zijn af te vinken. */
export function ActionLine({ action, showOwner = false }: { action: ActionView; showOwner?: boolean }) {
  const done = action.state === "afgerond";
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5">
        {action.state === "concept" || action.state === "vervallen" ? (
          <span className="block size-5 rounded-[5px] border border-dashed border-[var(--color-line-strong)]" />
        ) : (
          <ActionToggle id={action.id} done={done} disabled={!action.canToggle} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-relaxed ${done || action.state === "vervallen" ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink)]"}`}>{action.body}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-[var(--color-ink-faint)]">
          {showOwner && action.assigneeName ? <span>{action.assigneeName.split(" ")[0]}</span> : null}
          {action.dueOn ? <span>Deadline {formatDateFull(action.dueOn)}</span> : <span>Geen deadline</span>}
          <span>Meeting {monthLabel(action.period)}</span>
          {action.state === "vervallen" ? <span>Vervallen</span> : null}
        </p>
      </div>
    </li>
  );
}

export function PointLine({ point, children }: { point: PointView; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-[var(--color-ink)]">{point.body}</p>
        {point.example ? <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">Voorbeeld: {point.example}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-[var(--color-ink-faint)]">
          {point.theme !== "overig" ? <span>{point.themeLabel}</span> : null}
          <span>Meeting {monthLabel(point.period)}</span>
        </p>
      </div>
      {children}
    </li>
  );
}

export function EditorOwnView({ data, firstName }: { data: EditorPage; firstName: string }) {
  const { next, owner, development: dev } = data;
  const ownerFirst = owner?.fullName.split(" ")[0] ?? null;
  return (
    <div className="mx-auto max-w-[1040px] space-y-6">
      <PageHeader title="Editor Meetings" description={`Elke maand een persoonlijk gesprek${ownerFirst ? ` met ${ownerFirst}` : ""}: wat gaat goed, wat kan beter en wat spreken we af.`} />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Volgende meeting */}
        <Card padded={false} className="overflow-hidden">
          <div className="bg-[var(--color-indigo-ink)] px-5 py-4 text-white">
            <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.1em] text-white/70">
              <CalendarClock className="size-4" /> Volgende meeting
            </div>
            {next?.scheduledAt ? (
              <>
                <div className="mt-2 text-lg font-bold leading-snug tracking-tight">{meetingMoment(next.scheduledAt)}</div>
                <div className="mt-1 text-sm text-white/80">{ownerFirst ? `Met ${ownerFirst}` : "Met Shortclips"} · Gepland</div>
              </>
            ) : (
              <>
                <div className="mt-2 text-lg font-bold tracking-tight">Nog niet gepland</div>
                <div className="mt-1 text-sm text-white/80">{ownerFirst ? `${ownerFirst} plant de meeting in. Je krijgt een melding zodra de datum vaststaat.` : "Je krijgt een melding zodra de datum vaststaat."}</div>
              </>
            )}
          </div>
          {next ? (
            <div className="space-y-3 px-5 py-4">
              {next.meetingUrl ? (
                <a href={next.meetingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium text-[var(--color-brand-600)] hover:underline">
                  <Video className="size-4" /> Open de vergaderlink
                </a>
              ) : null}
              {next.location ? (
                <p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"><MapPin className="size-4" /> {next.location}</p>
              ) : null}
              <div>
                <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Wat we bespreken</div>
                {next.topics.length ? (
                  <ul className="mt-1.5 space-y-1">
                    {next.topics.map((t, i) => (
                      <li key={i} className="flex gap-2 text-sm text-[var(--color-ink)]"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-500)]" />{t}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-[var(--color-ink-muted)]">De bespreekpunten volgen.</p>
                )}
              </div>
              {data.nextCalendarUrl ? (
                <a href={data.nextCalendarUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                  <CalendarPlus className="size-3.5" /> Zet in mijn agenda
                </a>
              ) : null}
            </div>
          ) : null}
        </Card>

        {/* Mijn verbeterpunten */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Target className="size-4 text-[var(--color-warn)]" /> Mijn verbeterpunten</span>} subtitle="De actuele punten uit je meetings." />
          {data.openPoints.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">Geen openstaande verbeterpunten.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-line)]">
              {data.openPoints.slice(0, 5).map((p) => <PointLine key={p.id} point={p} />)}
            </ul>
          )}
        </Card>

        {/* Mijn actiepunten */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ListChecks className="size-4 text-[var(--color-brand-600)]" /> Mijn actiepunten</span>} subtitle="Afspraken die jij nog uitvoert. Vink af wat klaar is." />
          {data.openActions.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">Geen openstaande actiepunten.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-line)]">
              {data.openActions.map((a) => <ActionLine key={a.id} action={a} />)}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Geschiedenis per maand */}
        <Card padded={false} className="lg:col-span-2">
          <div className="p-5 pb-3"><CardHeader title="Mijn meetings" subtitle="Per maand, met het verslag zodra het er is." /></div>
          <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
            {data.history.map((h) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--color-ink)]">{monthTitle(h.period)}</span>
                    {h.scheduledAt ? <span className="block text-xs text-[var(--color-ink-muted)]">{meetingMoment(h.scheduledAt)}</span> : null}
                  </span>
                  <Badge tone={STATUS_TONE[h.status]}>{editorStatusLabel(h.status)}</Badge>
                  {h.hasReport ? <span className="text-xs font-medium text-[var(--color-brand-600)]">Verslag →</span> : null}
                </>
              );
              return (
                <li key={h.period}>
                  {h.meetingId && h.hasReport ? (
                    <Link href={`/editor-meetings/${h.meetingId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-sunken)]">{body}</Link>
                  ) : (
                    <div className="flex items-center gap-3 px-5 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Mijn ontwikkeling */}
        <Card className="lg:col-span-3">
          <CardHeader title={<span className="flex items-center gap-2"><TrendingUp className="size-4 text-[var(--color-good)]" /> Mijn ontwikkeling</span>} subtitle={`Wat je hebt bereikt en waar je aan werkt, ${firstName}.`} />
          {dev.achieved.length + dev.strengths.length + dev.recurring.length + dev.skills.length + dev.actionsTotal === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">Na je eerste meeting met een verslag zie je hier je sterke punten, behaalde verbeterdoelen en waar je aan werkt.</p>
          ) : (
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Verbeterd en behaald</div>
                {dev.achieved.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {dev.achieved.slice(0, 6).map((p) => (
                      <li key={p.id} className="flex gap-2 text-sm text-[var(--color-ink)]"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--color-good)]" />{p.body}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Nog geen afgeronde verbeterdoelen.</p>
                )}
                {dev.actionsTotal > 0 ? <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{dev.actionsDone} van {dev.actionsTotal} afspraken afgerond.</p> : null}
              </div>
              <div>
                <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Hier ben je sterk in</div>
                {dev.strengths.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {dev.strengths.slice(0, 5).map((p) => <li key={p.id} className="text-sm text-[var(--color-ink)]">{p.body}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Nog niets vastgelegd.</p>
                )}
              </div>
              <div>
                <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Aandachtspunten die terugkomen</div>
                {dev.recurring.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {dev.recurring.map((t) => <Badge key={t.theme} tone="warn">{t.label} · {t.months} maanden</Badge>)}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Geen terugkerende punten.</p>
                )}
              </div>
              <div>
                <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Nieuwe vaardigheden</div>
                {dev.skills.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {dev.skills.map((p) => <li key={p.id} className="text-sm text-[var(--color-ink)]">{p.body}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Nog geen nieuwe vaardigheden afgesproken.</p>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
