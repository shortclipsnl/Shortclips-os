"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Clock, Layers, Lightbulb, Megaphone, MessageSquareQuote, Play, Sparkles, Target, Trophy, Wand2 } from "lucide-react";
import { PlatformLogo } from "@/components/platform-logo";
import { PlayerModal, VideoThumb, type Playable } from "@/app/(portal)/portal/mijlpalen/video-parts";
import type { MilestoneVideo } from "@/lib/milestones";
import { DIMENSION_LABEL, openingReason, type GroupDimension, type GroupKind, type HeroCard, type YearGroup, type YearVideo, type YearView } from "@/server/content-memory/year-view";

/**
 * Contentgeheugen in het klantportaal: visueel en scanbaar. Elke conclusie
 * staat naast een echte video die de klant direct kan afspelen. Alle cijfers
 * komen uit dezelfde videolijst als de Resultatenpagina, over het huidige
 * kalenderjaar (of vanaf de latere startdatum).
 */

const nfmt = new Intl.NumberFormat("nl-NL");
const fmt = (n: number) => nfmt.format(Math.round(n));
const xf = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

const GREEN = "text-[#1d6b4c]";
const GREEN_BG = "bg-[var(--color-good-soft)]";

function toPlayable(v: YearVideo): Playable {
  return { title: v.title, playSrc: v.playSrc, embedSrc: v.embedSrc, externalUrl: v.externalUrl, poster: v.thumbUrl, publishedAt: v.publishedAt, stats: v as unknown as MilestoneVideo };
}

/* ------------------------------------------------------------------ *
 * Bouwstenen
 * ------------------------------------------------------------------ */

function Logos({ platforms, size = 18 }: { platforms: Array<{ platform: string }>; size?: number }) {
  const uniq = [...new Set(platforms.map((p) => p.platform))];
  return <span className="inline-flex items-center gap-1">{uniq.map((p) => <PlatformLogo key={p} platform={p} size={size} />)}</span>;
}

function VsAverage({ v, big = false }: { v: number | null; big?: boolean }) {
  if (v == null) return null;
  const good = v >= 1.2;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold tabular-nums ${big ? "text-[13px]" : "text-[11.5px]"} ${good ? `${GREEN_BG} ${GREEN}` : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
      {xf(v)} je gemiddelde video
    </span>
  );
}

const KIND_LABEL: Record<GroupKind, string> = { patroon: "Terugkerend patroon", signaal: "Eerste signaal", uitschieter: "Eenmalige uitschieter", geen: "Voorlopig" };

