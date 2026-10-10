import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { db } from "@/db/client";
import { meetingItems, teamMeetings } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { ensureWeeklyMeeting } from "@/server/meetings";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { NewMeetingForm } from "./meetings-ui";

export const metadata: Metadata = { title: "Teammeetings" };
export const dynamic = "force-dynamic";

function dateTime(d: Date): string {
  return `${formatDate(d)} · ${new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }).format(d)}`;
}

export default async function MeetingsPage() {
  await requireInternal();
  // Zorg dat de vaste woensdag-16:00-meeting bestaat (met carry-over).
  const weeklyId = await ensureWeeklyMeeting();
  const [members, meetings, weekly, weeklyCount] = await Promise.all([
    listAssignableUsers(),
    db.select().from(teamMeetings).orderBy(desc(teamMeetings.scheduledAt)).limit(100),
    db.select().from(teamMeetings).where(eq(teamMeetings.id, weeklyId)).limit(1),
    db.select({ n: sql<number>`count(*)` }).from(meetingItems).where(eq(meetingItems.meetingId, weeklyId)),
  ]);
  const now = Date.now();
  const w = weekly[0]!;
  const agendaCount = Number(weeklyCount[0]?.n ?? 0);
  // De wekelijkse meeting niet dubbel in de "komende" lijst.
  const upcoming = meetings.filter((m) => m.id !== weeklyId && new Date(m.scheduledAt).getTime() >= now - 2 * 60 * 60 * 1000).reverse();
  const past = meetings.filter((m) => new Date(m.scheduledAt).getTime() < now - 2 * 60 * 60 * 1000);

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="Teammeetings" description="Verzamel de hele week bespreekpunten voor de vaste teammeeting; leg besluiten en actiepunten vast en koppel actiepunten direct aan Taken." />

      {/* Vaste wekelijkse teammeeting */}
      <Link href={`/meetings/${weeklyId}`} className="mb-5 block overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] text-white transition-shadow hover:shadow-[var(--shadow-raised)]">
        <div className="flex flex-wrap items-center gap-3 p-5">
          <CalendarClock className="size-6 shrink-0 text-[var(--color-brand-400)]" />
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold tracking-tight">Vaste teammeeting · {dateTime(new Date(w.scheduledAt))}</div>
            <div className="text-xs text-white/70">Iedereen voegt de hele week bespreekpunten toe. {agendaCount} bespreekpunt{agendaCount === 1 ? "" : "en"} klaar · niet-behandelde punten gaan automatisch mee naar volgende week.</div>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium">Bespreekpunten toevoegen →</span>
        </div>
      </Link>

      <div className="mb-5"><NewMeetingForm members={members} /></div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <CardHeader title="Komende meetings" className="p-5 pb-2" />
          {upcoming.length === 0 ? <EmptyState title="Geen meetings gepland" /> : (
            <ul className="divide-y divide-[var(--color-line)]">
              {upcoming.map((m) => <MeetingRow key={m.id} m={m} />)}
            </ul>
          )}
        </Card>
        <Card padded={false}>
          <CardHeader title="Eerdere meetings" className="p-5 pb-2" />
          {past.length === 0 ? <EmptyState title="Nog geen eerdere meetings" /> : (
            <ul className="divide-y divide-[var(--color-line)]">
              {past.map((m) => <MeetingRow key={m.id} m={m} />)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MeetingRow({ m }: { m: typeof teamMeetings.$inferSelect }) {
  return (
    <li>
      <Link href={`/meetings/${m.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{m.title}</span>
          <span className="block truncate text-xs text-[var(--color-ink-muted)]">
            {dateTime(new Date(m.scheduledAt))}{m.location ? ` · ${m.location}` : ""} · {m.participantIds.length} deelnemers
          </span>
        </span>
        <span className="shrink-0 text-xs text-[var(--color-brand-600)]">openen →</span>
      </Link>
    </li>
  );
}
