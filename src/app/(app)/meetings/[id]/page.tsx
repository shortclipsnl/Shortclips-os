import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { meetingItems, teamMeetings, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { AddItemForm, DeleteMeetingButton, ItemActions } from "../meetings-ui";

export const metadata: Metadata = { title: "Teammeeting" };
export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal();
  const { id } = await params;

  const [meeting] = await db.select().from(teamMeetings).where(eq(teamMeetings.id, id)).limit(1);
  if (!meeting) notFound();

  const [items, members, participantRows] = await Promise.all([
    db.select().from(meetingItems).where(eq(meetingItems.meetingId, id)).orderBy(asc(meetingItems.createdAt)),
    listAssignableUsers(),
    meeting.participantIds.length
      ? db.select({ id: users.id, fullName: users.fullName }).from(users).where(and(inArray(users.id, meeting.participantIds), isNull(users.deletedAt)))
      : Promise.resolve([]),
  ]);
  const nameById = new Map(members.map((m) => [m.id, m.fullName]));

  const agenda = items.filter((i) => i.kind === "agenda");
  const decisions = items.filter((i) => i.kind === "decision");
  const actions = items.filter((i) => i.kind === "action");

  const when = new Date(meeting.scheduledAt);
  const timeStr = `${formatDate(when)} · ${new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }).format(when)}`;

  return (
    <div className="mx-auto max-w-[900px]">
      <Link href="/meetings" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Teammeetings</Link>
      <PageHeader title={meeting.title} description={`${timeStr}${meeting.location ? ` · ${meeting.location}` : ""}`} actions={<DeleteMeetingButton id={id} />} />

      {participantRows.length > 0 ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Deelnemers</span>
          {participantRows.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs">
              <Avatar name={p.fullName} size={16} /> {p.fullName.split(" ")[0]}
            </span>
          ))}
        </div>
      ) : null}

      <div className="space-y-5">
        <Section title="Agenda" subtitle="Bespreekpunten — voeg hieronder een nieuw punt toe aan deze meeting">
          {agenda.length === 0 ? <Empty text="Nog geen bespreekpunten" /> : (
            <ul className="divide-y divide-[var(--color-line)]">
              {agenda.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${i.isDone ? "text-[var(--color-ink-faint)] line-through" : ""}`}>{i.body}</span>
                    <span className="block text-2xs text-[var(--color-ink-faint)]">
                      toegevoegd door {(i.createdById && nameById.get(i.createdById)) || "onbekend"}{i.isDone ? " · behandeld" : ""}
                    </span>
                  </span>
                  <ItemActions id={i.id} kind={i.kind} hasTask={false} />
                </li>
              ))}
            </ul>
          )}
          <AddItemForm meetingId={id} kind="agenda" members={members} />
        </Section>

        <Section title="Besluiten" subtitle="Wat is er besloten">
          {decisions.length === 0 ? <Empty text="Nog geen besluiten vastgelegd" /> : (
            <ul className="divide-y divide-[var(--color-line)]">
              {decisions.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">{i.body}</span>
                  <ItemActions id={i.id} kind={i.kind} hasTask={false} />
                </li>
              ))}
            </ul>
          )}
          <AddItemForm meetingId={id} kind="decision" members={members} />
        </Section>

        <Section title="Actiepunten" subtitle="Toewijzen, een deadline geven en direct naar Taken sturen">
          {actions.length === 0 ? <Empty text="Nog geen actiepunten" /> : (
            <ul className="divide-y divide-[var(--color-line)]">
              {actions.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${i.isDone ? "text-[var(--color-ink-faint)] line-through" : ""}`}>{i.body}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">
                      {i.assigneeId ? (nameById.get(i.assigneeId) ?? "onbekend") : "niet toegewezen"}
                      {i.dueOn ? ` · deadline ${formatDate(i.dueOn)}` : ""}
                      {i.taskId ? " · ✓ als taak toegevoegd" : ""}
                    </span>
                  </span>
                  <ItemActions id={i.id} kind={i.kind} hasTask={Boolean(i.taskId)} />
                </li>
              ))}
            </ul>
          )}
          <AddItemForm meetingId={id} kind="action" members={members} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="bg-[var(--color-indigo-ink)] px-5 py-2.5 text-white">
        <div className="text-sm font-bold tracking-tight">{title}</div>
        <div className="text-2xs text-white/60">{subtitle}</div>
      </div>
      {children}
    </Card>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="px-4 py-4 text-sm text-[var(--color-ink-faint)]">{text}</p>;
}
