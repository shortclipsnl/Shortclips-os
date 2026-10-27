import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarDays, ClipboardCheck, Clock, ExternalLink, FileText, Film, MapPin, MessageSquareText, Users, Video } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalPlanning, type PortalOpname, type PortalScriptMeeting, type PortalScriptState } from "@/server/portal-planning";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { buttonClass, TeamAvatar } from "@/components/ui";
import { formatDateFull } from "@/lib/format";
import { VoorbereidingOverzicht } from "@/components/portal/voorbereiding-overzicht";
import { OpnamedagContent } from "../samenwerking/_content";

export const metadata: Metadata = { title: "Opnameplanning" };
export const dynamic = "force-dynamic";

const TONE_CLS: Record<PortalScriptState["tone"], string> = {
  warn: "bg-[rgba(25,168,255,0.14)] text-[#19a8ff]",
  info: "bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]",
  good: "bg-[rgba(47,210,122,0.14)] text-[#2fd27a]",
  neutral: "bg-[var(--sc-fill-strong)] text-[var(--color-ink-muted)]",
};

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

function relativeLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const diff = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  if (diff <= 0) return "vandaag";
  if (diff === 1) return "morgen";
  if (diff < 7) return `over ${diff} dagen`;
  if (diff < 14) return "volgende week";
  return `over ${Math.round(diff / 7)} weken`;
}

function DateBadge({ date, large = false }: { date: string; large?: boolean }) {
  const d = new Date(`${date}T12:00:00`);
  return (
    <div className={`flex shrink-0 flex-col items-center justify-center rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] ${large ? "size-[62px]" : "size-12"}`}>
      <span className={`font-bold leading-none tabular-nums ${large ? "text-[22px]" : "text-[17px]"}`}>{d.getDate()}</span>
      <span className={`mt-0.5 uppercase tracking-wide text-[var(--color-ink-muted)] ${large ? "text-[11px]" : "text-[10px]"}`}>{d.toLocaleDateString("nl-NL", { month: "short" })}</span>
    </div>
  );
}

