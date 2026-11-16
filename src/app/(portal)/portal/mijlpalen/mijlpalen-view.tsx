"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarCheck, Check, Copy, Download, Eye, Handshake, Heart, Info, Lock, Play, Share2, Sparkles, Target, Trophy, X } from "lucide-react";
import { portalBtn } from "@/components/portal/status-pill";
import { CATEGORIES, METALS, longDateNl, type AwardState, type MilestoneCategory, type MilestonesData } from "@/lib/milestones";
import { AwardBadge, badgeSvg } from "./award-badge";
import { CountUp } from "./count-up";
import { ArchiveModal, InteractionsModal, PlayerModal, TopSix, ViewsModal, playableFromLibrary, type Playable } from "./video-parts";

const nf = new Intl.NumberFormat("nl-NL");
const fmt = (n: number) => nf.format(n);
const pctNl = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;
const CAT_ICON: Record<MilestoneCategory, typeof Eye> = { bereik: Eye, content: Play, samenwerking: Handshake };
const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn" };

type Modal =
  | { kind: "award"; key: string }
  | { kind: "share"; key: string }
  | { kind: "year"; slide: number }
  | { kind: "new"; key: string }
  | { kind: "archive" }
  | { kind: "views" }
  | { kind: "interactions" }
  | null;

