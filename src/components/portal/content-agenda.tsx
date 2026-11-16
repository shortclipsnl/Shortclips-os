"use client";

import { useEffect, useState } from "react";
import { Clock, ExternalLink, Film, X } from "lucide-react";
import { PLATFORM } from "@/lib/statuses";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusPill } from "@/components/portal/status-pill";
import { CLIENT_POST_STATUS, type ClientPostStatus } from "@/lib/client-content-planning";
import type { ClientAgendaPost } from "@/server/portal-content";

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const BAR: Record<ClientPostStatus, string> = {
  published: "var(--st-green)",
  scheduled: "var(--st-blue)",
  tentative: "var(--st-orange)",
};

const dayLong = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayShort = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");

function Status({ status, wrap = false }: { status: ClientPostStatus; wrap?: boolean }) {
  const s = CLIENT_POST_STATUS[status];
  return (
    <StatusPill tone={s.tone} className={wrap ? "max-w-full !whitespace-normal !leading-tight" : ""}>
      {s.label}
    </StatusPill>
  );
}

function Platforms({ platforms, size = 14 }: { platforms: string[]; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--color-ink)]">
      {platforms.map((p) => (
        <PlatformIcon key={p} platform={p} size={size} title={PLATFORM[p]?.label ?? p} />
      ))}
    </span>
  );
}

function Thumb({ post, className }: { post: ClientAgendaPost; className: string }) {
  const [failed, setFailed] = useState(false);
  if (post.thumbUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={post.thumbUrl} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover`} />
    );
  }
  return (
    <span className={`${className} grid place-items-center bg-[var(--sc-fill-strong)] text-[var(--color-ink-faint)]`} aria-hidden>
      <Film className="size-4" />
    </span>
  );
}

/**
 * Contentkaart: zelfde opbouw als de interne planning (statuskleur links), met
 * alleen klantgegevens. Mobiel liggend (thumbnail links), in de weekkolommen
 * op desktop staand zodat niets wordt afgekapt.
 */
function PostCard({ post, onOpen }: { post: ClientAgendaPost; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-[40px_1fr] gap-x-3 gap-y-1.5 rounded-[12px] border border-l-[3px] border-[var(--sc-line)] bg-[var(--color-surface)] p-2.5 text-left shadow-[var(--shadow-card)] transition-colors hover:bg-[var(--sc-fill)] lg:grid-cols-[34px_1fr] lg:gap-x-2.5"
      style={{ borderLeftColor: BAR[post.status] }}
    >
      <Thumb post={post} className="row-span-3 h-[68px] w-[40px] rounded-[7px] lg:row-span-1 lg:h-[60px] lg:w-[34px]" />
      <span className="col-start-2 row-start-1 line-clamp-2 text-[13.5px] font-semibold leading-snug lg:col-span-2 lg:col-start-1 lg:row-start-2">{post.title}</span>
      <span className="col-start-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--color-ink-muted)] lg:row-start-1 lg:flex-col lg:items-start lg:justify-center">
        {post.scheduledAt ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="size-3" />
            {post.scheduledAt}
          </span>
        ) : (
          <span>Tijd volgt</span>
        )}
        <Platforms platforms={post.platforms} size={13} />
      </span>
      <span className="col-start-2 row-start-3 min-w-0 lg:col-span-2 lg:col-start-1">
        <Status status={post.status} wrap />
      </span>
    </button>
  );
}

/** Compacte regel voor de maandweergave. */
function PostChip({ post, onOpen }: { post: ClientAgendaPost; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${post.title} · ${CLIENT_POST_STATUS[post.status].label}`}
      className="flex w-full items-center gap-1.5 rounded-[6px] border-l-[3px] bg-[var(--sc-fill)] px-1.5 py-1 text-left text-[11.5px] hover:bg-[var(--sc-fill-strong)]"
      style={{ borderLeftColor: BAR[post.status] }}
    >
      {post.scheduledAt ? <span className="shrink-0 tabular-nums text-[var(--color-ink-muted)]">{post.scheduledAt}</span> : null}
      <span className="min-w-0 flex-1 truncate font-medium">{post.title}</span>
    </button>
  );
}

