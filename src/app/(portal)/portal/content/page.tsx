import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { countClientAgendaByWeek, getClientAgenda } from "@/server/portal-content";
import { ContentAgenda } from "@/components/portal/content-agenda";
import { ContentPlanningPdfButton } from "@/components/content-planning/pdf-button";
import { addDays, isIsoDate, isIsoMonth, isoWeekNumber, mondayOf, monthDays, shiftMonth } from "@/lib/client-content-planning";

export const metadata: Metadata = { title: "Contentplanning" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";

const shortDate = (iso: string, withYear = false) =>
  new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString("nl-NL", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })
    .replace(".", "");
const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Contentplanning in het klantportaal: een vereenvoudigde weergave van exact de
 * interne contentplanning. Standaard de huidige week, met navigatie per week
 * (of maand). Geen interne stappen, acties of voortgangsblokken.
 */
export default async function PortalContentPage({
  searchParams,
}: {
  searchParams: Promise<{ weergave?: string; week?: string; maand?: string }>;
}) {
  const viewer = await requirePortal();
  const params = await searchParams;
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const thisMonday = mondayOf(todayIso);
  const thisMonth = todayIso.slice(0, 7);

  const view: "week" | "maand" = params.weergave === "maand" ? "maand" : "week";
  const weekStart = view === "week" && isIsoDate(params.week) ? mondayOf(params.week) : thisMonday;
  const month = view === "maand" && isIsoMonth(params.maand) ? params.maand : thisMonth;

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : monthDays(month);
  const from = days[0]!;
  const to = days[days.length - 1]!;

  // Vooruitblik: de komende vier weken vanaf de getoonde week (of vanaf nu bij de maand).
  const aheadStart = view === "week" ? addDays(weekStart, 7) : addDays(thisMonday, 7);
  const [agenda, ahead] = await Promise.all([
    getClientAgenda(viewer, from, to),
    countClientAgendaByWeek(viewer, aheadStart, addDays(aheadStart, 27)),
  ]);

  const weekHref = (w: string) => (w === thisMonday ? "/portal/content" : `/portal/content?week=${w}`);
  const monthHref = (m: string) => `/portal/content?weergave=maand&maand=${m}`;

  const isCurrent = view === "week" ? weekStart === thisMonday : month === thisMonth;
  const prevHref = view === "week" ? weekHref(addDays(weekStart, -7)) : monthHref(shiftMonth(month, -1));
  const nextHref = view === "week" ? weekHref(addDays(weekStart, 7)) : monthHref(shiftMonth(month, 1));
  const todayHref = view === "week" ? "/portal/content" : monthHref(thisMonth);
  // Wisselen houdt de periode vast: week → maand van die week, maand → eerste week van die maand.
  const toMonthHref = monthHref(addDays(weekStart, 3).slice(0, 7));
  const toWeekHref = month === thisMonth ? "/portal/content" : weekHref(mondayOf(`${month}-01`));

  const weekName =
    weekStart === thisMonday ? "Deze week" : weekStart === addDays(thisMonday, 7) ? "Volgende week" : weekStart === addDays(thisMonday, -7) ? "Vorige week" : `Week ${isoWeekNumber(weekStart)}`;
  const heading = view === "week" ? weekName : monthLabel(month);
  const subheading =
    view === "week"
      ? `${weekName.startsWith("Week") ? "" : `Week ${isoWeekNumber(weekStart)} · `}${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6), true)}`
      : null;

  const inView = view === "maand" ? agenda.posts.filter((p) => p.scheduledOn.startsWith(month)) : agenda.posts;
  const emptyWeek = view === "week" && agenda.posts.length === 0;

  const navBtn =
    "grid size-10 place-items-center rounded-[10px] border border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-colors hover:bg-[var(--sc-fill)]";
  const seg = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
      active ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
    }`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Contentplanning</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Welke video&apos;s wanneer online komen, en op welke kanalen.</p>
        </div>
        <ContentPlanningPdfButton href="/api/portal/contentplanning/pdf" />
      </div>

      {/* Navigatie: periode, vorige/volgende, terug naar nu, week of maand. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[var(--sc-line)] bg-[var(--color-surface)]/95 px-3 py-2.5 shadow-[var(--shadow-card)] backdrop-blur">
        <div className="flex items-center gap-2">
          <Link href={prevHref} className={navBtn} aria-label={view === "week" ? "Vorige week" : "Vorige maand"} scroll={false}>
            <ChevronLeft className="size-5" />
          </Link>
          <Link href={nextHref} className={navBtn} aria-label={view === "week" ? "Volgende week" : "Volgende maand"} scroll={false}>
            <ChevronRight className="size-5" />
          </Link>
          <div className="ml-1 min-w-0">
            <h2 className="text-[17px] font-bold leading-tight tracking-tight first-letter:uppercase">{heading}</h2>
            {subheading ? <p className="text-[12.5px] text-[var(--color-ink-muted)]">{subheading}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isCurrent ? (
            <Link href={todayHref} scroll={false} className="rounded-[10px] border border-[var(--sc-line)] px-3 py-2 text-[13px] font-semibold hover:bg-[var(--sc-fill)]">
              {view === "week" ? "Naar deze week" : "Naar deze maand"}
            </Link>
          ) : null}
          <div className="inline-flex items-center gap-1 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1" role="tablist" aria-label="Weergave">
            <Link href={view === "week" ? weekHref(weekStart) : toWeekHref} scroll={false} className={seg(view === "week")} aria-selected={view === "week"} role="tab">
              Week
            </Link>
            <Link href={view === "maand" ? monthHref(month) : toMonthHref} scroll={false} className={seg(view === "maand")} aria-selected={view === "maand"} role="tab">
              Maand
            </Link>
          </div>
        </div>
      </div>

      {emptyWeek ? (
        <section className="flex items-center gap-3 rounded-[16px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-5">
          <CalendarDays className="size-5 shrink-0 text-[var(--sc-accent)]" />
          <p className="text-[14px] font-medium">Er staan deze week nog geen video&apos;s gepland.</p>
        </section>
      ) : (
        <ContentAgenda view={view} days={days} month={view === "maand" ? month : undefined} todayIso={todayIso} posts={inView} />
      )}

      {/* Komende weken in één oogopslag; klik om naar die week te gaan. */}
      {ahead.length ? (
        <section>
          <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Komende weken</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ahead.map((w) => (
              <Link
                key={w.weekStart}
                href={weekHref(w.weekStart)}
                scroll={false}
                className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--sc-fill)]"
              >
                <div className="text-[13px] font-semibold">Week {isoWeekNumber(w.weekStart)}</div>
                <div className="text-[12px] text-[var(--color-ink-muted)]">
                  {shortDate(w.weekStart)} – {shortDate(addDays(w.weekStart, 6))} ·{" "}
                  {w.count === 0 ? "nog niets gepland" : `${w.count} ${w.count === 1 ? "video" : "video's"}`}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