export function MijlpalenView({ data }: { data: MilestonesData }) {
  const [cat, setCat] = useState<"alle" | MilestoneCategory>("alle");
  const [modal, setModal] = useState<Modal>(null);
  const [allTl, setAllTl] = useState(false);
  const [playing, setPlaying] = useState<Playable | null>(null);
  const close = useCallback(() => setModal(null), []);

  const achieved = data.awards.filter((a) => a.achieved);
  const byKey = useMemo(() => new Map(data.awards.map((a) => [a.key, a])), [data.awards]);

  // Nieuw behaalde mijlpaal: één keer een rustige viering tonen. Bij het eerste
  // bezoek tellen alle bestaande awards als gezien (geen vieringen van oud nieuws).
  useEffect(() => {
    const storeKey = `sc-mijlpalen-gezien:${data.clientName}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = localStorage.getItem(storeKey);
      const keys = achieved.map((a) => a.key);
      if (raw) {
        const seen = new Set<string>(JSON.parse(raw));
        const fresh = achieved.filter((a) => !seen.has(a.key)).sort((a, b) => (b.achievedOn ?? "").localeCompare(a.achievedOn ?? ""));
        const first = fresh[0];
        // Kort na het laden tonen, zodat de pagina eerst rustig in beeld staat.
        if (first) timer = setTimeout(() => setModal({ kind: "new", key: first.key }), 700);
      }
      localStorage.setItem(storeKey, JSON.stringify(keys));
    } catch {
      /* geen opslag beschikbaar: dan geen viering */
    }
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!modal && !playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (playing) setPlaying(null);
        else close();
        return;
      }
      if (!modal) return;
      if (modal.kind === "year") {
        if (e.key === "ArrowRight") setModal((m) => (m && m.kind === "year" ? { kind: "year", slide: m.slide + 1 } : m));
        if (e.key === "ArrowLeft") setModal((m) => (m && m.kind === "year" ? { kind: "year", slide: Math.max(0, m.slide - 1) } : m));
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [modal, playing, close]);

  const timeline = achieved.filter((a) => a.achievedOn).sort((a, b) => (b.achievedOn ?? "").localeCompare(a.achievedOn ?? ""));
  const shownTl = allTl ? timeline : timeline.slice(0, 6);
  const libById = useMemo(() => new Map(data.library.map((l) => [l.id, l])), [data.library]);
  const statsByKey = useMemo(() => new Map(data.videos.map((v) => [v.key, v])), [data.videos]);
  const avg = data.totals.videos > 0 ? Math.round(data.totals.views / data.totals.videos) : 0;
  const cats = cat === "alle" ? (Object.keys(CATEGORIES) as MilestoneCategory[]) : [cat];

  return (
    <div className="flex flex-col gap-[22px]">
      {/* Intro */}
      <section className="ms-hero relative overflow-hidden rounded-[20px] px-6 py-7 text-white shadow-[var(--shadow-raised)] sm:px-8 sm:py-9">
        <div className="relative z-[1]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Onze mijlpalen</div>
          <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight sm:text-[32px]">Bekijk wat we samen hebben bereikt</h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/75">
            Van onze eerste video tot miljoenen weergaven. Hier vind je alle resultaten en mijlpalen die {data.clientName} samen met Shortclips heeft behaald.
          </p>
          {data.startedOn ? (
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] text-white/85">
              <Handshake className="size-3.5" /> Samen sinds {longDateNl(data.startedOn)}
              {data.daysTogether ? <span className="text-white/55">· {fmt(data.daysTogether)} dagen</span> : null}
            </div>
          ) : null}
        </div>
        {data.awards.length > 0 ? (
          <div className="relative z-[1] mt-6 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-[auto_auto_1fr] sm:items-center sm:gap-6">
            <div className="flex items-center gap-3">
              <span className="ms-hero-chip grid size-10 place-items-center rounded-[12px] text-[#f5d58a]"><Trophy className="size-5" /></span>
              <div className="leading-tight">
                <b className="block text-[22px] font-bold"><CountUp value={achieved.length} duration={1200} /></b>
                <span className="text-[12px] text-white/65">awards behaald</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-[12px] border border-white/15 bg-white/[0.05] text-white/70"><Lock className="size-[18px]" /></span>
              <div className="leading-tight">
                <b className="block text-[22px] font-bold"><CountUp value={data.awards.length - achieved.length} duration={1200} /></b>
                <span className="text-[12px] text-white/65">nog te ontgrendelen</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex justify-between text-[12px] text-white/65">
                <span>Jullie awardcollectie</span>
                <span className="tabular-nums text-white/85">{achieved.length} van {data.awards.length}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Awards behaald" aria-valuenow={achieved.length} aria-valuemin={0} aria-valuemax={data.awards.length}>
                <div className="ms-grow ms-gold-bar h-full rounded-full" style={{ width: `${data.awards.length ? Math.max(3, (achieved.length / data.awards.length) * 100) : 0}%` }} />
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Kerncijfers */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Kerncijfers">
        <Stat icon={Play} label="Gepubliceerde video's" value={data.totals.videos} delay={0} sub={data.totals.firstVideoOn ? `Eerste video op ${longDateNl(data.totals.firstVideoOn)}` : "Sinds de start"} cta="Bekijk alle video's" onClick={data.library.length || data.videos.length ? () => setModal({ kind: "archive" }) : undefined} />
        <Stat icon={Eye} label="Totaal aantal views" value={data.totals.views} delay={120} sub={avg > 0 ? `Gemiddeld ${fmt(avg)} per video` : "Op alle kanalen"} cta="Bekijk per video" onClick={data.videos.length ? () => setModal({ kind: "views" }) : undefined} />
        <Stat icon={Heart} label="Totaal aantal interacties" value={data.totals.interactions} delay={240} sub="Likes, reacties, shares en saves" cta="Bekijk de uitsplitsing" onClick={data.videos.length ? () => setModal({ kind: "interactions" }) : undefined} />
        <Stat icon={Trophy} label="Behaalde mijlpalen" value={achieved.length} delay={360} sub={`${achieved.length} van ${data.awards.length} awards`} cta="Bekijk de awards" onClick={() => document.getElementById("awards")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      </section>

      {/* Jaaroverzicht: volledige breedte */}
      {data.year ? (
        <section aria-labelledby="ms-jaar" className="ms-hero relative overflow-hidden rounded-[20px] px-5 py-7 text-white shadow-[var(--shadow-raised)] sm:px-8 sm:py-9">
          <span aria-hidden className="pointer-events-none absolute -top-6 right-4 hidden text-[170px] font-bold leading-none tracking-tighter text-white/[0.045] md:block">{data.year.year}</span>
          <div className="relative max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f5d58a]">
              <span className="size-1.5 rounded-full bg-[#f5d58a]" /> Shortclips Jaaroverzicht
            </div>
            <h2 id="ms-jaar" className="mt-2 text-[24px] font-bold leading-tight tracking-tight sm:text-[30px]">Jullie jaar in short video, {data.year.year}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-white/72">
              Dit hebben jullie van {data.year.periodLabel} samen met Shortclips neergezet. De cijfers worden automatisch bijgewerkt met de nieuwste statistieken.
            </p>
          </div>
          <ul className="relative mt-6 grid grid-cols-2 gap-2.5 sm:mt-7 sm:gap-3 lg:grid-cols-4 lg:gap-4">
            <YearStat icon={Play} n={data.year.videos} l="Gepubliceerde video's" sub="Short video's online gezet" delay={0} />
            <YearStat icon={Eye} n={data.year.views} l="Totaal aantal views" sub="Op alle kanalen samen" delay={120} />
            <YearStat icon={Heart} n={data.year.interactions} l="Totaal aantal interacties" sub="Likes, reacties, shares en saves" delay={240} />
            <YearStat icon={Trophy} n={data.year.awardKeys.length} l="Behaalde awards" sub={`Behaald in ${data.year.year}`} delay={360} gold />
          </ul>
          <div className="relative mt-7">
            <button type="button" onClick={() => setModal({ kind: "year", slide: 0 })} className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[11px] bg-white px-4 text-[14px] sm:px-5 sm:text-[14.5px] font-semibold text-[#00003b] shadow-[0_10px_24px_-12px_rgba(0,0,0,0.5)] transition-colors hover:bg-white/90">
              Bekijk het volledige jaaroverzicht <ArrowRight className="size-4" />
            </button>
          </div>
        </section>
      ) : null}

      {/* Deze awards kunnen jullie nog behalen */}
      {data.awards.length > 0 ? (
        <section aria-labelledby="ms-volgende" className="sc-glass p-5 sm:p-7">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <SectionHead id="ms-volgende" tone="gold" kicker="Volgende doelen" title="Deze awards kunnen jullie nog behalen" sub="De eerstvolgende award per categorie. De voortgang beweegt automatisch mee met jullie resultaten." />
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-green-bg)] px-3 py-1 text-[12.5px] font-semibold text-[var(--st-green)]"><Check className="size-3.5" /> {achieved.length} behaald</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ms-gold-bg)] px-3 py-1 text-[12.5px] font-semibold text-[var(--ms-gold-ink)]"><Target className="size-3.5" /> {data.awards.length - achieved.length} nog te behalen</span>
              <button type="button" onClick={() => document.getElementById("awards")?.scrollIntoView({ behavior: "smooth", block: "start" })} className={portalBtn.soft + " h-9"}>
                Bekijk de volledige collectie <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
          {data.next.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.next.map((a) => (
                <NextAwardCard key={a.key} a={a} onOpen={() => setModal({ kind: "award", key: a.key })} />
              ))}
            </div>
          ) : (
            <div className="rounded-[16px] border border-[var(--sc-line)] bg-[var(--st-green-bg)] px-5 py-4 text-[14px] font-medium text-[var(--st-green)]">
              Alle beschikbare awards zijn behaald. Samen bouwen we verder aan jullie online zichtbaarheid.
            </div>
          )}
        </section>
      ) : null}

      {/* Recente mijlpalen */}
      {timeline.length > 0 ? (
        <section aria-labelledby="ms-recent" className="sc-glass p-5 sm:p-7">
          <div className="mb-6">
            <SectionHead id="ms-recent" tone="green" kicker="Behaalde successen" title="Recente mijlpalen" sub="De nieuwste mijlpalen bovenaan. Elke mijlpaal wordt automatisch vastgelegd op het moment dat hij is behaald." />
          </div>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shownTl.map((a) => {
              const lib = a.videoId ? libById.get(a.videoId) : undefined;
              const stats = lib?.statsKey ? (statsByKey.get(lib.statsKey) ?? null) : null;
              return (
                <MilestoneCard
                  key={a.key}
                  a={a}
                  onOpen={() => setModal({ kind: "award", key: a.key })}
                  onPlay={lib ? () => setPlaying(playableFromLibrary(lib, stats)) : undefined}
                />
              );
            })}
          </ol>
          {timeline.length > 6 ? (
            <button type="button" onClick={() => setAllTl((v) => !v)} className={`${portalBtn.soft} mt-5 h-10`}>
              {allTl ? "Toon minder" : `Toon alle ${timeline.length} mijlpalen`}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* Awards */}
      <section id="awards" className="sc-glass scroll-mt-20 p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3">
            <SectionHead tone="navy" kicker="Awardcollectie" title="Jullie volledige awardcollectie" sub="Klik op een award voor de details. Bij elke award die nog openstaat zie je wat er nodig is en hoe ver jullie al zijn." />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-ink-muted)]">
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--st-green)]" /> Behaald</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#d2a548]" /> Nog te behalen</span>
            </div>
          </div>
          <div role="tablist" aria-label="Categorie" className="flex w-full flex-wrap gap-1 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1 sm:w-auto">
            {([["alle", "Alle"], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])] as Array<[string, string]>).map(([k, label]) => {
              const list = k === "alle" ? data.awards : data.awards.filter((a) => a.category === k);
              const on = cat === k;
              return (
                <button
                  key={k}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  onClick={() => setCat(k as typeof cat)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors sm:flex-none ${on ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)]" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
                >
                  {label}
                  <span className={`hidden rounded-full px-1.5 text-[11px] tabular-nums sm:inline ${on ? "bg-[var(--st-blue-bg)] text-[var(--sc-accent)]" : "bg-[var(--sc-fill-strong)]"}`}>
                    {list.filter((a) => a.achieved).length}/{list.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-7">
          {cats.map((c) => {
            const list = data.awards.filter((a) => a.category === c);
            return (
              <div key={c} className="flex flex-col gap-3.5 [&+&]:border-t [&+&]:border-[var(--sc-line)] [&+&]:pt-6">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <h3 className="text-[15px] font-semibold">{CATEGORIES[c].label}</h3>
                  <span className="text-[12.5px] text-[var(--color-ink-muted)]">{CATEGORIES[c].sub} · {list.filter((a) => a.achieved).length} van {list.length} behaald</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {list.map((a, i) => (
                    <AwardTile key={a.key} a={a} index={i} onOpen={() => setModal({ kind: "award", key: a.key })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Top 6 */}
      {data.videos.some((v) => v.views > 0) ? <TopSix videos={data.videos} onPlay={setPlaying} /> : null}

      {/* Fysieke Short Video Award */}
      {data.physicalAward ? (
        <section className="sc-glass grid items-center gap-8 p-5 sm:p-7 lg:grid-cols-[minmax(260px,360px)_1fr]">
          <Plaque name={data.clientName} pa={data.physicalAward} />
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--st-blue-bg)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--sc-accent)]">
              <Trophy className="size-3.5" /> Shortclips Awards
            </span>
            <h2 className="mt-2.5 text-[20px] font-bold tracking-tight">Short Video Award {data.physicalAward.year}</h2>
            <p className="mt-2 max-w-[58ch] text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              Ieder jaar reiken we persoonlijk een fysieke award uit aan partners met een bijzondere prestatie. Hier zie je de digitale versie van jullie award, met dezelfde resultaten als op het exemplaar dat we komen overhandigen.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <Fact l="Bedrijfsnaam" v={data.clientName} />
              <Fact l="Geproduceerde shorts" v={fmt(data.physicalAward.videos)} />
              <Fact l="Behaalde views" v={fmt(data.physicalAward.views)} />
              <Fact l="Interacties" v={fmt(data.physicalAward.interactions)} />
            </div>
            <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-[var(--color-ink-faint)]">
              <Info className="mt-0.5 size-4 shrink-0 text-[var(--sc-accent)]" />
              Resultaten vanaf 1 januari {data.physicalAward.year}, stand per {longDateNl(data.physicalAward.standOn)}. De definitieve cijfers worden vastgelegd bij de uitreiking.
            </p>
          </div>
        </section>
      ) : null}

      {data.lastUpdated ? (
        <p className="text-[12px] text-[var(--color-ink-faint)]">Statistieken bijgewerkt tot en met {longDateNl(data.lastUpdated)}. Mijlpalen worden automatisch bijgewerkt.</p>
      ) : null}

      {/* Vensters */}
      {modal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(0,0,30,0.6)] p-2.5 backdrop-blur-sm sm:items-center sm:p-6" onClick={(e) => e.target === e.currentTarget && close()}>
          {modal.kind === "award" || modal.kind === "share" ? (
            <AwardModal a={byKey.get(modal.key)!} share={modal.kind === "share"} clientName={data.clientName} totals={data.totals} onClose={close} onShare={(s) => setModal({ kind: s ? "share" : "award", key: modal.key })} />
          ) : modal.kind === "archive" ? (
            <ArchiveModal videos={data.videos} library={data.library} totalPublished={data.totals.videos} onClose={close} onPlay={setPlaying} />
          ) : modal.kind === "views" ? (
            <ViewsModal videos={data.videos} totalViews={data.totals.views} onClose={close} onPlay={setPlaying} />
          ) : modal.kind === "interactions" ? (
            <InteractionsModal videos={data.videos} totalInteractions={data.totals.interactions} onClose={close} onPlay={setPlaying} />
          ) : modal.kind === "new" ? (
            <NewModal a={byKey.get(modal.key)!} onClose={close} onOpen={() => setModal({ kind: "award", key: modal.key })} />
          ) : data.year ? (
            <YearModal data={data} byKey={byKey} slide={modal.slide} setSlide={(s) => setModal({ kind: "year", slide: s })} onClose={close} />
          ) : null}
        </div>
      ) : null}

      {/* Speler (boven een eventueel open lijst) */}
      {playing ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(0,0,20,0.75)] p-2.5 backdrop-blur-sm sm:p-6" onClick={(e) => e.target === e.currentTarget && setPlaying(null)}>
          <PlayerModal key={playing.playSrc ?? playing.embedSrc ?? playing.title} p={playing} onClose={() => setPlaying(null)} />
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Kleine onderdelen ---------- */

function Stat({ icon: Icon, label, value, delay = 0, sub, cta, onClick }: { icon: typeof Eye; label: string; value: number; delay?: number; sub: string; cta?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--st-blue-bg)] text-[var(--sc-accent)]"><Icon className="size-[15px]" /></span>
        <span className="leading-tight">{label}</span>
      </div>
      <div className="text-[22px] font-bold tabular-nums tracking-tight sm:text-[28px]"><CountUp value={value} delay={delay} /></div>
      <div className="text-[12px] text-[var(--color-ink-faint)]">{sub}</div>
      {onClick && cta ? <div className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--sc-accent)]">{cta} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></div> : null}
    </>
  );
  if (!onClick) return <div className="sc-glass flex flex-col gap-1.5 p-4 sm:p-5">{body}</div>;
  return (
    <button type="button" onClick={onClick} className="sc-glass group flex flex-col gap-1.5 p-4 text-left transition-shadow hover:shadow-[var(--shadow-raised)] sm:p-5">
      {body}
    </button>
  );
}


function Bar({ pct, thin = false }: { pct: number; thin?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-full bg-[var(--sc-fill-strong)] ${thin ? "h-1.5" : "h-2.5"}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="ms-bar ms-grow h-full rounded-full" style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

function Fact({ l, v }: { l: string; v: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3.5 py-3 text-[12px] text-[var(--color-ink-muted)]">
      {l}
      <b className="mt-0.5 block text-[15px] font-semibold tabular-nums text-[var(--color-ink)]">{v}</b>
    </div>
  );
}

function AwardTile({ a, index, onOpen }: { a: AwardState; index: number; onOpen: () => void }) {
  if (a.achieved) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={{ ["--glow" as string]: METALS[a.metal].glow, ["--d" as string]: `${(index % 5) * 1.3}s` }}
        aria-label={`${a.name}, behaald`}
        className="ms-award ms-got ms-unlocked group relative flex flex-col items-center gap-2 overflow-hidden rounded-[16px] border px-3 pb-4 pt-5 text-center transition-all duration-300 hover:-translate-y-0.5"
      >
        <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-[var(--st-green-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--st-green)]">
          <Check className="size-3" /> Behaald
        </span>
        <span className="relative mt-2 block size-[84px] sm:size-[92px]">
          <AwardBadge award={a} className="ms-badge-got size-full" />
          <Sparkles aria-hidden className="ms-twinkle absolute -right-1 -top-1 size-4 text-[color:var(--glow)]" />
        </span>
        <span className="text-[13px] font-semibold leading-snug">{a.name}</span>
        <span className="text-[11.5px] font-medium text-[var(--color-ink-muted)]">{a.achievedOn ? `Behaald op ${longDateNl(a.achievedOn)}` : `${METALS[a.metal].label} award`}</span>
      </button>
    );
  }
  const showCount = a.category !== "samenwerking" && a.threshold > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${a.name}, nog te ontgrendelen, ${Math.round(a.progressPct)} procent`}
      className="ms-award ms-locked group relative flex flex-col items-center gap-2 overflow-hidden rounded-[16px] border px-3 pb-4 pt-5 text-center transition-all duration-300 hover:-translate-y-0.5"
    >
      <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10.5px] font-semibold text-white/75">
        <Lock className="size-3" /> Nog te ontgrendelen
      </span>
      <span className="relative mt-2 block size-[84px] sm:size-[92px]">
        <AwardBadge award={a} className="ms-badge-lock size-full" />
        <span className="ms-lock-badge absolute inset-0 m-auto grid size-9 place-items-center rounded-full text-white"><Lock className="size-4" /></span>
      </span>
      <span className="text-[13px] font-semibold leading-snug text-white">{a.name}</span>
      <span className="text-[11.5px] leading-snug text-white/60">Doel: {targetLabel(a)}</span>
      <span className="mt-0.5 w-full">
        <span className="flex justify-between text-[11px] tabular-nums text-white/70">
          <span>{showCount ? `${fmt(a.current)} van ${fmt(a.threshold)}` : "Voortgang"}</span>
          <b className="font-semibold text-white">{Math.floor(a.progressPct)}%</b>
        </span>
        <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <span className="ms-grow ms-lock-bar block h-full rounded-full" style={{ width: `${Math.max(2, a.progressPct)}%` }} />
        </span>
      </span>
      <span className="text-[11.5px] font-medium leading-snug text-[#f5d58a]">{lockedLine(a)}</span>
    </button>
  );
}