function KindChip({ kind, n, hits }: { kind: GroupKind; n: number; hits?: number }) {
  const cls = kind === "patroon" ? `${GREEN_BG} ${GREEN}` : "bg-[var(--color-warn-soft)] text-[#8a5a00]";
  const count = kind === "patroon" && hits != null ? `${hits} van ${n} video's` : plural(n, "video", "video's");
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${cls}`}>{KIND_LABEL[kind]} · {count}</span>;
}

function PlayThumb({ v, onPlay, className = "", rank, big = false }: { v: YearVideo; onPlay: (v: YearVideo) => void; className?: string; rank?: number; big?: boolean }) {
  return (
    <button type="button" onClick={() => onPlay(v)} aria-label={`Speel af: ${v.title}`} className={`group relative block shrink-0 text-left ${className}`}>
      <VideoThumb src={v.thumbUrl} rank={rank} big={big} className="w-full" />
      <span className="pointer-events-none absolute inset-0 grid place-items-center">
        <span className="grid size-11 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/40 transition-transform group-hover:scale-110"><Play className="size-5 translate-x-[1px]" fill="currentColor" /></span>
      </span>
      {v.above ? <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-[#1d6b4c] px-2 py-0.5 text-[10.5px] font-bold text-white">Bovengemiddeld</span> : null}
    </button>
  );
}

const TONE: Record<string, { bar: string; icon: string; tint: string }> = {
  navy: { bar: "bg-[#00003b]", icon: "bg-[#00003b] text-white", tint: "" },
  green: { bar: "bg-[#1d6b4c]", icon: "bg-[#1d6b4c] text-white", tint: "" },
  amber: { bar: "bg-[#c98a00]", icon: "bg-[#c98a00] text-white", tint: "" },
  violet: { bar: "bg-[#5b4bc4]", icon: "bg-[#5b4bc4] text-white", tint: "" },
  rose: { bar: "bg-[#c2410c]", icon: "bg-[#c2410c] text-white", tint: "" },
};

function SectionHead({ icon: Icon, label, title, sub, tone = "navy", right }: { icon: typeof Play; label: string; title: string; sub?: string; tone?: keyof typeof TONE; right?: ReactNode }) {
  const t = TONE[tone];
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex gap-3">
        <span className={`w-1.5 shrink-0 self-stretch rounded-full ${t.bar}`} aria-hidden />
        <div>
          <div className="flex items-center gap-2">
            <span className={`grid size-7 place-items-center rounded-lg ${t.icon}`}><Icon className="size-4" /></span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{label}</span>
          </div>
          <h2 className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight">{title}</h2>
          {sub ? <p className="mt-1 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">{sub}</p> : null}
        </div>
      </div>
      {right}
    </header>
  );
}

function Rail({ children, label, ariaLabel }: { children: ReactNode; label?: string; ariaLabel: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(240, (ref.current?.clientWidth ?? 600) * 0.8), behavior: "smooth" });
  return (
    <div className="relative">
      <div className="mb-2 hidden items-center justify-end gap-2 sm:flex">
        {label ? <span className="mr-auto text-[12px] text-[var(--color-ink-muted)]">{label}</span> : null}
        <button type="button" onClick={() => by(-1)} disabled={edges.start} aria-label="Naar links" className="grid size-9 place-items-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] disabled:opacity-35"><ChevronLeft className="size-4" /></button>
        <button type="button" onClick={() => by(1)} disabled={edges.end} aria-label="Naar rechts" className="grid size-9 place-items-center rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] disabled:opacity-35"><ChevronRight className="size-4" /></button>
      </div>
      <ol ref={ref} onScroll={measure} aria-label={ariaLabel} className="-mx-1 flex snap-x snap-mandatory gap-3.5 overflow-x-auto scroll-smooth px-1 pb-3 [scrollbar-width:thin] sm:gap-4">
        {children}
      </ol>
    </div>
  );
}

function Stat({ value, label, strong = false }: { value: string; label: string; strong?: boolean }) {
  return (
    <span className="flex flex-col">
      <b className={`text-[19px] font-bold leading-tight tabular-nums tracking-tight ${strong ? GREEN : ""}`}>{value}</b>
      <span className="text-[11.5px] text-[var(--color-ink-muted)]">{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Secties
 * ------------------------------------------------------------------ */

const HERO_ICON: Record<HeroCard["key"], typeof Play> = { format: Wand2, opening: MessageSquareQuote, lengte: Clock };

function HeroCardView({ c, onPlay }: { c: HeroCard; onPlay: (v: YearVideo) => void }) {
  const Icon = HERO_ICON[c.key];
  const v = c.video;
  return (
    <article className={`flex gap-4 rounded-[18px] border bg-[var(--color-surface)] p-3.5 shadow-[var(--shadow-card)] sm:p-4 ${c.kind === "patroon" ? "border-[#1d6b4c]/40" : "border-[var(--sc-line)]"}`}>
      <PlayThumb v={v} onPlay={onPlay} className="w-[112px] sm:w-[128px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]"><Icon className="size-3.5" />{c.label}</span>
          <KindChip kind={c.kind} n={c.n} />
        </div>
        {c.key === "opening" ? (
          <blockquote className="rounded-[12px] bg-[#00003b] px-3.5 py-3 text-[15.5px] font-semibold leading-snug text-white">“{c.value}”</blockquote>
        ) : (
          <div className="text-[19px] font-bold leading-snug">{c.value}</div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Stat value={fmt(v.views)} label="weergaven" />
          <Stat value={fmt(v.interactions)} label="interacties" />
          <VsAverage v={v.vsAverage} big />
        </div>
        <p className="text-[13px] leading-relaxed"><b>Waarom dit werkt:</b> <span className="text-[var(--color-ink-muted)]">{c.why}</span></p>
        <div className="mt-auto flex items-center gap-2 text-[12px] text-[var(--color-ink-muted)]"><Logos platforms={v.platforms} size={16} /><span className="truncate">Voorbeeld: {v.title}</span></div>
      </div>
    </article>
  );
}

function TopCard({ v, rank, onPlay }: { v: YearVideo; rank: number; onPlay: (v: YearVideo) => void }) {
  return (
    <li className="w-[176px] shrink-0 snap-start sm:w-[206px] lg:w-[220px]">
      <div className={`flex h-full flex-col gap-2.5 rounded-[18px] border bg-[var(--color-surface)] p-2 shadow-[var(--shadow-card)] ${v.above ? "border-[#1d6b4c]/45" : "border-[var(--sc-line)]"}`}>
        <PlayThumb v={v} onPlay={onPlay} rank={rank} big />
        <div className="flex flex-1 flex-col gap-2 px-1 pb-1">
          <button type="button" onClick={() => onPlay(v)} className="line-clamp-2 text-left text-[13px] font-semibold leading-snug hover:underline">{v.title}</button>
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--color-ink-muted)]"><span>{shortDate(v.publishedAt)}</span><Logos platforms={v.platforms} size={16} /></div>
          <div className="grid grid-cols-2 gap-1">
            <Stat value={fmt(v.views)} label="weergaven" strong={v.above} />
            <Stat value={fmt(v.interactions)} label="interacties" />
          </div>
          <div className="mt-auto"><VsAverage v={v.vsAverage} /></div>
        </div>
      </div>
    </li>
  );
}

const DIM_STYLE: Record<GroupDimension, { icon: typeof Play; cls: string; ic: string }> = {
  format: { icon: Wand2, cls: "bg-[#eef7f2] border-[#cfe8db]", ic: "bg-[#1d6b4c] text-white" },
  hook: { icon: MessageSquareQuote, cls: "bg-[#eef0fb] border-[#d6daf3]", ic: "bg-[#00003b] text-white" },
  lengte: { icon: Clock, cls: "bg-[#fdf6e7] border-[#f2e2bb]", ic: "bg-[#c98a00] text-white" },
  cta: { icon: Megaphone, cls: "bg-[#fcefe8] border-[#f3d5c4]", ic: "bg-[#c2410c] text-white" },
  opbouw: { icon: Layers, cls: "bg-[#f2effb] border-[#ddd6f3]", ic: "bg-[#5b4bc4] text-white" },
};

function conclusion(g: YearGroup): string {
  const what = g.dimension === "format" ? `Video's van het type "${g.label}"` : g.dimension === "hook" ? `${g.label}` : g.dimension === "lengte" ? `Video's van ${g.label.toLowerCase()}` : g.dimension === "cta" ? `Afsluiten met: ${g.label.toLowerCase()}` : `Presentatievorm "${g.label}"`;
  return `${what} ${g.dimension === "hook" || g.dimension === "cta" ? "werkt" : "werken"} bij jou ${g.medianPerf >= 1.5 ? "duidelijk " : ""}beter dan normaal.`;
}

function PatternCard({ g, onPlay }: { g: YearGroup; onPlay: (v: YearVideo) => void }) {
  const st = DIM_STYLE[g.dimension];
  const Icon = st.icon;
  return (
    <article className={`flex gap-3.5 rounded-[16px] border p-4 ${st.cls}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className={`grid size-8 place-items-center rounded-lg ${st.ic}`}><Icon className="size-4" /></span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{DIMENSION_LABEL[g.dimension]}</span>
        </div>
        <h3 className="text-[16.5px] font-bold leading-snug">{conclusion(g)}</h3>
        <KindChip kind={g.kind} n={g.n} hits={g.hits} />
        <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          Gemiddeld <b className={GREEN}>{xf(g.medianPerf)}</b> je normale niveau op hetzelfde platform. Een gemiddelde video van dit type haalt {fmt(g.medianViews)} weergaven.
        </p>
      </div>
      <PlayThumb v={g.best} onPlay={onPlay} className="w-[78px] self-start sm:w-[88px]" />
    </article>
  );
}

