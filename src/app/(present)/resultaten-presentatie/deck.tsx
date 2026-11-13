"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Film, Maximize, Minimize, Pause, Play, X,
} from "lucide-react";
import { compact } from "@/lib/format";
import { PERIODS, formatCategoryValue, type PeriodKey, type TopCategory, type VideoCard } from "@/lib/resultaten-overzicht";
import type { PresentationClient, PresentationData } from "@/server/resultaten-presentatie";
import { VideoPlayer } from "@/app/(app)/analytics/video-player";

/* ------------------------------------------------------------------ *
 * Presentatiemodus: schermvullende slides voor een groot scherm of tv.
 * Alle maten schalen met de schermbreedte (em op de basis), zodat het op
 * een laptop én een 4K-tv goed leesbaar is. Draait zelfstandig: wisselt
 * automatisch, haalt elke 5 minuten verse cijfers op en houdt het scherm
 * wakker. Bediening verschijnt alleen als de muis beweegt.
 * ------------------------------------------------------------------ */

const NAVY = "#00003b";
const REFRESH_MS = 5 * 60_000;
const HIDE_CONTROLS_MS = 3_000;
const INTERVALS = [10, 15, 20, 30, 45, 60];
const CLIENTS_PER_PAGE = 8;
const GOOD = "#7ee0b0";
const BAD = "#ffb1a8";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn",
};

const nl = (n: number, d = 0) => n.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
const dateShort = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* geen opslag beschikbaar */ }
}

/* ------------------------------ Bouwstenen ------------------------------ */

function Delta({ d, label }: { d: number | null; label?: string }) {
  if (d === null) return null;
  const up = d >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-[0.2em] font-semibold tabular-nums" style={{ color: up ? GOOD : BAD }}>
      <Icon style={{ width: "1.1em", height: "1.1em" }} strokeWidth={2.4} />
      {up ? "+" : ""}{d}%{label ? <span className="ml-[0.35em] font-normal text-white/50">{label}</span> : null}
    </span>
  );
}