function lockedLine(a: AwardState): string {
  const left = Math.max(0, a.threshold - a.current);
  if (a.category === "bereik" && left > 0) return `Nog ${fmt(left)} views te gaan`;
  if (a.category === "content" && left > 0) return `Nog ${fmt(left)} video${left === 1 ? "" : "'s"} te gaan`;
  if (a.category === "samenwerking" && a.remainingLine.startsWith("Op ")) return `Automatisch behaald op ${a.remainingLine.slice(3)}`;
  return a.remainingLine;
}

function currentLabel(a: AwardState): string {
  if (a.category === "bereik") return `${fmt(a.current)} views`;
  if (a.category === "content") return `${fmt(a.current)} video's`;
  return `${fmt(a.current)} dagen`;
}
function targetLabel(a: AwardState): string {
  if (a.category === "bereik") return `${fmt(a.threshold)} views`;
  if (a.category === "content") return `${fmt(a.threshold)} video's`;
  return a.name.replace(" samenwerking", "");
}
function timelineText(a: AwardState): string {
  if (a.category === "bereik") return `${a.name} bereikt`;
  return a.name;
}

/* ---------- Mijlpalen v3: kopjes, jaarcijfers, volgende awards, mijlpaalkaarten ---------- */

const TONE: Record<"gold" | "green" | "navy", { text: string; dot: string }> = {
  gold: { text: "text-[var(--ms-gold-ink)]", dot: "bg-[#d2a548]" },
  green: { text: "text-[var(--st-green)]", dot: "bg-[var(--st-green)]" },
  navy: { text: "text-[var(--ms-navy-ink)]", dot: "bg-[var(--ms-navy-ink)]" },
};

