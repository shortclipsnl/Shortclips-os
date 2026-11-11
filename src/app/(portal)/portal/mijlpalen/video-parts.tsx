"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ExternalLink, Eye, Film, Heart, MessageCircle, Play, Share2, Trophy, X } from "lucide-react";
import { PLATFORM } from "@/lib/statuses";
import { longDateNl, type LibraryVideo, type MilestoneVideo } from "@/lib/milestones";

const nf = new Intl.NumberFormat("nl-NL");
const fmt = (n: number) => nf.format(n);
const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const platLabel = (p: string) => PLATFORM[p]?.label ?? p.charAt(0).toUpperCase() + p.slice(1);

/** Wat de speler nodig heeft; een video met cijfers of een video uit de bibliotheek. */
export type Playable = {
  title: string;
  playSrc: string | null;
  embedSrc: string | null;
  externalUrl: string | null;
  poster: string | null;
  publishedAt: string | null;
  stats: MilestoneVideo | null;
};

export function playableFromVideo(v: MilestoneVideo): Playable {
  return { title: v.title, playSrc: v.playSrc, embedSrc: v.embedSrc, externalUrl: v.externalUrl, poster: v.thumbUrl, publishedAt: v.publishedAt, stats: v };
}
export function playableFromLibrary(l: LibraryVideo, stats: MilestoneVideo | null): Playable {
  return {
    title: l.title,
    playSrc: `/api/portal/frame/${l.id}/play`,
    embedSrc: null,
    externalUrl: stats?.externalUrl ?? null,
    poster: `/api/portal/frame/${l.id}/thumb`,
    publishedAt: stats?.publishedAt ?? l.publishedAt,
    stats,
  };
}

/* ---------- Bouwstenen ---------- */

export function PlatformDots({ platforms }: { platforms: MilestoneVideo["platforms"] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {platforms.map((p) => (
        <span key={p.platform} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
          <span className="size-2 shrink-0 rounded-full ring-1 ring-[var(--sc-line)]" style={{ background: PLATFORM[p.platform]?.color ?? "#888" }} />
          {platLabel(p.platform)}
        </span>
      ))}
    </span>
  );
}

export function VideoThumb({ src, rank, className = "", big = false }: { src: string | null; rank?: number; className?: string; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`relative block aspect-[9/16] overflow-hidden rounded-[12px] border border-[var(--sc-line)] bg-[linear-gradient(160deg,#1a1f66,#00003b)] ${className}`}>
      <span className="absolute inset-0 grid place-items-center text-white/35"><Film className="size-5" strokeWidth={1.5} /></span>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      ) : null}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
      <span className={`absolute grid place-items-center rounded-full bg-white/90 text-[#00003b] shadow-md transition-transform group-hover:scale-110 ${big ? "bottom-3 left-3 size-10" : "bottom-1.5 left-1.5 size-6"}`}>
        <Play className={big ? "size-4 translate-x-px" : "size-3 translate-x-px"} fill="currentColor" />
      </span>
      {rank ? (
        <span className={`absolute left-2 top-2 grid place-items-center rounded-full bg-[#00003b] font-bold text-white shadow ${big ? "size-8 text-[14px]" : "size-5 text-[10px]"}`}>{rank}</span>
      ) : null}
    </span>
  );
}

function StatLine({ v }: { v: MilestoneVideo }) {
  const items: Array<[typeof Eye, string, number]> = [
    [Heart, "Likes", v.likes],
    [MessageCircle, "Reacties", v.comments],
    [Share2, "Shares", v.shares],
  ];
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--color-ink-muted)]">
      {items.map(([Icon, l, n]) => (
        <span key={l} className="inline-flex items-center gap-1 tabular-nums" title={l}><Icon className="size-3.5" /> {fmt(n)}</span>
      ))}
    </span>
  );
}

/* ---------- Top 6 ---------- */

type Period = "altijd" | "jaar" | "90" | "30";
const PERIODS: Array<[Period, string]> = [["altijd", "Altijd"], ["jaar", "Dit jaar"], ["90", "Laatste 90 dagen"], ["30", "Laatste 30 dagen"]];

function inPeriod(iso: string, p: Period): boolean {
  if (p === "altijd") return true;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  if (p === "jaar") return iso.slice(0, 4) === today.slice(0, 4);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - (Number(p) - 1) * 86_400_000).toISOString().slice(0, 10);
  return iso >= from;
}

