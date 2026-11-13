"use client";

import { ArrowDownRight, ArrowUpRight, Crown, Info, Link2Off } from "lucide-react";
import type { PortalPlatformDetail, PortalVideo } from "@/server/portal";
import { VideoThumb } from "../mijlpalen/video-parts";
import { fmt, platColor, platLabel, statsFor, videosFor, type PlatformFilterValue } from "./video-stats";

function Growth({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  if (pct === 0) return <span className="text-[11.5px] text-[var(--color-ink-faint)]">gelijk aan vorige periode</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11.5px] font-semibold ${up ? "text-[var(--st-green)]" : "text-[var(--st-red)]"}`}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(pct)}% <span className="font-normal text-[var(--color-ink-faint)]">t.o.v. vorige periode</span>
    </span>
  );
}

/** Eén cijfer; null = het platform levert dit niet via de koppeling. */
function Stat({ label, value, prefix = "", suffix = "", growth, platform, hint }: { label: string; value: number | null; prefix?: string; suffix?: string; growth?: number | null; platform: string; hint?: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3.5 py-3">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
        {hint ? <span title={hint} className="text-[var(--color-ink-faint)]"><Info className="size-3" /></span> : null}
      </div>
      {value === null ? (
        <div className="mt-1 text-[13px] text-[var(--color-ink-faint)]" title={`${platLabel(platform)} levert dit cijfer niet via de koppeling.`}>Niet beschikbaar</div>
      ) : (
        <div className="mt-0.5 text-[22px] font-bold tabular-nums leading-tight">{prefix}{typeof value === "number" ? value.toLocaleString("nl-NL") : value}{suffix}</div>
      )}
      {growth !== undefined ? <div className="mt-1"><Growth pct={growth} /></div> : null}
    </div>
  );
}

function Dot({ platform, size = "size-2.5" }: { platform: string; size?: string }) {
  return <span className={`${size} shrink-0 rounded-full ring-1 ring-[var(--sc-line)]`} style={{ background: platColor(platform) }} />;
}

/**
 * Resultaten per platform: altijd Instagram, TikTok, YouTube Shorts en
 * Facebook. "Alle platformen" toont ze naast elkaar; een platform kiezen toont
 * alle cijfers, de groei en de beste video's van dat platform. Ontbrekende
 * cijfers staan er eerlijk als "niet beschikbaar".
 */
export function PlatformView({
  platforms,
  videos,
  platform,
  onSelect,
  onPlay,
}: {
  platforms: PortalPlatformDetail[];
  videos: PortalVideo[];
  platform: PlatformFilterValue;
  onSelect: (p: string) => void;
  onPlay: (v: PortalVideo, platform: string) => void;
}) {
  const current = platform === "alle" ? null : platforms.find((p) => p.platform === platform) ?? null;
  const best = [...platforms].filter((p) => (p.views ?? 0) > 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0]?.platform ?? null;

  if (!current) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {platforms.map((p) => (
          <button
            key={p.platform}
            type="button"
            onClick={() => onSelect(p.platform)}
            className="sc-glass flex flex-col gap-3 p-4 text-left transition-shadow hover:shadow-[var(--shadow-raised)]"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[15px] font-semibold"><Dot platform={p.platform} /> {label(p.platform)}</span>
              {best === p.platform && platforms.filter((x) => (x.views ?? 0) > 0).length > 1 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--st-green-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--st-green)]"><Crown className="size-3" /> Meeste weergaven</span>
              ) : null}
            </span>
            {p.state === "data" ? (
              <>
                <span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Weergaven</span>
                  <span className="block text-[26px] font-bold tabular-nums leading-tight">{p.views === null ? "Niet beschikbaar" : fmt(p.views)}</span>
                  <Growth pct={p.growth.views} />
                </span>
                <span className="grid grid-cols-3 gap-2 border-t border-[var(--sc-line)] pt-3 text-[12px]">
                  <Cell l="Interacties" v={p.interactions} />
                  <Cell l="Betrokkenheid" v={p.engagementRate} suffix="%" />
                  <Cell l="Video's" v={p.videoCount} />
                </span>
              </>
            ) : (
              <EmptyState p={p} compact />
            )}
          </button>
        ))}
      </div>
    );
  }

  const top = videosFor(videos, current.platform).slice(0, 6);
  return (
    <div className="sc-glass p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[17px] font-bold"><Dot platform={current.platform} size="size-3" /> {label(current.platform)}</span>
        {current.state === "data" && current.videoCount > 0 ? (
          <span className="text-[12.5px] text-[var(--color-ink-muted)]">{current.videoCount} video{current.videoCount === 1 ? "" : "'s"} geplaatst in deze periode</span>
        ) : null}
      </div>

      {current.state !== "data" ? (
        <div className="mt-4"><EmptyState p={current} /></div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            <Stat platform={current.platform} label="Weergaven" value={current.views} growth={current.growth.views}
              hint={current.viewsFrom === "video" ? `${label(current.platform)} levert geen dagcijfers voor het hele account; dit is de som van de video's die in deze periode geplaatst zijn.` : undefined} />
            <Stat platform={current.platform} label="Bereik" value={current.reach} hint="Unieke accounts die je content zagen." />
            <Stat platform={current.platform} label="Likes" value={current.likes} />
            <Stat platform={current.platform} label="Reacties" value={current.comments} />
            <Stat platform={current.platform} label="Shares" value={current.shares} />
            <Stat platform={current.platform} label="Interacties" value={current.interactions} growth={current.growth.interactions} hint="Likes, reacties, shares en opgeslagen samen." />
            <Stat platform={current.platform} label="Betrokkenheid" value={current.engagementRate} suffix="%" hint="Interacties als percentage van de weergaven." />
            <Stat platform={current.platform} label="Nieuwe volgers" value={current.followerGrowth} prefix={current.followerGrowth && current.followerGrowth > 0 ? "+" : ""} />
          </div>
          {current.growth.views === null && current.viewsFrom === "kanaal" && current.prev.views === null ? (
            <p className="mt-2.5 text-[12px] text-[var(--color-ink-faint)]">Groei tonen we zodra er over de hele vorige periode cijfers zijn.</p>
          ) : null}

          <div className="mt-5">
            <h3 className="text-[14px] font-semibold">Best presterende video&apos;s op {label(current.platform)}</h3>
            {top.length ? (
              <ol className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
                {top.map((v, i) => {
                  const s = statsFor(v, current.platform);
                  return (
                    <li key={v.key}>
                      <button type="button" onClick={() => onPlay(v, current.platform)} className="group flex w-full flex-col gap-1.5 text-left" aria-label={`Speel af: ${v.title}`}>
                        <VideoThumb src={v.thumbUrl} rank={i + 1} className="w-full" />
                        <span className="text-[13px] font-bold tabular-nums">{fmt(s.views)} <span className="font-normal text-[var(--color-ink-muted)]">weergaven</span></span>
                        <span className="line-clamp-2 text-[12px] leading-snug text-[var(--color-ink-muted)]">{v.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">In deze periode zijn er op {label(current.platform)} geen video&apos;s met cijfers.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const label = (p: string) => (p === "youtube" ? "YouTube Shorts" : platLabel(p));

function Cell({ l, v, suffix = "" }: { l: string; v: number | null; suffix?: string }) {
  return (
    <span className="min-w-0">
      <b className="block truncate tabular-nums">{v === null ? "n.b." : `${v.toLocaleString("nl-NL")}${suffix}`}</b>
      <span className="block truncate text-[10.5px] text-[var(--color-ink-faint)]">{l}</span>
    </span>
  );
}

function EmptyState({ p, compact = false }: { p: PortalPlatformDetail; compact?: boolean }) {
  const text =
    p.state === "niet-gekoppeld"
      ? `De cijfers van ${label(p.platform)} zijn nog niet gekoppeld. Zodra de koppeling actief is, verschijnen ze hier automatisch.`
      : `Geen geplaatste video's of activiteit op ${label(p.platform)} in deze periode.`;
  return (
    <span className={`flex items-start gap-2 rounded-[12px] border border-dashed border-[var(--sc-line)] text-[var(--color-ink-muted)] ${compact ? "p-3 text-[12.5px]" : "p-4 text-[13.5px]"}`}>
      <Link2Off className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)]" />
      {text}
    </span>
  );
}