function SectionHead({ id, tone, kicker, title, sub }: { id?: string; tone: keyof typeof TONE; kicker: string; title: string; sub: string }) {
  const t = TONE[tone];
  return (
    <div className="min-w-0 max-w-2xl">
      <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${t.text}`}>
        <span className={`size-1.5 rounded-full ${t.dot}`} /> {kicker}
      </div>
      <h2 id={id} className="mt-1.5 text-[21px] font-bold leading-tight tracking-tight sm:text-[24px]">{title}</h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">{sub}</p>
    </div>
  );
}

function YearStat({ icon: Icon, n, l, sub, delay, gold = false }: { icon: typeof Eye; n: number; l: string; sub: string; delay: number; gold?: boolean }) {
  return (
    <li className="flex min-w-0 flex-col gap-2.5 rounded-[16px] border border-white/10 bg-white/[0.06] p-3.5 sm:gap-3 sm:p-6">
      <span className={`grid size-9 place-items-center rounded-[11px] sm:size-11 sm:rounded-[12px] ${gold ? "ms-hero-chip text-[#f5d58a]" : "border border-white/15 bg-white/[0.08] text-white"}`}>
        <Icon className="size-[18px] sm:size-5" />
      </span>
      <b className="block text-[24px] min-[420px]:text-[28px] sm:text-[34px] lg:text-[40px] font-bold leading-none tabular-nums tracking-tight"><CountUp value={n} delay={delay} duration={1400} /></b>
      <span className="leading-snug">
        <span className="block text-[13px] font-semibold text-white sm:text-[14px]">{l}</span>
        <span className="block text-[11.5px] text-white/60 sm:text-[12.5px]">{sub}</span>
      </span>
    </li>
  );
}

function conditionText(a: AwardState): string {
  if (a.category === "bereik") return `${fmt(a.threshold)} views op alle kanalen samen`;
  if (a.category === "content") return `${fmt(a.threshold)} gepubliceerde short video's`;
  return `${a.name.replace(" samenwerking", "")} samenwerking met Shortclips`;
}

function NextAwardCard({ a, onOpen }: { a: AwardState; onOpen: () => void }) {
  const Icon = CAT_ICON[a.category];
  const counted = a.category !== "samenwerking";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${a.name}, nog te behalen, ${Math.floor(a.progressPct)} procent`}
      className="ms-next group flex flex-col gap-5 rounded-[18px] border p-5 text-left transition-all duration-300 hover:-translate-y-0.5 sm:p-6"
    >
      <span className="flex items-start gap-4">
        <span className="relative block size-[84px] shrink-0 sm:size-[96px]">
          <AwardBadge award={a} className="ms-next-badge size-full" />
          <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-[#00003b] text-[#f5d58a] ring-2 ring-[var(--color-surface)]"><Lock className="size-3.5" /></span>
        </span>
        <span className="min-w-0 pt-0.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ms-gold-bg)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--ms-gold-ink)]">
            <Icon className="size-3.5" /> {CATEGORIES[a.category].label}
          </span>
          <span className="mt-2 block text-[17px] font-bold leading-snug tracking-tight">{a.name}</span>
          <span className="mt-1 block text-[12.5px] leading-snug text-[var(--color-ink-muted)]">Voorwaarde: {conditionText(a)}</span>
        </span>
      </span>
      <span className="mt-auto block">
        <span className="flex items-baseline justify-between gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
          <span className="tabular-nums">{counted ? `${fmt(a.current)} van ${fmt(a.threshold)}` : `${fmt(a.current)} dagen samen`}</span>
          <b className="text-[14px] font-bold tabular-nums text-[var(--color-ink)]">{Math.floor(a.progressPct)}%</b>
        </span>
        <span className="mt-1.5 block h-2.5 w-full overflow-hidden rounded-full bg-[var(--sc-fill-strong)]" role="progressbar" aria-valuenow={Math.floor(a.progressPct)} aria-valuemin={0} aria-valuemax={100}>
          <span className="ms-grow ms-gold-bar block h-full rounded-full" style={{ width: `${Math.max(2, a.progressPct)}%` }} />
        </span>
        <span className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-semibold text-[var(--ms-gold-ink)]">{lockedLine(a)}</span>
          <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  );
}

function MilestoneCard({ a, onOpen, onPlay }: { a: AwardState; onOpen: () => void; onPlay?: () => void }) {
  const m = METALS[a.metal];
  return (
    <li className="ms-done flex flex-col overflow-hidden rounded-[18px] border" style={{ ["--glow" as string]: m.glow }}>
      <span aria-hidden className="block h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${m.stops[2]}, ${m.stops[1]}, ${m.stops[0]})` }} />
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <button type="button" onClick={onOpen} aria-label={`Bekijk ${a.name}`} className="relative block size-[88px] shrink-0 transition-transform hover:scale-[1.03] sm:size-[96px]">
            <AwardBadge award={a} className="ms-badge-got size-full" />
            <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-[var(--st-green)] text-white ring-2 ring-[var(--color-surface)]"><Check className="size-4" strokeWidth={3} /></span>
          </button>
          <div className="min-w-0 pt-0.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--st-green-bg)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--st-green)]">
              <Check className="size-3" strokeWidth={3} /> Behaald · {CATEGORIES[a.category].label}
            </span>
            <h3 className="mt-2 text-[17px] font-bold leading-snug tracking-tight">{timelineText(a)}</h3>
            <time dateTime={a.achievedOn!} className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-ink-muted)]">
              <CalendarCheck className="size-3.5" /> {longDateNl(a.achievedOn!)}
            </time>
          </div>
        </div>
        {a.resultLine ? <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">{a.resultLine}</p> : null}
        <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--sc-line)] pt-4">
          {onPlay ? (
            <button type="button" onClick={onPlay} className={portalBtn.cta}>
              <Play className="size-4" fill="currentColor" /> Bekijk de video
            </button>
          ) : null}
          <button type="button" onClick={onOpen} className={portalBtn.soft + " h-10"}>Bekijk award</button>
        </div>
      </div>
    </li>
  );
}

