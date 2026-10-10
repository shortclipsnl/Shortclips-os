import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMeetings } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
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
  const [members, meetings] = await Promise.all([
    listAssignableUsers(),
    db.select().from(teamMeetings).orderBy(desc(teamMeetings.scheduledAt)).limit(100),
  ]);
  const now = Date.now();
  const upcoming = meetings.filter((m) => new Date(m.scheduledAt).getTime() >= now - 2 * 60 * 60 * 1000).reverse();
  const past = meetings.filter((m) => new Date(m.scheduledAt).getTime() < now - 2 * 60 * 60 * 1000);

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="Teammeetings" description="Bereid meetings voor met een agenda, leg besluiten en actiepunten vast en koppel actiepunten direct aan Taken." />

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
