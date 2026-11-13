"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Film, Play, X } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { compact, num } from "@/lib/format";
import {
  formatCategoryValue, rankByCategory, TOP_CATEGORIES, type TopCategory, type VideoCard,
} from "@/lib/resultaten-overzicht";
import { VideoPlayer } from "./video-player";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" });
const nl1 = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });

function Thumb({ v }: { v: VideoCard }) {
  const [failed, setFailed] = useState(false);
  const src = v.thumb ?? (v.assetId ? `/api/portal/frame/${v.assetId}/thumb` : null);
  return src && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
  ) : (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/40">
      <Film className="size-7" strokeWidth={1.5} />
      <span className="text-2xs">geen preview</span>
    </span>
  );
}

/** Alle cijfers van een video. Ontbreekt een cijfer, dan staat er "Niet beschikbaar". */
export function videoStats(v: VideoCard): { label: string; value: string | null }[] {
  return [
    { label: "Weergaven", value: compact(v.views) },
    { label: "Gem. kijktijd", value: v.avgWatchSeconds ? `${nl1(v.avgWatchSeconds)} sec` : null },
    { label: "Retentie", value: v.retention != null ? `${Math.round(v.retention * 100)}%` : null },
    { label: "Interacties", value: compact(v.engagement) },
    { label: "Engagement", value: v.engagementRate != null ? `${nl1(v.engagementRate * 100)}%` : null },
    { label: "Bereik", value: v.reachValue != null ? compact(v.reachValue) : null },
  ];
}