/* ---------- Award-venster + LinkedIn ---------- */

function shareText(a: AwardState, clientName: string, totals: MilestonesData["totals"]): string {
  return `Trots op deze mijlpaal: ${a.name.toLowerCase()} met onze short video content.\n\nSamen met Shortclips publiceerden we inmiddels ${fmt(totals.videos)} video's, goed voor ${fmt(totals.views)} views.\n\nDank aan iedereen die kijkt, reageert en deelt, en aan het team van Shortclips voor de fijne samenwerking.\n\n#shortvideo #contentmarketing #${clientName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
}

function shareImageSvg(a: AwardState, clientName: string): string {
  const badge = badgeSvg(a, "share", 360).replace("<svg ", '<svg x="110" y="134" ');
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627">
<defs><radialGradient id="bg" cx=".25" cy=".45" r=".9"><stop offset="0" stop-color="#14185a"/><stop offset="1" stop-color="#00003b"/></radialGradient></defs>
<rect width="1200" height="627" fill="url(#bg)"/>
${badge}
<text x="560" y="250" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="22" font-weight="600" letter-spacing="5" fill="#9fa3d6">SHORTCLIPS MIJLPAAL</text>
<text x="560" y="320" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="54" font-weight="700" fill="#ffffff">${esc(a.name)}</text>
<text x="560" y="372" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="26" fill="#c9cbe6">${esc(clientName)}${a.achievedOn ? ` · ${longDateNl(a.achievedOn)}` : ""}</text>
<text x="560" y="520" font-family="Poppins, Helvetica, Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff">shortclips</text>
</svg>`;
}

