import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, Clock, Eye, Film, MapPin, MessagesSquare, Play, Radio, Sparkles, Users } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { buttonClass } from "@/components/ui";
import { compact, num } from "@/lib/format";

export const metadata: Metadata = { title: "Jouw omgeving" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";

/** "Woensdag 29 oktober 2026" — volledige datum met weekdag (hoofdletter). */
function fullDate(d: Date): string {
  const s = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function timeOf(d: Date): string {
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
/** "YYYY-MM-DD" → Date op het middaguur (voorkomt tijdzone-verschuiving). */
function dateFromIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

/** Datumblok (grote dag + maand) in de huisstijl — links in een planningskaart. */
function DateChip({ date }: { date: Date }) {
  return (
    <div className="flex size-[58px] shrink-0 flex-col items-center justify-center rounded-[14px] border border-white/10 bg-gradient-to-br from-[rgba(25,168,255,0.22)] to-[rgba(27,95,224,0.22)]">
      <span className="text-xl font-bold leading-none tabular-nums">{date.getDate()}</span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
        {date.toLocaleDateString("nl-NL", { month: "short", timeZone: TZ })}
      </span>
    </div>
  );
}

/** Eén planningskaart (opnamedag of scriptmeeting) — zelfde opbouw, rustig. */
function PlanCard({
  icon,
  label,
  date,
  time,
  location,
  emptyText,
}: {
  icon: React.ReactNode;
  label: string;
  date: Date | null;
  time: string | null;
  location: string | null;
  emptyText: string;
}) {
  return (
    <section className="sc-glass flex min-h-[132px] flex-col p-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[#4bc4ff]">{icon}</span>
        {label}
      </div>
      {date ? (
        <div className="mt-4 flex items-start gap-3.5">
          <DateChip date={date} />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-snug">{fullDate(date)}</div>
            <div className="mt-1 flex flex-col gap-1 text-[13px] text-[var(--color-ink-muted)]">
              {time ? (
                <span className="flex items-center gap-1.5"><Clock className="size-3.5 shrink-0" /> vanaf {time} uur</span>
              ) : null}
              {location ? (
                <span className="flex items-center gap-1.5"><MapPin className="size-3.5 shrink-0" /> {location}</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 flex flex-1 items-center text-sm text-[var(--color-ink-muted)]">{emptyText}</p>
      )}
    </section>
  );
}

/** Eén resultaatcijfer, met korte periode-/contextlabel eronder. */
function ResultTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="sc-glass p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        <span className="text-[#4bc4ff]">{icon}</span> {label}
      </div>
      <div className="mt-2 text-[26px] font-bold tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 text-[11px] text-[var(--color-ink-faint)]">{sub}</div>
    </div>
  );
}

export default async function PortalPage() {
  const viewer = await requirePortal();
  const data = await getPortalData(viewer);

  const companyName = data.client.name;

  // 2 — Planning. Volgende opnamedag uit de bestaande klantplanning.
  const shoot = data.upcomingShoot;
  const shootDate = shoot ? dateFromIso(shoot.scheduledOn) : null;
  const shootTime = shoot?.startTime ? shoot.startTime.slice(0, 5) : null;

  // Scriptmeeting = eerstvolgende afspraak van het type "scriptbespreking"
  // (uit de gekoppelde agenda). Geen dubbele invoer.
  const scriptMeeting = data.appointments.find((a) => a.kind === "scriptbespreking") ?? null;
  const scriptDate = scriptMeeting ? new Date(scriptMeeting.startsAt) : null;
  const scriptTime = scriptMeeting && !scriptMeeting.allDay && scriptDate ? timeOf(scriptDate) : null;

  // 3 — Video's: hoeveel wachten er op beoordeling (subtiele, relevante hint).
  const pendingReview = data.awaitingApproval.length + (data.scriptsToReview?.length ?? 0);

  // 4 — Resultaten (laatste 30 dagen, uit de gekoppelde cijfers) + totaal online.
  const m = data.metrics;
  const online = data.published.length;
  const hasMetrics = m.views + m.reach + m.engagements > 0;

  return (
    <div className="flex flex-col gap-[22px]">
      {/* 1 — Persoonlijke welkomstsectie */}
      <section className="px-0.5 pt-1">
        <h1 className="text-[30px] font-bold tracking-tight">
          Welkom bij ShortClips, {companyName}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          Dit is je persoonlijke omgeving. Hier zie je in één oogopslag wanneer de volgende opname is,
          of er een scriptmeeting gepland staat, waar je je video&apos;s bekijkt en welke resultaten we voor je behalen.
        </p>
      </section>

      {/* 2 — Volgende opnamedag en scriptmeeting, naast elkaar */}
      <div className="grid gap-[18px] sm:grid-cols-2">
        <PlanCard
          icon={<Camera className="size-[18px]" strokeWidth={1.9} />}
          label="Volgende opnamedag"
          date={shootDate}
          time={shootTime}
          location={shoot?.locationName ?? null}
          emptyText="Nog geen opname gepland. Je contactpersoon neemt contact met je op zodra er een datum staat."
        />
        <PlanCard
          icon={<MessagesSquare className="size-[18px]" strokeWidth={1.9} />}
          label="Scriptmeeting"
          date={scriptDate}
          time={scriptTime}
          location={scriptMeeting?.location ?? null}
          emptyText="Nog geen scriptmeeting gepland."
        />
      </div>

      {/* 3 — Directe toegang tot de video's */}
      <Link
        href="/portal/videos"
        className="sc-glass sc-glow group flex flex-wrap items-center gap-4 p-5 transition-colors hover:border-white/25"
        style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.1), rgba(255,255,255,0.03))" }}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-[rgba(25,168,255,0.16)] text-[#4bc4ff]">
          <Film className="size-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">Bekijk jouw video&apos;s</h2>
          <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">
            Bekijk alle opnamesessies en video&apos;s van jouw bedrijf.
            {pendingReview > 0 ? (
              <span className="ml-1 font-medium text-[#ffb020]">
                {pendingReview} {pendingReview === 1 ? "wacht" : "wachten"} op jouw beoordeling.
              </span>
            ) : null}
          </p>
        </div>
        <span className={`${buttonClass({ variant: "accent", size: "md" })} shrink-0`}>
          <Play className="size-4" fill="currentColor" /> Bekijk video&apos;s
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>

      {/* 4 — Resultatenoverzicht */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Jouw resultaten</h2>
          <Link href="/portal/resultaten" className="text-[13px] font-semibold text-[#4bc4ff]">Meer resultaten →</Link>
        </div>
        {hasMetrics ? (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <ResultTile icon={<Eye className="size-3.5" />} label="Weergaven" value={compact(m.views)} sub="laatste 30 dagen" />
            <ResultTile icon={<Radio className="size-3.5" />} label="Bereik" value={compact(m.reach)} sub="laatste 30 dagen" />
            <ResultTile icon={<Sparkles className="size-3.5" />} label="Interacties" value={compact(m.engagements)} sub="laatste 30 dagen" />
            <ResultTile icon={<Film className="size-3.5" />} label="Video's online" value={num(online)} sub="totaal gepubliceerd" />
          </div>
        ) : (
          <div className="sc-glass flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[rgba(25,168,255,0.14)] text-[#4bc4ff]"><Film className="size-5" /></span>
              <div>
                <div className="text-[17px] font-bold tabular-nums leading-none">{num(online)} video&apos;s online</div>
                <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Zodra je content online staat, zie je hier je weergaven, bereik en interacties.</p>
              </div>
            </div>
            {online > 0 ? (
              <Link href="/portal/videos" className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}>Bekijk video&apos;s</Link>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
