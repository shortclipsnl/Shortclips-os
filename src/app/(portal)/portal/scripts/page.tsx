import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2, ChevronDown, Clock, FileText, MapPin } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { CLIENT_ACTION_STATUSES, listPortalScriptReviews, type PortalReviewListItem } from "@/server/script-review";
import { ScriptLeeswijzer } from "@/components/portal/script-leeswijzer";
import { StatusPill, portalBtn, type StatusTone } from "@/components/portal/status-pill";
import { relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Scripts" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

/** "Donderdag 13 november" — weekdag erbij maakt een deadline direct concreet. */
function dayLabel(iso: string): string {
  const s = new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Row = {
  key: string;
  shootOn: string | null;
  shootTime: string | null;
  location: string | null;
  review: PortalReviewListItem | null;
};

type Bucket = "actie" | "bezig" | "goedgekeurd" | "afgerond";

/**
 * Vaste kleur per status, gelijk aan de statuslabels:
 * blauw = wij zijn bezig (informatie), groen = goedgekeurd, oranje/rood = actie van de klant.
 * `solid` is een volle kleur waar witte tekst goed op leesbaar is (licht en donker thema);
 * `ink` is de themavolgende tekstkleur voor accenten.
 */
const TONE_COLOR: Record<StatusTone, { solid: string; ink: string }> = {
  blue: { solid: "#1b5fe0", ink: "var(--st-blue)" },
  green: { solid: "#17784c", ink: "var(--st-green)" },
  orange: { solid: "#c2410c", ink: "var(--st-orange)" },
  red: { solid: "#b42318", ink: "var(--st-red)" },
  grey: { solid: "#5b5b74", ink: "var(--st-grey)" },
};

/** Status per opname, met de vaste portaalkleuren. */
function statusOf(r: Row, today: string): { bucket: Bucket; tone: StatusTone; label: string } {
  const rev = r.review;
  const past = !!r.shootOn && r.shootOn < today;
  if (!rev) return past ? { bucket: "afgerond", tone: "grey", label: "Geen script gedeeld" } : { bucket: "bezig", tone: "blue", label: "Script wordt voorbereid" };
  if (CLIENT_ACTION_STATUSES.includes(rev.status)) {
    const overdue = !!rev.feedbackDeadline && rev.feedbackDeadline.slice(0, 10) < today;
    if (overdue) return { bucket: "actie", tone: "red", label: "Feedbacktermijn verstreken" };
    return { bucket: "actie", tone: "orange", label: rev.status === "opnieuw_controle" ? "Aangepast, opnieuw beoordelen" : "Wacht op jouw akkoord" };
  }
  if (rev.status === "feedback_gegeven" || rev.status === "wordt_aangepast") return { bucket: "bezig", tone: "blue", label: rev.status === "feedback_gegeven" ? "Wijziging voorgesteld" : "Wordt aangepast" };
  return past ? { bucket: "afgerond", tone: "grey", label: "Afgerond · opgenomen" } : { bucket: "goedgekeurd", tone: "green", label: "Goedgekeurd" };
}

/** Groot datumvak: weekdag, dagnummer en maand op een volle statuskleur. */
function ShootDate({ iso, tone, muted }: { iso: string | null; tone: StatusTone; muted: boolean }) {
  if (!iso) {
    return (
      <span className="grid h-[84px] w-[76px] shrink-0 place-items-center rounded-[14px] bg-[var(--sc-fill-strong)] text-[var(--color-ink-faint)]">
        <FileText className="size-6" />
      </span>
    );
  }
  const d = new Date(`${iso}T12:00:00`);
  const weekday = d.toLocaleDateString("nl-NL", { weekday: "short", timeZone: TZ }).replace(".", "");
  const month = d.toLocaleDateString("nl-NL", { month: "short", timeZone: TZ }).replace(".", "");
  if (muted) {
    return (
      <span className="flex h-[84px] w-[76px] shrink-0 flex-col items-center justify-center rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] text-[var(--color-ink-muted)]">
        <span className="text-[11px] font-semibold uppercase tracking-wider">{weekday}</span>
        <span className="text-[26px] font-bold leading-none tabular-nums">{d.getDate()}</span>
        <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider">{month}</span>
      </span>
    );
  }
  return (
    <span
      className="flex h-[84px] w-[76px] shrink-0 flex-col items-center justify-center rounded-[14px] text-white"
      style={{ background: TONE_COLOR[tone].solid, boxShadow: `0 8px 20px -10px ${TONE_COLOR[tone].solid}` }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider opacity-85">{weekday}</span>
      <span className="text-[28px] font-extrabold leading-none tabular-nums">{d.getDate()}</span>
      <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider opacity-85">{month}</span>
    </span>
  );
}

function SessionRow({ r, today, isNext = false }: { r: Row; today: string; isNext?: boolean }) {
  const st = statusOf(r, today);
  const rev = r.review;
  const actie = st.bucket === "actie";
  const done = st.bucket === "afgerond";
  const color = TONE_COLOR[st.tone];
  return (
    <div
      className="flex flex-col gap-4 rounded-[var(--radius-lg)] border p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:gap-5 sm:p-5"
      style={
        done
          ? { background: "var(--color-surface)", borderColor: "var(--color-line)" }
          : {
              background: `color-mix(in srgb, ${color.solid} 6%, var(--color-surface))`,
              borderColor: `color-mix(in srgb, ${color.solid} 30%, var(--color-line))`,
              boxShadow: `inset 4px 0 0 ${color.solid}, var(--shadow-card)`,
            }
      }
    >
      <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
        <ShootDate iso={r.shootOn} tone={st.tone} muted={done} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] font-semibold uppercase tracking-wider" style={{ color: done ? "var(--color-ink-faint)" : color.ink }}>
              Opnamesessie
            </span>
            {isNext ? (
              <span className="rounded-full bg-[var(--sc-cta)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--sc-cta-ink)]">Eerstvolgende opname</span>
            ) : null}
          </div>
          <h3 className={`mt-0.5 font-bold tracking-tight ${done ? "text-[16px]" : "text-[19px] sm:text-[20px]"}`}>
            {r.shootOn ? dayLabel(r.shootOn) : rev?.title ?? "Scripts"}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-[var(--color-ink-muted)]">
            {r.shootOn ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-ink)]">
                <Clock className="size-4" style={{ color: done ? undefined : color.ink }} />
                {r.shootTime ? `Vanaf ${r.shootTime.slice(0, 5)}` : "Tijd volgt"}
                <span className="font-normal text-[var(--color-ink-muted)]">· {relativeDays(r.shootOn)}</span>
              </span>
            ) : null}
            {r.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {r.location}</span> : null}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill tone={st.tone} className="px-3 py-1.5 text-[12.5px]">{st.label}</StatusPill>
            {rev ? <span className="inline-flex items-center gap-1 text-[13px] text-[var(--color-ink-muted)]"><FileText className="size-3.5" /> {rev.title}</span> : null}
            {rev && rev.openComments > 0 ? <span className="text-[13px] text-[var(--color-ink-muted)]">{rev.openComments} opmerking{rev.openComments === 1 ? "" : "en"}</span> : null}
          </div>
          {rev && rev.totalScripts > 0 && !done ? <ScriptProgress approved={rev.approvedScripts} total={rev.totalScripts} /> : null}
          {actie && rev?.feedbackDeadline ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: color.ink }}>
              <Clock className="size-3.5" /> Graag uiterlijk {dayLabel(rev.feedbackDeadline).toLowerCase()} om 17:00
            </p>
          ) : null}
        </div>
      </div>
      {rev ? (
        <Link href={`/portal/scripts/${rev.id}`} className={`${actie ? portalBtn.act : portalBtn.soft} w-full shrink-0 sm:w-auto`}>
          {actie ? (rev.approvedScripts > 0 ? "Verder beoordelen" : "Scripts beoordelen") : "Bekijk scripts"} <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

/** "4 van 6 scripts goedgekeurd" met een smalle voortgangsbalk. */
function ScriptProgress({ approved, total }: { approved: number; total: number }) {
  const pct = Math.round((approved / total) * 100);
  return (
    <div className="mt-2.5 flex max-w-[380px] items-center gap-2.5">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--sc-fill-strong)]" aria-hidden>
        <div className="h-full rounded-full bg-[var(--st-green)]" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-[12.5px] font-semibold text-[var(--color-ink-muted)] tabular-nums">
        {approved === total ? <span className="text-[var(--st-green)]">Alle {total} goedgekeurd</span> : `${approved} van ${total} scripts goedgekeurd`}
      </span>
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
  today,
  tone,
  icon: Icon,
  nextKey,
}: {
  title: string;
  hint?: string;
  rows: Row[];
  today: string;
  tone: StatusTone;
  icon: LucideIcon;
  nextKey: string | null;
}) {
  if (rows.length === 0) return null;
  const color = TONE_COLOR[tone];
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white" style={{ background: color.solid }}>
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[19px] font-bold tracking-tight">{title}</h2>
            <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums" style={{ color: color.ink, background: `var(--st-${tone}-bg)` }}>
              {rows.length}
            </span>
          </div>
          {hint ? <p className="text-[13px] text-[var(--color-ink-muted)]">{hint}</p> : null}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {rows.map((r) => <SessionRow key={r.key} r={r} today={today} isNext={r.key === nextKey} />)}
      </div>
    </section>
  );
}

