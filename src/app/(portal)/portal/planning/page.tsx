import type { Metadata } from "next";
import { CalendarClock, CalendarDays, Film, MapPin, Send, Users } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { getPortalSettings } from "@/server/portal-settings";
import { EmptyState } from "@/components/ui";
import { formatDateFull, relativeDays } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";

export const metadata: Metadata = { title: "Planning" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  opname: "Opnamedag",
  scriptbespreking: "Scriptbespreking",
  evaluatie: "Evaluatiegesprek",
  publicatie: "Publicatie",
  overig: "Afspraak",
};

const INTERNAL_RE = /(shortclips\.nl|teamshortclips@gmail\.com|jarnoklijnsma9@gmail\.com)/i;

function shortclipsPeople(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  const names = new Set<string>();
  for (const a of attendees as Array<{ email?: string | null; displayName?: string | null }>) {
    if (!a?.email || !INTERNAL_RE.test(a.email)) continue;
    const name = (a.displayName ?? a.email.split("@")[0] ?? "").replace(/\s*-?\s*shortclips.*/i, "").trim();
    if (name) names.add(name);
  }
  return [...names];
}

type Item = {
  key: string;
  date: Date;
  type: "afspraak" | "publicatie" | "oplevering";
  title: string;
  time?: string | null;
  location?: string | null;
  people?: string[];
  platforms?: string[];
};

const TYPE_STYLE: Record<Item["type"], { label: string; cls: string }> = {
  afspraak: { label: "Afspraak", cls: "bg-[rgba(25,168,255,0.12)] text-[#4bc4ff]" },
  publicatie: { label: "Publicatie", cls: "bg-[rgba(47,210,122,0.12)] text-[#2fd27a]" },
  oplevering: { label: "Verwachte oplevering", cls: "bg-[rgba(255,176,32,0.12)] text-[#ffb020]" },
};