async function downloadShareImage(a: AwardState, clientName: string): Promise<void> {
  const svg = shareImageSvg(a, clientName);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 2400;
  canvas.height = 1254;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, 2400, 1254);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shortclips-mijlpaal-${a.key}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function CloseBtn({ onClose, dark = false }: { onClose: () => void; dark?: boolean }) {
  return (
    <button type="button" onClick={onClose} aria-label="Sluiten" autoFocus className={`absolute right-3.5 top-3.5 z-[2] grid size-9 place-items-center rounded-full border ${dark ? "border-white/15 bg-white/[0.06] text-white" : "border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink)]"}`}>
      <X className="size-4" />
    </button>
  );
}

function AwardModal({ a, share, clientName, totals, onClose, onShare }: { a: AwardState; share: boolean; clientName: string; totals: MilestonesData["totals"]; onClose: () => void; onShare: (s: boolean) => void }) {
  const [copied, setCopied] = useState<"" | "ok" | "fout">("");
  const text = shareText(a, clientName, totals);
  return (
    <div role="dialog" aria-modal="true" aria-label={a.name} className="ms-pop relative max-h-full w-full max-w-[540px] overflow-auto rounded-[22px] border border-[var(--sc-line)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-pop)]">
      <CloseBtn onClose={onClose} />
      <div className="border-b border-[var(--sc-line)] px-6 pb-6 pt-8 text-center" style={{ background: `radial-gradient(circle at 50% 40%, color-mix(in srgb, ${METALS[a.metal].glow} 22%, transparent), transparent 62%), var(--sc-fill)` }}>
        <AwardBadge award={a} className={`mx-auto size-[136px] sm:size-[164px] ${a.achieved ? "ms-badge-hero" : "ms-badge-lock"}`} />
        <h2 className="mt-3 text-[22px] font-bold tracking-tight">{a.name}</h2>
        <div className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{CATEGORIES[a.category].label} · {METALS[a.metal].label} · {a.achieved ? "Behaald" : "Nog niet behaald"}</div>
      </div>

      <div className="flex flex-col gap-4 p-5 sm:p-6">
        {share && a.achieved ? (
          <>
            <div className="overflow-hidden rounded-[12px] border border-[var(--sc-line)]">
              <div className="flex items-center gap-2.5 px-3.5 py-3">
                <span className="grid size-10 place-items-center rounded-md bg-[#00003b] text-[13px] font-semibold text-white">{clientName.slice(0, 2).toUpperCase()}</span>
                <div className="text-[13px] font-semibold leading-tight">{clientName}<span className="block text-[11.5px] font-normal text-[var(--color-ink-muted)]">Voorbeeld van je LinkedIn-post</span></div>
              </div>
              <p className="whitespace-pre-line px-3.5 pb-3 text-[13px] leading-relaxed">{text}</p>
              <div className="ms-hero flex aspect-[1.91/1] items-center gap-5 px-6 text-white">
                <AwardBadge award={a} className="size-[38%] max-w-[150px] shrink-0" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">Shortclips mijlpaal</div>
                  <div className="mt-1 text-[18px] font-bold leading-snug sm:text-[20px]">{a.name}</div>
                  <div className="mt-1 text-[11.5px] text-white/70">{clientName}{a.achievedOn ? ` · ${longDateNl(a.achievedOn)}` : ""}</div>
                </div>
              </div>
            </div>
            <ol className="flex flex-col gap-1.5 text-[13px] text-[var(--color-ink-muted)]">
              <li>1. Download de afbeelding en kopieer de tekst.</li>
              <li>2. Open LinkedIn, plak de tekst en voeg de afbeelding toe.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => downloadShareImage(a, clientName)} className={portalBtn.cta}><Download className="size-4" /> Download afbeelding</button>
              <button
                type="button"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(text); setCopied("ok"); } catch { setCopied("fout"); }
                }}
                className={portalBtn.soft + " h-10"}
              >
                {copied === "ok" ? <Check className="size-4 text-[var(--st-green)]" /> : <Copy className="size-4" />}
                {copied === "ok" ? "Tekst gekopieerd" : copied === "fout" ? "Kopiëren lukte niet" : "Kopieer tekst"}
              </button>
              <a href={`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#0a66c2] px-4 text-[14px] font-semibold text-white hover:bg-[#0958a8]">
                <Share2 className="size-4" /> Open LinkedIn
              </a>
            </div>
            <button type="button" onClick={() => onShare(false)} className={portalBtn.link + " self-start"}><ArrowLeft className="size-3.5" /> Terug naar de award</button>
          </>
        ) : (
          <>
            <p className="text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{a.description}</p>
            {a.achieved ? (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <Fact l="Behaald op" v={a.achievedOn ? longDateNl(a.achievedOn) : "Behaald"} />
                  <Fact l="Materiaal" v={METALS[a.metal].label} />
                  <div className="col-span-2 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-3.5 py-3 text-[12px] text-[var(--color-ink-muted)]">
                    Behaald resultaat
                    <b className="mt-0.5 block text-[14px] font-semibold leading-snug text-[var(--color-ink)]">{a.resultLine}</b>
                  </div>
                </div>
                <div className="rounded-[14px] border border-[color-mix(in_srgb,var(--sc-accent)_25%,transparent)] bg-[var(--st-blue-bg)] px-4 py-3.5 text-[13.5px] leading-relaxed">
                  {a.congrats}
                  <span className="mt-2 block text-[12.5px] font-semibold text-[var(--sc-accent)]">Team Shortclips</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => onShare(true)} className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#0a66c2] px-4 text-[14px] font-semibold text-white hover:bg-[#0958a8]"><Share2 className="size-4" /> Delen op LinkedIn</button>
                  <button type="button" onClick={onClose} className={portalBtn.soft + " h-10"}>Sluiten</button>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <Fact l="Huidige stand" v={currentLabel(a)} />
                  <Fact l="Doel" v={targetLabel(a)} />
                </div>
                <div>
                  <Bar pct={a.progressPct} />
                  <div className="mt-2 flex justify-between text-[12.5px] text-[var(--color-ink-muted)]"><span>{pctNl(a.progressPct)} behaald</span><span>{a.remainingLine}</span></div>
                </div>
                <button type="button" onClick={onClose} className={portalBtn.soft + " h-10 self-start"}>Sluiten</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NewModal({ a, onClose, onOpen }: { a: AwardState; onClose: () => void; onOpen: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Nieuwe mijlpaal behaald" className="ms-pop relative w-full max-w-[440px] rounded-[22px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-6 pb-7 pt-9 text-center text-[var(--color-ink)] shadow-[var(--shadow-pop)]" style={{ ["--glow" as string]: METALS[a.metal].glow }}>
      <CloseBtn onClose={onClose} />
      <div className="ms-ring relative mx-auto grid size-[200px] place-items-center">
        <AwardBadge award={a} className="ms-reveal size-[150px]" />
      </div>
      <span className="mt-2 inline-flex rounded-full bg-[var(--st-blue-bg)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--sc-accent)]">Nieuwe mijlpaal behaald</span>
      <h2 className="mt-2.5 text-[22px] font-bold tracking-tight">{a.name}</h2>
      <p className="mx-auto mt-1.5 max-w-[36ch] text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{a.achievedOn ? `Behaald op ${longDateNl(a.achievedOn)}. ` : ""}Gefeliciteerd namens het hele team van Shortclips.</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={onOpen} className={portalBtn.cta}>Bekijk award</button>
        <button type="button" onClick={onClose} className={portalBtn.soft + " h-10"}>Later</button>
      </div>
    </div>
  );
}

/* ---------- Jaaroverzicht ---------- */

function YearModal({ data, byKey, slide, setSlide, onClose }: { data: MilestonesData; byKey: Map<string, AwardState>; slide: number; setSlide: (n: number) => void; onClose: () => void }) {
  const y = data.year!;
  const max = Math.max(1, ...y.monthly.map((m) => m.views));
  const yearAwards = y.awardKeys.map((k) => byKey.get(k)!).filter(Boolean);
  const slides: React.ReactNode[] = [
    <>
      <Kick>Shortclips Jaaroverzicht {y.year}</Kick>
      <H>{data.clientName}<span className="block text-white/55">jullie jaar in short video</span></H>
      <P>Een overzicht van alle resultaten die we samen hebben behaald, van {y.periodLabel}.</P>
    </>,
    <>
      <Kick>In cijfers</Kick>
      <H>Dit hebben we samen neergezet</H>
      <div className="grid grid-cols-2 gap-3">
        <Big n={y.videos} l="video's geproduceerd en gepubliceerd" />
        <Big n={y.views} l="views op alle kanalen" />
        <Big n={y.interactions} l="interacties" />
        <Big n={y.videos > 0 ? Math.round(y.views / y.videos) : 0} l="gemiddelde views per video" />
      </div>
    </>,
    <>
      <Kick>Views per maand</Kick>
      <H>Het verloop van {y.year}</H>
      <div>
        <div className="flex h-[200px] items-end gap-1.5 border-b border-white/15 pt-6 sm:gap-3">
          {y.monthly.map((m) => (
            <div key={m.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[9.5px] tabular-nums text-white/70 sm:text-[11px]">{m.views >= 1e6 ? `${(m.views / 1e6).toFixed(1).replace(".", ",")}M` : m.views >= 1000 ? `${Math.round(m.views / 1000)}K` : m.views}</span>
              <i className={`block w-full max-w-[52px] rounded-t-[6px] ${m.views === max ? "bg-white" : "bg-white/35"}`} style={{ height: `${(m.views / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1.5 sm:gap-3">{y.monthly.map((m) => <span key={m.label} className="flex-1 text-center text-[10.5px] text-white/55">{m.label}</span>)}</div>
      </div>
    </>,
  ];
  if (y.bestVideo) {
    const b = y.bestVideo;
    slides.push(
      <>
        <Kick>Beste video van het jaar</Kick>
        <div className="grid items-center gap-6 sm:grid-cols-[150px_1fr]">
          <div className="relative grid aspect-[9/16] w-[120px] place-items-center overflow-hidden rounded-[16px] border border-white/15 bg-white/[0.06] sm:w-full">
            {b.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" />
            ) : null}
            <span className="relative grid size-12 place-items-center rounded-full bg-white/90 text-[#00003b]"><Play className="ml-0.5 size-5" fill="currentColor" /></span>
          </div>
          <div className="flex flex-col gap-4">
            <H small>{b.title}</H>
            <div className="flex flex-wrap gap-6">
              <Mini n={fmt(b.views)} l="views" />
              {b.interactions > 0 ? <Mini n={fmt(b.interactions)} l="interacties" /> : null}
              <Mini n={PLATFORM[b.platform] ?? b.platform} l="platform" />
            </div>
            {b.publishedAt ? <P>Gepubliceerd op {longDateNl(b.publishedAt)}.</P> : null}
            {b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white underline-offset-4 hover:underline">Bekijk de video <ArrowRight className="size-3.5" /></a> : null}
          </div>
        </div>
      </>,
    );
  }
  if (y.growth) {
    const g = y.growth;
    slides.push(
      <>
        <Kick>Grootste groeimoment</Kick>
        <H>{g.month.charAt(0).toUpperCase() + g.month.slice(1)} {y.year}: <span className="text-white/60">+{fmt(g.pct)}% views</span></H>
        <P>In {g.month} groeiden de maandelijkse views van {fmt(g.prevViews)} naar {fmt(g.views)}, de sterkste stijging van dit jaar.</P>
        <div className="flex flex-wrap gap-6">
          <Mini n={fmt(g.prevViews)} l={`views in ${g.prevMonth}`} />
          <Mini n={fmt(g.views)} l={`views in ${g.month}`} />
        </div>
      </>,
    );
  }
  if (yearAwards.length) {
    slides.push(
      <>
        <Kick>Behaalde awards in {y.year}</Kick>
        <H>{yearAwards.length === 1 ? "Eén mijlpaal" : `${yearAwards.length} mijlpalen`} in één jaar</H>
        <div className="flex flex-wrap gap-3">
          {yearAwards.map((a) => (
            <div key={a.key} className="w-[88px] text-center text-[11px] leading-snug text-white/70 sm:w-[96px]">
              <AwardBadge award={a} className="mx-auto mb-1.5 size-[76px] sm:size-[84px]" />
              {a.name}
            </div>
          ))}
        </div>
      </>,
    );
  }
  const nxt = data.next[0];
  slides.push(
    <>
      <Kick>Op naar {y.year + 1}</Kick>
      <H>Samen bouwen we verder aan jullie online zichtbaarheid</H>
      <P>{nxt ? `Volgende doel: ${nxt.name}. ` : ""}Dank voor het vertrouwen in {y.year}. Wij kijken uit naar het komende jaar.</P>
      <div className="text-[14px] font-semibold">Team Shortclips</div>
    </>,
  );

  const i = Math.min(slide, slides.length - 1);
  const last = i === slides.length - 1;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Jaaroverzicht ${y.year}`} className="ms-pop ms-hero relative max-h-full w-full max-w-[820px] overflow-auto rounded-[22px] text-white shadow-[var(--shadow-pop)]">
      <CloseBtn onClose={onClose} dark />
      <div key={i} className="ms-fade flex min-h-[460px] flex-col justify-center gap-5 px-6 pb-6 pt-12 sm:px-12">{slides[i]}</div>
      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-4 sm:px-6">
        <button type="button" disabled={i === 0} onClick={() => setSlide(i - 1)} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/[0.06] px-3.5 text-[13.5px] font-medium disabled:opacity-35">
          <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Vorige</span>
        </button>
        <div className="flex gap-1.5">
          {slides.map((_, k) => (
            <button key={k} type="button" aria-label={`Pagina ${k + 1}`} onClick={() => setSlide(k)} className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-white" : "w-2 bg-white/25"}`} />
          ))}
        </div>
        <button type="button" onClick={() => (last ? onClose() : setSlide(i + 1))} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-white px-3.5 text-[13.5px] font-semibold text-[#00003b]">
          {last ? "Sluiten" : <>Volgende <ArrowRight className="size-4" /></>}
        </button>
      </div>
    </div>
  );
}

