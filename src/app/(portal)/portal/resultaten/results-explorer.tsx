"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, LayoutGrid, Trophy } from "lucide-react";
import type { PortalPlatformDetail, PortalVideo } from "@/server/portal";
import { PlayerModal, type Playable } from "../mijlpalen/video-parts";
import { BestVideos } from "./best-videos";
import { PlatformView } from "./platform-view";
import { VideoResults } from "./video-results";
import { SectionHead } from "./section-head";
import { PlatformBadge } from "./platform-badge";
import { platLabel, playableFor, videosFor, type PlatformFilterValue } from "./video-stats";

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

  // Alle video's van de periode (niet beperkt): vier in beeld, de rest via de slider.
  const best = videosFor(videos, platform).filter((v) => v.platforms.length > 0);
  const play = (v: PortalVideo, p: PlatformFilterValue = platform) => setPlaying(playableFor(v, p));
  const current = platforms.find((p) => p.platform === platform);

  return (
    <>
      {/* Best presterende video's */}
      <section className="sc-glass p-5 sm:p-6">
        <SectionHead
          icon={Trophy}
          tone="green"
          eyebrow="Top van deze periode"
          title="Best presterende video's"
          sub={<>Gesorteerd op weergaven{platform !== "alle" ? ` op ${platLabel(platform)}` : " op alle platforms samen"}. Klik op een video om hem te bekijken.</>}
        >
          <PlatformFilter platforms={platforms} value={platform} onChange={setPlatform} />
        </SectionHead>
        <BestVideos videos={best} platform={platform} onPlay={(v) => play(v)} />
      </section>

      {/* Resultaten per platform */}
      <section>
        <SectionHead
          icon={LayoutGrid}
          tone="blue"
          eyebrow="Per kanaal"
          title="Resultaten per platform"
          sub={current ? `Alle cijfers van ${platLabel(current.platform)} in deze periode.` : "Hoe Instagram, TikTok, Facebook en YouTube ieder afzonderlijk presteren. Klik op een platform voor alle details."}
        />
        <PlatformView platforms={platforms} videos={videos} platform={platform} onSelect={setPlatform} onPlay={(v, p) => play(v, p)} />
      </section>

      {/* Resultaten per video */}
      {videos.length > 0 ? (
        <VideoResults videos={videos} platform={platform} onPlay={(v) => play(v)} />
      ) : (
        <section className="sc-glass p-5 sm:p-6">
          <SectionHead icon={Film} tone="accent" eyebrow="Per video" title="Resultaten per video" />
          <p className="text-[13.5px] text-[var(--color-ink-muted)]">Voor deze periode zijn (nog) geen cijfers per video beschikbaar via de gekoppelde kanalen. De totalen hierboven zijn wel compleet.</p>
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
    <div role="tablist" aria-label="Platform" className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
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
            {p.platform !== "alle" ? <PlatformBadge platform={p.platform} size={16} className={muted ? "opacity-50" : ""} /> : null}
            {p.platform === "alle" ? "Alle platformen" : platLabel(p.platform)}
          </button>
        );
      })}
    </div>
  );
}
