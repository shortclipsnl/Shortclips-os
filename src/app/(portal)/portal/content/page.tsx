import type { Metadata } from "next";
import { CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContentPlanning, type PortalContentPost } from "@/server/portal-content";
import { PLATFORM } from "@/lib/statuses";

export const metadata: Metadata = { title: "Contentplanning" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";
const WEEKDAYS_SHORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/** De 7 dagen (ma–zo) van de week die op `mondayIso` begint, als YYYY-MM-DD. */
function daysOfWeek(mondayIso: string): string[] {
  const base = new Date(`${mondayIso}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function dayNumber(iso: string): number {
  return new Date(`${iso}T12:00:00`).getDate();
}

/** Statuslabel + kleur: online (groen), ingepland (blauw) of in voorbereiding. */
function statusMeta(post: PortalContentPost): { label: string; tone: "online" | "planned" | "prep"; color: string } {
  if (post.isOnline) return { label: "Staat online", tone: "online", color: "#2fd27a" };
  if (post.status === "scheduled" || post.status === "ready") return { label: "Ingepland", tone: "planned", color: "var(--sc-accent)" };
  return { label: "In voorbereiding", tone: "prep", color: "var(--color-ink-faint)" };
}

/** Kleine platformstippen (max 4) in de kleur van het kanaal. */
function PlatformDots({ platforms }: { platforms: string[] }) {
  if (platforms.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {platforms.slice(0, 4).map((p) => (
        <span key={p} className="size-1.5 rounded-full" title={PLATFORM[p]?.label ?? p} style={{ background: PLATFORM[p]?.color ?? "var(--color-ink-faint)" }} />
      ))}
    </span>
  );
}

export default async function PortalContentPage() {
  const viewer = await requirePortal();
  const data = await getPortalContentPlanning(viewer);
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

  return (
    <div className="flex flex-col gap-[22px]">
      {/* Kop */}
      <div className="px-0.5 pt-1">
        <h1 className="text-[26px] font-bold tracking-tight">Contentplanning</h1>
        <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
          Je hele week in beeld: op welke dag welke video online komt, en op welke kanalen. Wat al live staat is groen.
        </p>
      </div>

      {/* Legenda met de kleuren, zodat de agenda meteen te lezen is */}
      {data.shared && data.weeks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--color-ink-muted)]">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#2fd27a]" /> Staat online</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--sc-accent)]" /> Ingepland</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--color-ink-faint)]" /> In voorbereiding</span>
        </div>
      ) : null}

      {!data.shared ? (
        <section className="sc-glass flex items-start gap-3 p-5">
          <CalendarDays className="size-5 shrink-0 text-[var(--sc-accent)]" />
          <div>
            <p className="text-sm font-semibold">Je contentplanning wordt voorbereid</p>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
              Zodra wij de planning met je delen, zie je hier precies welke post wanneer online komt.
            </p>
          </div>
        </section>
      ) : data.weeks.length === 0 ? (
        <section className="sc-glass p-5 text-sm text-[var(--color-ink-muted)]">
          Er staat op dit moment nog geen content ingepland. Je ziet het hier zodra wij de planning hebben gevuld.
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {data.weeks.map((week) => {
            const days = daysOfWeek(week.weekStart);
            const isThisWeek = week.weekStart <= todayIso && todayIso <= days[6]!;
            return (
              <section key={week.weekStart}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    Week van {week.label}
                  </h2>
                  {isThisWeek ? <span className="rounded-full bg-[var(--sc-accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--sc-accent)]">Deze week</span> : null}
                </div>

                {/* Weekagenda: 7 dagen (ma–zo) als kolommen op desktop, gestapeld op
                    mobiel. Lege dagen blijven zichtbaar, zodat je de hele week ziet. */}
                <div className="sc-glass overflow-hidden p-0">
                  <div className="grid grid-cols-1 gap-px bg-[var(--sc-line)] sm:grid-cols-7">
                    {days.map((dayIso, i) => {
                      const isToday = dayIso === todayIso;
                      const posts = week.posts.filter((p) => p.scheduledOn === dayIso);
                      return (
                        <div key={dayIso} className="flex min-h-[112px] min-w-0 flex-col bg-[var(--color-surface)]">
                          {/* Dagkop */}
                          <div className={`flex items-baseline justify-between px-2.5 pt-2.5 pb-1.5 ${isToday ? "bg-[var(--sc-accent)] text-white" : ""}`}>
                            <span className="text-[12px] font-bold capitalize">{WEEKDAYS_SHORT[i]}</span>
                            <span className={`text-[11px] tabular-nums ${isToday ? "text-white/85" : "text-[var(--color-ink-faint)]"}`}>
                              {dayNumber(dayIso)}
                              {isToday ? " · vandaag" : ""}
                            </span>
                          </div>
                          {/* Posts van die dag */}
                          <div className="flex flex-1 flex-col gap-1.5 px-2 pb-2.5 pt-1">
                            {posts.length === 0 ? (
                              <span className="px-1 py-1 text-[11px] text-[var(--color-ink-faint)]">—</span>
                            ) : (
                              posts.map((post) => {
                                const st = statusMeta(post);
                                return (
                                  <div
                                    key={post.id}
                                    className="rounded-[10px] border-l-[3px] bg-[var(--sc-fill)] px-2 py-1.5"
                                    style={{ borderLeftColor: st.color }}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <PlatformDots platforms={post.platforms} />
                                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight">{post.title}</span>
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[var(--color-ink-muted)]">
                                      {st.tone === "online" ? <CheckCircle2 className="size-3 text-[#2fd27a]" /> : <Clock className="size-3" />}
                                      {post.scheduledAt ? `${post.scheduledAt} · ` : ""}{st.label}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <footer className="flex items-center gap-1.5 pt-1 text-xs text-[var(--color-ink-faint)]">
        <Clock className="size-3.5" /> Zodra een video online staat, krijg je er automatisch bericht van.
      </footer>
    </div>
  );
}