function Kick({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-white/55">{children}</div>;
}
function H({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return <h3 className={`font-bold leading-[1.12] tracking-tight ${small ? "text-[24px] sm:text-[28px]" : "text-[28px] sm:text-[38px]"}`}>{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[54ch] text-[14.5px] leading-relaxed text-white/70">{children}</p>;
}
function Big({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-white/[0.05] px-4 py-4 text-[12.5px] text-white/65 sm:px-5">
      <b className="block text-[24px] font-bold tabular-nums tracking-tight text-white sm:text-[30px]">{fmt(n)}</b>
      {l}
    </div>
  );
}
function Mini({ n, l }: { n: string; l: string }) {
  return (
    <div className="text-[12.5px] text-white/60">
      <b className="block text-[20px] font-bold tabular-nums text-white">{n}</b>
      {l}
    </div>
  );
}

/* ---------- Fysieke award ---------- */

function Plaque({ name, pa }: { name: string; pa: NonNullable<MilestonesData["physicalAward"]> }) {
  const [tilt, setTilt] = useState<string>("");
  return (
    <div
      className="flex flex-col items-center py-3 [perspective:1100px]"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        setTilt(`rotateY(${x * 20}deg) rotateX(${-y * 10}deg)`);
      }}
      onPointerLeave={() => setTilt("")}
    >
      <div className="ms-plaque" style={tilt ? { transform: tilt } : undefined}>
        <div className="ms-engr text-[10px] font-semibold tracking-[0.42em]">SHORTCLIPS</div>
        <div className="my-4 grid size-8 place-items-center rounded-full border border-white/30"><Play className="ml-0.5 size-3 text-[#c9cfe3]" fill="currentColor" /></div>
        <div className="ms-engr text-[14px] font-light uppercase leading-relaxed tracking-[0.18em]">Short Video<br />Award</div>
        <div className="ms-engr text-[36px] font-semibold leading-tight tracking-wide">{pa.year}</div>
        <div className="my-3.5 h-px w-11 bg-white/35" />
        <div className="ms-engr text-[12.5px] font-medium uppercase tracking-[0.06em]">{name}</div>
        <div className="mt-auto flex w-full flex-col gap-2">
          {[["Shorts", pa.videos], ["Views", pa.views], ["Interacties", pa.interactions]].map(([l, v]) => (
            <div key={l as string} className="flex justify-between border-t border-white/15 pt-1.5 text-[10px] uppercase tracking-[0.08em] text-[#c9cfe3]">
              <span>{l}</span><b className="text-[11.5px] font-semibold tabular-nums tracking-normal text-white">{fmt(v as number)}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="ms-plaque-base" />
    </div>
  );
}