export function TopSix({ videos, onPlay }: { videos: MilestoneVideo[]; onPlay: (p: Playable) => void }) {
  const [period, setPeriod] = useState<Period>("altijd");
  const top = useMemo(() => videos.filter((v) => v.views > 0 && inPeriod(v.publishedAt, period)).slice(0, 6), [videos, period]);
  return (
    <section className="sc-glass p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight">Jouw 6 best presterende video&apos;s</h2>
          <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">Op weergaven, van video&apos;s die in de gekozen periode zijn gepubliceerd. Klik om af te spelen.</p>
        </div>
        <div role="tablist" aria-label="Periode" className="flex w-full flex-wrap gap-1 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1 sm:w-auto">
          {PERIODS.map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={period === k} onClick={() => setPeriod(k)}
              className={`flex-1 rounded-[9px] px-3 py-1.5 text-[12.5px] font-medium transition-colors sm:flex-none ${period === k ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)]" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {top.length ? (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
          {top.map((v, i) => (
            <li key={v.key}>
              <button type="button" onClick={() => onPlay(playableFromVideo(v))} className="group flex w-full flex-col gap-2.5 text-left" aria-label={`Speel af: ${v.title}`}>
                <VideoThumb src={v.thumbUrl} rank={i + 1} big className="w-full" />
                <span>
                  <span className="flex items-baseline gap-1.5"><b className="text-[19px] font-bold tabular-nums tracking-tight">{fmt(v.views)}</b><span className="text-[12px] text-[var(--color-ink-muted)]">views</span></span>
                  <span className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug">{v.title}</span>
                </span>
                <StatLine v={v} />
                <span className="flex items-center justify-between gap-2 border-t border-[var(--sc-line)] pt-2 text-[12px]">
                  <span className="text-[var(--color-ink-muted)]">Interacties</span>
                  <b className="font-semibold tabular-nums">{fmt(v.interactions)}</b>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-[12px] border border-dashed border-[var(--sc-line)] px-4 py-6 text-center text-[13.5px] text-[var(--color-ink-muted)]">Geen video&apos;s met cijfers in deze periode.</p>
      )}
    </section>
  );
}

/* ---------- Vensters ---------- */

function Shell({ title, sub, onClose, children, wide = true }: { title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className={`ms-pop relative flex max-h-full w-full flex-col overflow-hidden rounded-[22px] border border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-pop)] ${wide ? "max-w-[920px]" : "max-w-[560px]"}`}>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--sc-line)] px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold tracking-tight">{title}</h2>
          {sub ? <div className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{sub}</div> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Sluiten" autoFocus className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)]"><X className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

type SortKey = "views" | "interactions" | "date";

/** Rij met video, platform, datum en alle cijfers; klikken speelt af. */
function VideoRow({ v, onPlay, bar, rank }: { v: MilestoneVideo; onPlay: () => void; bar?: number; rank?: number }) {
  const cells: Array<[string, number]> = [["Weergaven", v.views], ["Likes", v.likes], ["Reacties", v.comments], ["Shares", v.shares], ["Interacties", v.interactions]];
  return (
    <li>
      <button type="button" onClick={onPlay} className="group flex w-full gap-3.5 px-5 py-3 text-left transition-colors hover:bg-[var(--sc-fill)] sm:px-6">
        <VideoThumb src={v.thumbUrl} rank={rank} className="w-14 shrink-0 sm:w-16" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[14px] font-semibold leading-snug">{v.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <PlatformDots platforms={v.platforms} />
            <span className="text-[12px] text-[var(--color-ink-faint)]">{shortDate(v.publishedAt)}</span>
          </span>
          <span className="mt-2 grid grid-cols-5 gap-1.5 sm:max-w-[520px]">
            {cells.map(([l, n], i) => (
              <span key={l} className="min-w-0">
                <b className={`block truncate tabular-nums ${i === 0 ? "text-[15px] font-bold" : "text-[13.5px] font-semibold"}`}>{fmt(n)}</b>
                <span className="block truncate text-[10.5px] text-[var(--color-ink-faint)]">{l}</span>
              </span>
            ))}
          </span>
          {bar !== undefined ? (
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[var(--sc-fill-strong)] sm:max-w-[520px]"><span className="ms-bar block h-full rounded-full" style={{ width: `${Math.max(1, bar)}%` }} /></span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function PlatformFilter({ platforms, value, onChange }: { platforms: string[]; value: string; onChange: (p: string) => void }) {
  if (platforms.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {["alle", ...platforms].map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${value === p ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "border border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
          {p !== "alle" ? <span className="size-2 rounded-full ring-1 ring-white/30" style={{ background: PLATFORM[p]?.color ?? "#888" }} /> : null}
          {p === "alle" ? "Alle platforms" : platLabel(p)}
        </button>
      ))}
    </div>
  );
}

function useFiltered(videos: MilestoneVideo[], sort: SortKey, platform: string) {
  return useMemo(() => {
    const f = platform === "alle" ? videos : videos.filter((v) => v.platforms.some((p) => p.platform === platform));
    const val = (v: MilestoneVideo) => (sort === "date" ? Date.parse(v.publishedAt) : v[sort]);
    return [...f].sort((a, b) => val(b) - val(a));
  }, [videos, sort, platform]);
}

export function ArchiveModal({ videos, library, totalPublished, onClose, onPlay }: { videos: MilestoneVideo[]; library: LibraryVideo[]; totalPublished: number; onClose: () => void; onPlay: (p: Playable) => void }) {
  const [tab, setTab] = useState<"resultaten" | "bibliotheek">(videos.length ? "resultaten" : "bibliotheek");
  const [sort, setSort] = useState<SortKey>("date");
  const [platform, setPlatform] = useState("alle");
  const platforms = useMemo(() => [...new Set(videos.flatMap((v) => v.platforms.map((p) => p.platform)))], [videos]);
  const list = useFiltered(videos, sort, platform);
  const byKey = useMemo(() => new Map(videos.map((v) => [v.key, v])), [videos]);

  return (
    <Shell title="Gepubliceerde video's" sub={`${fmt(totalPublished)} video's opgeleverd en gepubliceerd`} onClose={onClose}>
      <div className="flex flex-col gap-3 border-b border-[var(--sc-line)] px-5 py-3.5 sm:px-6">
        <div role="tablist" className="flex gap-1 self-start rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1">
          {([["resultaten", `Met resultaten (${videos.length})`], ["bibliotheek", `Videobibliotheek (${library.length})`]] as const).map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-[9px] px-3 py-1.5 text-[13px] font-medium ${tab === k ? "bg-[var(--color-surface)] shadow-[var(--shadow-card)]" : "text-[var(--color-ink-muted)]"}`}>{l}</button>
          ))}
        </div>
        {tab === "resultaten" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PlatformFilter platforms={platforms} value={platform} onChange={setPlatform} />
            <label className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
              <ArrowDown className="size-3.5" /> Sorteer op
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="sc-input rounded-lg py-1.5 pl-2.5 pr-7 text-[13px] font-medium text-[var(--color-ink)]">
                <option value="date">Nieuwste</option>
                <option value="views">Weergaven</option>
                <option value="interactions">Interacties</option>
              </select>
            </label>
          </div>
        ) : (
          <p className="text-[12.5px] text-[var(--color-ink-muted)]">Alle video&apos;s die we voor jullie hebben gemaakt. Klik om af te spelen.</p>
        )}
      </div>

      {tab === "resultaten" ? (
        list.length ? (
          <ul className="divide-y divide-[var(--sc-line)]">{list.map((v) => <VideoRow key={v.key} v={v} onPlay={() => onPlay(playableFromVideo(v))} />)}</ul>
        ) : (
          <p className="px-6 py-10 text-center text-[13.5px] text-[var(--color-ink-muted)]">Nog geen video&apos;s met cijfers.</p>
        )
      ) : (
        <ul className="grid grid-cols-3 gap-3 p-5 sm:grid-cols-4 sm:p-6 lg:grid-cols-6">
          {library.map((l) => {
            const stats = l.statsKey ? byKey.get(l.statsKey) ?? null : null;
            return (
              <li key={l.id}>
                <button type="button" onClick={() => onPlay(playableFromLibrary(l, stats))} className="group flex w-full flex-col gap-1.5 text-left">
                  <VideoThumb src={`/api/portal/frame/${l.id}/thumb`} className="w-full" />
                  <span className="line-clamp-2 text-[12.5px] font-medium leading-snug">{l.title}</span>
                  <span className="text-[11.5px] text-[var(--color-ink-faint)]">{stats ? `${fmt(stats.views)} views` : shortDate(l.publishedAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

export function ViewsModal({ videos, totalViews, onClose, onPlay }: { videos: MilestoneVideo[]; totalViews: number; onClose: () => void; onPlay: (p: Playable) => void }) {
  const [platform, setPlatform] = useState("alle");
  const platforms = useMemo(() => [...new Set(videos.flatMap((v) => v.platforms.map((p) => p.platform)))], [videos]);
  const list = useFiltered(videos, "views", platform);
  const measured = videos.reduce((s, v) => s + v.views, 0);
  return (
    <Shell title="Totaal aantal views" sub="Welke video's hebben bijgedragen aan jullie bereik" onClose={onClose}>
      <div className="grid gap-3 border-b border-[var(--sc-line)] px-5 py-4 sm:grid-cols-2 sm:px-6">
        <Tile icon={Eye} l="Totaal op alle kanalen" v={fmt(totalViews)} />
        <Tile icon={Film} l={`Per video gemeten (${videos.length} video's)`} v={fmt(measured)} />
        <div className="sm:col-span-2"><PlatformFilter platforms={platforms} value={platform} onChange={setPlatform} /></div>
      </div>
      {list.length ? (
        <ul className="divide-y divide-[var(--sc-line)]">
          {list.map((v, i) => <VideoRow key={v.key} v={v} rank={i < 3 && platform === "alle" ? i + 1 : undefined} bar={measured > 0 ? (v.views / Math.max(1, list[0]!.views)) * 100 : 0} onPlay={() => onPlay(playableFromVideo(v))} />)}
        </ul>
      ) : <p className="px-6 py-10 text-center text-[13.5px] text-[var(--color-ink-muted)]">Nog geen video&apos;s met cijfers.</p>}
      <p className="px-5 py-4 text-[12px] leading-relaxed text-[var(--color-ink-faint)] sm:px-6">Het totaal komt uit de dagelijkse kanaalstatistieken (dezelfde bron als Resultaten). De cijfers per video komen uit de laatste meting per post en kunnen daardoor iets afwijken.</p>
    </Shell>
  );
}

export function InteractionsModal({ videos, totalInteractions, onClose, onPlay }: { videos: MilestoneVideo[]; totalInteractions: number; onClose: () => void; onPlay: (p: Playable) => void }) {
  const list = useFiltered(videos, "interactions", "alle");
  const sum = (k: "likes" | "comments" | "shares" | "saves") => videos.reduce((s, v) => s + v[k], 0);
  return (
    <Shell title="Totaal aantal interacties" sub="Likes, reacties, shares en opgeslagen per video" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2.5 border-b border-[var(--sc-line)] px-5 py-4 sm:grid-cols-5 sm:px-6">
        <div className="col-span-2 sm:col-span-1"><Tile icon={Heart} l="Totaal" v={fmt(totalInteractions)} /></div>
        <Tile l="Likes" v={fmt(sum("likes"))} />
        <Tile l="Reacties" v={fmt(sum("comments"))} />
        <Tile l="Shares" v={fmt(sum("shares"))} />
        <Tile l="Opgeslagen" v={fmt(sum("saves"))} />
      </div>
      {list.length ? (
        <ul className="divide-y divide-[var(--sc-line)]">{list.map((v) => <VideoRow key={v.key} v={v} onPlay={() => onPlay(playableFromVideo(v))} />)}</ul>
      ) : <p className="px-6 py-10 text-center text-[13.5px] text-[var(--color-ink-muted)]">Nog geen video&apos;s met cijfers.</p>}
      <p className="px-5 py-4 text-[12px] leading-relaxed text-[var(--color-ink-faint)] sm:px-6">Het totaal komt uit de dagelijkse kanaalstatistieken; de uitsplitsing en de cijfers per video uit de laatste meting per post.</p>
    </Shell>
  );
}

function Tile({ icon: Icon, l, v }: { icon?: typeof Eye; l: string; v: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3.5 py-3 text-[12px] text-[var(--color-ink-muted)]">
      <span className="flex items-center gap-1.5">{Icon ? <Icon className="size-3.5" /> : null}{l}</span>
      <b className="mt-0.5 block text-[18px] font-bold tabular-nums text-[var(--color-ink)]">{v}</b>
    </div>
  );
}

/* ---------- Speler ---------- */

export function PlayerModal({ p, onClose }: { p: Playable; onClose: () => void }) {
  const [mode, setMode] = useState<"video" | "embed" | "none">(p.playSrc ? "video" : p.embedSrc ? "embed" : "none");
  const s = p.stats;
  const mainPlat = s?.platforms.find((x) => x.url === p.externalUrl)?.platform ?? s?.platforms[0]?.platform;
  return (
    <div role="dialog" aria-modal="true" aria-label={p.title} className="ms-pop relative grid max-h-full w-full max-w-[860px] overflow-y-auto rounded-[22px] border border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-pop)] md:grid-cols-[minmax(0,380px)_1fr]">
      <button type="button" onClick={onClose} aria-label="Sluiten" autoFocus className="absolute right-3 top-3 z-[2] grid size-9 place-items-center rounded-full border border-white/20 bg-black/40 text-white md:border-[var(--sc-line)] md:bg-[var(--color-surface)] md:text-[var(--color-ink)]"><X className="size-4" /></button>
      <div className="flex items-center justify-center bg-black">
        {mode === "video" ? (
          <video
            key={p.playSrc!}
            src={p.playSrc!}
            poster={p.poster ?? undefined}
            controls
            autoPlay
            playsInline
            onError={() => setMode(p.embedSrc ? "embed" : "none")}
            className="aspect-[9/16] max-h-[78vh] w-full bg-black object-contain"
          />
        ) : mode === "embed" ? (
          <iframe
            src={p.embedSrc!}
            title={p.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="aspect-[9/16] max-h-[78vh] w-full border-0 bg-white"
          />
        ) : (
          <div className="flex aspect-[9/16] max-h-[78vh] w-full flex-col items-center justify-center gap-3 p-6 text-center text-[13.5px] text-white/80">
            <Film className="size-8" strokeWidth={1.5} />
            De video kan hier nu niet worden afgespeeld.
            {p.externalUrl ? <a href={p.externalUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-white underline underline-offset-4">Bekijk de originele post</a> : null}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="pr-10">
          <h2 className="text-[18px] font-bold leading-snug tracking-tight">{p.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--color-ink-muted)]">
            {s ? <PlatformDots platforms={s.platforms} /> : null}
            {p.publishedAt ? <span>{longDateNl(p.publishedAt)}</span> : null}
          </div>
        </div>
        {s ? (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Tile icon={Eye} l="Weergaven" v={fmt(s.views)} />
              <Tile icon={Trophy} l="Interacties" v={fmt(s.interactions)} />
              <Tile icon={Heart} l="Likes" v={fmt(s.likes)} />
              <Tile icon={MessageCircle} l="Reacties" v={fmt(s.comments)} />
              <Tile icon={Share2} l="Shares" v={fmt(s.shares)} />
              <Tile l="Opgeslagen" v={fmt(s.saves)} />
            </div>
            {s.platforms.length > 1 ? (
              <div className="rounded-[12px] border border-[var(--sc-line)] px-3.5 py-3">
                <div className="mb-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Weergaven per platform</div>
                <ul className="flex flex-col gap-1.5">
                  {s.platforms.map((x) => (
                    <li key={x.platform} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: PLATFORM[x.platform]?.color ?? "#888" }} />{platLabel(x.platform)}</span>
                      <span className="flex items-center gap-3">
                        <b className="tabular-nums">{fmt(x.views)}</b>
                        {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" className="text-[var(--sc-accent)]" aria-label={`Open op ${platLabel(x.platform)}`}><ExternalLink className="size-3.5" /></a> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[13.5px] text-[var(--color-ink-muted)]">Voor deze video zijn nog geen cijfers per post gekoppeld.</p>
        )}
        <div className="mt-auto flex flex-wrap gap-2">
          {mode !== "video" && p.playSrc ? <button type="button" onClick={() => setMode("video")} className="sc-btn-soft inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--sc-line)] px-3.5 text-[13px] font-medium"><Play className="size-3.5" /> Speel af in het portaal</button> : null}
          {p.externalUrl ? (
            <a href={p.externalUrl} target="_blank" rel="noopener noreferrer" className="sc-btn-soft inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--sc-line)] px-3.5 text-[13px] font-medium">
              <ExternalLink className="size-3.5" /> Bekijk op {mainPlat ? platLabel(mainPlat) : "het platform"}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