function ScriptPill({ s }: { s: PortalScriptState }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${TONE_CLS[s.tone]}`}><FileText className="size-3" /> {s.label}</span>;
}

function PersonRow({ label, person }: { label: string; person: NonNullable<PortalOpname["contentCreative"]> }) {
  return (
    <div className="flex items-center gap-2">
      <TeamAvatar name={person.name} avatarUrl={person.avatarUrl} size={32} />
      <div className="leading-tight">
        <div className="text-[13px] font-semibold">{person.name}</div>
        <div className="text-[11px] text-[var(--color-ink-faint)]">{label}</div>
      </div>
    </div>
  );
}

function ScriptsButton({ o, variant = "secondary" }: { o: PortalOpname; variant?: "accent" | "secondary" }) {
  if (o.reviewId) {
    return (
      <Link href={`/portal/scripts/${o.reviewId}`} className={`${buttonClass({ variant, size: "sm" })} shrink-0`}>
        Bekijk scripts <ArrowRight className="size-4" />
      </Link>
    );
  }
  return <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--color-ink-faint)]"><Clock className="size-3.5" /> Scripts volgen</span>;
}

function OpnameCard({ o, hero = false, id }: { o: PortalOpname; hero?: boolean; id?: string }) {
  return (
    <div id={id} className={`sc-glass scroll-mt-24 ${hero ? "p-6" : "p-5"}`} style={hero ? { background: "linear-gradient(180deg, rgba(25,168,255,0.08), rgba(255,255,255,0.02))" } : undefined}>
      <div className="flex items-start gap-4">
        <DateBadge date={o.date} large={hero} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(25,168,255,0.14)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--sc-accent)]"><Video className="size-3" /> Opnamedag</span>
            <span className="text-[12.5px] font-medium text-[var(--color-ink-muted)]">{relativeLabel(o.date)}</span>
          </div>
          <h3 className={`mt-1.5 font-bold leading-tight ${hero ? "text-[19px]" : "text-[16px]"}`}>{dayLabel(o.date)}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
            {o.startTime ? <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> {o.startTime}{o.endTime ? `–${o.endTime}` : ""}</span> : null}
            {o.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {o.location}</span> : null}
            {o.scriptCount > 0 ? <span className="inline-flex items-center gap-1"><FileText className="size-3.5" /> {o.scriptCount} script{o.scriptCount === 1 ? "" : "s"} gepland</span> : null}
            {o.plannedShorts ? <span className="inline-flex items-center gap-1"><Film className="size-3.5" /> {o.plannedShorts} video{o.plannedShorts === 1 ? "" : "'s"} gepland</span> : null}
          </div>
        </div>
      </div>

      {(o.contentCreative || o.videographer) ? (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 border-t border-[var(--sc-line)] pt-4">
          {o.contentCreative ? <PersonRow label="Content creative" person={o.contentCreative} /> : null}
          {o.videographer ? <PersonRow label="Videograaf" person={o.videographer} /> : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sc-line)] pt-4">
        <ScriptPill s={o.script} />
        <ScriptsButton o={o} variant={hero ? "accent" : "secondary"} />
      </div>
    </div>
  );
}

function ScriptMeetingCard({ m, id }: { m: PortalScriptMeeting; id?: string }) {
  const d = new Date(m.startsAt);
  const dateStr = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  const time = m.allDay ? null : d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  return (
    <div id={id} className="sc-glass scroll-mt-24 flex items-start gap-4 p-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[rgba(155,120,255,0.16)] text-[#b79bff]"><MessageSquareText className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(155,120,255,0.16)] px-2.5 py-0.5 text-[11px] font-semibold text-[#b79bff]">Scriptmeeting</span>
        <h3 className="mt-1.5 text-[15px] font-semibold leading-tight">{dateStr}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
          {time ? <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> {time}</span> : null}
          {m.people.length > 0 ? <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {m.people.join(", ")}</span> : null}
        </div>
      </div>
      {m.link ? (
        <a href={m.link} target="_blank" rel="noreferrer" className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}>
          Open <ExternalLink className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

type DayMark = { type: "opname" | "meeting" | "both"; href: string };

/** Compacte maandkalender (maandag-start) met gemarkeerde opname-/meetingdagen. */
function MonthCalendar({ year, month, marks }: { year: number; month: number; marks: Map<number, DayMark> }) {
  const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // ma = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === month;
  const cells: Array<number | null> = [...Array<null>(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="sc-glass p-4">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const mark = marks.get(d);
          const isToday = isThisMonth && d === today.getDate();
          const base = "grid aspect-square place-items-center rounded-lg text-[12.5px] tabular-nums";
          if (mark) {
            const col = mark.type === "meeting" ? "bg-[rgba(155,120,255,0.18)] text-[#b79bff]" : "bg-[rgba(25,168,255,0.18)] text-[var(--sc-accent)]";
            return <a key={i} href={mark.href} title="Bekijk afspraak" className={`${base} ${col} font-bold ring-1 ring-inset ring-[var(--sc-line)] transition-[filter] hover:brightness-110`}>{d}</a>;
          }
          return <div key={i} className={`${base} text-[var(--color-ink-muted)] ${isToday ? "font-semibold text-[var(--color-ink)] ring-1 ring-inset ring-[var(--sc-accent)]" : ""}`}>{d}</div>;
        })}
      </div>
    </div>
  );
}

const MONTH_NAMES = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

export default async function PortalPlanningPage() {
  const viewer = await requirePortal();
  const [p, settings] = await Promise.all([getPortalPlanning(viewer), getPortalSettingsForClient(viewer.clientId ?? "")]);

  const hasAny = p.nextOpname || p.scriptMeetings.length > 0 || p.laterOpnames.length > 0;

  // Agenda per maand opbouwen: alle toekomstige opnames + scriptmeetings bij hun maand.
  const futureOpnames = [p.nextOpname, ...p.laterOpnames].filter((o): o is PortalOpname => o !== null);
  const months = new Map<string, { year: number; month: number; opnames: PortalOpname[]; meetings: PortalScriptMeeting[] }>();
  const ensureMonth = (y: number, m: number) => {
    const key = `${y}-${m}`;
    if (!months.has(key)) months.set(key, { year: y, month: m, opnames: [], meetings: [] });
    return months.get(key)!;
  };
  for (const o of futureOpnames) { const d = new Date(`${o.date}T12:00:00`); ensureMonth(d.getFullYear(), d.getMonth()).opnames.push(o); }
  for (const m of p.scriptMeetings) { const d = new Date(m.startsAt); ensureMonth(d.getFullYear(), d.getMonth()).meetings.push(m); }

  // Minstens de komende 6 maanden tonen (dus ook jan/feb e.v. als die nog leeg zijn),
  // en zo nodig verder tot en met de laatste maand met een afspraak.
  const now = new Date();
  let span = 6;
  for (const v of months.values()) { const diff = (v.year - now.getFullYear()) * 12 + (v.month - now.getMonth()); if (diff + 1 > span) span = diff + 1; }
  span = Math.min(span, 12);
  const agenda = Array.from({ length: span }, (_, i) => {
    const y = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
    const m = (now.getMonth() + i) % 12;
    const bucket = months.get(`${y}-${m}`) ?? { year: y, month: m, opnames: [], meetings: [] };
    // Dag-markeringen voor de kalender.
    const marks = new Map<number, DayMark>();
    for (const o of bucket.opnames) { const day = new Date(`${o.date}T12:00:00`).getDate(); const ex = marks.get(day); marks.set(day, { type: ex && ex.type === "meeting" ? "both" : "opname", href: `#item-op-${o.id}` }); }
    for (const mt of bucket.meetings) { const day = new Date(mt.startsAt).getDate(); const ex = marks.get(day); marks.set(day, { type: ex ? "both" : "meeting", href: ex ? ex.href : `#item-mt-${mt.id}` }); }
    // Detailkaarten chronologisch.
    const items = [
      ...bucket.opnames.map((o) => ({ date: o.date, node: <OpnameCard key={`op-${o.id}`} id={`item-op-${o.id}`} o={o} /> })),
      ...bucket.meetings.map((mt) => ({ date: mt.startsAt.slice(0, 10), node: <ScriptMeetingCard key={`mt-${mt.id}`} id={`item-mt-${mt.id}`} m={mt} /> })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    return { year: y, month: m, marks, items };
  });

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Opnameplanning</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Je opnames en scriptmeetings — automatisch bijgewerkt vanuit ons team.</p>
      </div>

      {!hasAny ? (
        <div className="sc-glass flex flex-col items-start gap-3 border-dashed p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--sc-fill)] text-[var(--sc-accent)]"><CalendarDays className="size-5" strokeWidth={1.75} /></span>
          <div>
            <p className="text-sm font-semibold">Je planning wordt voorbereid</p>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-muted)]">
              Zodra er een opnamedag of scriptmeeting vaststaat, verschijnt die hier automatisch — met tijd, locatie, je content creative,
              videograaf en de bijbehorende scripts. Je hoeft nu niets te doen.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Eerstvolgende opname — snelle blik */}
          {p.nextOpname ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-faint)]"><CalendarClock className="size-4 text-[var(--sc-accent)]" /> JE EERSTVOLGENDE OPNAME</h2>
              <OpnameCard o={p.nextOpname} hero />
              <a href="#voorbereiding" className={`${buttonClass({ variant: "secondary", size: "sm" })} mt-3`}>
                <ClipboardCheck className="size-4" /> Bekijk de voorbereiding en dagindeling
              </a>
            </section>
          ) : null}

          {/* Agenda — per maand, meerdere maanden duidelijk onder elkaar */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Agenda</h2>
              <div className="flex items-center gap-3 text-[11.5px] text-[var(--color-ink-muted)]">
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[4px] bg-[rgba(25,168,255,0.5)]" /> Opname</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[4px] bg-[rgba(155,120,255,0.5)]" /> Scriptmeeting</span>
              </div>
            </div>
            <div className="flex flex-col gap-7">
              {agenda.map((mo) => {
                const count = mo.items.length;
                return (
                  <div key={`${mo.year}-${mo.month}`}>
                    {/* Duidelijke maandkop in volle kleur, zodat je per maand kunt scannen. */}
                    <div className="mb-3 flex items-center justify-between gap-2 rounded-[12px] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
                      <h3 className="text-[15px] font-bold capitalize tracking-tight">{MONTH_NAMES[mo.month]} {mo.year}</h3>
                      <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11.5px] font-semibold">{count > 0 ? `${count} ${count === 1 ? "afspraak" : "afspraken"}` : "geen opname gepland"}</span>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[minmax(260px,320px)_1fr] lg:items-start">
                      <MonthCalendar year={mo.year} month={mo.month} marks={mo.marks} />
                      {count > 0 ? (
                        <div className="flex flex-col gap-3">
                          {mo.items.map((it) => it.node)}
                        </div>
                      ) : (
                        <div className="sc-glass flex items-center gap-2 px-5 py-4 text-[13.5px] text-[var(--color-ink-faint)]"><CalendarDays className="size-4" /> Nog geen opname gepland deze maand.</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Opname wijzigen of annuleren — belangrijk, dus duidelijk en opvallend
              en bewust vóór de voorbereiding zodat klanten dit snel vinden. */}
          <section className="overflow-hidden rounded-[16px] border border-[#19a8ff]/35 bg-[rgba(25,168,255,0.05)]">
            <div className="flex items-center gap-2 border-b border-[#19a8ff]/25 bg-[rgba(25,168,255,0.1)] px-5 py-3">
              <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.18)] text-[#1b5fe0]"><CalendarClock className="size-4" /></span>
              <h2 className="text-[15px] font-bold">Opname wijzigen of annuleren</h2>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <div className="rounded-[12px] border border-[#2fd27a]/30 bg-[rgba(47,210,122,0.06)] p-4">
                <div className="text-[13px] font-semibold text-[#2fd27a]">Kosteloos</div>
                <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">Verplaatsen of annuleren kan gratis tot <strong className="text-[var(--color-ink)]">{settings.cancelNoticeDays} werkdagen</strong> vóór de opnamedag.</p>
              </div>
              <div className="rounded-[12px] border border-[#19a8ff]/35 bg-[rgba(25,168,255,0.08)] p-4">
                <div className="text-[13px] font-semibold text-[#1b5fe0]">Binnen {settings.cancelNoticeDays} werkdagen</div>
                <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">Dan wordt <strong className="text-[var(--color-ink)]">{settings.cancelFee}</strong> in rekening gebracht. {settings.cancelLateNote}</p>
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px] text-[var(--color-ink-muted)]">
                <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[var(--sc-accent)]" /> Laat het je vaste contactpersoon zo snel mogelijk weten.</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-[var(--sc-accent)]" /> Een nieuwe datum plannen we direct met je in, afhankelijk van de beschikbaarheid.</span>
              </div>
            </div>
          </section>

          {/* Voorbereiding op de opname — overzicht (minder belangrijk, daarom lager) */}
          {p.nextOpname || p.laterOpnames.length > 0 ? (
            <section id="voorbereiding" className="scroll-mt-24">
              <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><ClipboardCheck className="size-4 text-[var(--sc-accent)]" /> Voorbereiding op je opname</h2>
              <p className="mb-3 text-[13px] text-[var(--color-ink-muted)]">Een overzicht van wat er vóór de opnamedag geregeld moet zijn.</p>
              <div className="sc-glass p-5 sm:p-6">
                <VoorbereidingOverzicht />
              </div>
              <details className="sc-glass mt-3 p-5 [&_summary]:cursor-pointer">
                <summary className="flex items-center gap-2 text-base font-semibold"><CalendarClock className="size-4 text-[var(--sc-accent)]" /> Zo ziet de opnamedag eruit</summary>
                <div className="mt-4"><OpnamedagContent /></div>
              </details>
            </section>
          ) : null}
        </>
      )}

      {/* Eerdere opnames (ingeklapt) */}
      {p.pastOpnames.length > 0 ? (
        <details className="sc-glass p-5 [&_summary]:cursor-pointer">
          <summary className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-[var(--color-ink-muted)]" /> Eerdere opnames ({p.pastOpnames.length})</summary>
          <div className="mt-4 flex flex-col gap-2.5">
            {p.pastOpnames.map((o) => (
              <div key={o.id} className="flex items-center gap-3 border-t border-[var(--sc-line)] pt-2.5 first:border-t-0 first:pt-0">
                <DateBadge date={o.date} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{dayLabel(o.date)}</div>
                  <div className="text-[12px] text-[var(--color-ink-muted)]">
                    {[o.contentCreative?.name, o.videographer?.name, o.plannedShorts ? `${o.plannedShorts} shorts` : null].filter(Boolean).join(" · ") || "Opnamedag"}
                  </div>
                </div>
                {o.reviewId ? <Link href={`/portal/scripts/${o.reviewId}`} className="shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--sc-accent)]"><FileText className="size-4" /></Link> : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
