import type { Metadata } from "next";
import { CalendarDays, Clock, Radio } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContentPlanning, type PortalContentPost } from "@/server/portal-content";
import { StatusPill, type StatusTone } from "@/components/portal/status-pill";
import { PLATFORM } from "@/lib/statuses";

export const metadata: Metadata = { title: "Contentplanning" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** ISO-weeknummer. */
function weekNumber(iso: string): number {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
function weekday(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", timeZone: "UTC" }).replace(".", "");
}
function dayMonth(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** Status in klanttaal, afhankelijk van wie publiceert. */
function statusOf(p: PortalContentPost, weHandle: boolean): { tone: StatusTone; label: string } {
  if (p.isOnline) return { tone: "green", label: weHandle ? "Online" : "Geplaatst" };
  if (p.status === "scheduled" || p.status === "ready") return weHandle ? { tone: "blue", label: "Ingepland" } : { tone: "orange", label: "Klaar om te plaatsen" };
  return { tone: "grey", label: "In voorbereiding" };
}

function PlatformChips({ platforms }: { platforms: string[] }) {
  if (platforms.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {platforms.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--color-ink-muted)]">
          <span className="size-2 rounded-full ring-1 ring-[var(--sc-line)]" style={{ background: PLATFORM[p]?.color ?? "var(--color-ink-faint)" }} />
          {PLATFORM[p]?.label ?? p}
        </span>
      ))}
    </div>
  );
}

function PostCard({ post, weHandle, isToday }: { post: PortalContentPost; weHandle: boolean; isToday: boolean }) {
  const st = statusOf(post, weHandle);
  return (
    <article className="flex gap-3.5 rounded-[14px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className={`flex w-12 shrink-0 flex-col items-center justify-center rounded-[12px] py-2 ${isToday ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "bg-[var(--sc-fill)]"}`}>
        <span className={`text-[11px] font-semibold uppercase ${isToday ? "opacity-80" : "text-[var(--color-ink-muted)]"}`}>{weekday(post.scheduledOn)}</span>
        <span className="text-[19px] font-bold leading-tight tabular-nums">{new Date(`${post.scheduledOn}T12:00:00Z`).getUTCDate()}</span>
      </div>
      {post.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.coverUrl} alt="" className="h-[72px] w-[44px] shrink-0 rounded-[8px] object-cover" />
      ) : null}
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">{post.title}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-[var(--color-ink-muted)]">
          <span>{dayMonth(post.scheduledOn)}</span>
          {post.scheduledAt ? <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {post.scheduledAt} uur</span> : null}
          {isToday ? <span className="font-semibold text-[var(--sc-accent)]">Vandaag</span> : null}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <StatusPill tone={st.tone}>{st.label}</StatusPill>
          <PlatformChips platforms={post.platforms} />
        </div>
      </div>
    </article>
  );
}

export default async function PortalContentPage() {
  const viewer = await requirePortal();
  const data = await getPortalContentPlanning(viewer);
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const thisMonday = mondayOf(todayIso);
  const nextMonday = addDays(thisMonday, 7);
  const weHandle = data.weHandlePosting;

  const thisWeek = data.weeks.find((w) => w.weekStart === thisMonday);
  const upcoming = data.weeks.flatMap((w) => w.posts).filter((p) => p.scheduledOn >= todayIso && !p.isOnline);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Contentplanning</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Welke video wanneer online komt, en op welke kanalen.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
          <Radio className="size-3.5 text-[var(--sc-accent)]" />
          {weHandle ? "Shortclips plaatst je video's" : "Je plaatst de video's zelf"}
        </span>
      </div>

      {!data.shared ? (
        <section className="sc-glass flex items-start gap-3 p-5">
          <CalendarDays className="size-5 shrink-0 text-[var(--sc-accent)]" />
          <div>
            <p className="text-sm font-semibold">Je contentplanning wordt voorbereid</p>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Zodra wij de planning met je delen, zie je hier precies welke video wanneer online komt.</p>
          </div>
        </section>
      ) : (
        <>
          {/* Kerncijfers: deze week en wat er nog komt */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="sc-glass p-4">
              <div className="text-[28px] font-bold leading-none tabular-nums">{thisWeek?.posts.length ?? 0}</div>
              <div className="mt-1.5 text-[12.5px] text-[var(--color-ink-muted)]">video&apos;s deze week</div>
            </div>
            <div className="sc-glass p-4">
              <div className="text-[28px] font-bold leading-none tabular-nums">{upcoming.length}</div>
              <div className="mt-1.5 text-[12.5px] text-[var(--color-ink-muted)]">{weHandle ? "nog ingepland" : "nog te plaatsen"}</div>
            </div>
            <div className="sc-glass col-span-2 p-4 sm:col-span-1">
              <div className="text-[15px] font-semibold leading-snug">{upcoming[0] ? `${weekday(upcoming[0].scheduledOn)} ${dayMonth(upcoming[0].scheduledOn)}${upcoming[0].scheduledAt ? ` · ${upcoming[0].scheduledAt}` : ""}` : "Nog niets gepland"}</div>
              <div className="mt-1.5 text-[12.5px] text-[var(--color-ink-muted)]">eerstvolgende publicatie</div>
            </div>
          </div>

          <div className="flex flex-col gap-5">
            {data.weeks.map((week) => {
              const isThis = week.weekStart === thisMonday;
              const isNext = week.weekStart === nextMonday;
              const isPast = week.weekStart < thisMonday;
              const name = isThis ? "Deze week" : isNext ? "Volgende week" : `Week ${weekNumber(week.weekStart)}`;
              return (
                <section
                  key={week.weekStart}
                  className={`rounded-[18px] p-4 sm:p-5 ${isThis ? "border-2 border-[var(--sc-now-line)] bg-[var(--sc-now-bg)]" : "border border-[var(--sc-line)] bg-[var(--sc-fill)]"} ${isPast ? "opacity-75" : ""}`}
                  aria-current={isThis ? "date" : undefined}
                >
                  <header className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <h2 className={`font-bold tracking-tight ${isThis ? "text-[20px]" : "text-[17px]"}`}>{name}</h2>
                      <span className="text-[13px] text-[var(--color-ink-muted)]">{isThis || isNext ? `week ${weekNumber(week.weekStart)} · ` : ""}{week.label}</span>
                    </div>
                    <span className="text-[12.5px] font-medium text-[var(--color-ink-muted)]">
                      {week.posts.length === 0 ? "Geen publicaties" : `${week.posts.length} ${week.posts.length === 1 ? "publicatie" : "publicaties"}`}
                    </span>
                  </header>
                  {week.posts.length === 0 ? (
                    <p className="text-[13px] text-[var(--color-ink-faint)]">Deze week staat er niets gepland.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {week.posts.map((p) => <PostCard key={p.id} post={p} weHandle={weHandle} isToday={p.scheduledOn === todayIso} />)}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
        <Clock className="size-3.5" />
        {weHandle ? "Zodra een video online staat, krijg je er automatisch bericht van." : "De video's staan klaar op de geplande dag; plaats ze bij voorkeur op het aangegeven tijdstip."}
      </p>
    </div>
  );
}