function FormatCard({ g, rank, onPlay }: { g: YearGroup; rank: number; onPlay: (v: YearVideo) => void }) {
  const strong = g.kind === "patroon" || rank === 1;
  return (
    <li className="w-[300px] shrink-0 snap-start sm:w-[340px]">
      <article className={`flex h-full gap-3.5 rounded-[18px] border bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)] ${strong ? "border-[#1d6b4c]/45" : "border-[var(--sc-line)]"}`}>
        <PlayThumb v={g.best} onPlay={onPlay} className="w-[118px] sm:w-[132px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">#{rank} · {plural(g.n, "video", "video's")}</div>
          <h3 className="text-[16px] font-bold leading-snug">{g.label}</h3>
          <div className="grid grid-cols-1 gap-1.5">
            <Stat value={fmt(g.medianViews)} label="gem. weergaven per video" strong={strong} />
            <Stat value={fmt(g.medianInteractions)} label="gem. interacties per video" />
          </div>
          <div className="mt-auto flex flex-wrap gap-1.5"><VsAverage v={g.vsAverage} />{g.kind === "patroon" ? <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${GREEN_BG} ${GREEN}`}>Bewezen sterk</span> : null}</div>
        </div>
      </article>
    </li>
  );
}

function OpeningCard({ v, onPlay, reason }: { v: YearVideo; onPlay: (v: YearVideo) => void; reason: string }) {
  if (!v.opening) return null;
  return (
    <article className="flex gap-3.5 rounded-[18px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-3.5 shadow-[var(--shadow-card)]">
      <PlayThumb v={v} onPlay={onPlay} className="w-[92px] self-start sm:w-[104px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <blockquote className="rounded-[12px] bg-[#00003b] px-4 py-3.5 text-[16px] font-semibold leading-snug text-white">“{v.opening.text}”</blockquote>
        <span className="text-[11.5px] font-semibold text-[var(--color-ink-muted)]">{v.opening.source === "transcript" ? "Letterlijk uitgesproken in de video" : "Letterlijk uit het script"}</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Stat value={fmt(v.views)} label="weergaven" strong={v.above} />
          <Stat value={fmt(v.interactions)} label="interacties" />
          <VsAverage v={v.vsAverage} />
        </div>
        <p className="text-[13px] leading-relaxed"><b>Waarom dit waarschijnlijk werkt:</b> <span className="text-[var(--color-ink-muted)]">{reason}</span></p>
        <div className="flex items-center gap-2 text-[12px] text-[var(--color-ink-muted)]"><Logos platforms={v.platforms} size={16} />{shortDate(v.publishedAt)}</div>
      </div>
    </article>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[14px] border border-dashed border-[var(--sc-line)] px-4 py-6 text-center text-[13.5px] text-[var(--color-ink-muted)]">{children}</p>;
}

/* ------------------------------------------------------------------ *
 * Pagina
 * ------------------------------------------------------------------ */

export function ClientYearView({ view, children }: { view: YearView; children?: ReactNode }) {
  const [playing, setPlaying] = useState<Playable | null>(null);
  const play = useCallback((v: YearVideo) => setPlaying(toPlayable(v)), []);
  const p = view.period;
  const periodText = p.startedLate ? `Vanaf je start op ${longDate(p.from)} tot en met ${longDate(p.to)}` : `1 januari tot en met ${longDate(p.to)}`;

  const nextSteps = view.patterns.slice(0, 4).map((g) =>
    g.dimension === "format" ? `Vaker video's van het type "${g.label}" maken.` : g.dimension === "hook" ? `${g.label}: vaker zo openen, met een nieuwe zin.` : g.dimension === "lengte" ? `De lengte van ${g.label.toLowerCase()} aanhouden.` : g.dimension === "cta" ? `Vaker afsluiten met: ${g.label.toLowerCase()}.` : `De presentatievorm "${g.label}" vaker inzetten.`,
  );

  return (
    <div className="flex flex-col gap-10">
      {/* Kop met periode */}
      <section className="overflow-hidden rounded-[22px] bg-[#00003b] p-6 text-white sm:p-8">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Contentgeheugen {p.year}</div>
        <h1 className="mt-1 text-[27px] font-bold leading-tight tracking-tight">Wat we over jouw content hebben geleerd</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-white/70">Welke video&apos;s werken, waarom ze werken en wat we meenemen naar je volgende video&apos;s. Automatisch bijgewerkt uit de echte resultaten.</p>
        <div className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px]">
          <span className="font-semibold">Geanalyseerd:</span> {periodText} · {plural(view.videoCount, "video", "video's")}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 sm:max-w-2xl">
          {[[fmt(view.videoCount), "video's dit jaar"], [fmt(view.totalViews), "weergaven"], [fmt(view.totalInteractions), "interacties"]].map(([v, l]) => (
            <div key={l} className="rounded-xl bg-white/[0.08] p-3"><div className="text-[24px] font-bold tabular-nums leading-tight">{v}</div><div className="text-[12px] text-white/65">{l}</div></div>
          ))}
        </div>
        {view.platforms.length ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {view.platforms.map((pl) => (
              <li key={pl.platform} className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] py-1 pl-1 pr-3 text-[12.5px]">
                <PlatformLogo platform={pl.platform} size={22} /><b className="tabular-nums">{fmt(pl.views)}</b><span className="text-white/60">weergaven</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {!view.videoCount ? (
        <Empty>Er zijn in deze periode nog geen video&apos;s met resultaten. Zodra je eerste video&apos;s live staan, bouwt je contentgeheugen zich hier automatisch op.</Empty>
      ) : null}

      {view.videoCount && !view.sufficient ? (
        <section className="rounded-[18px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-6">
          <h2 className="text-[18px] font-bold">Je contentgeheugen wordt opgebouwd</h2>
          <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">Vanaf 6 video&apos;s die minstens een week online staan, tonen we hier de eerste patronen. We trekken bewust geen conclusies uit een paar video&apos;s. Je best presterende video&apos;s zie je hieronder al wel.</p>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--sc-fill)]"><div className="h-full rounded-full bg-[#1d6b4c]" style={{ width: `${Math.min(100, (view.analyzedCount / 6) * 100)}%` }} /></div>
          <div className="mt-1.5 text-[12px] text-[var(--color-ink-muted)]">{view.analyzedCount} van 6 video&apos;s</div>
        </section>
      ) : null}

      {/* 2. Zo ziet jouw best presterende video eruit */}
      {view.hero.length ? (
        <section className="flex flex-col gap-4">
          <SectionHead icon={Target} tone="green" label="Wat werkt voor jou" title="Zo ziet jouw best presterende video eruit" sub="Bij elk inzicht een echte video die goed presteerde. Klik op de video om hem volledig te bekijken." />
          <div className="grid gap-3.5 xl:grid-cols-3 lg:grid-cols-2">{view.hero.map((c) => <HeroCardView key={c.key} c={c} onPlay={play} />)}</div>
        </section>
      ) : null}

      {/* 6. Best presterende video's */}
      {view.top.length ? (
        <section className="flex flex-col gap-3">
          <SectionHead icon={Trophy} tone="green" label={`Beste video's ${p.year}`} title="Je best presterende video's van dit jaar" sub={`Op aantal weergaven, opgeteld over alle platforms. Een gemiddelde video van jou haalt dit jaar ${fmt(view.averageViews)} weergaven; groen gemarkeerd betekent minstens 1,2x zoveel.`} />
          <Rail ariaLabel="Best presterende video's" label={`${view.top.length} video's`}>
            {view.top.map((v, i) => <TopCard key={v.key} v={v} rank={i + 1} onPlay={play} />)}
          </Rail>
        </section>
      ) : null}

      {children}

      {/* 3. Wat bij jou structureel goed werkt */}
      {view.sufficient ? (
        <section className="flex flex-col gap-4">
          <SectionHead icon={Sparkles} tone="violet" label="Sterkste patronen" title="Wat bij jou structureel goed werkt" sub="Alleen wat bij minstens drie video's terugkomt noemen we een patroon. Vergeleken binnen hetzelfde platform, dus eerlijk ten opzichte van elkaar." />
          {view.patterns.length ? (
            <div className="grid gap-3.5 md:grid-cols-2">{view.patterns.map((g) => <PatternCard key={`${g.dimension}-${g.label}`} g={g} onPlay={play} />)}</div>
          ) : (
            <Empty>Er is dit jaar nog geen onderdeel dat bij minstens drie video&apos;s duidelijk beter scoorde. Zodra dat zo is, zie je het hier.</Empty>
          )}
          {view.early.length ? (
            <div className="rounded-[16px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Nog geen patroon, wel opvallend</div>
              <ul className="mt-3 grid gap-3 md:grid-cols-3">
                {view.early.map((g) => (
                  <li key={`${g.dimension}-${g.label}`} className="flex gap-3">
                    <PlayThumb v={g.best} onPlay={play} className="w-[56px]" />
                    <div className="min-w-0 text-[13px]">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{DIMENSION_LABEL[g.dimension]}</div>
                      <div className="font-semibold leading-snug">{g.label}</div>
                      <div className="mt-1"><KindChip kind={g.kind} n={g.n} /></div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 4. Formats */}
      {view.sufficient && view.formats.length ? (
        <section className="flex flex-col gap-3">
          <SectionHead icon={Wand2} tone="green" label="Formats" title="Deze soorten video's werken het beste" sub="Per type video het aantal video's en de gemiddelde resultaten per video, vergeleken met je gemiddelde video van dit jaar." />
          <Rail ariaLabel="Formats" label={`${view.formats.length} formats`}>
            {view.formats.map((g, i) => <FormatCard key={g.label} g={g} rank={i + 1} onPlay={play} />)}
          </Rail>
        </section>
      ) : null}

      {/* 5. Openingszinnen */}
      {view.analyzedCount ? (
        <section className="flex flex-col gap-4">
          <SectionHead icon={MessageSquareQuote} tone="navy" label="Openingszinnen" title="Openingszinnen die de aandacht pakken" sub="De letterlijke openingszin uit het script of uit de video zelf, nooit een verzonnen voorbeeld." />
          {view.openings.length ? (
            <div className="grid gap-3.5 lg:grid-cols-2">{view.openings.map((v) => <OpeningCard key={v.key} v={v} onPlay={play} reason={openingReason(v.opening?.text ?? "")} />)}</div>
          ) : (
            <Empty>Voor de video&apos;s van dit jaar is nog geen letterlijke openingszin uit het script of de video gekoppeld. We tonen hier bewust geen afgeleide of verzonnen zinnen.</Empty>
          )}
        </section>
      ) : null}

      {/* Afsluiters */}
      {view.sufficient && view.ctas.length ? (
        <section className="flex flex-col gap-4">
          <SectionHead icon={Megaphone} tone="rose" label="Call to actions" title="Afsluiters die werken" />
          <div className="grid gap-3.5 md:grid-cols-3">
            {view.ctas.map((g) => {
              const ex = g.videos.find((v) => v.ctaText && !/^(https?:\/\/|www\.)\S+$/i.test(v.ctaText.trim()));
              return (
                <article key={g.label} className="flex flex-col gap-2 rounded-[16px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
                  <div className="text-[16px] font-bold">{g.label}</div>
                  <div className="flex flex-wrap gap-1.5"><KindChip kind={g.kind} n={g.n} hits={g.hits} /></div>
                  {ex?.ctaText ? <div className="rounded-[10px] bg-[var(--sc-fill)] p-2.5 text-[13px] italic">“{ex.ctaText}”</div> : null}
                  <div className="mt-auto text-[12.5px] text-[var(--color-ink-muted)]">Gemiddeld <b className={GREEN}>{xf(g.medianPerf)}</b> je normale niveau</div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Volgende stap */}
      {nextSteps.length ? (
        <section className="rounded-[20px] bg-[#00003b] p-6 text-white sm:p-7">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/60"><Lightbulb className="size-4" />Volgende stap</div>
          <h2 className="mt-1.5 text-[21px] font-bold tracking-tight">Wat we meenemen naar je volgende video&apos;s</h2>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {nextSteps.map((s) => <li key={s} className="flex gap-3 rounded-xl bg-white/[0.08] p-3 text-[14px]"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#5fd39a]" />{s}</li>)}
          </ul>
        </section>
      ) : null}

      <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
        Periode: {periodText}. Dezelfde video op meerdere platforms telt als één video; weergaven en interacties zijn per platform opgeteld, zoals op de Resultatenpagina. &quot;Je gemiddelde video&quot; is de middelste video van deze periode, zodat één uitschieter het beeld niet vertekent. Patronen worden binnen hetzelfde platform vergeleken.
        {view.tooYoung > 0 ? ` ${plural(view.tooYoung, "video staat", "video's staan")} korter dan een week online of ${view.tooYoung === 1 ? "is" : "zijn"} geen video en ${view.tooYoung === 1 ? "telt" : "tellen"} nog niet mee in de patronen.` : ""} Een patroon laat zien wat samen opvalt, niet wat de enige oorzaak is.
        {view.lastMeasured ? ` Laatst bijgewerkt: ${new Date(view.lastMeasured).toLocaleDateString("nl-NL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}.` : ""}
      </p>

      {playing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(0,0,20,0.75)] p-2.5 backdrop-blur-sm sm:p-6" onClick={(e) => e.target === e.currentTarget && setPlaying(null)}>
          <PlayerModal key={playing.playSrc ?? playing.embedSrc ?? playing.title} p={playing} onClose={() => setPlaying(null)} />
        </div>
      ) : null}
    </div>
  );
}
