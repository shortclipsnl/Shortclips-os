import Link from "next/link";
import { CalendarClock, CalendarPlus, CheckCircle2, ChevronDown, FileText, ListChecks, MapPin, MessageSquarePlus, Target, TrendingUp, Video } from "lucide-react";
import type { ActionView, EditorPage, ItemView, PointView } from "@/server/editor-meetings";
import { Badge, Card, PageHeader, TeamAvatar } from "@/components/ui";
import { formatDateFull } from "@/lib/format";
import { ITEM_OUTCOME_LABEL, editorStatusLabel, editorTone, meetingMoment, meetingMomentShort, monthLabel, monthTitle, splitHistory, type DisplayStatus, type EditorTone } from "@/lib/editor-meetings";
import { ActionToggle, ItemsEditor } from "./ui";

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

/* --------------------------- kleuren en bouwstenen --------------------------- */

/**
 * Vaste kleur per onderdeel, passend bij de donkere Shortclips-vormgeving:
 * paars meetinginformatie, oranje verbeterpunten, blauw bespreekpunten,
 * groen acties en ontwikkeling.
 */
const ACCENT = {
  paars: { line: "var(--color-violet)", soft: "var(--color-violet-soft)" },
  oranje: { line: "var(--color-warn)", soft: "var(--color-warn-soft)" },
  blauw: { line: "var(--color-info)", soft: "var(--color-info-soft)" },
  groen: { line: "var(--color-good)", soft: "var(--color-good-soft)" },
  grijs: { line: "var(--color-ink-faint)", soft: "var(--color-neutral-soft)" },
} as const;
type Accent = keyof typeof ACCENT;

function Block({ accent, icon, title, meta, subtitle, id, className = "", children }: { accent: Accent; icon: React.ReactNode; title: string; meta?: React.ReactNode; subtitle?: string; id?: string; className?: string; children: React.ReactNode }) {
  const a = ACCENT[accent];
  return (
    <Card padded={false} className={`overflow-hidden ${className}`}>
      <div id={id} className="h-full border-t-[3px] p-5" style={{ borderTopColor: a.line }}>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]" style={{ background: a.soft, color: a.line }}>{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
              {meta}
            </div>
            {subtitle ? <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{subtitle}</p> : null}
          </div>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </Card>
  );
}

function Count({ n, accent }: { n: number; accent: Accent }) {
  const a = ACCENT[accent];
  return <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: a.soft, color: a.line }}>{n}</span>;
}

/** Status met gekleurde stip: oranje nog te plannen, blauw ingepland, paars geweest, groen afgerond. */
export function StatusPill({ status }: { status: DisplayStatus }) {
  const tone: EditorTone = editorTone(status);
  const a = ACCENT[tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-[var(--color-ink)]" style={{ background: a.soft }}>
      <span className="size-2 rounded-full" style={{ background: a.line }} aria-hidden />
      {editorStatusLabel(status)}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[var(--color-ink-muted)]">{children}</p>;
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{children}</div>;
}

/** Een behandeld eigen bespreekpunt met de uitkomst. */
export function HandledItemLine({ item }: { item: ItemView }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <span className="min-w-0 flex-1 text-sm text-[var(--color-ink)]">{item.body}</span>
      {item.outcome ? <Badge tone={item.outcome === "besproken" ? "good" : "info"}>{ITEM_OUTCOME_LABEL[item.outcome]}</Badge> : null}
    </li>
  );
}

/* --------------------------------- pagina --------------------------------- */

