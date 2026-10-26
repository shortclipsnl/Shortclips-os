import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarDays, Clock, ExternalLink, FileText, Film, MapPin, MessageSquareText, Users, Video } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalPlanning, type PortalOpname, type PortalScriptMeeting, type PortalScriptState } from "@/server/portal-planning";
import { getPortalSettings } from "@/server/portal-settings";
import { Avatar, buttonClass } from "@/components/ui";
import { formatDateFull } from "@/lib/format";

export const metadata: Metadata = { title: "Planning" };
export const dynamic = "force-dynamic";

const TONE_CLS: Record<PortalScriptState["tone"], string> = {
  warn: "bg-[rgba(255,176,32,0.14)] text-[#ffb020]",
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
      <Avatar name={person.name} size={28} src={person.avatarUrl} />
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

function OpnameCard({ o, hero = false }: { o: PortalOpname; hero?: boolean }) {
  return (
    <div className={`sc-glass ${hero ? "p-6" : "p-5"}`} style={hero ? { background: "linear-gradient(180deg, rgba(25,168,255,0.08), rgba(255,255,255,0.02))" } : undefined}>
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
            {o.plannedShorts ? <span className="inline-flex items-center gap-1"><Film className="size-3.5" /> {o.plannedShorts} shorts</span> : null}
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

function ScriptMeetingCard({ m }: { m: PortalScriptMeeting }) {
  const d = new Date(m.startsAt);
  const dateStr = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  const time = m.allDay ? null : d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  return (
    <div className="sc-glass flex items-start gap-4 p-5">
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

export default async function PortalPlanningPage() {
  const viewer = await requirePortal();
  const [p, settings] = await Promise.all([getPortalPlanning(viewer), getPortalSettings()]);

  const hasAny = p.nextOpname || p.scriptMeetings.length > 0 || p.laterOpnames.length > 0;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Planning</h1>
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
          {/* Eerstvolgende opname */}
          {p.nextOpname ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-faint)]"><CalendarClock className="size-4 text-[var(--sc-accent)]" /> JE EERSTVOLGENDE OPNAME</h2>
              <OpnameCard o={p.nextOpname} hero />
            </section>
          ) : null}

          {/* Volgende opnames */}
          {p.laterOpnames.length > 0 ? (
            <section>
              <h2 className="mb-3 text-base font-semibold">Volgende opnames</h2>
              <div className="flex flex-col gap-3">
                {p.laterOpnames.map((o) => <OpnameCard key={o.id} o={o} />)}
              </div>
            </section>
          ) : null}

          {/* Scriptmeetings */}
          {p.scriptMeetings.length > 0 ? (
            <section>
              <h2 className="mb-3 text-base font-semibold">Scriptmeetings</h2>
              <div className="flex flex-col gap-3">
                {p.scriptMeetings.map((m) => <ScriptMeetingCard key={m.id} m={m} />)}
              </div>
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

      {/* Afspraak wijzigen of annuleren — de geldende voorwaarden (intern instelbaar) */}
      <section className="sc-glass p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><CalendarClock className="size-4" /></span>
          <h2 className="text-base font-semibold">Opname wijzigen of annuleren</h2>
        </div>
        <ul className="mt-3 flex flex-col gap-2 text-[13.5px] text-[var(--color-ink-muted)]">
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--sc-accent)]" /> Wil je een opname verplaatsen of annuleren? Laat het je vaste contactpersoon zo snel mogelijk weten.</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--sc-accent)]" /> Kosteloos verplaatsen of annuleren kan tot <strong className="text-[var(--color-ink)]">{settings.cancelNoticeDays} werkdagen</strong> voor de opnamedag.</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#ffb020]" /> Bij annulering binnen {settings.cancelNoticeDays} werkdagen wordt <strong className="text-[var(--color-ink)]">{settings.cancelFee}</strong> in rekening gebracht. {settings.cancelLateNote}</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--sc-accent)]" /> Een nieuwe datum plannen we direct met je in, afhankelijk van de beschikbaarheid.</li>
        </ul>
      </section>
    </div>
  );
}