export default async function PortalScriptsPage() {
  const viewer = await requirePortal();
  const [reviews, data, settings] = await Promise.all([listPortalScriptReviews(viewer), getPortalData(viewer), getPortalSettingsForClient(viewer.clientId ?? "")]);
  const today = todayIso();

  // Eén rij per opnamesessie: elk review hoort bij een opnamedag; aankomende
  // opnames zonder script staan er ook in ("wordt voorbereid").
  const byDay = new Map<string, Row>();
  for (const r of reviews) byDay.set(r.productionDayId, { key: r.productionDayId, shootOn: r.shootOn, shootTime: r.shootTime, location: r.shootLocation, review: r });
  for (const s of data.upcomingShoots) {
    if (!byDay.has(s.id)) byDay.set(s.id, { key: s.id, shootOn: s.scheduledOn, shootTime: s.startTime ?? null, location: s.locationName ?? null, review: null });
  }
  const rows = [...byDay.values()];
  const groups: Record<Bucket, Row[]> = { actie: [], bezig: [], goedgekeurd: [], afgerond: [] };
  for (const r of rows) groups[statusOf(r, today).bucket].push(r);
  const asc = (a: Row, b: Row) => (a.shootOn ?? "9999").localeCompare(b.shootOn ?? "9999");
  groups.actie.sort(asc);
  groups.bezig.sort(asc);
  groups.goedgekeurd.sort(asc);
  groups.afgerond.sort((a, b) => (b.shootOn ?? "").localeCompare(a.shootOn ?? ""));

  // Eerstvolgende opname (vandaag of later), ongeacht de status van het script.
  const nextShoot = rows.filter((r) => !!r.shootOn && r.shootOn >= today).sort(asc)[0] ?? null;
  const nextKey = nextShoot?.key ?? null;

  const firstAction = groups.actie[0]?.review ?? null;
  const deadlines = groups.actie.map((r) => r.review?.feedbackDeadline).filter((d): d is string => !!d).sort();

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Scripts</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Per opnamesessie zie je het script, de status en of er iets van je verwacht wordt.</p>
      </div>

      {/* In één oogopslag: moet ik iets doen? */}
      {groups.actie.length > 0 ? (
        <section className="sc-glass flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6" style={{ boxShadow: "inset 4px 0 0 var(--sc-act)" }}>
          <div>
            <StatusPill tone="orange">Actie nodig</StatusPill>
            <p className="mt-2 text-[20px] font-bold tracking-tight">
              {firstAction && firstAction.totalScripts > 0
                ? `${firstAction.approvedScripts} van de ${firstAction.totalScripts} scripts goedgekeurd`
                : groups.actie.length === 1 ? "Je scripts wachten op je akkoord" : `${groups.actie.length} opnames wachten op je akkoord`}
            </p>
            {firstAction?.shootOn ? <p className="text-[13.5px] font-medium text-[var(--color-ink)]">Scripts voor de opname van {dayLabel(firstAction.shootOn).toLowerCase()}</p> : null}
            <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">
              {deadlines[0] ? <>Graag uiterlijk <strong className="text-[var(--color-ink)]">{dayLabel(deadlines[0]).toLowerCase()} om 17:00</strong>. </> : null}
              Binnen {settings.feedbackDaysScripts} {settings.feedbackDaysScripts === 1 ? "werkdag" : "werkdagen"} reageren houdt de opnamedag op schema.
            </p>
          </div>
          {firstAction ? (
            <Link href={`/portal/scripts/${firstAction.id}`} className={`${portalBtn.act} w-full sm:w-auto`}>{firstAction.approvedScripts > 0 ? "Verder beoordelen" : "Start met beoordelen"} <ArrowRight className="size-4" /></Link>
          ) : null}
        </section>
      ) : (
        <section className="sc-glass flex items-center gap-3.5 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--st-green-bg)] text-[var(--st-green)]"><CheckCircle2 className="size-5" /></span>
          <div>
            <p className="text-[16px] font-semibold">Je hoeft nu niets te doen</p>
            <p className="text-[13.5px] text-[var(--color-ink-muted)]">
              {groups.bezig.length > 0 ? `${groups.bezig.length} ${groups.bezig.length === 1 ? "script is" : "scripts zijn"} bij ons in voorbereiding. Je krijgt bericht zodra er iets klaarstaat.` : "Zodra er een nieuw script klaarstaat, zie je het hier en krijg je bericht."}
            </p>
          </div>
        </section>
      )}

      <Section title="Wacht op jouw akkoord" rows={groups.actie} today={today} tone="orange" icon={AlertCircle} nextKey={nextKey} />
      <Section title="In voorbereiding" hint="Hier zijn wij mee bezig. Je hoeft nog niets te doen." rows={groups.bezig} today={today} tone="blue" icon={CalendarClock} nextKey={nextKey} />
      <Section title="Goedgekeurd" hint="Klaar voor de opnamedag." rows={groups.goedgekeurd} today={today} tone="green" icon={CheckCircle2} nextKey={nextKey} />

      {rows.length === 0 ? (
        <section className="sc-glass flex items-center gap-3 p-5 text-[14px] text-[var(--color-ink-muted)]">
          <CalendarClock className="size-5 text-[var(--sc-accent)]" /> Er zijn nog geen opnamesessies of scripts. Zodra we je eerste opname plannen, zie je hier de scripts.
        </section>
      ) : null}

      <ScriptLeeswijzer feedbackDays={settings.feedbackDaysScripts} />

      {groups.afgerond.length > 0 ? (
        <details className="sc-glass group p-5 [&_summary]:cursor-pointer">
          <summary className="flex list-none items-center justify-between gap-2 text-[15px] font-semibold">
            <span>Afgeronde sessies <span className="font-normal text-[var(--color-ink-faint)]">{groups.afgerond.length}</span></span>
            <ChevronDown className="size-4 text-[var(--color-ink-muted)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 flex flex-col gap-3">{groups.afgerond.map((r) => <SessionRow key={r.key} r={r} today={today} />)}</div>
        </details>
      ) : null}
    </div>
  );
}