export function EditorOwnView({ data, firstName, current }: { data: EditorPage; firstName: string; current: string }) {
  const { next, owner, development: dev, target } = data;
  const ownerFirst = owner?.fullName.split(" ")[0] ?? null;
  const { upcoming, earlier } = splitHistory(data.history, current);
  const targetRow = data.history.find((h) => h.period === target.period);
  const openItems = data.items.open;

  return (
    <div className="mx-auto max-w-[1180px] space-y-5">
      <PageHeader title="Editor Meetings" description={`Elke maand een persoonlijk gesprek${ownerFirst ? ` met ${ownerFirst}` : ""}: wat gaat goed, wat kan beter en wat spreken we af.`} />

      {/* Rij 1: volgende meeting, verbeterpunten, actiepunten */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Block accent="paars" icon={<CalendarClock className="size-5" />} title="Volgende meeting">
          {next?.scheduledAt ? (
            <>
              <div className="text-xl font-bold leading-snug tracking-tight text-[var(--color-ink)]">{meetingMoment(next.scheduledAt)}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusPill status="gepland" />
                <span className="text-sm text-[var(--color-ink-muted)]">{next.durationMinutes} minuten</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-xl font-bold tracking-tight text-[var(--color-ink)]">{monthTitle(target.period)}</div>
              <div className="mt-3"><StatusPill status={targetRow?.status ?? "te_plannen"} /></div>
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{ownerFirst ? `${ownerFirst} plant de meeting in.` : "Je content creative plant de meeting in."} Je krijgt een melding zodra de datum vaststaat.</p>
            </>
          )}
          <div className="mt-4 flex items-center gap-2.5 border-t border-[var(--color-line)] pt-4">
            {owner ? <TeamAvatar name={owner.fullName} avatarUrl={owner.avatarUrl} size={30} /> : null}
            <div className="min-w-0">
              <SubTitle>Met</SubTitle>
              <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{owner ? owner.fullName : "Nog niet bekend"}</div>
            </div>
          </div>
          {next ? (
            <div className="mt-3 space-y-2">
              {next.meetingUrl ? (
                <a href={next.meetingUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm font-medium text-[var(--color-ink)] hover:underline"><Video className="size-4" style={{ color: ACCENT.paars.line }} /> Open de vergaderlink</a>
              ) : null}
              {next.location ? <p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"><MapPin className="size-4" /> {next.location}</p> : null}
              {data.nextCalendarUrl ? (
                <a href={data.nextCalendarUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><CalendarPlus className="size-3.5" /> Zet in mijn agenda</a>
              ) : null}
            </div>
          ) : null}
          <a href="#bespreken" className="mt-4 flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium" style={{ background: ACCENT.blauw.soft, color: ACCENT.blauw.line }}>
            <span className="flex items-center gap-2"><MessageSquarePlus className="size-4" />{openItems.length ? `${openItems.length} ${openItems.length === 1 ? "eigen punt" : "eigen punten"} klaargezet` : "Zet je eigen bespreekpunten klaar"}</span>
            <span aria-hidden>↓</span>
          </a>
        </Block>

        <Block accent="oranje" icon={<Target className="size-5" />} title="Mijn verbeterpunten" subtitle="Uit eerdere meetings. Hier werk je aan." meta={data.openPoints.length ? <Count n={data.openPoints.length} accent="oranje" /> : null}>
          {data.openPoints.length === 0 ? (
            <Empty>Geen openstaande verbeterpunten.</Empty>
          ) : (
            <>
              <ul className="divide-y divide-[var(--color-line)]">{data.openPoints.slice(0, 5).map((p) => <PointLine key={p.id} point={p} />)}</ul>
              {data.openPoints.length > 5 ? <p className="mt-2 text-xs text-[var(--color-ink-faint)]">En nog {data.openPoints.length - 5} in je verslagen.</p> : null}
            </>
          )}
        </Block>

        <Block accent="groen" icon={<ListChecks className="size-5" />} title="Mijn actiepunten" subtitle="Afspraken die jij nog uitvoert. Vink af wat klaar is." meta={data.openActions.length ? <Count n={data.openActions.length} accent="groen" /> : null}>
          {data.openActions.length === 0 ? (
            <Empty>Geen openstaande actiepunten.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">{data.openActions.map((a) => <ActionLine key={a.id} action={a} />)}</ul>
          )}
          {dev.actionsTotal > 0 ? (
            <div className="mt-4 border-t border-[var(--color-line)] pt-3">
              <div className="flex items-center justify-between text-xs text-[var(--color-ink-muted)]"><span>Afgerond</span><span className="font-semibold text-[var(--color-ink)]">{dev.actionsDone} van {dev.actionsTotal}</span></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-neutral-soft)]">
                <div className="h-full rounded-full" style={{ width: `${Math.round((dev.actionsDone / dev.actionsTotal) * 100)}%`, background: ACCENT.groen.line }} />
              </div>
            </div>
          ) : null}
        </Block>
      </div>

      {/* Rij 2: wat wil ik bespreken, mijn ontwikkeling */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Block
          id="bespreken"
          accent="blauw"
          icon={<MessageSquarePlus className="size-5" />}
          title="Wat wil ik bespreken?"
          subtitle={`Jouw onderwerpen voor de meeting van ${monthLabel(target.period)}${next?.scheduledAt ? ` (${meetingMomentShort(next.scheduledAt)})` : ""}.`}
          meta={openItems.length ? <Count n={openItems.length} accent="blauw" /> : null}
        >
          <ItemsEditor items={openItems.map((i) => ({ id: i.id, body: i.body, state: i.editorState === "in_verslag" ? "in_verslag" : "open" }))} ownerFirst={ownerFirst} />
          {data.items.handled.length ? (
            <div className="mt-4 border-t border-[var(--color-line)] pt-3">
              <SubTitle>Besproken in {monthLabel(data.items.handled[0]!.period!)}</SubTitle>
              <ul className="divide-y divide-[var(--color-line)]">{data.items.handled.map((i) => <HandledItemLine key={i.id} item={i} />)}</ul>
            </div>
          ) : null}
        </Block>

        <Block accent="groen" icon={<TrendingUp className="size-5" />} title="Mijn ontwikkeling" subtitle={`Wat je hebt bereikt en waar je aan werkt, ${firstName}.`}>
          {dev.achieved.length + dev.strengths.length + dev.recurring.length + dev.skills.length + dev.actionsTotal === 0 ? (
            <Empty>Na je eerste meeting met een verslag zie je hier je sterke punten, behaalde verbeterdoelen en waar je aan werkt.</Empty>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <SubTitle>Verbeterd en behaald</SubTitle>
                {dev.achieved.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {dev.achieved.slice(0, 6).map((p) => (
                      <li key={p.id} className="flex gap-2 text-sm text-[var(--color-ink)]"><CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color: ACCENT.groen.line }} />{p.body}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Nog geen afgeronde verbeterdoelen.</p>
                )}
              </div>
              <div>
                <SubTitle>Hier ben je sterk in</SubTitle>
                {dev.strengths.length ? (
                  <ul className="mt-2 space-y-1.5">{dev.strengths.slice(0, 5).map((p) => <li key={p.id} className="text-sm text-[var(--color-ink)]">{p.body}</li>)}</ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Nog niets vastgelegd.</p>
                )}
              </div>
              <div>
                <SubTitle>Aandachtspunten die terugkomen</SubTitle>
                {dev.recurring.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">{dev.recurring.map((t) => <Badge key={t.theme} tone="warn">{t.label} · {t.months} maanden</Badge>)}</div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Geen terugkerende punten.</p>
                )}
              </div>
              <div>
                <SubTitle>Nieuwe vaardigheden</SubTitle>
                {dev.skills.length ? (
                  <ul className="mt-2 space-y-1.5">{dev.skills.map((p) => <li key={p.id} className="text-sm text-[var(--color-ink)]">{p.body}</li>)}</ul>
                ) : (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Nog geen nieuwe vaardigheden afgesproken.</p>
                )}
              </div>
            </div>
          )}
        </Block>
      </div>

      {/* Onderste deel: alle maanden */}
      <Block
        accent="paars"
        icon={<FileText className="size-5" />}
        title="Mijn meetings"
        subtitle="Per maand, met het verslag zodra het er is. Nieuwe maanden komen er vanzelf bij."
        meta={
          <span className="hidden flex-wrap items-center gap-1.5 sm:flex">
            <StatusPill status="te_plannen" />
            <StatusPill status="gepland" />
            <StatusPill status="afgerond" />
          </span>
        }
      >
        <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
          {upcoming.map((h) => <MonthRow key={h.period} h={h} highlight={h.period === target.period} />)}
        </ul>
        <details className="group mt-4" open={earlier.length > 0 && earlier.length <= 3}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" /> Eerdere meetings {earlier.length ? <span className="font-normal text-[var(--color-ink-muted)]">({earlier.length})</span> : null}
          </summary>
          {earlier.length ? (
            <ul className="mt-3 divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
              {earlier.map((h) => <MonthRow key={h.period} h={h} highlight={false} />)}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Nog geen eerdere meetings.</p>
          )}
        </details>
      </Block>
    </div>
  );
}

type HistoryRow = EditorPage["history"][number];

function MonthRow({ h, highlight }: { h: HistoryRow; highlight: boolean }) {
  return (
    <li
      className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[150px_190px_1fr_150px_auto]"
      style={highlight ? { background: ACCENT.paars.soft, boxShadow: `inset 3px 0 0 ${ACCENT.paars.line}` } : undefined}
    >
      <span className="text-sm font-semibold text-[var(--color-ink)]">
        {monthTitle(h.period)}
        {highlight ? <span className="ml-2 align-middle text-2xs font-semibold uppercase tracking-wide" style={{ color: ACCENT.paars.line }}>Eerstvolgende</span> : null}
      </span>
      <span className="justify-self-end sm:justify-self-start"><StatusPill status={h.status} /></span>
      <span className="text-sm text-[var(--color-ink-muted)]">{h.scheduledAt ? meetingMoment(h.scheduledAt) : h.status === "niet_gehouden" ? "Geen meeting" : "Datum volgt"}</span>
      <span className="text-sm text-[var(--color-ink-muted)]">{h.ownerName ? `Met ${h.ownerName.split(" ")[0]}` : ""}</span>
      <span className="col-span-2 sm:col-span-1 sm:justify-self-end">
        {h.meetingId && h.hasReport ? (
          <Link href={`/editor-meetings/${h.meetingId}`} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
            <FileText className="size-3.5" /> Verslag bekijken
          </Link>
        ) : (
          <span className="hidden text-xs text-[var(--color-ink-faint)] sm:inline">{h.status === "verslag_nodig" || h.status === "verslag_concept" ? "Verslag volgt" : ""}</span>
        )}
      </span>
    </li>
  );
}
