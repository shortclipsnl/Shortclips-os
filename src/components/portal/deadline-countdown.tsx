import Link from "next/link";
import { ArrowRight, CalendarCheck, CalendarClock, Check, Hand, Info } from "lucide-react";
import { StatusPill } from "@/components/portal/status-pill";
import { AGREEMENT_TEXT, AGREEMENT_TITLE, DEADLINE_DAYS, longDate, WHY_TEXT, WHY_TITLE, type DeadlineTone } from "@/lib/planning-deadline";
import type { ClientDeadline } from "@/server/planning-deadlines";

/**
 * Afteller bovenaan de contentplanning in het klantportaal: hoeveel dagen de
 * klant nog heeft, wat er nog openstaat en wat al is afgerond. Puur weergave;
 * de gegevens komen uit planning_deadlines + de bestaande scripts en video's.
 */

const BAR: Record<DeadlineTone, string> = {
  green: "bg-[var(--st-green)]",
  orange: "bg-[var(--st-orange)]",
  red: "bg-[var(--st-red)]",
  grey: "bg-[var(--st-grey)]",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Lead({ deadline }: { deadline: ClientDeadline }) {
  const { view } = deadline;
  if (view.done) return <>Je hebt alle benodigde acties afgerond. Dank je wel, zo kunnen we volgens planning publiceren.</>;
  if (view.daysLeft < 0) return <>De deadline is verstreken. Rond de openstaande acties zo snel mogelijk af, zodat we zonder vertraging kunnen publiceren.</>;
  if (view.daysLeft === 0) return <>Vandaag is de laatste dag om de benodigde acties af te ronden.</>;
  return (
    <>
      Je hebt nog <strong className="font-bold text-[var(--color-ink)]">{plural(view.daysLeft, "dag", "dagen")}</strong> om de benodigde acties af te ronden.
    </>
  );
}

export function DeadlineCountdown({ deadline }: { deadline: ClientDeadline }) {
  const { view, actions } = deadline;
  const elapsedDay = Math.min(view.totalDays, Math.max(0, view.totalDays - Math.max(0, view.daysLeft)));
  const open: { label: string; href: string }[] = [];
  if (actions.scriptsOpen > 0) open.push({ label: `${plural(actions.scriptsOpen, "script wacht", "scripts wachten")} op je akkoord`, href: "/portal/scripts" });
  if (actions.videosOpen > 0) open.push({ label: `${plural(actions.videosOpen, "video wacht", "video's wachten")} op je feedback`, href: "/portal/videos" });
  const done: string[] = [];
  if (actions.scriptsDone > 0) done.push(`${plural(actions.scriptsDone, "script", "scripts")} goedgekeurd`);
  if (actions.videosDone > 0) done.push(`${plural(actions.videosDone, "video", "video's")} van feedback voorzien`);

  return (
    <section aria-labelledby="planning-deadline" className="overflow-hidden rounded-[18px] border border-[var(--sc-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="px-5 pb-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="planning-deadline" className="text-[22px] font-bold leading-tight tracking-tight">
              {view.done ? "Alles is op tijd geregeld" : "Jouw contentplanning staat klaar!"}
            </h2>
            <p className="mt-1.5 max-w-2xl text-[15px] leading-snug text-[var(--color-ink-muted)]"><Lead deadline={deadline} /></p>
          </div>
          <StatusPill tone={view.tone}>{view.clientLabel}</StatusPill>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px] text-[var(--color-ink-muted)]">
          <span className="inline-flex items-center gap-1.5"><CalendarCheck className="size-4" /> Beschikbaar gesteld op {longDate(view.startedOn)}</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-ink)]"><CalendarClock className="size-4" /> Deadline: {longDate(view.deadlineOn)}</span>
        </div>

        <div className="mt-3">
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--sc-fill)]"
            role="progressbar"
            aria-label="Verstreken tijd tot de deadline"
            aria-valuemin={0}
            aria-valuemax={view.totalDays}
            aria-valuenow={elapsedDay}
          >
            <div className={`h-full rounded-full ${BAR[view.tone]}`} style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] tabular-nums text-[var(--color-ink-faint)]">
            <span>{view.done ? "Afgerond" : `Dag ${elapsedDay} van ${view.totalDays}`}</span>
            <span>{view.totalDays === DEADLINE_DAYS ? "3 weken" : `${view.totalDays} dagen`}</span>
          </div>
        </div>

        {!view.done ? (
          <p className="mt-3 text-[13px] text-[var(--color-ink-muted)]">Zorg dat alles op tijd geregeld is, zodat we volgens planning kunnen starten met publiceren.</p>
        ) : null}
      </div>

      <div className="grid border-t border-[var(--sc-line)] md:grid-cols-2">
        <div className={`px-5 py-4 sm:px-6 ${open.length > 0 ? "bg-[var(--st-orange-bg)]/40" : ""}`}>
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Wat moet er nog gebeuren</h3>
          {open.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-[var(--color-ink-muted)]">Er staat op dit moment niets open bij jou. Komt er iets bij, dan zie je het hier direct.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {open.map((o) => (
                <li key={o.href} className="flex items-start gap-2.5 text-[13.5px]">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--st-orange-bg)] text-[var(--st-orange)]" aria-hidden><Hand className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{o.label.replace(/^./, (c) => c.toUpperCase())}</span>
                    <Link href={o.href} className="ml-2 inline-flex items-center gap-1 font-semibold text-[var(--color-ink)] underline-offset-2 hover:underline">
                      Bekijken <ArrowRight className="size-3.5" />
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-[var(--sc-line)] px-5 py-4 sm:px-6 md:border-l md:border-t-0">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Al afgerond</h3>
          {done.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-[var(--color-ink-muted)]">In deze periode is nog niets afgerond.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {done.map((d) => (
                <li key={d} className="flex items-center gap-2.5 text-[13.5px]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--st-green-bg)] text-[var(--st-green)]" aria-hidden><Check className="size-3.5" strokeWidth={2.5} /></span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 border-t border-[var(--sc-line)] bg-[var(--sc-fill)] px-5 py-4 sm:px-6 md:grid-cols-2">
        <div className="flex gap-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-muted)]" />
          <div>
            <p className="text-[13.5px] font-semibold">{WHY_TITLE}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-[var(--color-ink-muted)]">{WHY_TEXT}</p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-muted)]" />
          <div>
            <p className="text-[13.5px] font-semibold">{AGREEMENT_TITLE}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-[var(--color-ink-muted)]">{AGREEMENT_TEXT}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
