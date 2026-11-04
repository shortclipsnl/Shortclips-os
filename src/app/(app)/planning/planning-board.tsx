"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, Palmtree, Presentation, Send, Video } from "lucide-react";
import { ClientLogo, TeamAvatar } from "@/components/ui";

type Responsible = { coordinatorId: string | null; coordinatorName: string | null; coordinatorAvatar: string | null };
type PlanItem = { id: string; kind: "opname" | "oplevering" | "publicatie"; date: string; clientName: string; clientColor: string | null; clientLogo: string | null; title: string; person: string | null; href: string } & Responsible;
type PlanMeeting = {
  id: string; title: string; date: string; time: string; location: string | null;
  source: "google" | "intern"; meetLink: string | null; attendees: string[];
  clientName: string | null; clientColor: string | null; clientLogo: string | null; href: string;
} & Responsible;
type PlanWeek = { key: string; label: string; weekNumber: number; startOn: string; endOn: string; opnames: PlanItem[]; opleveringen: PlanItem[]; publicaties: PlanItem[]; meetings: PlanMeeting[]; conflicts: Array<{ editor: string; count: number }>; leave: Array<{ name: string; startOn: string; endOn: string }> };

type Kind = "opname" | "oplevering" | "publicatie" | "meeting";

const KINDS: { key: Kind; label: string; color: string; Icon: typeof Camera }[] = [
  { key: "opname", label: "Opnames", color: "var(--color-brand-600)", Icon: Camera },
  { key: "oplevering", label: "Opleveringen", color: "var(--color-warn)", Icon: CheckCircle2 },
  { key: "publicatie", label: "Publicaties", color: "var(--color-good)", Icon: Send },
  { key: "meeting", label: "Meetings", color: "var(--color-violet)", Icon: Presentation },
];
const KIND_COLOR: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.key, k.color])) as Record<Kind, string>;

/** Eén regel in de dag-agenda, los van het soort. */
type AgendaItem = {
  id: string;
  kind: Kind;
  main: string;
  sub: string | null;
  time: string | null;
  href: string;
  clientName: string | null;
  clientColor: string | null;
  clientLogo: string | null;
  /** Vaste verantwoordelijke (coördinator) van de klant — voor de teamfilter. */
  coordinatorId: string | null;
  /** Externe link (Google Meet/afspraak) → in nieuw tabblad openen. */
  external?: boolean;
  /** Er is een Google Meet-link bij deze meeting. */
  hasMeet?: boolean;
};

const todayIso = new Date().toLocaleDateString("en-CA");

/** "woensdag 22 okt" uit een YYYY-MM-DD. */
function dayLabel(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "short" });
}

/** n dagen na een YYYY-MM-DD, weer als YYYY-MM-DD. */
function addDaysIso(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, day! + n);
  return dt.toLocaleDateString("en-CA");
}

