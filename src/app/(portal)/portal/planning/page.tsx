import type { Metadata } from "next";
import { CalendarDays, MapPin, Send, Users } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
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
  type: "afspraak" | "publicatie";
  title: string;
  time?: string | null;
  location?: string | null;
  people?: string[];
  platforms?: string[];
};

export default async function PortalPlanningPage() {
  const viewer = await requirePortal();
  const data = await getPortalData(viewer);

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
  items.sort((x, y) => x.date.getTime() - y.date.getTime());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Planning</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Je opnamedagen, besprekingen en publicaties, overzichtelijk op één tijdlijn.
        </p>
      </div>

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
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      it.type === "publicatie" ? "bg-[rgba(47,210,122,0.12)] text-[#2fd27a]" : "bg-[rgba(25,168,255,0.12)] text-[#4bc4ff]"
                    }`}>
                      {it.type === "publicatie" ? <Send className="size-3" /> : <CalendarDays className="size-3" />}
                      {it.type === "publicatie" ? "Publicatie" : "Afspraak"}
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
    </div>
  );
}
