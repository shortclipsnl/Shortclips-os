import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { CalendarClock, CheckCircle2, MessageSquarePlus } from "lucide-react";
import { db } from "@/db/client";
import { meetingItems, teamMeetings, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { ensureWeeklyMeeting } from "@/server/meetings";
import { Avatar, Badge, Card, PageHeader } from "@/components/ui";
import { AddItemForm, NewMeetingForm } from "./meetings-ui";

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
  const w = weekly[0]!;
  const openItems = weeklyItems.filter((i) => !i.isDone);
  const agendaCount = openItems.length;
  const nameById = new Map(members.map((m) => [m.id, m.fullName]));
  // Geweest: gearchiveerde meetings (nieuwste eerst).
  const past = meetings.filter((m) => Boolean(m.archivedAt)).slice(0, 25);

  return (
    <div className="mx-auto max-w-[920px] space-y-8">
      <PageHeader title="Teammeetings" description="Verzamel de hele week bespreekpunten voor de vaste teammeeting; leg besluiten en actiepunten vast en koppel actiepunten direct aan Taken." />

      {/* Vaste wekelijkse teammeeting — met directe invoer voor bespreekpunten. */}
      <Card padded={false} className="overflow-hidden">
        <Link href={`/meetings/${weeklyId}`} className="flex flex-wrap items-center gap-4 bg-[var(--color-indigo-ink)] p-6 text-white transition-opacity hover:opacity-95">
          <CalendarClock className="size-7 shrink-0 text-[var(--color-brand-400)]" />
          <div className="min-w-0 flex-1">
            <div className="text-2xs font-semibold uppercase tracking-[0.1em] text-[var(--color-brand-400)]">Vaste teammeeting</div>
            <div className="mt-0.5 text-lg font-bold tracking-tight">{dateTime(new Date(w.scheduledAt))}</div>
            <div className="mt-1 text-xs text-white/70">Elke week een schone lijst; na de meeting archiveert hij automatisch en staat de volgende klaar.</div>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-sm font-medium">Open de meeting →</span>
        </Link>

        <div className="space-y-6 p-6">
          {/* Bespreekpunten die al genoteerd zijn — met wie ze toevoegde. Zo zie je
              in één oogopslag waar de meeting over gaat, zonder door te klikken. */}
          <section>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--color-ink)]">Bespreekpunten voor deze meeting</h2>
              {agendaCount > 0 ? <Badge tone="info">{agendaCount}</Badge> : null}
            </div>
            {openItems.length === 0 ? (
              <p className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-5 text-center text-sm text-[var(--color-ink-muted)]">
                Nog geen bespreekpunten — voeg hieronder het eerste toe.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {openItems.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5">
                    <span className="mt-2 size-2 shrink-0 rounded-full bg-[var(--color-brand-500)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-relaxed text-[var(--color-ink)]">{i.body}</p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-[var(--color-ink-faint)]">
                        {i.byName ? <Avatar name={i.byName} size={16} /> : null}
                        <span>Toegevoegd door {i.byName ?? "onbekend"}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Nieuw bespreekpunt toevoegen — eigen, ruim opgezet blok met duidelijke
              kop en uitleg, zodat het direct leesbaar en uitnodigend is. */}
          <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-5">
            <div className="flex items-center gap-2">
              <MessageSquarePlus className="size-5 shrink-0 text-[var(--color-brand-600)]" />
              <h2 className="text-base font-semibold text-[var(--color-ink)]">Nieuw bespreekpunt toevoegen</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
              Heb je iets te bespreken? Voeg het de hele week door toe — dan behandelen we het samen tijdens de vaste teammeeting.
            </p>
            <div className="mt-4">
              <AddItemForm meetingId={weeklyId} kind="agenda" members={members} bare />
            </div>
          </section>
        </div>
      </Card>

      {/* Geweest: automatisch gearchiveerde meetings, de dag na de meeting. Met een
          groen accent zodat je in één oogopslag ziet dat ze zijn geweest, plus wie
          erbij was. */}
      {past.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--color-ink)]">Geweest</h2>
            <span className="text-sm text-[var(--color-ink-muted)]">· meetings die al zijn geweest, met hun bespreekpunten</span>
          </div>
          <div className="space-y-3">
            {past.map((m) => {
              const attendees = m.participantIds.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));
              return (
                <Card key={m.id} padded={false} className="overflow-hidden">
                  <Link
                    href={`/meetings/${m.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-3 border-l-4 border-[var(--color-good)] bg-[var(--color-good-soft)] px-5 py-4 transition-colors hover:brightness-[0.98]"
                  >
                    <CheckCircle2 className="size-5 shrink-0 text-[var(--color-good)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--color-ink)]">{weekdayDate(new Date(m.scheduledAt))}</span>
                        <Badge tone="good">Bij geweest</Badge>
                      </div>
                      <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">
                        {m.title} · {timeOf(new Date(m.scheduledAt))}{m.location ? ` · ${m.location}` : ""}
                      </span>
                    </div>
                    <Attendees names={attendees} fallback={m.participantIds.length} />
                    <span className="shrink-0 text-xs font-medium text-[var(--color-good)]">openen →</span>
                  </Link>
                  {m.summary ? (
                    <div className="border-t border-[var(--color-line)] px-5 py-3">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Samenvatting van besproken punten</p>
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[var(--color-ink-muted)]">{m.summary}</p>
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Buiten de vaste teammeeting plan je zelden iets; de optie blijft wel
          behouden, maar bewust subtiel en onderaan. */}
      <div className="flex items-center gap-3 border-t border-[var(--color-line)] pt-5">
        <NewMeetingForm members={members} />
        <span className="text-xs text-[var(--color-ink-faint)]">Alleen nodig voor een losse meeting buiten de vaste teammeeting.</span>
      </div>
    </div>
  );
}

/** Wie was erbij — compacte, overlappende avatars met een label, zodat je in één
 *  oogopslag ziet wie aanwezig was. Valt terug op een telling als er geen namen
 *  bekend zijn. */
function Attendees({ names, fallback }: { names: string[]; fallback: number }) {
  if (names.length === 0) {
    if (fallback === 0) return null;
    return <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{fallback} aanwezig</span>;
  }
  const shown = names.slice(0, 6);
  const rest = names.length - shown.length;
  return (
    <span className="flex shrink-0 items-center gap-2" title={`Aanwezig: ${names.join(", ")}`}>
      <span className="flex -space-x-1.5">
        {shown.map((n, idx) => (
          <span key={idx} className="rounded-full ring-2 ring-[var(--color-good-soft)]">
            <Avatar name={n} size={22} />
          </span>
        ))}
      </span>
      <span className="text-xs text-[var(--color-ink-muted)]">{names.length} aanwezig{rest > 0 ? ` (+${rest})` : ""}</span>
    </span>
  );
}
