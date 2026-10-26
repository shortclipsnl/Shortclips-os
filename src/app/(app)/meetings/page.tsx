import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { db } from "@/db/client";
import { meetingItems, teamMeetings, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { ensureWeeklyMeeting } from "@/server/meetings";
import { Avatar, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AddItemForm, DeleteMeetingRowButton, NewMeetingForm } from "./meetings-ui";

export const metadata: Metadata = { title: "Teammeetings" };
export const dynamic = "force-dynamic";

/** Volledige datum mét weekdag, bijv. "woensdag 21 oktober 2026" (Amsterdam). */
function weekdayDate(d: Date): string {
  const s = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1); // weekdag met hoofdletter
}
function timeOf(d: Date): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }).format(d);
}
function dateTime(d: Date): string {
  return `${weekdayDate(d)} · ${timeOf(d)}`;
}

export default async function MeetingsPage() {
  await requireInternal();
  // Zorg dat de vaste woensdag-16:00-meeting bestaat (start met een lege lijst).
  const weeklyId = await ensureWeeklyMeeting();
  const [members, meetings, weekly, weeklyItems] = await Promise.all([
    listAssignableUsers(),
    db.select().from(teamMeetings).orderBy(desc(teamMeetings.scheduledAt)).limit(100),
    db.select().from(teamMeetings).where(eq(teamMeetings.id, weeklyId)).limit(1),
    // De bespreekpunten zelf, mét wie ze heeft toegevoegd — zodat je in één
    // oogopslag ziet waar de meeting over gaat, zonder door te klikken.
    db
      .select({ id: meetingItems.id, body: meetingItems.body, isDone: meetingItems.isDone, byName: users.fullName })
      .from(meetingItems)
      .leftJoin(users, eq(users.id, meetingItems.createdById))
      .where(and(eq(meetingItems.meetingId, weeklyId), eq(meetingItems.kind, "agenda")))
      .orderBy(asc(meetingItems.createdAt)),
  ]);
  const now = Date.now();
  const w = weekly[0]!;
  const openItems = weeklyItems.filter((i) => !i.isDone);
  const agendaCount = openItems.length;
  // Komende meetings: niet de vaste meeting, niet gearchiveerd, en nog niet voorbij.
  const upcoming = meetings
    .filter((m) => m.id !== weeklyId && !m.archivedAt && new Date(m.scheduledAt).getTime() >= now - 2 * 60 * 60 * 1000)
    .reverse();
  // Geweest: gearchiveerde meetings (nieuwste eerst).
  const past = meetings.filter((m) => Boolean(m.archivedAt)).slice(0, 25);

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="Teammeetings" description="Verzamel de hele week bespreekpunten voor de vaste teammeeting; leg besluiten en actiepunten vast en koppel actiepunten direct aan Taken." />

      {/* Vaste wekelijkse teammeeting — met directe invoer voor bespreekpunten. */}
      <Card padded={false} className="mb-5 overflow-hidden">
        <Link href={`/meetings/${weeklyId}`} className="flex flex-wrap items-center gap-3 bg-[var(--color-indigo-ink)] p-5 text-white transition-opacity hover:opacity-95">
          <CalendarClock className="size-6 shrink-0 text-[var(--color-brand-400)]" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold tracking-tight">Vaste teammeeting · {dateTime(new Date(w.scheduledAt))}</div>
            <div className="text-xs text-white/70">{agendaCount} bespreekpunt{agendaCount === 1 ? "" : "en"} klaar · elke week een schone lijst; na de meeting archiveert hij automatisch en staat de volgende klaar.</div>
          </div>
          <span className="shrink-0 text-right">
            <span className="inline-block rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium">Open de meeting →</span>
            <span className="mt-1 block text-2xs text-white/60">om de bespreekpunten te bekijken</span>
          </span>
        </Link>

        {/* Bespreekpunten die al genoteerd zijn — met wie ze toevoegde. Zo zie je
            in één oogopslag waar de meeting over gaat, zonder door te klikken. */}
        <div className="px-4 pt-4">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Bespreekpunten voor deze meeting{openItems.length > 0 ? ` · ${openItems.length}` : ""}
          </p>
          {openItems.length === 0 ? (
            <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">Nog geen bespreekpunten — voeg hieronder het eerste toe.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--color-line)] rounded-[var(--radius-md)] border border-[var(--color-line)]">
              {openItems.map((i) => (
                <li key={i.id} className="flex items-start gap-2.5 px-3 py-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-brand-500)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{i.body}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-2xs text-[var(--color-ink-faint)]">
                      {i.byName ? <Avatar name={i.byName} size={14} /> : null}
                      door {i.byName ?? "onbekend"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Duidelijke oproep + voorbeelden: wat zet je neer als bespreekpunt? */}
        <div className="px-4 pt-3">
          <p className="text-sm font-semibold">Voeg hieronder een nieuw bespreekpunt toe aan deze meeting</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Heb je iets te bespreken? Voeg het de hele week door toe — dan behandelen we het samen tijdens de vaste teammeeting.
          </p>
          <div className="mt-2.5 rounded-[var(--radius-sm)] border border-[var(--color-info)]/25 bg-[var(--color-info-soft)]/60 px-3 py-2.5 text-xs text-[var(--color-ink)]">
            <p className="font-semibold">Waar kun je aan denken?</p>
            <ul className="mt-1 space-y-1 text-[var(--color-ink-muted)]">
              <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Loop je ergens tegenaan? (een proces, een tool, de samenwerking)</span></li>
              <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Denk je dat iets beter kan bij ShortClips? Deel je idee of verbeterpunt.</span></li>
              <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Gaat het over een specifieke klant? <strong>Noem de klant erbij</strong>, zodat het meteen duidelijk is.</span></li>
              <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Een vraag, knelpunt of iets waarvan je vindt dat we het samen moeten bespreken.</span></li>
            </ul>
            <p className="mt-1.5 text-2xs text-[var(--color-ink-faint)]">Kort en concreet is prima — we behandelen het tijdens de volgende teammeeting.</p>
          </div>
        </div>
        <AddItemForm meetingId={weeklyId} kind="agenda" members={members} />
      </Card>

      <div className="mb-5"><NewMeetingForm members={members} /></div>

      <Card padded={false}>
        <CardHeader title="Komende meetings" className="p-5 pb-2" />
        {upcoming.length === 0 ? <EmptyState title="Geen extra meetings gepland" description="Naast de vaste teammeeting staat er niets ingepland." /> : (
          <ul className="divide-y divide-[var(--color-line)]">
            {upcoming.map((m) => <MeetingRow key={m.id} m={m} />)}
          </ul>
        )}
      </Card>

      {/* Geweest: automatisch gearchiveerde meetings, de dag na de meeting. */}
      {past.length > 0 ? (
        <Card padded={false} className="mt-5">
          <CardHeader title="Geweest" subtitle="Meetings die al zijn geweest, met hun bespreekpunten." className="p-5 pb-2" />
          <ul className="divide-y divide-[var(--color-line)]">
            {past.map((m) => <MeetingRow key={m.id} m={m} archived />)}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function MeetingRow({ m, archived = false }: { m: typeof teamMeetings.$inferSelect; archived?: boolean }) {
  return (
    <li className={`px-5 py-3 hover:bg-[var(--color-surface-2)]${archived ? " opacity-90" : ""}`}>
      <div className="flex items-center gap-2">
        <Link href={`/meetings/${m.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span className="min-w-0">
            {/* Geweest: de dag + datum vooraan en in het oog springend, zodat je
                direct ziet wanneer de meeting was (bijv. "Woensdag 21 oktober 2026"). */}
            {archived ? (
              <span className="mb-0.5 block text-xs font-bold text-[var(--color-brand-600)]">{weekdayDate(new Date(m.scheduledAt))}</span>
            ) : null}
            <span className="block truncate text-sm font-medium">{m.title}</span>
            <span className="block truncate text-xs text-[var(--color-ink-muted)]">
              {archived ? timeOf(new Date(m.scheduledAt)) : dateTime(new Date(m.scheduledAt))}{m.location ? ` · ${m.location}` : ""} · {m.participantIds.length} deelnemers
            </span>
          </span>
          <span className="shrink-0 text-xs text-[var(--color-brand-600)]">openen →</span>
        </Link>
        {archived ? null : <DeleteMeetingRowButton id={m.id} title={m.title} />}
      </div>
      {archived && m.summary ? (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Samenvatting van besproken punten</p>
          <p className="mt-1 whitespace-pre-line text-xs leading-snug text-[var(--color-ink-muted)]">{m.summary}</p>
        </div>
      ) : null}
    </li>
  );
}