const LABEL = "text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-muted)]";

function DetailModal({ post, onClose }: { post: ClientAgendaPost; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const s = CLIENT_POST_STATUS[post.status];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-6" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={post.title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[20px] bg-[var(--color-surface)] p-5 shadow-2xl sm:max-w-[640px] sm:rounded-[20px] sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[19px] font-bold leading-snug tracking-tight">{post.title}</h2>
          <button type="button" onClick={onClose} aria-label="Sluiten" className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-[var(--sc-fill-strong)]">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row">
          <Thumb post={post} className="mx-auto aspect-[9/16] w-[150px] shrink-0 rounded-[12px] sm:mx-0" />
          <dl className="grid flex-1 content-start gap-3.5 text-[14px]">
            <div>
              <dt className={LABEL}>Publicatie</dt>
              <dd className="mt-1 font-medium first-letter:uppercase">
                {dayLong(post.scheduledOn)}
                {post.scheduledAt ? ` om ${post.scheduledAt} uur` : ""}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Kanalen</dt>
              <dd className="mt-1.5 flex flex-wrap gap-2">
                {post.platforms.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sc-line)] px-2.5 py-1 text-[12.5px]">
                    <PlatformIcon platform={p} size={13} />
                    {PLATFORM[p]?.label ?? p}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Status</dt>
              <dd className="mt-1.5 flex flex-wrap items-center gap-2">
                <Status status={post.status} />
                <span className="text-[12.5px] text-[var(--color-ink-muted)]">{s.hint}</span>
              </dd>
            </div>
            {post.links.length ? (
              <div>
                <dt className={LABEL}>Bekijk de video</dt>
                <dd className="mt-1.5 flex flex-wrap gap-2">
                  {post.links.map((l) => (
                    <a
                      key={l.platform}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--sc-line)] px-3 py-2 text-[13px] font-semibold hover:bg-[var(--sc-fill)]"
                    >
                      <PlatformIcon platform={l.platform} size={14} />
                      {PLATFORM[l.platform]?.label ?? l.platform}
                      <ExternalLink className="size-3.5 text-[var(--color-ink-muted)]" />
                    </a>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
        {post.caption ? (
          <div className="mt-5 border-t border-[var(--sc-line)] pt-4">
            <div className={LABEL}>Caption</div>
            <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed">{post.caption}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * De agenda van de klant: week- of maandweergave van exact de interne
 * contentplanning. Klikken op een video opent de details; aanpassen kan niet.
 */
export function ContentAgenda({
  view,
  days,
  month,
  todayIso,
  posts,
}: {
  view: "week" | "maand";
  days: string[];
  /** YYYY-MM bij de maandweergave (dagen buiten de maand worden gedimd). */
  month?: string;
  todayIso: string;
  posts: ClientAgendaPost[];
}) {
  const [open, setOpen] = useState<ClientAgendaPost | null>(null);
  const byDay = new Map<string, ClientAgendaPost[]>();
  for (const p of posts) byDay.set(p.scheduledOn, [...(byDay.get(p.scheduledOn) ?? []), p]);
  const daysWithPosts = days.filter((d) => byDay.has(d) && (!month || d.startsWith(month)));

  return (
    <>
      {view === "week" ? (
        <div className="grid gap-3 lg:grid-cols-7 lg:gap-2.5">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const isToday = d === todayIso;
            return (
              <section
                key={d}
                aria-current={isToday ? "date" : undefined}
                className={`flex flex-col rounded-[14px] p-2.5 lg:min-h-[260px] ${
                  isToday ? "border-2 border-[var(--sc-now-line)] bg-[var(--sc-now-bg)]" : "border border-[var(--sc-line)] bg-[var(--sc-fill)]"
                }`}
              >
                <header className={`flex flex-wrap items-center justify-between gap-1.5 px-1 ${list.length ? "mb-2" : "lg:mb-2"}`}>
                  <span className="flex items-baseline gap-1.5">
                    <span className={`text-[12px] font-semibold uppercase tracking-wide ${isToday ? "text-[var(--sc-accent)]" : "text-[var(--color-ink-muted)]"}`}>{WEEKDAYS[i]}</span>
                    <span className="text-[15px] font-bold tabular-nums">{dayShort(d)}</span>
                  </span>
                  {isToday ? (
                    <span className="rounded-full bg-[var(--sc-cta)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--sc-cta-ink)]">Vandaag</span>
                  ) : list.length === 0 ? (
                    <span className="text-[12px] text-[var(--color-ink-faint)] lg:hidden">Geen video</span>
                  ) : null}
                </header>
                {list.length ? (
                  <div className="flex flex-col gap-2">
                    {list.map((p) => (
                      <PostCard key={p.id} post={p} onOpen={() => setOpen(p)} />
                    ))}
                  </div>
                ) : (
                  <span className="hidden px-1 text-[12px] text-[var(--color-ink-faint)] lg:block">Geen video</span>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <>
          {/* Maand, desktop en tablet: kalenderraster. */}
          <div className="hidden overflow-hidden rounded-[16px] border border-[var(--sc-line)] bg-[var(--color-surface)] md:block">
            <div className="grid grid-cols-7 border-b border-[var(--sc-line)] bg-[var(--sc-fill)]">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d, i) => {
                const list = byDay.get(d) ?? [];
                const inMonth = !month || d.startsWith(month);
                const isToday = d === todayIso;
                return (
                  <div
                    key={d}
                    className={`min-h-[104px] border-b border-[var(--sc-line)] p-1.5 ${i % 7 === 6 ? "" : "border-r"} ${
                      isToday ? "bg-[var(--sc-now-bg)]" : inMonth ? "" : "bg-[var(--sc-fill)] opacity-60"
                    }`}
                  >
                    <div className={`mb-1 px-1 text-[12px] tabular-nums ${isToday ? "font-bold text-[var(--sc-accent)]" : "text-[var(--color-ink-muted)]"}`}>
                      {Number(d.slice(8, 10))}
                    </div>
                    <div className="flex flex-col gap-1">
                      {list.map((p) => (
                        <PostChip key={p.id} post={p} onOpen={() => setOpen(p)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Maand, mobiel: alleen de dagen met video's, onder elkaar. */}
          <div className="flex flex-col gap-3 md:hidden">
            {daysWithPosts.length === 0 ? (
              <p className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4 text-[13.5px] text-[var(--color-ink-muted)]">
                Er staan deze maand nog geen video&apos;s gepland.
              </p>
            ) : (
              daysWithPosts.map((d) => (
                <section
                  key={d}
                  className={`rounded-[14px] p-2.5 ${d === todayIso ? "border-2 border-[var(--sc-now-line)] bg-[var(--sc-now-bg)]" : "border border-[var(--sc-line)] bg-[var(--sc-fill)]"}`}
                >
                  <h3 className="mb-2 px-1 text-[13px] font-semibold first-letter:uppercase">{dayLong(d)}</h3>
                  <div className="flex flex-col gap-2">
                    {(byDay.get(d) ?? []).map((p) => (
                      <PostCard key={p.id} post={p} onOpen={() => setOpen(p)} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[var(--color-ink-muted)]">
        {(Object.keys(CLIENT_POST_STATUS) as ClientPostStatus[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-2">
            <Status status={k} />
            <span className="hidden sm:inline">{CLIENT_POST_STATUS[k].hint}</span>
          </span>
        ))}
      </div>

      {open ? <DetailModal post={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
