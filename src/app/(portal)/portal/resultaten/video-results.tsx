"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ExternalLink, Play, Trophy } from "lucide-react";
import type { PortalTopVideo } from "@/server/portal";
import { PLATFORM } from "@/lib/statuses";

type SortKey = "views" | "likes" | "comments" | "shares" | "saves" | "date";
const SORTS: Array<{ k: SortKey; label: string }> = [
  { k: "views", label: "Weergaven" },
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

function Thumb({ v, rank }: { v: PortalTopVideo; rank: number | null }) {
  return (
    <div className="relative aspect-[9/16] w-14 shrink-0 overflow-hidden rounded-[10px] border border-[var(--sc-line)] bg-[var(--sc-fill-strong)] sm:w-16">
      {v.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-[var(--color-ink-faint)]"><Play className="size-4" /></span>
      )}
      {rank ? (
        <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--sc-cta)] text-[10px] font-bold text-[var(--sc-cta-ink)]">{rank}</span>
      ) : null}
    </div>
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
 * Resultaten per video: elke video met miniatuur, titel, datum, platform en de
 * belangrijkste cijfers direct zichtbaar. Sorteren op elke statistiek en filteren
 * op platform; de top 3 (op weergaven) is gemarkeerd. Op mobiel als kaarten.
 */
export function VideoResults({ videos }: { videos: PortalTopVideo[] }) {
  const [sort, setSort] = useState<SortKey>("views");
  const [platform, setPlatform] = useState<string>("alle");

  const platforms = useMemo(() => [...new Set(videos.map((v) => v.platform))], [videos]);
  const ranks = useMemo(() => {
    const m = new Map<string, number>();
    [...videos].sort((a, b) => b.views - a.views).slice(0, 3).forEach((v, i) => { if (v.views > 0) m.set(v.id, i + 1); });
    return m;
  }, [videos]);
  const hasShares = videos.some((v) => v.shares > 0);
  const hasSaves = videos.some((v) => v.saves > 0);

  const list = useMemo(() => {
    const f = platform === "alle" ? videos : videos.filter((v) => v.platform === platform);
    const val = (v: PortalTopVideo) => (sort === "date" ? Date.parse(v.publishedAt ?? "1970-01-01") : v[sort]);
    return [...f].sort((a, b) => val(b) - val(a));
  }, [videos, platform, sort]);

  const max = Math.max(1, ...list.map((v) => v.views));

  return (
    <section className="sc-glass overflow-hidden p-0">
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-tight">Resultaten per video</h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{list.length} video&apos;s geplaatst in deze periode · top 3 op weergaven gemarkeerd</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
          <ArrowDown className="size-3.5" /> Sorteer op
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sc-input rounded-lg py-1.5 pl-2.5 pr-7 text-[13px] font-medium text-[var(--color-ink)]">
            {SORTS.filter((s) => (s.k !== "shares" || hasShares) && (s.k !== "saves" || hasSaves)).map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {platforms.length > 1 ? (
        <div className="flex flex-wrap gap-1.5 px-5 pt-3">
          {["alle", ...platforms].map((p) => {
            const active = p === platform;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${active ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "border border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
              >
                {p !== "alle" ? <span className="size-2 rounded-full ring-1 ring-white/30" style={{ background: PLATFORM[p]?.color ?? "#888" }} /> : null}
                {p === "alle" ? "Alle platforms" : PLATFORM[p]?.label ?? p}
              </button>
            );
          })}
        </div>
      ) : null}

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
              <th className="px-5 py-2.5 text-right font-semibold">Gem. kijktijd</th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => {
              const rank = ranks.get(v.id) ?? null;
              return (
                <tr key={v.id} className={`border-t border-[var(--sc-line)] ${rank ? "[background:color-mix(in_srgb,var(--st-green-bg)_55%,transparent)]" : ""}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3.5">
                      <Thumb v={v} rank={rank} />
                      <div className="min-w-0">
                        <div className="line-clamp-2 max-w-[340px] font-semibold leading-snug">{v.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <PlatformTag p={v.platform} />
                          {v.publishedAt ? <span className="text-[12px] text-[var(--color-ink-faint)]">{dateNl(v.publishedAt)}</span> : null}
                          {rank === 1 ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--st-green)]"><Trophy className="size-3.5" /> Best presterend</span> : null}
                          {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--sc-accent)] hover:underline">Bekijken <ExternalLink className="size-3" /></a> : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right align-middle">
                    <div className="text-[15px] font-bold tabular-nums">{fmt(v.views)}</div>
                    <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-[var(--sc-fill-strong)]"><div className="h-full rounded-full bg-[var(--sc-accent)]" style={{ width: `${Math.round((v.views / max) * 100)}%` }} /></div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmt(v.likes)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmt(v.comments)}</td>
                  {hasShares ? <td className="px-3 py-3 text-right tabular-nums">{fmt(v.shares)}</td> : null}
                  {hasSaves ? <td className="px-3 py-3 text-right tabular-nums">{fmt(v.saves)}</td> : null}
                  <td className="px-5 py-3 text-right tabular-nums text-[var(--color-ink-muted)]">{v.avgWatchSeconds ? `${v.avgWatchSeconds}s` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobiel: kaarten met de cijfers direct zichtbaar */}
      <ul className="mt-3 flex flex-col divide-y divide-[var(--sc-line)] md:hidden">
        {list.map((v) => {
          const rank = ranks.get(v.id) ?? null;
          const stats: Array<[string, number]> = [["Weergaven", v.views], ["Likes", v.likes], ["Reacties", v.comments]];
          if (hasShares) stats.push(["Shares", v.shares]);
          return (
            <li key={v.id} className="flex gap-3 px-4 py-3.5">
              <Thumb v={v} rank={rank} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[14px] font-semibold leading-snug">{v.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5"><PlatformTag p={v.platform} />{v.publishedAt ? <span className="text-[12px] text-[var(--color-ink-faint)]">{dateNl(v.publishedAt)}</span> : null}</div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {stats.map(([l, n]) => (
                    <div key={l}>
                      <div className="text-[14px] font-bold tabular-nums">{fmt(n)}</div>
                      <div className="text-[10.5px] text-[var(--color-ink-faint)]">{l}</div>
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
