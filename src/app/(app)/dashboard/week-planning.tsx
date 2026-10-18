import Link from "next/link";
import { Camera, Presentation, Upload } from "lucide-react";
import { Card, CardHeader, ClientLogo } from "@/components/ui";
import type { UpcomingMeeting } from "@/server/meetings";

/** Opname-rij zoals die uit het dashboard komt (subset). */
export type WeekShoot = {
  id: string;
  scheduledOn: string | Date;
  startTime: string | null;
  locationName: string | null;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  videographerName: string | null;
};

/** Content die die dag gepost/geüpload wordt (uit de contentplanning). */
export type WeekUpload = {
  id: string;
  scheduledOn: string | Date;
  scheduledAt: string | null;
  title: string;
  clientName: string;
  clientSlug: string | null;
  clientColor: string | null;
  clientLogo: string | null;
};

const WEEKDAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag"];
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const dayOf = (input: string | Date) => (typeof input === "string" ? input.slice(0, 10) : iso(new Date(input)));

/**
 * Weekplanning op het dashboard als échte werkweek (ma–vr): elke opname en
 * teammeeting staat op de dag waarop hij valt, zodat het team in één oogopslag
 * ziet wat er die dag gebeurt. De dag van vandaag is gemarkeerd.
 */
export function WeekPlanning({ shoots, meetings, uploads = [] }: { shoots: WeekShoot[]; meetings: UpcomingMeeting[]; uploads?: WeekUpload[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = (today.getDay() + 6) % 7; // 0 = maandag … 6 = zondag
  const monday = new Date(today);
  // Op een werkdag: deze week. In het weekend (za/zo): de kómende werkweek,
  // zodat je niet naar een afgelopen week kijkt.
  monday.setDate(today.getDate() + (dow >= 5 ? 7 - dow : -dow));
  const todayIso = iso(today);

  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  return (
    <Card padded={false} className="overflow-hidden">
      <CardHeader title="Deze week" subtitle="Opnames, uploads en meetings per dag (ma–vr)." className="px-5 py-3.5" />
      <div className="grid gap-px bg-[var(--color-line)] sm:grid-cols-5">
        {days.map((d, i) => {
          const key = iso(d);
          const isToday = key === todayIso;
          const dayShoots = shoots.filter((s) => dayOf(s.scheduledOn) === key);
          const dayMeetings = meetings.filter((m) => dayOf(m.scheduledAt) === key);
          const dayUploads = uploads.filter((u) => dayOf(u.scheduledOn) === key);
          const empty = dayShoots.length === 0 && dayMeetings.length === 0 && dayUploads.length === 0;
          return (
            <div key={key} className="min-w-0 bg-[var(--color-surface)]">
              {/* Dagkop */}
              <div className={`px-3 pt-3 pb-2 ${isToday ? "bg-[var(--color-brand-600)] text-white" : ""}`}>
                <div className="text-sm font-bold capitalize">{WEEKDAYS[i]}</div>
                <div className={`text-2xs ${isToday ? "text-white/80" : "text-[var(--color-ink-faint)]"}`}>
                  {d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                  {isToday ? " · vandaag" : ""}
                </div>
              </div>
              {/* Items */}
              <div className="space-y-1.5 px-2 pb-3">
                {empty ? (
                  <p className="px-1 py-2 text-2xs text-[var(--color-ink-faint)]">—</p>
                ) : (
                  <>
                    {dayShoots.map((s) => (
                      <Link
                        key={s.id}
                        href={`/clients/${s.clientSlug}`}
                        className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border-l-[3px] border-l-[var(--color-brand-600)] bg-[var(--color-brand-50)] p-1.5 hover:brightness-[0.99]"
                      >
                        <Camera className="mt-0.5 size-3.5 shrink-0 text-[var(--color-brand-600)]" strokeWidth={2} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            <ClientLogo name={s.clientName} logoUrl={s.clientLogo} color={s.clientColor} size={14} />
                            <span className="truncate text-2xs font-semibold">{s.clientName}</span>
                          </span>
                          <span className="block text-[10px] text-[var(--color-ink-muted)]">
                            opname{s.startTime ? ` · ${s.startTime.slice(0, 5)}` : ""}
                          </span>
                        </span>
                      </Link>
                    ))}
                    {dayUploads.map((u) => (
                      <Link
                        key={u.id}
                        href={u.clientSlug ? `/clients/${u.clientSlug}?tab=planning` : "/calendar"}
                        className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border-l-[3px] border-l-[var(--color-good)] bg-[var(--color-good-soft)] p-1.5 hover:brightness-[0.99]"
                      >
                        <Upload className="mt-0.5 size-3.5 shrink-0 text-[var(--color-good)]" strokeWidth={2} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            <ClientLogo name={u.clientName} logoUrl={u.clientLogo} color={u.clientColor} size={14} />
                            <span className="truncate text-2xs font-semibold">{u.clientName}</span>
                          </span>
                          <span className="block truncate text-[10px] text-[var(--color-ink-muted)]">
                            upload{u.scheduledAt ? ` · ${u.scheduledAt.slice(0, 5)}` : ""}{u.title ? ` · ${u.title}` : ""}
                          </span>
                        </span>
                      </Link>
                    ))}
                    {dayMeetings.map((m) => (
                      <Link
                        key={m.id}
                        href="/meetings"
                        className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-warn-soft)] p-1.5 hover:brightness-[0.99]"
                      >
                        <Presentation className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warn)]" strokeWidth={2} />
                        <span className="min-w-0">
                          <span className="block truncate text-2xs font-semibold">{m.title}</span>
                          <span className="block text-[10px] text-[var(--color-ink-muted)]">
                            meeting · {new Date(m.scheduledAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