function StatGrid({ v, dense = true }: { v: VideoCard; dense?: boolean }) {
  return (
    <dl className={`grid grid-cols-2 ${dense ? "gap-x-3 gap-y-1" : "gap-x-5 gap-y-3"}`}>
      {videoStats(v).map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="truncate text-[10.5px] text-[var(--color-ink-faint)]">{s.label}</dt>
          <dd className={`${dense ? "text-xs" : "text-base"} font-semibold tabular-nums ${s.value === null ? "font-normal text-[var(--color-ink-faint)]" : ""}`}>
            {s.value ?? <span className={dense ? "text-[10.5px]" : "text-xs"}>Niet beschikbaar</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Best presterende video's van deze periode": zeven rangschikkingen, direct te
 * wisselen. Een categorie toont alleen video's waarvoor dat cijfer echt bestaat.
 * Klik op een video om hem af te spelen met alle cijfers ernaast.
 */
export function TopVideos({ cards, periodLabel }: { cards: VideoCard[]; periodLabel: string }) {
  const [cat, setCat] = useState<TopCategory>("totaal");
  const [open, setOpen] = useState<VideoCard | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ranked = useMemo(() => rankByCategory(cards, cat, 12), [cards, cat]);
  const counts = useMemo(
    () => Object.fromEntries(TOP_CATEGORIES.map((c) => [c.key, rankByCategory(cards, c.key, 12).length])) as Record<TopCategory, number>,
    [cards],
  );
  const meta = TOP_CATEGORIES.find((c) => c.key === cat)!;

  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  useEffect(() => { scroller.current?.scrollTo({ left: 0 }); }, [cat]);

  const scrollBy = (dir: number) => scroller.current?.scrollBy({ left: dir * 640, behavior: "smooth" });
  const showHook = cat === "hooks" || cat === "totaal";

  return (
    <section className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Best presterende video&apos;s van deze periode</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">{periodLabel} · alle klanten · laatste meting</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => scrollBy(-1)} aria-label="Naar links" className="hidden size-8 place-items-center rounded-full border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] sm:grid"><ChevronLeft className="size-4" /></button>
          <button type="button" onClick={() => scrollBy(1)} aria-label="Naar rechts" className="hidden size-8 place-items-center rounded-full border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] sm:grid"><ChevronRight className="size-4" /></button>
        </div>
      </div>

      <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Rangschikken op">
        {TOP_CATEGORIES.map((c, i) => {
          const active = c.key === cat;
          const empty = counts[c.key] === 0;
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCat(c.key)}
              title={empty ? "Geen video's met dit cijfer in deze periode" : c.explain}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-[var(--color-indigo-ink)] text-white"
                  : `border border-[var(--color-line-strong)] ${empty ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink-muted)] hover:border-[var(--color-indigo-ink)] hover:text-[var(--color-ink)]"}`
              }`}
            >
              <span className={`tabular-nums ${active ? "text-white/60" : "text-[var(--color-ink-faint)]"}`}>{i + 1}</span>
              {c.label}
            </button>
          );
        })}
      </div>
      <p className="mb-3 text-2xs text-[var(--color-ink-muted)]">{meta.explain}</p>

      {ranked.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
          Geen video&apos;s met dit cijfer in deze periode. De platforms leveren het (nog) niet voor de video&apos;s uit deze periode.
        </p>
      ) : (
        <div ref={scroller} className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
          {ranked.map((v, i) => {
            const big = formatCategoryValue(v, cat);
            return (
              <article key={v.id} className="flex w-[228px] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] transition hover:shadow-[var(--shadow-raised)]">
                <button
                  type="button"
                  onClick={() => setOpen(v)}
                  className="group relative aspect-[9/16] w-full overflow-hidden bg-[var(--color-indigo-ink)] text-left"
                  aria-label={`Video van ${v.clientName} afspelen`}
                >
                  <Thumb v={v} />
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-black/30" />
                  <span className={`absolute left-2 top-2 grid size-7 place-items-center rounded-full text-xs font-bold ${i < 3 ? "bg-white text-[var(--color-indigo-ink)]" : "bg-black/50 text-white"}`}>{i + 1}</span>
                  <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-2xs font-medium text-white">
                    {PLATFORM_LABEL[v.platform] ?? v.platform}{v.alsoOn.length ? ` +${v.alsoOn.length}` : ""}
                  </span>
                  <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[var(--color-indigo-ink)] opacity-0 shadow-lg transition group-hover:opacity-100">
                    <Play className="size-5 translate-x-px" fill="currentColor" />
                  </span>
                  {big ? (
                    <span className="absolute inset-x-3 bottom-3 text-white">
                      <span className="block text-2xl font-bold leading-none tabular-nums drop-shadow">{big.value}</span>
                      <span className="mt-1 block text-2xs font-medium uppercase tracking-wide text-white/75">{big.unit}</span>
                    </span>
                  ) : null}
                </button>
                <div className="flex flex-1 flex-col gap-2 p-2.5">
                  <Link href={`/analytics/${v.clientSlug}`} className="flex min-w-0 items-center gap-1.5 hover:underline" title={`Alle resultaten van ${v.clientName}`}>
                    <ClientLogo name={v.clientName} logoUrl={v.clientLogoUrl} color={v.clientColor} size={20} />
                    <span className="truncate text-xs font-semibold">{v.clientName}</span>
                  </Link>
                  {showHook && v.hook ? (
                    <p className="line-clamp-2 text-xs leading-snug text-[var(--color-ink)]" title={v.hook}>&ldquo;{v.hook}&rdquo;</p>
                  ) : null}
                  <StatGrid v={v} />
                  <div className="mt-auto pt-1 text-2xs text-[var(--color-ink-faint)]">{dateFmt.format(new Date(v.publishedAt))}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label={`Video van ${open.clientName}`}>
          <button type="button" aria-label="Sluiten" className="absolute inset-0" onClick={close} />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-[820px] flex-col gap-4 overflow-auto rounded-[16px] bg-[var(--color-surface)] p-4 sm:flex-row">
            <div className="relative mx-auto aspect-[9/16] h-[78vh] max-h-[680px] shrink-0 overflow-hidden rounded-[12px] bg-black sm:mx-0">
              <VideoPlayer v={open} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <ClientLogo name={open.clientName} logoUrl={open.clientLogoUrl} color={open.clientColor} size={36} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{open.clientName}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {PLATFORM_LABEL[open.platform]}{open.alsoOn.length ? ` + ${open.alsoOn.map((p) => PLATFORM_LABEL[p]).join(", ")}` : ""} · {dateFmt.format(new Date(open.publishedAt))}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={close} aria-label="Sluiten" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-line)] hover:bg-[var(--color-line-strong)]"><X className="size-4" /></button>
              </div>
              {open.hook ? (
                <div>
                  <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Hook</div>
                  <p className="mt-1 text-base font-semibold leading-snug">&ldquo;{open.hook}&rdquo;</p>
                  {open.hookScore != null ? (
                    <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{nl1(open.hookScore)}× de normale weergaven van {open.clientName} op {PLATFORM_LABEL[open.platform]}</p>
                  ) : null}
                </div>
              ) : null}
              <StatGrid v={open} dense={false} />
              <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-line)] pt-3 text-xs">
                <div><div className="text-[10.5px] text-[var(--color-ink-faint)]">Likes</div><div className="font-semibold tabular-nums">{num(open.likes)}</div></div>
                <div><div className="text-[10.5px] text-[var(--color-ink-faint)]">Reacties</div><div className="font-semibold tabular-nums">{num(open.comments)}</div></div>
                <div><div className="text-[10.5px] text-[var(--color-ink-faint)]">Opgeslagen</div><div className="font-semibold tabular-nums">{open.savesValue == null ? <span className="font-normal text-[var(--color-ink-faint)]">n.v.t.</span> : num(open.savesValue)}</div></div>
              </div>
              {open.totalScore != null ? (
                <p className="text-xs text-[var(--color-ink-muted)]">Totaalscore deze periode: <span className="font-semibold text-[var(--color-ink)]">{open.totalScore}/100</span></p>
              ) : null}
              <div className="mt-auto flex flex-wrap gap-3 text-xs">
                {open.url ? (
                  <a href={open.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                    <ExternalLink className="size-3.5" /> Open op {PLATFORM_LABEL[open.platform]}
                  </a>
                ) : null}
                <Link href={`/analytics/${open.clientSlug}`} className="inline-flex items-center gap-1.5 font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                  Alle resultaten van {open.clientName}
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
