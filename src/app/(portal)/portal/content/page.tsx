import type { Metadata } from "next";
import { CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContentPlanning, type PortalContentPost } from "@/server/portal-content";
import { PLATFORM } from "@/lib/statuses";
import { formatDateFull, relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Contentplanning" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";

function PlatformTags({ platforms }: { platforms: string[] }) {
  if (platforms.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {platforms.map((p) => {
        const meta = PLATFORM[p];
        return (
          <span key={p} className="inline-flex items-center gap-1 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] px-2 py-0.5 text-[11px] font-medium">
            <span className="size-1.5 rounded-full" style={{ background: meta?.color ?? "var(--color-ink-faint)" }} />
            {meta?.label ?? p}
          </span>
        );
      })}
    </span>
  );
}

/** Statuslabel: online (groen), ingepland of in voorbereiding. */
function statusMeta(post: PortalContentPost): { label: string; tone: "online" | "planned" | "prep" } {
  if (post.isOnline) return { label: "Staat online", tone: "online" };
  if (post.status === "scheduled" || post.status === "ready") return { label: "Ingepland", tone: "planned" };
  return { label: "In voorbereiding", tone: "prep" };
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
          Welke video&apos;s komen wanneer online, en op welke kanalen. Wat al live staat is groen gemarkeerd.
        </p>
      </div>

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
            const isThisWeek = week.weekStart <= todayIso && todayIso < new Date(new Date(`${week.weekStart}T12:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
            return (
              <section key={week.weekStart}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                    Week van {week.label}
                  </h2>
                  {isThisWeek ? <span className="rounded-full bg-[var(--sc-accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--sc-accent)]">Deze week</span> : null}
                </div>
                <div className="flex flex-col gap-2.5">
                  {week.posts.map((post) => {
                    const st = statusMeta(post);
                    const online = st.tone === "online";
                    return (
                      <div
                        key={post.id}
                        className="sc-glass flex flex-wrap items-center gap-4 p-4"
                        style={online ? { boxShadow: "inset 3px 0 0 #2fd27a" } : undefined}
                      >
                        <span className="grid size-11 shrink-0 place-items-center rounded-[12px] border border-[var(--sc-line)] bg-gradient-to-br from-[rgba(25,168,255,0.18)] to-[rgba(27,95,224,0.18)] text-center">
                          <span className="text-[16px] font-bold leading-none">{new Date(`${post.scheduledOn}T12:00:00`).getDate()}</span>
                          <span className="text-[9px] uppercase text-[var(--color-ink-muted)]">{new Date(`${post.scheduledOn}T12:00:00`).toLocaleDateString("nl-NL", { month: "short" })}</span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[14.5px] font-semibold">{post.title}</div>
                          <div className="text-[12.5px] text-[var(--color-ink-muted)]">
                            {formatDateFull(post.scheduledOn)}
                            {post.scheduledAt ? ` · ${post.scheduledAt} uur` : ""} · {relativeDays(post.scheduledOn)}
                          </div>
                          <div className="mt-2 border-t border-[var(--sc-line)] pt-2">
                            <PlatformTags platforms={post.platforms} />
                          </div>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${
                            online
                              ? "bg-[#2fd27a]/15 text-[#1a9956]"
                              : st.tone === "planned"
                                ? "bg-[var(--sc-accent)]/15 text-[var(--sc-accent)]"
                                : "bg-[var(--sc-fill)] text-[var(--color-ink-muted)]"
                          }`}
                        >
                          {online ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}
                          {st.label}
                        </span>
                      </div>
                    );
                  })}
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
