import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, CalendarClock, Check, Clock, Film } from "lucide-react";
import { StatusPill, portalBtn } from "@/components/portal/status-pill";
import {
  STATE_TONE,
  longDate,
  shortDate,
  type ClientRoadmap,
  type NextAction,
  type RoadmapTone,
  type SessionRoadmap,
  type StepState,
} from "@/lib/client-roadmap";

/**
 * Klantroadmap op het portaaloverzicht. Twee lagen, bewust in deze volgorde:
 *  1. "Wat gebeurt er nu?" — precies één hoofdboodschap (prioriteitsmodel),
 *     met eventueel een korte lijst "Ook voor jou".
 *  2. Per lopende opnamesessie een compacte tijdlijn van vijf stappen.
 * Kleur betekent overal hetzelfde (groen klaar, blauw wij, oranje jij, rood
 * termijn voorbij, grijs nog niet), altijd samen met een icoon en tekst.
 */

const TONE_VAR: Record<RoadmapTone, { fg: string; bg: string }> = {
  green: { fg: "var(--st-green)", bg: "var(--st-green-bg)" },
  blue: { fg: "var(--st-blue)", bg: "var(--st-blue-bg)" },
  orange: { fg: "var(--st-orange)", bg: "var(--st-orange-bg)" },
  red: { fg: "var(--st-red)", bg: "var(--st-red-bg)" },
  grey: { fg: "var(--st-grey)", bg: "var(--st-grey-bg)" },
};

function ToneIcon({ tone, className = "size-5" }: { tone: RoadmapTone; className?: string }) {
  if (tone === "green") return <Check className={className} strokeWidth={2.4} />;
  if (tone === "orange") return <Bell className={className} strokeWidth={2.1} />;
  if (tone === "red") return <AlertTriangle className={className} strokeWidth={2.1} />;
  if (tone === "blue") return <Clock className={className} strokeWidth={2.1} />;
  return <CalendarClock className={className} strokeWidth={2} />;
}

function StepDot({ state, current }: { state: StepState; current: boolean }) {
  const tone = STATE_TONE[state];
  const { fg, bg } = TONE_VAR[tone];
  const size = current ? "size-7" : "size-6";
  return (
    <span
      className={`relative z-10 grid ${size} shrink-0 place-items-center rounded-full border`}
      style={{
        color: state === "done" ? "var(--color-surface)" : fg,
        background: state === "done" ? fg : bg,
        borderColor: state === "future" ? "var(--sc-line)" : fg,
        boxShadow: current && state !== "done" ? `0 0 0 4px ${bg}` : undefined,
      }}
      aria-hidden
    >
      {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : state === "future" ? null : <ToneIcon tone={tone} className="size-3.5" />}
    </span>
  );
}

const STATE_WORD: Record<StepState, string> = {
  done: "afgerond",
  active: "Shortclips is bezig",
  action: "jouw actie nodig",
  blocked: "termijn verstreken",
  future: "nog niet gestart",
};

function DateChip({ kind, iso }: { kind: "deadline" | "expected"; iso: string }) {
  const tone: RoadmapTone = kind === "deadline" ? "orange" : "blue";
  const { fg, bg } = TONE_VAR[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ color: fg, background: bg }}>
      <CalendarClock className="size-3.5" />
      {kind === "deadline" ? `Reageer vóór ${longDate(iso)}` : `Verwacht rond ${shortDate(iso)}`}
    </span>
  );
}

