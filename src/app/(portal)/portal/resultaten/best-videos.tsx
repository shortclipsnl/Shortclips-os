"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Heart, MessageCircle, Share2, Users } from "lucide-react";
import type { PortalVideo } from "@/server/portal";
import { VideoThumb } from "../mijlpalen/video-parts";
import { PlatformBadge } from "./platform-badge";
import { fmt, platLabel, shortDate, statsFor, type PlatformFilterValue } from "./video-stats";

/**
 * Slider met álle video's van de periode, gesorteerd op weergaven. Op desktop
 * staan er vier tegelijk in beeld; met de pijlen links en rechts (of swipen op
 * mobiel) scroll je verder. Klikken opent de video met zijn cijfers.
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
  const [pos, setPos] = useState({ start: true, end: true, progress: 0, ratio: 1 });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setPos({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft >= max - 4,
      progress: max > 0 ? el.scrollLeft / max : 0,
      ratio: el.scrollWidth > 0 ? Math.min(1, el.clientWidth / el.scrollWidth) : 1,
    });
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

  /** Eén "pagina" verder: zoveel kaarten als er in beeld passen. */
  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector("li");
    const step = card ? card.getBoundingClientRect().width + 16 : el.clientWidth * 0.8;
    const perView = Math.max(1, Math.floor((el.clientWidth + 16) / step));
    el.scrollBy({ left: dir * step * perView, behavior: "smooth" });
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

  const scrollable = pos.ratio < 0.999;

  return (
    <div>
      <div className="relative">
        <ol
          ref={track}
          onScroll={measure}
          aria-label="Best presterende video's"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); page(1); }
            if (e.key === "ArrowLeft") { e.preventDefault(); page(-1); }
          }}
          className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {videos.map((v, i) => {
            const s = statsFor(v, platform);
            const shown = platform === "alle" ? v.platforms : v.platforms.filter((p) => p.platform === platform);
            return (
              <li key={v.key} className="w-[74%] shrink-0 snap-start sm:w-[calc((100%-2rem)/2.5)] md:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                <button
                  type="button"
                  onClick={() => onPlay(v)}
                  aria-label={`Bekijk video: ${v.title}`}
                  className="group flex h-full w-full flex-col gap-3 rounded-[16px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-2 text-left shadow-[var(--shadow-card)] transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-raised)]"
                >
                  <span className="relative block">
                    <VideoThumb src={v.thumbUrl} rank={i + 1} big className="w-full" />
                    {/* Platform(s) waarop de video staat */}
                    <span className="absolute right-2 top-2 flex gap-1">
                      {shown.map((p) => <PlatformBadge key={p.platform} platform={p.platform} size={22} className="shadow-md ring-1 ring-white/70" />)}
                    </span>
                  </span>
                  <span className="flex flex-1 flex-col gap-2 px-1.5 pb-1">
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                      <Eye className="size-4 shrink-0 self-center text-[var(--sc-accent)]" />
                      <b className="text-[20px] font-bold tabular-nums tracking-tight sm:text-[22px]">{fmt(s.views)}</b>
                      <span className="text-[12px] text-[var(--color-ink-muted)]">weergaven</span>
                    </span>
                    <span className="line-clamp-2 min-h-[2.5em] text-[13px] font-medium leading-snug">{v.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--color-ink-muted)]">
                      {shown.map((p) => platLabel(p.platform)).join(" · ")}
                      <span className="text-[var(--color-ink-faint)]">{shortDate(v.publishedAt)}</span>
                    </span>
                    <span className="mt-auto grid grid-cols-3 gap-1 border-t border-[var(--sc-line)] pt-2.5 text-[12px]">
                      {s.reach > 0 ? <Mini icon={Users} label="Bereik" value={s.reach} /> : <Mini icon={Share2} label="Shares" value={s.shares} />}
                      <Mini icon={Heart} label="Likes" value={s.likes} />
                      <Mini icon={MessageCircle} label="Reacties" value={s.comments} />
                    </span>
                    {s.rate !== null ? (
                      <span className="self-start rounded-full bg-[var(--st-green-bg)] px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-[var(--st-green)]" title="Betrokkenheid: interacties als percentage van de weergaven">
                        {s.rate.toLocaleString("nl-NL")}% betrokkenheid
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Navigatiepijlen links en rechts */}
        {scrollable ? (
          <>
            <Arrow dir="left" disabled={pos.start} onClick={() => page(-1)} />
            <Arrow dir="right" disabled={pos.end} onClick={() => page(1)} />
          </>
        ) : null}
      </div>

      {/* Voortgang: laat zien dat er meer video's zijn (ook op mobiel) */}
      {scrollable ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-[var(--sc-fill-strong)]">
            <div
              className="absolute inset-y-0 rounded-full bg-[var(--sc-accent)] transition-[left] duration-150"
              style={{ width: `${pos.ratio * 100}%`, left: `${pos.progress * (1 - pos.ratio) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-[12px] text-[var(--color-ink-muted)]">{videos.length} video&apos;s · <span className="sm:hidden">swipe voor meer</span><span className="hidden sm:inline">gebruik de pijlen voor meer</span></span>
        </div>
      ) : null}
    </div>
  );
}

function Arrow({ dir, disabled, onClick }: { dir: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const Icon = dir === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "Vorige video's" : "Volgende video's"}
      className={`absolute top-[36%] z-10 size-11 place-items-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-raised)] transition-opacity disabled:pointer-events-none disabled:opacity-30 sm:size-12 ${
        dir === "left" ? "-left-2 sm:-left-5" : "-right-2 sm:-right-5"
      } hidden sm:grid`}
    >
      <Icon className="size-6" />
    </button>
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
