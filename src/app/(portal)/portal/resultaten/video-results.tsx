"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ExternalLink, Play, Trophy } from "lucide-react";
import type { PortalVideo } from "@/server/portal";
import { PLATFORM } from "@/lib/statuses";
import { statsFor, type PlatformFilterValue, type VideoStats } from "./video-stats";

type SortKey = "views" | "interactions" | "likes" | "comments" | "shares" | "saves" | "date";
const SORTS: Array<{ k: SortKey; label: string }> = [
  { k: "views", label: "Weergaven" },
  { k: "interactions", label: "Interacties" },
  { k: "likes", label: "Likes" },
  { k: "comments", label: "Reacties" },
  { k: "shares", label: "Shares" },
  { k: "saves", label: "Opgeslagen" },
  { k: "date", label: "Nieuwste" },
];

const nf = new Intl.NumberFormat("nl-NL");
const fmt = (n: number) => nf.format(n);
const dateNl = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–";

function Thumb({ v, rank, onPlay }: { v: PortalVideo; rank: number | null; onPlay: () => void }) {
  return (
    <button type="button" onClick={onPlay} aria-label={`Speel af: ${v.title}`} className="group relative aspect-[9/16] w-14 shrink-0 overflow-hidden rounded-[10px] border border-[var(--sc-line)] bg-[var(--sc-fill-strong)] sm:w-16">
      {v.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
      ) : null}
      <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-white/90 text-[#00003b] shadow transition-transform group-hover:scale-110"><Play className="size-2.5 translate-x-px" fill="currentColor" /></span>
      {rank ? (
        <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--sc-cta)] text-[10px] font-bold text-[var(--sc-cta-ink)]">{rank}</span>
      ) : null}
    </button>
  );
}

function PlatformTag({ p }: { p: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
      <span className="size-2 shrink-0 rounded-full ring-1 ring-[var(--sc-line)]" style={{ background: PLATFORM[p]?.color ?? "#888" }} />
      {PLATFORM[p]?.label ?? p}
    </span>
  );
}

/**
 * Resultaten per video: elke video één keer (samengevoegd over de platforms),
 * met miniatuur, titel, datum, platforms en de belangrijkste cijfers direct
 * zichtbaar. Volgt de platformfilter van de pagina; sorteren op elke statistiek.
 * De top 3 (op weergaven) is gemarkeerd. Op mobiel als kaarten.
 */