export default async function PortalPlanningPage() {
  const viewer = await requirePortal();
  const [data, settings] = await Promise.all([getPortalData(viewer), getPortalSettings()]);

  const items: Item[] = [];
  for (const a of data.appointments) {
    items.push({
      key: `a-${a.id}`,
      date: new Date(a.startsAt),
      type: "afspraak",
      title: KIND_LABEL[a.kind] ?? "Afspraak",
      time: a.allDay ? null : new Date(a.startsAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }),
      location: a.location,
      people: shortclipsPeople(a.attendees),
    });
  }
  for (const c of data.calendar) {
    items.push({
      key: `c-${c.id}`,
      date: new Date(c.scheduledOn),
      type: "publicatie",
      title: c.title,
      platforms: (c.platforms as string[] | null) ?? [],
    });
  }
  // Verwachte opleveringen van video's die nu in productie zijn.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  for (const v of data.inProgress) {
    if (!v.plannedPublishOn) continue;
    const d = new Date(v.plannedPublishOn);
    if (Number.isNaN(d.getTime()) || d < startOfToday) continue;
    items.push({ key: `o-${v.id}`, date: d, type: "oplevering", title: v.title });
  }
  items.sort((x, y) => x.date.getTime() - y.date.getTime());

  // Productie vs. publicatie — overzicht van de verwachtingen.
  const inVoorbereiding = data.inProgress.length;
  const wachtFeedback = data.awaitingApproval.length;
  const now = new Date();
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const pubDates = data.calendar.map((c) => new Date(`${c.scheduledOn}T12:00:00`));
  const pubDezeWeek = pubDates.filter((d) => d >= now && d <= weekEnd).length;
  const pubDezeMaand = pubDates.filter((d) => d >= now && d <= monthEnd).length;
  const eerstePub = data.calendar[0] ?? null;

  const summary = [
    { label: "In voorbereiding", value: inVoorbereiding, hint: "wij werken eraan", color: "#4bc4ff" },
    { label: "Wacht op jouw feedback", value: wachtFeedback, hint: "actie van jou", color: "#ffb020" },
    { label: "Online deze week", value: pubDezeWeek, hint: "gaat live", color: "#2fd27a" },
    { label: "Gepland deze maand", value: pubDezeMaand, hint: "publicaties", color: "#9fdcff" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Planning</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Van productie tot publicatie — overzichtelijk op één tijdlijn.
        </p>
      </div>

      {/* Productie vs publicatie — verwachtingen in één oogopslag */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/10 bg-white/5 sm:grid-cols-4">
        {summary.map((s) => (
          <div key={s.label} className="bg-[rgba(10,12,38,0.6)] p-4">
            <div className="text-[22px] font-bold tabular-nums leading-none" style={{ color: s.color }}>{s.value}</div>
            <div className="mt-1.5 text-[12px] font-medium">{s.label}</div>
            <div className="text-[11px] text-[var(--color-ink-faint)]">{s.hint}</div>
          </div>
        ))}
      </div>
      {eerstePub ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[#2fd27a]/25 bg-[rgba(47,210,122,0.06)] px-4 py-2.5 text-[13px]">
          <Send className="size-4 text-[#2fd27a]" />
          <span className="font-semibold">Eerstvolgende publicatie:</span>
          <span className="text-[var(--color-ink-muted)]">{eerstePub.title} · {formatDateFull(new Date(`${eerstePub.scheduledOn}T12:00:00`))}</span>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="Je planning wordt voorbereid"
          description="Zodra er een opname, bespreking of publicatiedatum vaststaat, verschijnt die hier automatisch. Je hoeft nu niets te doen."
          icon={<CalendarDays className="size-6" />}
        />
      ) : (
        <div className="sc-glass p-2 sm:p-3">
          <ul className="flex flex-col">
            {items.map((it) => (
              <li key={it.key} className="flex items-start gap-4 border-t border-white/10 px-3 py-4 first:border-t-0 sm:px-4">
                <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-[13px] border border-white/10 bg-white/[0.04]">
                  <span className="text-[17px] font-bold leading-none tabular-nums">{it.date.getDate()}</span>
                  <span className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--color-ink-muted)]">
                    {it.date.toLocaleDateString("nl-NL", { month: "short" })}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TYPE_STYLE[it.type].cls}`}>
                      {it.type === "publicatie" ? <Send className="size-3" /> : it.type === "oplevering" ? <Film className="size-3" /> : <CalendarDays className="size-3" />}
                      {TYPE_STYLE[it.type].label}
                    </span>
                    <span className="text-[12.5px] text-[var(--color-ink-muted)]">{formatDateFull(it.date)} · {relativeDays(it.date)}</span>
                  </div>
                  <div className="mt-1 text-[15px] font-semibold">{it.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-ink-muted)]">
                    {it.time ? <span>vanaf {it.time.slice(0, 5)}</span> : null}
                    {it.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {it.location}</span> : null}
                    {it.people && it.people.length > 0 ? (
                      <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {it.people.join(", ")}</span>
                    ) : null}
                    {it.platforms && it.platforms.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        {it.platforms.slice(0, 4).map((pl) => (
                          <span key={pl} title={PLATFORM[pl]?.label ?? pl} className="size-2.5 rounded-full ring-1 ring-white/30" style={{ background: PLATFORM[pl]?.color ?? "#888" }} />
                        ))}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Afspraak wijzigen of annuleren — de geldende voorwaarden (intern instelbaar) */}
      <section className="sc-glass p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[#4bc4ff]"><CalendarClock className="size-4" /></span>
          <h2 className="text-base font-semibold">Afspraak wijzigen of annuleren</h2>
        </div>
        <ul className="mt-3 flex flex-col gap-2 text-[13.5px] text-[var(--color-ink-muted)]">
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#4bc4ff]" /> Wil je een opname verplaatsen of annuleren? Laat het je vaste contactpersoon zo snel mogelijk weten.</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#4bc4ff]" /> Kosteloos verplaatsen of annuleren kan tot <strong className="text-[var(--color-ink)]">{settings.cancelNoticeDays} werkdagen</strong> voor de opnamedag.</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#ffb020]" /> Bij annulering binnen {settings.cancelNoticeDays} werkdagen wordt <strong className="text-[var(--color-ink)]">{settings.cancelFee}</strong> in rekening gebracht. {settings.cancelLateNote}</li>
          <li className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#4bc4ff]" /> Een nieuwe datum plannen we direct met je in, afhankelijk van de beschikbaarheid.</li>
        </ul>
      </section>
    </div>
  );
}