function ActionButton({ a, tone, small = false }: { a: NonNullable<NextAction["action"]>; tone: RoadmapTone; small?: boolean }) {
  const cls = tone === "orange" || tone === "red" ? portalBtn.act : small ? portalBtn.soft : portalBtn.cta;
  return (
    <Link href={a.href} className={`${cls} group shrink-0`}>
      {a.label} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function WhatsNext({ roadmap }: { roadmap: ClientRoadmap }) {
  const n = roadmap.next;
  const { fg, bg } = TONE_VAR[n.tone];
  return (
    <section aria-labelledby="wat-nu" className="sc-glass p-5 sm:p-6" style={{ boxShadow: `inset 4px 0 0 ${fg}` }}>
      <h2 id="wat-nu" className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Wat gebeurt er nu?</h2>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="grid size-11 shrink-0 place-items-center rounded-[14px]" style={{ color: fg, background: bg }}>
          <ToneIcon tone={n.tone} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-bold leading-snug tracking-tight sm:text-[21px]">{n.headline}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{n.detail}</p>
          {n.deadline || n.expectedOn ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {n.deadline && n.tone !== "red" ? <DateChip kind="deadline" iso={n.deadline} /> : null}
              {n.expectedOn ? <DateChip kind="expected" iso={n.expectedOn} /> : null}
            </div>
          ) : null}
        </div>
        {n.action ? <ActionButton a={n.action} tone={n.tone} /> : null}
      </div>

      {roadmap.alsoForYou.length > 0 ? (
        <div className="mt-5 border-t border-[var(--sc-line)] pt-4">
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Ook voor jou</p>
          <ul className="mt-2 flex flex-col gap-2">
            {roadmap.alsoForYou.map((x) => {
              const t = TONE_VAR[x.tone];
              const row = (
                <>
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ color: t.fg, background: t.bg }}><ToneIcon tone={x.tone} className="size-3.5" /></span>
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                    {x.headline}
                    {x.deadline ? <span className="font-normal text-[var(--color-ink-muted)]"> · vóór {shortDate(x.deadline)}</span> : null}
                  </span>
                  {x.action ? <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" /> : null}
                </>
              );
              return (
                <li key={`${x.sessionId}-${x.headline}`}>
                  {x.action ? (
                    <Link href={x.action.href} className="flex items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3.5 py-2.5 transition-colors hover:border-[var(--sc-accent)]">{row}</Link>
                  ) : (
                    <div className="flex items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3.5 py-2.5">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SessionCard({ s }: { s: SessionRoadmap }) {
  const tone = STATE_TONE[s.state];
  return (
    <li className="sc-glass p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14.5px] font-semibold">{s.title}</span>
        <StatusPill tone={tone}>{s.statusLabel}</StatusPill>
      </div>
      <ol className="mt-4 grid grid-cols-5" aria-label={`Voortgang ${s.title}`}>
        {s.steps.map((st, i) => {
          const isCurrent = st.key === s.current;
          const next = s.steps[i + 1];
          return (
            <li key={st.key} className="relative flex flex-col items-center text-center" aria-current={isCurrent ? "step" : undefined}>
              {next ? (
                <span
                  className="absolute left-1/2 top-[13px] h-[2px] w-full"
                  style={{ background: st.state === "done" ? "var(--st-green)" : "var(--sc-line)" }}
                  aria-hidden
                />
              ) : null}
              <StepDot state={st.state} current={isCurrent} />
              <span
                className={`mt-1.5 px-0.5 text-[10.5px] leading-tight sm:text-[11.5px] ${isCurrent ? "font-bold" : "text-[var(--color-ink-muted)]"}`}
                style={isCurrent ? { color: TONE_VAR[STATE_TONE[st.state]].fg } : undefined}
              >
                {st.label}
              </span>
              <span className="sr-only">{STATE_WORD[st.state]}</span>
            </li>
          );
        })}
      </ol>
      {s.deadline || s.expectedOn || (s.action && s.state !== "done") ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-[var(--sc-line)] pt-3">
          {s.deadline ? <DateChip kind="deadline" iso={s.deadline} /> : null}
          {s.expectedOn ? <DateChip kind="expected" iso={s.expectedOn} /> : null}
          {s.action ? (
            <Link href={s.action.href} className={`${portalBtn.link} ml-auto`}>{s.action.label} <ArrowRight className="size-3.5" /></Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ProductionTimeline({ roadmap }: { roadmap: ClientRoadmap }) {
  if (roadmap.inactive || roadmap.sessions.length === 0) return null;
  // Compact houden: maximaal drie sessies tegelijk in beeld.
  const shown = roadmap.sessions.slice(0, 3);
  const hidden = roadmap.sessions.length - shown.length;
  return (
    <section aria-labelledby="producties">
      <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
        <h2 id="producties" className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
          {shown.length === 1 ? "Jouw productie" : "Jouw producties"}
        </h2>
        {roadmap.archivedCount > 0 || hidden > 0 ? (
          <Link href="/portal/videos" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <Film className="size-3.5" /> {roadmap.archivedCount + hidden} eerdere {roadmap.archivedCount + hidden === 1 ? "productie" : "producties"}
          </Link>
        ) : null}
      </div>
      <ul className={`grid gap-3 ${shown.length > 1 ? "lg:grid-cols-2" : ""} ${shown.length > 2 ? "2xl:grid-cols-3" : ""}`}>
        {shown.map((s) => <SessionCard key={s.id} s={s} />)}
      </ul>
    </section>
  );
}
