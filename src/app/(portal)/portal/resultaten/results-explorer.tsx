"use client";

import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import type { PortalPlatformDetail, PortalVideo } from "@/server/portal";
import { PlayerModal, type Playable } from "../mijlpalen/video-parts";
import { BestVideos } from "./best-videos";
import { PlatformView } from "./platform-view";
import { VideoResults } from "./video-results";
import { platColor, platLabel, playableFor, videosFor, type PlatformFilterValue } from "./video-stats";

/**
 * De drie videosecties van de resultatenpagina met één gedeelde platformfilter:
 * best presterende video's → resultaten per platform → resultaten per video.
 * De filter staat in de URL (?platform=), zodat hij samen met de periode werkt
 * en bewaard blijft bij het wisselen van periode.
 */
export function ResultsExplorer({
  videos,
  platforms,
  initialPlatform,
}: {
  videos: PortalVideo[];
  platforms: PortalPlatformDetail[];
  initialPlatform: string;
}) {
  const keys = platforms.map((p) => p.platform);
  const [platform, setPlatformState] = useState<PlatformFilterValue>(keys.includes(initialPlatform) ? initialPlatform : "alle");
  const [playing, setPlaying] = useState<Playable | null>(null);

  const setPlatform = useCallback((p: PlatformFilterValue) => {
    setPlatformState(p);
    try {
      const url = new URL(window.location.href);
      if (p === "alle") url.searchParams.delete("platform");
      else url.searchParams.set("platform", p);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* geen URL-ondersteuning: filter werkt alleen op de pagina */
    }
  }, []);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPlaying(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  const best = videosFor(videos, platform).filter((v) => v.platforms.length > 0).slice(0, 20);
  const play = (v: PortalVideo, p: PlatformFilterValue = platform) => setPlaying(playableFor(v, p));
  const current = platforms.find((p) => p.platform === platform);

  return (
    <>
      {/* Best presterende video's */}
      <section className="sc-glass p-5 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-[var(--st-green-bg)] text-[var(--st-green)]"><Trophy className="size-4" /></span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Top van deze periode</span>
            </div>
            <h2 className="mt-1.5 text-[22px] font-bold tracking-tight">Best presterende video&apos;s van deze periode</h2>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
              Gesorteerd op weergaven{platform !== "alle" ? ` op ${platLabel(platform)}` : " op alle platforms samen"}. Elke video staat er één keer in, ook als hij op meerdere platforms staat. Klik om af te spelen.
            </p>
          </div>
          <PlatformFilter platforms={platforms} value={platform} onChange={setPlatform} />
        </div>
        <BestVideos videos={best} platform={platform} onPlay={(v) => play(v)} />
      </section>

      {/* Resultaten per platform */}
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[20px] font-bold tracking-tight">Resultaten per platform</h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
              {current ? `Alle cijfers van ${platLabel(current.platform)} in deze periode.` : "Kies een platform voor alle cijfers, de groei en de beste video's."}
            </p>
          </div>
          <PlatformFilter platforms={platforms} value={platform} onChange={setPlatform} />
        </div>
        <PlatformView platforms={platforms} videos={videos} platform={platform} onSelect={setPlatform} onPlay={(v, p) => play(v, p)} />
      </section>

      {/* Resultaten per video */}
      {videos.length > 0 ? (
        <VideoResults videos={videos} platform={platform} onPlay={(v) => play(v)} />
      ) : (
        <section className="sc-glass p-5 text-[13.5px] text-[var(--color-ink-muted)]">
          <span className="font-semibold text-[var(--color-ink)]">Resultaten per video</span> · voor deze periode zijn (nog) geen cijfers per video beschikbaar via de gekoppelde kanalen. De totalen hierboven zijn wel compleet.
        </section>
      )}

      {playing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(0,0,20,0.75)] p-2.5 backdrop-blur-sm sm:p-6" onClick={(e) => e.target === e.currentTarget && setPlaying(null)}>
          <PlayerModal key={playing.playSrc ?? playing.embedSrc ?? playing.title} p={playing} onClose={() => setPlaying(null)} />
        </div>
      ) : null}
    </>
  );
}

/** Alle platformen | Instagram | TikTok | YouTube | Facebook */
function PlatformFilter({ platforms, value, onChange }: { platforms: PortalPlatformDetail[]; value: string; onChange: (p: string) => void }) {
  return (
    <div role="tablist" aria-label="Platform" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5">
      {[{ platform: "alle", state: "data" as const }, ...platforms].map((p) => {
        const active = p.platform === value;
        const muted = p.state !== "data";
        return (
          <button
            key={p.platform}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(p.platform)}
            title={p.state === "niet-gekoppeld" ? "Nog niet gekoppeld" : p.state === "stil" ? "Geen activiteit in deze periode" : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              active
                ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]"
                : `border border-[var(--sc-line)] bg-[var(--color-surface)] hover:text-[var(--color-ink)] ${muted ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink-muted)]"}`
            }`}
          >
            {p.platform !== "alle" ? <span className="size-2 rounded-full ring-1 ring-white/40" style={{ background: platColor(p.platform) }} /> : null}
            {p.platform === "alle" ? "Alle platformen" : platLabel(p.platform)}
          </button>
        );
      })}
    </div>
  );
}