function AreaChart({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const W = 1000;
  const H = 220;
  const max = Math.max(...values) || 1;
  const step = W / (values.length - 1);
  const pts = values.map((v, i) => [i * step, H - 6 - (v / max) * (H - 16)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="pres-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#pres-area)" />
      <path d={line} fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Logo({ c, size }: { c: { name: string; logoUrl: string | null; color: string | null }; size: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-white" style={{ width: size, height: size }}>
      {c.logoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.logoUrl} alt={c.name} onError={() => setFailed(true)} className="size-full object-contain p-[12%]" />
      ) : (
        <span className="grid size-full place-items-center font-bold text-white" style={{ background: c.color ?? NAVY, fontSize: `calc(${size} * 0.42)` }}>
          {c.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * Video-tegel: speelt de echte video stil en in een lus af als die gekoppeld
 * is en de slide in beeld is; anders de miniatuur. Klik = afspelen met geluid.
 */
function Clip({ v, live, onOpen, children, className = "" }: {
  v: VideoCard; live: boolean; onOpen: (v: VideoCard) => void; children?: React.ReactNode; className?: string;
}) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumb = v.thumb ?? (v.assetId ? `/api/portal/frame/${v.assetId}/thumb` : null);
  const playLive = live && v.assetId && !videoFailed;
  return (
    <button
      type="button"
      onClick={() => onOpen(v)}
      className={`group relative block overflow-hidden rounded-[0.9em] bg-[#0a0a52] text-left shadow-[0_1.2em_3em_rgba(0,0,0,0.45)] ring-1 ring-white/10 ${className}`}
      aria-label={`Video van ${v.clientName} afspelen`}
    >
      {thumb && !thumbFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" onError={() => setThumbFailed(true)} className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-white/30"><Film style={{ width: "2.4em", height: "2.4em" }} strokeWidth={1.4} /></span>
      )}
      {playLive ? (
        <video
          src={`/api/portal/frame/${v.assetId}/play`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onError={() => setVideoFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/0 to-black/35" />
      <span className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-[#00003b] opacity-0 shadow-lg transition group-hover:opacity-100" style={{ width: "3.2em", height: "3.2em" }}>
        <Play style={{ width: "1.3em", height: "1.3em" }} fill="currentColor" />
      </span>
      {children}
    </button>
  );
}

function ClientTag({ v, size = "1.6em" }: { v: VideoCard; size?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-[0.5em]">
      <Logo c={{ name: v.clientName, logoUrl: v.clientLogoUrl, color: v.clientColor }} size={size} />
      <span className="truncate font-semibold">{v.clientName}</span>
    </span>
  );
}

function SlideHeader({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <header className="mb-[1.6em]">
      <div className="text-[0.85em] font-semibold uppercase tracking-[0.18em] text-white/50">{kicker}</div>
      <h1 className="mt-[0.15em] text-[2.6em] font-bold leading-[1.05] tracking-tight">{title}</h1>
      {sub ? <p className="mt-[0.4em] text-[1em] text-white/60">{sub}</p> : null}
    </header>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="grid flex-1 place-items-center">
      <p className="max-w-[34em] rounded-[1em] bg-white/[0.05] px-[2em] py-[1.6em] text-center text-[1.2em] text-white/70 ring-1 ring-white/10">{text}</p>
    </div>
  );
}

/* -------------------------------- Slides -------------------------------- */

function TotalsSlide({ d }: { d: PresentationData }) {
  const t = d.totals;
  const tiles: { label: string; value: string; sub?: React.ReactNode }[] = [
    { label: "Bereik", value: t.reach > 0 ? compact(t.reach) : "Niet beschikbaar", sub: <Delta d={t.reachDelta} label={`t.o.v. ${d.prevLabel}`} /> },
    { label: "Interacties", value: compact(t.interactions), sub: <span className="text-white/50">likes, reacties en opgeslagen</span> },
    { label: "Volgersgroei", value: `${t.followers >= 0 ? "+" : ""}${nl(t.followers)}`, sub: <span className="text-white/50">nieuwe volgers</span> },
    { label: "Gepubliceerde video's", value: nl(t.videos), sub: <Delta d={t.videosDelta} label={`t.o.v. ${d.prevLabel}`} /> },
  ];
  if (t.avgWatchSeconds != null) tiles.push({ label: "Gem. kijktijd", value: `${nl(t.avgWatchSeconds, 1)} sec`, sub: <span className="text-white/50">over {t.watchSample} video&apos;s met kijktijd</span> });
  if (t.avgRetention != null) tiles.push({ label: "Gem. retentie", value: `${nl(t.avgRetention * 100)}%`, sub: <span className="text-white/50">over {t.retentionSample} video&apos;s met retentie</span> });

  return (
    <div className="flex h-full flex-col">
      <SlideHeader kicker={`Shortclips · ${d.periodLabel}`} title="Totaalresultaten van alle klanten" sub={`${d.clientCount} gekoppelde klanten · vergeleken met ${d.prevLabel}`} />
      <div className="grid min-h-0 flex-1 grid-cols-[1.25fr_1fr] gap-[1.6em]">
        <div className="relative flex flex-col overflow-hidden rounded-[1.2em] bg-white/[0.06] p-[1.8em] ring-1 ring-white/10">
          <div className="text-[1em] font-semibold uppercase tracking-[0.14em] text-white/60">Weergaven</div>
          <div className="mt-[0.2em] text-[7em] font-bold leading-none tracking-tight tabular-nums">{compact(t.views)}</div>
          <div className="mt-[0.5em] text-[1.3em]"><Delta d={t.viewsDelta} label={`t.o.v. ${d.prevLabel}`} /></div>
          <div className="mt-auto h-[38%] min-h-[6em]"><AreaChart values={t.series} /></div>
          <div className="mt-[0.4em] text-[0.8em] text-white/40">Weergaven per dag</div>
        </div>
        <div className="grid min-h-0 grid-cols-2 gap-[1em]" style={{ gridAutoRows: "1fr" }}>
          {tiles.map((x) => (
            <div key={x.label} className="flex min-w-0 flex-col justify-between rounded-[1.1em] bg-white/[0.06] p-[1.2em] ring-1 ring-white/10">
              <div className="text-[0.85em] font-semibold uppercase tracking-[0.12em] text-white/55">{x.label}</div>
              <div className="text-[2.7em] font-bold leading-none tabular-nums">{x.value}</div>
              <div className="text-[0.85em]">{x.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TopVideosSlide({ d, onOpen }: { d: PresentationData; onOpen: (v: VideoCard) => void }) {
  if (!d.top.length) return <div className="flex h-full flex-col"><SlideHeader kicker={d.periodLabel} title="Best presterende video's" /><Empty text="Nog geen video's met cijfers in deze periode." /></div>;
  return (
    <div className="flex h-full flex-col">
      <SlideHeader kicker={`${d.periodLabel} · totaalscore op weergaven, engagement en retentie`} title="Best presterende video's" />
      <div className="flex min-h-0 flex-1 items-end justify-center gap-[1.4em]">
        {d.top.map((v, i) => {
          const h = i === 0 ? "62vh" : "50vh";
          return (
            <div key={v.id} className="flex min-w-0 flex-col gap-[0.7em]" style={{ width: `calc(${h} * 9 / 16)` }}>
              <Clip v={v} live onOpen={onOpen} className="aspect-[9/16] w-full">
                <span className="absolute left-[0.7em] top-[0.7em] grid place-items-center rounded-full bg-white font-bold text-[#00003b]" style={{ width: "2em", height: "2em", fontSize: i === 0 ? "1.2em" : "1em" }}>{i + 1}</span>
                <span className="absolute inset-x-[0.8em] bottom-[0.8em] text-white">
                  <span className="block font-bold leading-none tabular-nums" style={{ fontSize: i === 0 ? "3em" : "2.2em" }}>{v.totalScore}</span>
                  <span className="text-[0.75em] uppercase tracking-[0.12em] text-white/70">score</span>
                </span>
              </Clip>
              <div className="text-[0.95em]"><ClientTag v={v} /></div>
              <div className="grid grid-cols-3 gap-[0.4em] text-[0.8em]">
                <Mini label="Weergaven" value={compact(v.views)} />
                <Mini label="Engagement" value={v.engagementRate != null ? `${nl(v.engagementRate * 100, 1)}%` : null} />
                <Mini label="Retentie" value={v.retention != null ? `${nl(v.retention * 100)}%` : null} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-white/50">{label}</div>
      <div className={`truncate font-semibold tabular-nums ${value === null ? "font-normal text-white/35" : ""}`}>{value ?? "n.v.t."}</div>
    </div>
  );
}

function HooksSlide({ d, onOpen }: { d: PresentationData; onOpen: (v: VideoCard) => void }) {
  const [first, ...rest] = d.hooks;
  if (!first) return <div className="flex h-full flex-col"><SlideHeader kicker={d.periodLabel} title="Beste hooks" /><Empty text="Nog te weinig video's om hooks eerlijk te vergelijken in deze periode." /></div>;
  return (
    <div className="flex h-full flex-col">
      <SlideHeader kicker={`${d.periodLabel} · weergaven ten opzichte van wat normaal is voor die klant`} title="Beste hooks" />
      <div className="flex min-h-0 flex-1 gap-[2.2em]">
        <Clip v={first} live onOpen={onOpen} className="aspect-[9/16] h-full max-h-[64vh] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="text-[0.9em] font-semibold uppercase tracking-[0.14em] text-white/50">Nummer 1</div>
          <blockquote className="mt-[0.3em] text-[2.6em] font-bold leading-[1.15]">&ldquo;{first.hook}&rdquo;</blockquote>
          <div className="mt-[0.6em] flex items-center gap-[1.2em] text-[1.15em]">
            <ClientTag v={first} size="1.9em" />
            <span className="rounded-full bg-white px-[0.8em] py-[0.2em] font-bold tabular-nums text-[#00003b]">{nl(first.hookScore ?? 0, 1)}× normaal</span>
            <span className="text-white/60 tabular-nums">{compact(first.views)} weergaven</span>
          </div>
          <ol className="mt-auto grid grid-cols-2 gap-[1em]">
            {rest.map((v, i) => (
              <li key={v.id}>
                <button type="button" onClick={() => onOpen(v)} className="flex h-full w-full gap-[0.9em] rounded-[1em] bg-white/[0.06] p-[0.9em] text-left ring-1 ring-white/10 transition hover:bg-white/[0.1]">
                  <span className="text-[1.6em] font-bold leading-none text-white/35 tabular-nums">{i + 2}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[1.1em] font-semibold leading-snug">&ldquo;{v.hook}&rdquo;</span>
                    <span className="mt-[0.4em] flex items-center justify-between gap-[0.6em] text-[0.85em]">
                      <ClientTag v={v} size="1.4em" />
                      <span className="shrink-0 font-bold tabular-nums">{nl(v.hookScore ?? 0, 1)}×</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function WatchSlide({ d, onOpen }: { d: PresentationData; onOpen: (v: VideoCard) => void }) {
  if (!d.watch.length) return <div className="flex h-full flex-col"><SlideHeader kicker={d.periodLabel} title="Hoogste kijktijd" /><Empty text="De platforms leveren voor de video's uit deze periode (nog) geen kijktijd." /></div>;
  const max = Math.max(...d.watch.map((v) => v.avgWatchSeconds ?? 0)) || 1;
  return (
    <div className="flex h-full flex-col">
      <SlideHeader kicker={`${d.periodLabel} · gemiddelde kijktijd per weergave`} title="Deze video's houden kijkers het langst vast" />
      <div className="flex min-h-0 flex-1 gap-[2.4em]">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.1em]">
          {d.watch.map((v, i) => {
            const sec = v.avgWatchSeconds ?? 0;
            return (
              <button key={v.id} type="button" onClick={() => onOpen(v)} className="grid grid-cols-[2.2em_minmax(0,14em)_1fr] items-center gap-[1em] text-left">
                <span className="text-[1.8em] font-bold text-white/35 tabular-nums">{i + 1}</span>
                <span className="min-w-0 text-[1.05em]">
                  <ClientTag v={v} size="1.7em" />
                  <span className="mt-[0.2em] block truncate text-[0.8em] text-white/50">{v.hook ?? PLATFORM_LABEL[v.platform]}</span>
                </span>
                <span className="relative h-[3.2em] overflow-hidden rounded-[0.6em] bg-white/[0.06]">
                  <span className="absolute inset-y-0 left-0 rounded-[0.6em] bg-white" style={{ width: `${Math.max(8, (sec / max) * 100)}%`, opacity: i === 0 ? 1 : 0.75 - i * 0.08 }} />
                  <span className="absolute inset-y-0 left-[1em] flex items-center gap-[0.8em] text-[1.25em] font-bold tabular-nums text-[#00003b]">
                    {nl(sec, sec < 10 ? 1 : 0)} sec
                    {v.retention != null ? <span className="text-[0.7em] font-semibold text-[#00003b]/70">{nl(v.retention * 100)}% van de video</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <Clip v={d.watch[0]} live onOpen={onOpen} className="aspect-[9/16] h-full max-h-[64vh] shrink-0">
          <span className="absolute inset-x-[0.8em] bottom-[0.8em] text-white">
            <span className="block text-[2.4em] font-bold leading-none tabular-nums">{nl(d.watch[0].avgWatchSeconds ?? 0, 1)} sec</span>
            <span className="text-[0.75em] uppercase tracking-[0.12em] text-white/70">gem. kijktijd</span>
          </span>
        </Clip>
      </div>
    </div>
  );
}

function ReachSlide({ d, onOpen }: { d: PresentationData; onOpen: (v: VideoCard) => void }) {
  if (!d.reach.length) return <div className="flex h-full flex-col"><SlideHeader kicker={d.periodLabel} title="Meeste bereik en weergaven" /><Empty text="Nog geen video's met weergaven in deze periode." /></div>;
  const [a, b, ...rest] = d.reach;
  const label = (v: VideoCard, big: boolean) => {
    const views = formatCategoryValue(v, "weergaven" as TopCategory);
    return (
      <span className="absolute inset-x-[0.8em] bottom-[0.8em] text-white">
        <span className="block font-bold leading-none tabular-nums" style={{ fontSize: big ? "3em" : "1.8em" }}>{views?.value}</span>
        <span className="mt-[0.2em] block uppercase tracking-[0.1em] text-white/70" style={{ fontSize: "0.72em" }}>
          weergaven{v.reachValue != null ? ` · ${compact(v.reachValue)} bereik` : ""}
        </span>
        <span className="mt-[0.5em] block" style={{ fontSize: big ? "1em" : "0.8em" }}><ClientTag v={v} size="1.5em" /></span>
      </span>
    );
  };
  return (
    <div className="flex h-full flex-col">
      <SlideHeader kicker={`${d.periodLabel} · totaal ${compact(d.totals.views)} weergaven en ${compact(d.totals.reach)} bereik`} title="Meeste bereik en weergaven" />
      <div className="flex min-h-0 flex-1 items-stretch gap-[1.2em]">
        {[a, b].filter(Boolean).map((v) => (
          <Clip key={v!.id} v={v!} live onOpen={onOpen} className="aspect-[9/16] h-full max-h-[64vh] shrink-0">{label(v!, true)}</Clip>
        ))}
        <div className="grid min-w-0 flex-1 grid-cols-3 grid-rows-2 gap-[1em]">
          {rest.map((v) => (
            <Clip key={v.id} v={v} live={false} onOpen={onOpen} className="h-full w-full">{label(v, false)}</Clip>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientsSlide({ d, page, pages, onOpen }: { d: PresentationData; page: number; pages: number; onOpen: (v: VideoCard) => void }) {
  const list = d.clients.slice(page * CLIENTS_PER_PAGE, (page + 1) * CLIENTS_PER_PAGE);
  if (!list.length) return <div className="flex h-full flex-col"><SlideHeader kicker={d.periodLabel} title="Resultaten per klant" /><Empty text="Nog geen klanten met resultaten in deze periode." /></div>;
  return (
    <div className="flex h-full flex-col">
      <SlideHeader
        kicker={`${d.periodLabel} · gesorteerd op weergaven${pages > 1 ? ` · ${page + 1} van ${pages}` : ""}`}
        title="Resultaten per klant"
      />
      <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-[1.1em]">
        {list.map((c, i) => <ClientCard key={c.id} c={c} rank={page * CLIENTS_PER_PAGE + i + 1} prevLabel={d.prevLabel} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function ClientCard({ c, rank, prevLabel, onOpen }: { c: PresentationClient; rank: number; prevLabel: string; onOpen: (v: VideoCard) => void }) {
  return (
    <div className="flex min-h-0 gap-[0.9em] overflow-hidden rounded-[1.1em] bg-white/[0.06] p-[1em] ring-1 ring-white/10">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-[0.6em]">
          <Logo c={c} size="2.4em" />
          <div className="min-w-0">
            <div className="text-[0.75em] font-semibold text-white/40 tabular-nums">#{rank}</div>
            <div className="truncate text-[1.05em] font-bold leading-tight">{c.name}</div>
          </div>
        </div>
        <div className="mt-auto">
          <div className="text-[2.2em] font-bold leading-none tabular-nums">{compact(c.views)}</div>
          <div className="mt-[0.2em] text-[0.75em] text-white/55">weergaven</div>
          <div className="mt-[0.3em] text-[0.8em]"><Delta d={c.viewsDelta} label={`t.o.v. ${prevLabel}`} /></div>
          <div className="mt-[0.7em] grid grid-cols-2 gap-[0.3em] text-[0.78em]">
            <Mini label="Interacties" value={compact(c.interactions)} />
            <Mini label="Volgers" value={`${c.followers >= 0 ? "+" : ""}${nl(c.followers)}`} />
            <Mini label="Bereik" value={c.reach != null ? compact(c.reach) : null} />
            <Mini label="Video's" value={nl(c.videos)} />
          </div>
        </div>
      </div>
      {c.best ? (
        <div className="flex w-[38%] shrink-0 flex-col gap-[0.3em]">
          <Clip v={c.best} live={false} onOpen={onOpen} className="min-h-0 w-full flex-1">
            <span className="absolute inset-x-[0.5em] bottom-[0.5em] text-[0.8em] font-bold tabular-nums text-white">{compact(c.best.views)}</span>
          </Clip>
          <div className="text-center text-[0.65em] uppercase tracking-[0.1em] text-white/45">beste video</div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------- Het deck ------------------------------- */

type SlideId = "totaal" | "top" | "hooks" | "kijktijd" | "bereik" | "klanten";
const SLIDES: { id: SlideId; label: string }[] = [
  { id: "totaal", label: "Totaal" },
  { id: "top", label: "Topvideo's" },
  { id: "hooks", label: "Hooks" },
  { id: "kijktijd", label: "Kijktijd" },
  { id: "bereik", label: "Bereik" },
  { id: "klanten", label: "Per klant" },
];

type Step = { slide: SlideId; page: number; available: boolean };

function buildSteps(d: PresentationData): Step[] {
  const pages = Math.max(1, Math.ceil(d.clients.length / CLIENTS_PER_PAGE));
  const avail: Record<SlideId, boolean> = {
    totaal: true,
    top: d.top.length > 0,
    hooks: d.hooks.length > 0,
    kijktijd: d.watch.length > 0,
    bereik: d.reach.length > 0,
    klanten: d.clients.length > 0,
  };
  return SLIDES.flatMap((s) =>
    s.id === "klanten"
      ? Array.from({ length: pages }, (_, page) => ({ slide: s.id, page, available: avail.klanten }))
      : [{ slide: s.id, page: 0, available: avail[s.id] }],
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, []);
  if (!now) return null;
  return <span>{now.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}</span>;
}

export function PresentationDeck({ initial }: { initial: PresentationData }) {
  const [data, setData] = useState(initial);
  const [period, setPeriod] = useState<PeriodKey>(initial.periodKey as PeriodKey);
  const [loading, setLoading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [interval, setIntervalSec] = useState(20);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [open, setOpen] = useState<VideoCard | null>(null);
  const hideTimer = useRef<number | null>(null);

  const steps = useMemo(() => buildSteps(data), [data]);
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const clientPages = steps.filter((s) => s.slide === "klanten").length;

  // Voorkeuren onthouden per scherm.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setIntervalSec(readPref("sc-pres-interval", 20));
      setPlaying(readPref("sc-pres-autoplay", true));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const go = useCallback((dir: 1 | -1, onlyAvailable = false) => {
    setStepIdx((cur) => {
      const n = steps.length;
      let i = Math.min(cur, n - 1);
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (!onlyAvailable || steps[i].available) return i;
      }
      return cur;
    });
  }, [steps]);

  const goSlide = (id: SlideId) => setStepIdx(Math.max(0, steps.findIndex((s) => s.slide === id)));

  // Automatisch wisselen (gepauzeerd zolang er een video open staat).
  useEffect(() => {
    if (!playing || open) return;
    const t = window.setTimeout(() => go(1, true), interval * 1000);
    return () => window.clearTimeout(t);
  }, [playing, open, interval, stepIdx, go]);

  // Verse cijfers ophalen.
  const load = useCallback(async (p: PeriodKey) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/resultaten/presentatie?periode=${p}`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as PresentationData);
    } catch {
      /* netwerk even weg: de huidige cijfers blijven staan, volgende ronde opnieuw */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(period); }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, period]);

  const changePeriod = (p: PeriodKey) => {
    setPeriod(p);
    const url = new URL(window.location.href);
    if (p === "30") url.searchParams.delete("periode"); else url.searchParams.set("periode", p);
    window.history.replaceState(null, "", url.toString());
    void load(p);
  };

  // Scherm wakker houden.
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    let lock: Sentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } };
    const acquire = async () => {
      try { if (nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen"); } catch { /* niet ondersteund */ }
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); void lock?.release().catch(() => {}); };
  }, []);

  // Volledig scherm.
  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  // Bediening tonen bij beweging, daarna verbergen.
  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), HIDE_CONTROLS_MS);
  }, []);
  useEffect(() => {
    const first = window.setTimeout(poke, 0);
    window.addEventListener("mousemove", poke);
    window.addEventListener("touchstart", poke);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("mousemove", poke);
      window.removeEventListener("touchstart", poke);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [poke]);

  // Toetsenbord.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement) return;
      if (open) { if (e.key === "Escape") setOpen(null); return; }
      if (e.key === "ArrowRight" || e.key === "PageDown") { go(1); poke(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { go(-1); poke(); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => { writePref("sc-pres-autoplay", !p); return !p; }); poke(); }
      else if (e.key.toLowerCase() === "f") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, poke, open, toggleFullscreen]);

  const backHref = `/analytics${period !== "30" ? `?periode=${period}` : ""}`;
  const slideKey = `${step.slide}-${step.page}`;

  return (
    <div
      className={`fixed inset-0 overflow-hidden text-white ${controls ? "" : "cursor-none"}`}
      style={{
        background: "radial-gradient(120% 90% at 25% 15%, #0b0b5c 0%, #00003b 55%, #000026 100%)",
        fontSize: "clamp(11px, 1.05vw, 34px)",
        fontFamily: "var(--font-poppins), system-ui, sans-serif",
      }}
    >
      <style>{`@keyframes sc-pres-in{from{opacity:0;transform:translateY(0.6em)}to{opacity:1;transform:none}}@keyframes sc-pres-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}`}</style>

      {/* Voortgang van de automatische wissel */}
      {playing && !open ? (
        <div className="absolute inset-x-0 top-0 z-20 h-[3px] bg-white/10">
          <div key={`${slideKey}-${interval}`} className="h-full origin-left bg-white/80" style={{ animation: `sc-pres-bar ${interval}s linear forwards` }} />
        </div>
      ) : null}

      {/* Kopregel */}
      <div className="absolute inset-x-[3em] top-[1.6em] z-10 flex items-center justify-between text-[0.85em] text-white/55">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shortclips-logo-ondark.png" alt="Shortclips" style={{ height: "1.9em" }} className="opacity-90" />
        <span className="flex items-center gap-[1em]">
          {loading ? <span>Bijwerken…</span> : null}
          <Clock />
        </span>
      </div>

      {/* Slide */}
      <main key={slideKey} className="absolute inset-x-[3em] bottom-[3.2em] top-[4.6em]" style={{ animation: "sc-pres-in 0.6s ease-out" }}>
        {step.slide === "totaal" ? <TotalsSlide d={data} /> : null}
        {step.slide === "top" ? <TopVideosSlide d={data} onOpen={setOpen} /> : null}
        {step.slide === "hooks" ? <HooksSlide d={data} onOpen={setOpen} /> : null}
        {step.slide === "kijktijd" ? <WatchSlide d={data} onOpen={setOpen} /> : null}
        {step.slide === "bereik" ? <ReachSlide d={data} onOpen={setOpen} /> : null}
        {step.slide === "klanten" ? <ClientsSlide d={data} page={step.page} pages={clientPages} onOpen={setOpen} /> : null}
      </main>

      {/* Voetregel: stille slide-indicator, altijd zichtbaar */}
      <div className="absolute inset-x-[3em] bottom-[1.1em] z-10 flex items-center justify-between text-[0.75em] text-white/40">
        <span>
          {data.lastUpdated ? `Cijfers bijgewerkt ${new Date(data.lastUpdated).toLocaleString("nl-NL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}` : "Nog geen metingen"}
        </span>
        <span className="flex items-center gap-[0.5em]">
          {SLIDES.map((s) => (
            <span key={s.id} className="h-[0.45em] rounded-full transition-all" style={{ width: s.id === step.slide ? "2.2em" : "0.45em", background: s.id === step.slide ? "#fff" : "rgba(255,255,255,0.3)" }} />
          ))}
        </span>
      </div>

      {/* Bediening (verschijnt bij muisbeweging) */}
      <div
        className={`absolute bottom-[2.4em] left-1/2 z-30 flex -translate-x-1/2 items-center gap-[0.6em] rounded-full bg-black/55 px-[0.8em] py-[0.5em] text-[0.85em] shadow-2xl ring-1 ring-white/15 backdrop-blur transition-opacity duration-300 ${controls || open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onMouseEnter={() => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }}
        onMouseLeave={poke}
      >
        <Link href={backHref} className="inline-flex items-center gap-[0.4em] rounded-full px-[0.8em] py-[0.4em] font-semibold hover:bg-white/10" title="Terug naar de resultatenpagina">
          <ArrowLeft style={{ width: "1.1em", height: "1.1em" }} /> Resultaten
        </Link>
        <Sep />
        <IconBtn label="Vorige slide (←)" onClick={() => go(-1)}><ChevronLeft /></IconBtn>
        <IconBtn label={playing ? "Automatisch wisselen pauzeren (spatie)" : "Automatisch wisselen starten (spatie)"} onClick={() => setPlaying((p) => { writePref("sc-pres-autoplay", !p); return !p; })}>
          {playing ? <Pause /> : <Play />}
        </IconBtn>
        <IconBtn label="Volgende slide (→)" onClick={() => go(1)}><ChevronRight /></IconBtn>
        <Sep />
        <div className="flex items-center gap-[0.2em]">
          {SLIDES.map((s, i) => {
            const avail = steps.some((x) => x.slide === s.id && x.available);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goSlide(s.id)}
                className={`rounded-full px-[0.75em] py-[0.35em] font-medium transition ${s.id === step.slide ? "bg-white text-[#00003b]" : avail ? "text-white/80 hover:bg-white/10" : "text-white/35 hover:bg-white/10"}`}
                title={avail ? s.label : `${s.label} (geen data in deze periode)`}
              >
                {i + 1}. {s.label}
              </button>
            );
          })}
        </div>
        <Sep />
        <label className="flex items-center gap-[0.4em] text-white/70" title="Tijd per slide">
          <select
            value={interval}
            onChange={(e) => { const v = Number(e.target.value); setIntervalSec(v); writePref("sc-pres-interval", v); }}
            className="rounded-full bg-white/10 px-[0.6em] py-[0.35em] text-white outline-none"
            aria-label="Tijd per slide"
          >
            {INTERVALS.map((s) => <option key={s} value={s} className="text-black">{s} sec</option>)}
          </select>
        </label>
        <select
          value={period}
          onChange={(e) => changePeriod(e.target.value as PeriodKey)}
          className="rounded-full bg-white/10 px-[0.6em] py-[0.35em] text-white outline-none"
          aria-label="Periode"
          title="Periode"
        >
          {PERIODS.map((p) => <option key={p.key} value={p.key} className="text-black">{p.label}</option>)}
        </select>
        <Sep />
        <IconBtn label={fullscreen ? "Volledig scherm sluiten (F)" : "Volledig scherm (F)"} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize /> : <Maximize />}
        </IconBtn>
      </div>

      {/* Video afspelen met geluid */}
      {open ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center gap-[2.4em] bg-black/85 p-[2em]" role="dialog" aria-modal="true" aria-label={`Video van ${open.clientName}`}>
          <button type="button" aria-label="Sluiten" className="absolute inset-0 cursor-default" onClick={() => setOpen(null)} />
          <div className="relative z-10 aspect-[9/16] h-[84vh] overflow-hidden rounded-[1em] bg-black shadow-2xl">
            <VideoPlayer v={open} />
          </div>
          <div className="relative z-10 w-[24em] max-w-[40vw]">
            <ClientTag v={open} size="2.2em" />
            <p className="mt-[0.4em] text-[0.85em] text-white/55">
              {PLATFORM_LABEL[open.platform]}{open.alsoOn.length ? ` + ${open.alsoOn.map((p) => PLATFORM_LABEL[p]).join(", ")}` : ""} · {dateShort(open.publishedAt)}
            </p>
            {open.hook ? <p className="mt-[1em] text-[1.5em] font-bold leading-snug">&ldquo;{open.hook}&rdquo;</p> : null}
            <div className="mt-[1.4em] grid grid-cols-2 gap-x-[1.4em] gap-y-[1em]">
              <Big label="Weergaven" value={compact(open.views)} />
              <Big label="Interacties" value={compact(open.engagement)} />
              <Big label="Gem. kijktijd" value={open.avgWatchSeconds ? `${nl(open.avgWatchSeconds, 1)} sec` : null} />
              <Big label="Retentie" value={open.retention != null ? `${nl(open.retention * 100)}%` : null} />
              <Big label="Engagement" value={open.engagementRate != null ? `${nl(open.engagementRate * 100, 1)}%` : null} />
              <Big label="Bereik" value={open.reachValue != null ? compact(open.reachValue) : null} />
            </div>
            <button type="button" onClick={() => setOpen(null)} className="mt-[1.8em] inline-flex items-center gap-[0.4em] rounded-full bg-white/10 px-[1em] py-[0.5em] text-[0.9em] font-semibold hover:bg-white/20">
              <X style={{ width: "1.1em", height: "1.1em" }} /> Terug naar presentatie
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Big({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[0.75em] uppercase tracking-[0.1em] text-white/50">{label}</div>
      <div className={`text-[1.9em] font-bold leading-tight tabular-nums ${value === null ? "text-[1em] font-normal text-white/35" : ""}`}>{value ?? "Niet beschikbaar"}</div>
    </div>
  );
}

function Sep() {
  return <span className="mx-[0.2em] h-[1.4em] w-px bg-white/20" />;
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid place-items-center rounded-full hover:bg-white/10 [&>svg]:h-[1.2em] [&>svg]:w-[1.2em]" style={{ width: "2.2em", height: "2.2em" }}>
      {children}
    </button>
  );
}
