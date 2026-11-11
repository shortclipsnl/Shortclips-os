"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Eye, Film, Heart, MessageCircle, Bookmark, Play, Users, X } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { compact, num } from "@/lib/format";
import { rankVideos, SORTS, type SortKey, type VideoCard } from "@/lib/resultaten-overzicht";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" });

function Thumb({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/40">
          <Film className="size-7" strokeWidth={1.5} />
          <span className="text-2xs">geen preview</span>
        </span>
      )}
    </>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between gap-1.5 whitespace-nowrap text-2xs" title={value === null ? `${label}: niet beschikbaar op dit platform` : label}>
      <span className="inline-flex items-center gap-1 text-[var(--color-ink-muted)]">
        <Icon className="size-3" strokeWidth={2} /> {label}
      </span>
      {value === null ? (
        <span className="text-[10.5px] text-[var(--color-ink-faint)]">Niet beschikbaar</span>
      ) : (
        <span className="font-semibold tabular-nums text-[var(--color-ink)]">{compact(value)}</span>
      )}
    </div>
  );
}

/**
 * Horizontaal scrollbare rij met de best presterende video's van de gekozen
 * periode. Rangschikking wisselt direct (weergaven, bereik, betrokkenheid);
 * klik op een video speelt hem af in het portaal via de officiële speler van
 * het platform.
 */
export function TopVideos({ cards, periodLabel }: { cards: VideoCard[]; periodLabel: string }) {
  const [sort, setSort] = useState<SortKey>("views");
  const [open, setOpen] = useState<VideoCard | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ranked = useMemo(() => rankVideos(cards, sort, 10), [cards, sort]);

  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const scrollBy = (dir: number) => scroller.current?.scrollBy({ left: dir * 640, behavior: "smooth" });

  return (
    <section className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Best presterende video&apos;s van deze periode</h2>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {periodLabel} · alle klanten · automatisch gerangschikt op de laatste meting
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border border-[var(--color-line-strong)] p-0.5" role="tablist" aria-label="Rangschikken op">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={sort === s.key}
                onClick={() => setSort(s.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${sort === s.key ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => scrollBy(-1)} aria-label="Naar links" className="hidden size-8 place-items-center rounded-full border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] sm:grid"><ChevronLeft className="size-4" /></button>
          <button type="button" onClick={() => scrollBy(1)} aria-label="Naar rechts" className="hidden size-8 place-items-center rounded-full border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] sm:grid"><ChevronRight className="size-4" /></button>
        </div>
      </div>

      {ranked.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
          Geen gepubliceerde video&apos;s met cijfers in deze periode.
        </p>
      ) : (
        <div ref={scroller} className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
          {ranked.map((v, i) => (
            <article key={v.id} className="flex w-[220px] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
              <button
                type="button"
                onClick={() => setOpen(v)}
                className="group relative aspect-[9/16] w-full overflow-hidden bg-[var(--color-indigo-ink)] text-left"
                aria-label={`Video van ${v.clientName} afspelen`}
              >
                <Thumb src={v.thumb} title={v.caption ?? v.clientName} />
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/25" />
                <span className={`absolute left-2 top-2 grid size-6 place-items-center rounded-full text-2xs font-bold ${i < 3 ? "bg-white text-[var(--color-indigo-ink)]" : "bg-black/45 text-white"}`}>{i + 1}</span>
                <span className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-2xs font-medium text-white">
                  {PLATFORM_LABEL[v.platform] ?? v.platform}
                  {v.alsoOn.length ? ` +${v.alsoOn.length}` : ""}
                </span>
                <span className="absolute bottom-2.5 left-2.5 grid size-9 place-items-center rounded-full bg-white/90 text-[var(--color-indigo-ink)] shadow-md transition-transform group-hover:scale-105">
                  <Play className="size-4 translate-x-px" fill="currentColor" />
                </span>
                <span className="absolute bottom-3 right-2.5 text-sm font-bold tabular-nums text-white drop-shadow">{compact(v.views)}</span>
              </button>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <Link href={`/analytics/${v.clientSlug}`} className="flex min-w-0 items-center gap-1.5 hover:underline" title={`Alle resultaten van ${v.clientName}`}>
                  <ClientLogo name={v.clientName} logoUrl={v.clientLogoUrl} color={v.clientColor} size={18} />
                  <span className="truncate text-xs font-semibold">{v.clientName}</span>
                </Link>
                <div className="flex flex-col gap-0.5">
                  <Stat icon={Eye} label="Weergaven" value={v.views} />
                  <Stat icon={Users} label="Bereik" value={v.reachValue} />
                  <Stat icon={Heart} label="Likes" value={v.likes} />
                  <Stat icon={MessageCircle} label="Reacties" value={v.comments} />
                  <Stat icon={Bookmark} label="Opgeslagen" value={v.savesValue} />
                </div>
                <div className="mt-auto pt-1 text-2xs text-[var(--color-ink-faint)]">{dateFmt.format(new Date(v.publishedAt))}</div>
              </div>
            </article>
          ))}
        </div>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={`Video van ${open.clientName}`}>
          <button type="button" aria-label="Sluiten" className="absolute inset-0" onClick={close} />
          <div className="relative z-10 flex w-full max-w-[380px] flex-col gap-3">
            <div className="flex items-center justify-between gap-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{open.clientName}</p>
                <p className="text-xs text-white/60">
                  {PLATFORM_LABEL[open.platform]} · {dateFmt.format(new Date(open.publishedAt))} · {num(open.views)} weergaven
                </p>
              </div>
              <button type="button" onClick={close} aria-label="Sluiten" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-5" /></button>
            </div>
            {open.embedUrl ? (
              <div className="relative aspect-[9/16] max-h-[76vh] w-full overflow-hidden rounded-[14px] bg-black">
                <iframe
                  key={open.id}
                  src={open.embedUrl}
                  title={`Video van ${open.clientName}`}
                  className="absolute inset-0 size-full border-0"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            ) : (
              <p className="rounded-[10px] bg-white/10 px-3 py-6 text-center text-sm text-white/90">Deze video kan niet in het portaal worden afgespeeld.</p>
            )}
            {open.url ? (
              <a href={open.url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 text-xs text-white/70 hover:text-white">
                <ExternalLink className="size-3.5" /> Open op {PLATFORM_LABEL[open.platform]}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