export function PlanningBoard({ weeks, clientOptions }: { weeks: PlanWeek[]; clientOptions: string[] }) {
  const [client, setClient] = useState("alle");
  const [coordinator, setCoordinator] = useState("alle");
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ opname: true, oplevering: true, publicatie: true, meeting: true });
  // Dagen die in de huidige week al geweest zijn, staan standaard ingeklapt —
  // zo valt vandaag op en leidt wat al is gebeurd niet meer af.
  const [showPast, setShowPast] = useState(false);

  // Teamfilter: de vaste verantwoordelijke (coördinator) per klant, afgeleid uit
  // alle items — zodat je op Milou/Jiska/Jarno/Rutger kunt filteren en ziet wie
  // waar verantwoordelijk voor is (wie wat moet uploaden).
  const teamGroups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; avatar: string | null; count: number }>();
    for (const w of weeks) {
      for (const i of [...w.opnames, ...w.opleveringen, ...w.publicaties, ...w.meetings]) {
        if (!i.coordinatorId || !i.coordinatorName) continue;
        const g = map.get(i.coordinatorId) ?? { id: i.coordinatorId, name: i.coordinatorName, avatar: i.coordinatorAvatar, count: 0 };
        g.count += 1;
        map.set(i.coordinatorId, g);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [weeks]);

  // Per week de items per dag bundelen (agenda-weergave).
  const view = useMemo(() => {
    const matchesClient = (name: string | null) => client === "alle" || name === client;
    const matchesCoord = (id: string | null) => coordinator === "alle" || id === coordinator;
    const toItem = (i: PlanItem, kind: Kind): AgendaItem => ({
      id: i.id,
      kind,
      main: kind === "opname" ? i.clientName : i.title,
      sub: kind === "opname" ? (i.person ?? null) : [i.clientName, i.person].filter(Boolean).join(" · ") || null,
      time: null,
      href: i.href,
      clientName: i.clientName,
      clientColor: i.clientColor,
      clientLogo: i.clientLogo,
      coordinatorId: i.coordinatorId,
    });

    return weeks.map((w) => {
      const byDate = new Map<string, AgendaItem[]>();
      const push = (date: string, item: AgendaItem) => {
        const list = byDate.get(date) ?? [];
        list.push(item);
        byDate.set(date, list);
      };
      if (kinds.opname) w.opnames.filter((i) => matchesClient(i.clientName) && matchesCoord(i.coordinatorId)).forEach((i) => push(i.date, toItem(i, "opname")));
      if (kinds.oplevering) w.opleveringen.filter((i) => matchesClient(i.clientName) && matchesCoord(i.coordinatorId)).forEach((i) => push(i.date, toItem(i, "oplevering")));
      if (kinds.publicatie) w.publicaties.filter((i) => matchesClient(i.clientName) && matchesCoord(i.coordinatorId)).forEach((i) => push(i.date, toItem(i, "publicatie")));
      if (kinds.meeting) {
        // Meetings met een klant volgen het klant- én teamfilter; meetings zonder
        // klant (interne/algemene afspraken) tonen we alleen bij "alle".
        w.meetings
          .filter((m) => (m.clientName ? matchesClient(m.clientName) : client === "alle") && (m.coordinatorId ? matchesCoord(m.coordinatorId) : coordinator === "alle"))
          .forEach((m) => {
            const sub = [m.clientName, m.location, m.attendees.length ? `${m.attendees.length} deelnemer${m.attendees.length === 1 ? "" : "s"}` : null]
              .filter(Boolean)
              .join(" · ") || null;
            push(m.date, {
              id: m.id, kind: "meeting", main: m.title, sub, time: m.time, href: m.href,
              clientName: m.clientName, clientColor: m.clientColor, clientLogo: m.clientLogo,
              coordinatorId: m.coordinatorId,
              external: m.source === "google", hasMeet: Boolean(m.meetLink),
            });
          });
      }
      // Toon altijd de hele werkweek (ma–vr), ook dagen zonder items, zodat
      // je ziet dat er bijv. op donderdag niets gepland staat. Weekenddagen
      // tonen we alleen als er wél iets op staat.
      const weekdays = Array.from({ length: 5 }, (_, i) => addDaysIso(w.startOn, i));
      const weekend = [addDaysIso(w.startOn, 5), addDaysIso(w.startOn, 6)].filter((d) => byDate.has(d));
      const dates = [...weekdays, ...weekend].sort((a, b) => a.localeCompare(b));
      const days = dates.map((date) => ({ date, items: byDate.get(date) ?? [] }));
      const total = days.reduce((n, d) => n + d.items.length, 0);
      return { ...w, days, total };
    });
  }, [weeks, client, coordinator, kinds]);

  return (
    <div>
      {/* Teamfilter — wie is verantwoordelijk voor welke klant. Zelfde grote
          avatars als op de klanten-/scripting-/editingpagina; één klik toont
          alleen de planning van die persoon zijn klanten. */}
      {teamGroups.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="mr-0.5 hidden text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] sm:inline">Klanten van</span>
          <button type="button" onClick={() => setCoordinator("alle")}
            className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium transition ${coordinator === "alle" ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`}>
            Iedereen
          </button>
          {teamGroups.map((t) => {
            const on = coordinator === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setCoordinator(on ? "alle" : t.id)}
                title={`Alleen de klanten van ${t.name}`}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-semibold transition ${on ? "border-[var(--color-brand-500)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)]" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
                style={on ? { boxShadow: "0 0 0 2px var(--color-brand-500)" } : undefined}>
                <span className="rounded-full p-[2px]" style={{ background: on ? "var(--color-brand-500)" : "transparent" }}>
                  <TeamAvatar name={t.name} avatarUrl={t.avatar} size={40} />
                </span>
                {t.name.split(" ")[0]}
                <span className="grid min-w-5 place-items-center rounded-full bg-[var(--color-brand-600)] px-1 text-2xs font-bold text-white">{t.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klik om te tonen of verbergen:</span>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => {
            const on = kinds[k.key];
            return (
              <button
                key={k.key}
                onClick={() => setKinds((s) => ({ ...s, [k.key]: !s[k.key] }))}
                aria-pressed={on}
                title={on ? `${k.label} verbergen` : `${k.label} tonen`}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${on ? "text-white" : "border text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
                style={on ? { background: k.color } : { borderColor: "var(--color-line-strong)" }}
              >
                <k.Icon className="size-3.5" strokeWidth={2} style={on ? undefined : { color: k.color }} />
                {k.label}
              </button>
            );
          })}
        </div>
        <select className="sc-input ml-auto h-8 w-auto py-0 text-xs" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Klant">
          <option value="alle">Alle klanten</option>
          {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="space-y-4">
        {view.map((w) => {
          const isCurrentWeek = w.startOn <= todayIso && todayIso <= w.endOn;
          // In de huidige week: dagen vóór vandaag zijn "geweest" en gaan onder
          // een inklapbare, gedimde balk; de rest (vandaag + verder) blijft staan.
          const pastDays = isCurrentWeek ? w.days.filter((d) => d.date < todayIso) : [];
          const shownDays = isCurrentWeek ? w.days.filter((d) => d.date >= todayIso) : w.days;
          const pastCount = pastDays.reduce((n, d) => n + d.items.length, 0);
          return (
          <div key={w.key} className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
            <WeekHeader w={w} count={w.total} color={weekBarColor(w)}>
              {w.conflicts.map((c) => (
                <span key={c.editor} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-2xs font-medium text-[#a3271c]">
                  <AlertTriangle className="size-3" /> {c.editor}: {c.count} opleveringen
                </span>
              ))}
              {w.leave.map((l) => (
                <span key={l.name + l.startOn} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-medium text-[#8a5300]">
                  <Palmtree className="size-3" /> {l.name.split(" ")[0]} afwezig
                </span>
              ))}
            </WeekHeader>

            {w.total === 0 ? (
              <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">Niets gepland in deze week.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {pastDays.length > 0 ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => setShowPast((v) => !v)}
                      aria-expanded={showPast}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-[var(--color-ink-faint)] transition hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink-muted)]"
                    >
                      <ChevronDown className={`size-3.5 shrink-0 transition-transform ${showPast ? "" : "-rotate-90"}`} />
                      <span className="capitalize">{pastDays.length === 1 ? dayLabel(pastDays[0]!.date) : rangeLabel(pastDays[0]!.date, pastDays[pastDays.length - 1]!.date)}</span>
                      <span>· al geweest</span>
                      {pastCount > 0 ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--color-surface-sunken)] px-1 text-2xs font-semibold tabular-nums text-[var(--color-ink-muted)]">{pastCount}</span> : null}
                      <span className="ml-auto text-2xs uppercase tracking-wide">{showPast ? "verbergen" : "tonen"}</span>
                    </button>
                  </li>
                ) : null}
                {showPast ? pastDays.map((d) => <DayRow key={d.date} d={d} past />) : null}
                {shownDays.map((d) => <DayRow key={d.date} d={d} />)}
              </ul>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/** Eén dag-rij in de weekagenda. `past` dimt een dag die al geweest is. */
function DayRow({ d, past }: { d: { date: string; items: AgendaItem[] }; past?: boolean }) {
  const isToday = d.date === todayIso;
  return (
    <li
      className={`flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:gap-3 ${
        isToday
          ? "bg-[var(--color-brand-50)] shadow-[inset_4px_0_0_var(--color-brand-600)]"
          : past
            ? "opacity-55"
            : d.items.length === 0
              ? "bg-[var(--color-surface-sunken)]/40"
              : ""
      }`}
    >
      {/* Daglabel — vandaag valt extra op met een gevulde pil + gekleurde rij. */}
      <div className={`flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-bold capitalize sm:w-36 ${isToday ? "text-[var(--color-brand-700)]" : d.items.length === 0 ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink)]"}`}>
        {dayLabel(d.date)}
        {isToday ? <span className="rounded-full bg-[var(--color-brand-600)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Vandaag</span> : null}
      </div>
      {/* Items van die dag */}
      <div className="min-w-0 flex-1 space-y-1">
        {d.items.length === 0 ? (
          <span className="text-xs text-[var(--color-ink-faint)]">—</span>
        ) : null}
        {d.items.map((it) => (
          <Link key={`${it.kind}-${it.id}`} href={it.href}
            {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="flex items-center gap-2 rounded-[var(--radius-sm)] border-l-[3px] bg-[var(--color-surface)] px-2 py-1 text-xs hover:bg-[var(--color-surface-sunken)]"
            style={{ borderLeftColor: KIND_COLOR[it.kind] }}>
            <KindIcon kind={it.kind} />
            {it.clientName ? <ClientLogo name={it.clientName} logoUrl={it.clientLogo} color={it.clientColor} size={16} /> : null}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{it.main}</span>
              {it.sub ? <span className="text-[var(--color-ink-muted)]"> · {it.sub}</span> : null}
            </span>
            {it.hasMeet ? <Video className="size-3.5 shrink-0 text-[var(--color-violet)]" aria-label="Google Meet" /> : null}
            {it.time ? <span className="shrink-0 tabular-nums text-[var(--color-ink-faint)]">{it.time}</span> : null}
          </Link>
        ))}
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: Kind }) {
  const k = KINDS.find((x) => x.key === kind)!;
  const Icon = k.Icon;
  return <Icon className="size-3.5 shrink-0" style={{ color: k.color }} strokeWidth={2} />;
}

/** Eén vaste kleur per maand (jan…dec), zodat alle weken van dezelfde maand
 *  dezelfde kleur hebben en je de maanden uit elkaar kunt houden terwijl je
 *  scrollt. Allemaal donker genoeg voor witte tekst. */
const MONTH_COLOR = [
  "#1e40af", // januari
  "#0369a1", // februari
  "#0e7490", // maart
  "#0f766e", // april
  "#1a7f37", // mei
  "#4d7c0f", // juni
  "#a16207", // juli
  "#b45309", // augustus
  "#c2410c", // september
  "#9d174d", // oktober
  "#7c2d6b", // november
  "#6d28d9", // december
];

/** Kleur van de weekbalk: deze week altijd groen, anders de maandkleur
 *  (bepaald op basis van de woensdag, zodat randweken bij de juiste maand
 *  horen). */
function weekBarColor(w: PlanWeek): string {
  if (w.startOn <= todayIso && todayIso <= w.endOn) return "var(--color-good)";
  const mid = addDaysIso(w.startOn, 3); // woensdag
  const month = Number(mid.split("-")[1]) - 1;
  return MONTH_COLOR[month] ?? MONTH_COLOR[0]!;
}

/** "20 – 26 okt" uit twee YYYY-MM-DD datums. */
function rangeLabel(startOn: string, endOn: string) {
  const f = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  };
  return `${f(startOn)} – ${f(endOn)}`;
}

/** Weekkop in volle kleur met weeknummer, naam en datumbereik. */
function WeekHeader({ w, count, color, children }: { w: PlanWeek; count: number; color: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-white" style={{ background: color }}>
      <span className="rounded bg-white/25 px-1.5 py-0.5 text-2xs font-bold tabular-nums">W{w.weekNumber}</span>
      <span className="text-sm font-bold capitalize">{w.label}</span>
      <span className="text-xs font-medium text-white/80">{rangeLabel(w.startOn, w.endOn)}</span>
      <span className="rounded-full bg-white/20 px-2 py-0.5 text-2xs font-semibold tabular-nums">{count}</span>
      {children}
    </div>
  );
}