export function VideoResults({ videos, platform, onPlay }: { videos: PortalVideo[]; platform: PlatformFilterValue; onPlay: (v: PortalVideo) => void }) {
  const [sort, setSort] = useState<SortKey>("views");

  const rows = useMemo(() => {
    const f = platform === "alle" ? videos : videos.filter((v) => v.platforms.some((p) => p.platform === platform));
    return f.map((v) => ({ v, s: statsFor(v, platform) }));
  }, [videos, platform]);
  const ranks = useMemo(() => {
    const m = new Map<string, number>();
    [...rows].sort((a, b) => b.s.views - a.s.views).slice(0, 3).forEach((r, i) => { if (r.s.views > 0) m.set(r.v.key, i + 1); });
    return m;
  }, [rows]);
  const hasShares = rows.some((r) => r.s.shares > 0);
  const hasSaves = rows.some((r) => r.s.saves > 0);

  const list = useMemo(() => {
    const val = (r: { v: PortalVideo; s: VideoStats }) => (sort === "date" ? Date.parse(r.v.publishedAt) : r.s[sort]);
    return [...rows].sort((a, b) => val(b) - val(a));
  }, [rows, sort]);

  const max = Math.max(1, ...list.map((r) => r.s.views));

  return (
    <section className="sc-glass overflow-hidden p-0">
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-tight">Resultaten per video</h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{list.length} video&apos;s in deze periode{platform !== "alle" ? ` op ${PLATFORM[platform]?.label ?? platform}` : ""} · top 3 op weergaven gemarkeerd · klik op een video om hem af te spelen</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
          <ArrowDown className="size-3.5" /> Sorteer op
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sc-input rounded-lg py-1.5 pl-2.5 pr-7 text-[13px] font-medium text-[var(--color-ink)]">
            {SORTS.filter((s) => (s.k !== "shares" || hasShares) && (s.k !== "saves" || hasSaves)).map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {/* Desktop: tabel */}
      <div className="mt-4 hidden max-h-[640px] overflow-auto md:block">
        <table className="w-full text-[13.5px]">
          <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
            <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
              <th className="px-5 py-2.5 font-semibold">Video</th>
              <th className="px-3 py-2.5 text-right font-semibold">Weergaven</th>
              <th className="px-3 py-2.5 text-right font-semibold">Likes</th>
              <th className="px-3 py-2.5 text-right font-semibold">Reacties</th>
              {hasShares ? <th className="px-3 py-2.5 text-right font-semibold">Shares</th> : null}
              {hasSaves ? <th className="px-3 py-2.5 text-right font-semibold">Opgeslagen</th> : null}
              <th className="px-3 py-2.5 text-right font-semibold" title="Interacties als percentage van de weergaven">Betrokkenheid</th>
              <th className="px-5 py-2.5 text-right font-semibold">Gem. kijktijd</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ v, s: st }) => {
              const rank = ranks.get(v.key) ?? null;
              const shown = platform === "alle" ? v.platforms : v.platforms.filter((p) => p.platform === platform);
              return (
                <tr key={v.key} className={`border-t border-[var(--sc-line)] ${rank ? "[background:color-mix(in_srgb,var(--st-green-bg)_55%,transparent)]" : ""}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3.5">
                      <Thumb v={v} rank={rank} onPlay={() => onPlay(v)} />
                      <div className="min-w-0">
                        <button type="button" onClick={() => onPlay(v)} className="line-clamp-2 max-w-[340px] text-left font-semibold leading-snug hover:underline">{v.title}</button>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          {shown.map((p) => <PlatformTag key={p.platform} p={p.platform} />)}
                          <span className="text-[12px] text-[var(--color-ink-faint)]">{dateNl(v.publishedAt)}</span>
                          {rank === 1 ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--st-green)]"><Trophy className="size-3.5" /> Best presterend</span> : null}
                          {st.url ? <a href={st.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--sc-accent)] hover:underline">Originele post <ExternalLink className="size-3" /></a> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right align-middle">
                    <div className="text-[15px] font-bold tabular-nums">{fmt(st.views)}</div>
                    <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-[var(--sc-fill-strong)]"><div className="h-full rounded-full bg-[var(--sc-accent)]" style={{ width: `${Math.round((st.views / max) * 100)}%` }} /></div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmt(st.likes)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmt(st.comments)}</td>
                  {hasShares ? <td className="px-3 py-3 text-right tabular-nums">{fmt(st.shares)}</td> : null}
                  {hasSaves ? <td className="px-3 py-3 text-right tabular-nums">{fmt(st.saves)}</td> : null}
                  <td className="px-3 py-3 text-right tabular-nums">{st.rate !== null ? `${st.rate.toLocaleString("nl-NL")}%` : "n.b."}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-[var(--color-ink-muted)]">{st.avgWatchSeconds ? `${st.avgWatchSeconds}s` : "n.b."}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobiel: kaarten met de cijfers direct zichtbaar */}
      <ul className="mt-3 flex flex-col divide-y divide-[var(--sc-line)] md:hidden">
        {list.map(({ v, s: st }) => {
          const rank = ranks.get(v.key) ?? null;
          const stats: Array<[string, string]> = [["Weergaven", fmt(st.views)], ["Likes", fmt(st.likes)], ["Reacties", fmt(st.comments)], ["Betrokkenheid", st.rate !== null ? `${st.rate.toLocaleString("nl-NL")}%` : "n.b."]];
          const shown = platform === "alle" ? v.platforms : v.platforms.filter((p) => p.platform === platform);
          return (
            <li key={v.key} className="flex gap-3 px-4 py-3.5">
              <Thumb v={v} rank={rank} onPlay={() => onPlay(v)} />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onPlay(v)} className="line-clamp-2 text-left text-[14px] font-semibold leading-snug">{v.title}</button>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5">{shown.map((p) => <PlatformTag key={p.platform} p={p.platform} />)}<span className="text-[12px] text-[var(--color-ink-faint)]">{dateNl(v.publishedAt)}</span></div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {stats.map(([l, n]) => (
                    <div key={l} className="min-w-0">
                      <div className="truncate text-[14px] font-bold tabular-nums">{n}</div>
                      <div className="truncate text-[10.5px] text-[var(--color-ink-faint)]">{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="h-4" />
    </section>
  );
}
