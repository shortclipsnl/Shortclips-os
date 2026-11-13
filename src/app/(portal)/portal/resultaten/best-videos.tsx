"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Heart, MessageCircle, Share2, Sparkles, Users } from "lucide-react";
import type { PortalVideo } from "@/server/portal";
import { VideoThumb } from "../mijlpalen/video-parts";
import { fmt, platColor, platLabel, shortDate, statsFor, type PlatformFilterValue } from "./video-stats";

/**
 * Horizontale carrousel met de best presterende video's van de periode.
 * Swipen op mobiel, pijlen op desktop; klikken speelt de video af.
 */
export function BestVideos({
  videos,
  platform,
  onPlay,
}: {
  videos: PortalVideo[];
  platform: PlatformFilterValue;
  onPlay: (v: PortalVideo) => void;
}) {
  const track = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: 0 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [videos, platform, measure]);

  const scrollBy = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" });
  };

  if (!videos.length) {
    return (
      <p className="rounded-[14px] border border-dashed border-[var(--sc-line)] px-4 py-8 text-center text-[13.5px] text-[var(--color-ink-muted)]">
        {platform === "alle"
          ? "Er zijn in deze periode nog geen video's met cijfers. Zodra er video's live staan, zie je ze hier automatisch."
          : `Er zijn in deze periode geen video's met cijfers op ${platLabel(platform)}.`}
      </p>
    );
  }

  return (
    <div className="relative">
      <ol
        ref={track}
        onScroll={measure}
        aria-label="Best presterende video's"
        className="-mx-1 flex snap-x snap-mandatory gap-3.5 overflow-x-auto scroll-smooth px-1 pb-3 [scrollbar-width:thin] sm:gap-4"
      >
        {videos.map((v, i) => {
          const s = statsFor(v, platform);
          const shownPlatforms = platform === "alle" ? v.platforms : v.platforms.filter((p) => p.platform === platform);
          return (
            <li key={v.key} className="w-[168px] shrink-0 snap-start sm:w-[200px] lg:w-[214px]">
              <button
                type="button"
                onClick={() => onPlay(v)}
                aria-label={`Speel af: ${v.title}`}
                className="group flex h-full w-full flex-col gap-2.5 rounded-[16px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-2 text-left shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-raised)]"
              >
                <VideoThumb src={v.thumbUrl} rank={i + 1} big className="w-full" />
                <span className="flex flex-1 flex-col gap-2 px-1 pb-1">
                  <span className="flex items-baseline gap-1.5">
                    <b className="text-[20px] font-bold tabular-nums tracking-tight">{fmt(s.views)}</b>
                    <span className="text-[12px] text-[var(--color-ink-muted)]">weergaven</span>
                  </span>
                  <span className="line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-snug">{v.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[var(--color-ink-muted)]">
                    {shownPlatforms.map((p) => (
                      <span key={p.platform} className="inline-flex items-center gap-1">
                        <span className="size-2 rounded-full ring-1 ring-[var(--sc-line)]" style={{ background: platColor(p.platform) }} />
                        {platLabel(p.platform)}
                      </span>
                    ))}
                    <span className="text-[var(--color-ink-faint)]">{shortDate(v.publishedAt)}</span>
                  </span>
                  <span className="grid grid-cols-3 gap-1 border-t border-[var(--sc-line)] pt-2 text-[12px]">
                    <Mini icon={Heart} label="Likes" value={s.likes} />
                    <Mini icon={MessageCircle} label="Reacties" value={s.comments} />
                    <Mini icon={Share2} label="Shares" value={s.shares} />
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-2 text-[12px]">
                    {s.reach > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[var(--color-ink-muted)]" title="Bereik: unieke accounts die de video zagen">
                        <Users className="size-3.5" /> {fmt(s.reach)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--color-ink-muted)]" title="Interacties: likes, reacties, shares en opgeslagen">
                        <Sparkles className="size-3.5" /> {fmt(s.interactions)}
                      </span>
                    )}
                    {s.rate !== null ? (
                      <span className="rounded-full bg-[var(--st-green-bg)] px-2 py-0.5 font-semibold tabular-nums text-[var(--st-green)]" title="Betrokkenheid: interacties als percentage van de weergaven">
                        {s.rate.toLocaleString("nl-NL")}%
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Pijlen (desktop); op touchschermen swipe je. */}
      {!edges.start ? (
        <button type="button" onClick={() => scrollBy(-1)} aria-label="Vorige video's" className="absolute -left-3 top-[38%] hidden size-10 place-items-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)] md:grid">
          <ChevronLeft className="size-5" />
        </button>
      ) : null}
      {!edges.end ? (
        <button type="button" onClick={() => scrollBy(1)} aria-label="Volgende video's" className="absolute -right-3 top-[38%] hidden size-10 place-items-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)] md:grid">
          <ChevronRight className="size-5" />
        </button>
      ) : null}
    </div>
  );
}

function Mini({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number }) {
  return (
    <span className="min-w-0" title={label}>
      <span className="flex items-center gap-1 font-semibold tabular-nums"><Icon className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />{fmt(value)}</span>
      <span className="block truncate text-[10.5px] text-[var(--color-ink-faint)]">{label}</span>
    </span>
  );
}
