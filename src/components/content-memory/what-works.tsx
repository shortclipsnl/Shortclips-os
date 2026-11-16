import { ArrowDownRight, ArrowUpRight, FlaskConical, Play, Wrench } from "lucide-react";
import type { AdviceRef } from "@/server/content-memory/advice";
import { TIER_LABEL, TIER_NOTE, type ClientImprovement, type ClientInsight, type ClientInsights, type InsightTier } from "@/server/content-memory/client-insights";
import { nf, plat, xf } from "./shared";

/**
 * "Wat werkt bij jouw bedrijf?" in het klantportaal: wat werkt goed, wat werkt
 * minder, wat Shortclips verbetert en wat er getest wordt. Alleen inzichten die
 * het team heeft goedgekeurd; elk inzicht klikt door naar de video's erachter.
 */

const TIER_CLS: Record<InsightTier, string> = {
  bewezen: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
  voorlopig: "bg-[var(--color-warn-soft)] text-[#8a5a00]",
  hypothese: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
};

function TierPill({ tier }: { tier: InsightTier }) {
  return <span title={TIER_NOTE[tier]} className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TIER_CLS[tier]}`}>{TIER_LABEL[tier]}</span>;
}

function VideoTile({ v }: { v: AdviceRef }) {
  const inner = (
    <span className="flex h-full items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--color-surface)] p-2.5">
      <span className="relative h-[84px] w-[48px] shrink-0 overflow-hidden rounded-lg bg-[var(--color-indigo-ink)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {v.thumbnail ? <img src={v.thumbnail} alt="" loading="lazy" className="size-full object-cover" /> : null}
        <span className="absolute inset-0 grid place-items-center"><span className="grid size-6 place-items-center rounded-full bg-black/45 text-white"><Play className="size-3 translate-x-[1px]" fill="currentColor" /></span></span>
      </span>
      <span className="min-w-0 text-[12.5px] leading-snug">
        <span className="line-clamp-3 font-semibold text-[var(--color-ink)]">{v.title}</span>
        <span className="mt-0.5 block text-[var(--color-ink-muted)]">{nf(v.views)} weergaven · {plat(v.platform)} · {xf(v.perf)} normaal</span>
      </span>
    </span>
  );
  return v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="block h-full" aria-label={`Bekijk video: ${v.title}`}>{inner}</a> : inner;
}

function Videos({ videos, label }: { videos: AdviceRef[]; label: string }) {
  if (!videos.length) return null;
  return (
    <details className="group">
      <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-[13px] font-semibold text-[var(--color-ink)] underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Video&apos;s verbergen</span>
      </summary>
      <ul className="mt-1 grid gap-2">
        {videos.map((v) => <li key={v.id}><VideoTile v={v} /></li>)}
      </ul>
    </details>
  );
}

function InsightCard({ i }: { i: ClientInsight }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{i.category}</span>
        <TierPill tier={i.tier} />
      </div>
      <h3 className="text-[17px] font-bold leading-snug">{i.title}</h3>
      <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">{i.text}</p>
      <div className="rounded-[10px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px]"><b>Bewijs:</b> {i.proofLine}</div>
      <p className="text-[13px] leading-relaxed"><b>Wat wij ermee doen:</b> {i.action}</p>
      <div className="mt-auto"><Videos videos={i.videos} label={i.videos.length === 1 ? "Bekijk de video" : `Bekijk ${i.videos.length} video's`} /></div>
    </article>
  );
}

const STEPS = ["Voorstel", "Ingepland", "Online", "Uitkomst"];

function TestCard({ i }: { i: ClientInsight }) {
  const step = i.step ?? 1;
  const last = i.outcome === "bevestigd" ? "Uitkomst: bevestigd" : i.outcome === "niet_bevestigd" ? "Uitkomst: niet bevestigd" : "Uitkomst";
  return (
    <article className="flex flex-col gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{i.category}</span>
          <h3 className="text-[17px] font-bold leading-snug">{i.title}</h3>
        </div>
        <TierPill tier={i.tier} />
      </div>
      <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">{i.text}</p>
      <div className="rounded-[10px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-2 text-[13px]"><b>Waarom we dit testen:</b> {i.proofLine}</div>
      <ol className="flex flex-wrap gap-1.5 text-[12px] font-semibold" aria-label="Voortgang van de test">
        {STEPS.map((s, n) => (
          <li key={s} aria-current={n + 1 === step ? "step" : undefined} className={`rounded-full px-3 py-1 ${n + 1 <= step ? "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
            {n + 1}. {n === 3 ? last : s}
          </li>
        ))}
      </ol>
      <Videos videos={i.videos} label={i.videos.length === 1 ? "Bekijk de video waarop dit idee rust" : `Bekijk de ${i.videos.length} video's waarop dit idee rust`} />
    </article>
  );
}

const STATUS_CLS: Record<string, string> = {
  ingepland: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
  uitgevoerd: "bg-[var(--color-warn-soft)] text-[#8a5a00]",
  resultaat: "bg-[var(--color-warn-soft)] text-[#8a5a00]",
  effectief: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
  niet_effectief: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
};

function ImprovementRow({ r }: { r: ClientImprovement }) {
  return (
    <li className="grid gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4 md:grid-cols-[1.1fr_1.1fr_1.3fr]">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Inzicht</div>
        <div className="mt-0.5 text-[14.5px] font-semibold leading-snug">{r.insight}</div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Onze actie</div>
        <div className="mt-0.5 text-[13.5px] leading-relaxed">{r.action}</div>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Resultaat</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLS[r.status] ?? STATUS_CLS.ingepland}`}>{r.statusLabel}</span>
        </div>
        <div className="mt-0.5 text-[13.5px] leading-relaxed">{r.result}</div>
        <Videos videos={r.videos} label={r.videos.length === 1 ? "Bekijk de video waarin we dit toepasten" : `Bekijk ${r.videos.length} video's waarin we dit toepasten`} />
      </div>
    </li>
  );
}

function Head({ icon: Icon, label, title, tone }: { icon: typeof Play; label: string; title: string; tone: string }) {
  return (
    <header>
      <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider ${tone}`}><Icon className="size-4" />{label}</div>
      <h2 className="mt-1.5 text-[21px] font-bold tracking-tight">{title}</h2>
    </header>
  );
}

export function WhatWorks({ insights }: { insights: ClientInsights }) {
  const { goed, minder, testen, verbeterd } = insights;
  if (!goed.length && !minder.length && !testen.length && !verbeterd.length) return null;
  const nav = [
    goed.length ? { href: "#werkt-goed", label: "Dit werkt goed", value: goed[0].title } : null,
    minder.length ? { href: "#werkt-minder", label: "Dit werkt minder", value: minder[0].title } : null,
    verbeterd.length ? { href: "#verbeterd", label: "Dit verbeteren wij", value: verbeterd[0].insight } : null,
    testen.length ? { href: "#testen", label: "Dit testen we", value: testen[0].title } : null,
  ].filter((x): x is { href: string; label: string; value: string } => !!x);

  return (
    <>
      <nav aria-label="Wat werkt bij jouw bedrijf" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {nav.map((n, idx) => (
          <a key={n.href} href={n.href} className="flex min-h-[64px] flex-col justify-center gap-0.5 rounded-[14px] bg-[var(--sc-cta)] px-4 py-3 text-[var(--sc-cta-ink)] hover:bg-[var(--sc-cta-hover)]">
            <span className="text-[12px] opacity-75">{idx + 1}. {n.label}</span>
            <span className="line-clamp-2 text-[14.5px] font-semibold leading-snug">{n.value}</span>
          </a>
        ))}
      </nav>

      {goed.length ? (
        <section id="werkt-goed" className="sc-glass scroll-mt-6 p-6 sm:p-7">
          <Head icon={ArrowUpRight} label="Dit werkt goed" title="Dit hebben we geleerd over jouw bedrijf" tone="text-[#1d6b4c]" />
          <div className="mt-4 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">{goed.map((i) => <InsightCard key={i.key} i={i} />)}</div>
        </section>
      ) : null}

      {minder.length ? (
        <section id="werkt-minder" className="sc-glass scroll-mt-6 p-6 sm:p-7">
          <Head icon={ArrowDownRight} label="Dit werkt minder" title="Dit passen we aan" tone="text-[#8a5a00]" />
          <div className="mt-4 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">{minder.map((i) => <InsightCard key={i.key} i={i} />)}</div>
        </section>
      ) : null}

      {verbeterd.length ? (
        <section id="verbeterd" className="sc-glass scroll-mt-6 p-6 sm:p-7">
          <Head icon={Wrench} label="Dit verbeteren wij" title="Wat hebben we verbeterd op basis van jouw resultaten?" tone="text-[var(--color-ink-muted)]" />
          <ul className="mt-4 flex flex-col gap-3">{verbeterd.map((r) => <ImprovementRow key={`${r.key}-${r.since}`} r={r} />)}</ul>
        </section>
      ) : null}

      {testen.length ? (
        <section id="testen" className="sc-glass scroll-mt-6 p-6 sm:p-7">
          <Head icon={FlaskConical} label="Dit testen we" title="Lopende en geplande tests" tone="text-[var(--color-ink-muted)]" />
          <div className="mt-4 grid gap-3.5 md:grid-cols-2">{testen.map((i) => <TestCard key={i.key} i={i} />)}</div>
        </section>
      ) : null}

      <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
        Bewezen: {TIER_NOTE.bewezen.toLowerCase()} Voorlopig: {TIER_NOTE.voorlopig.toLowerCase()} Hypothese: {TIER_NOTE.hypothese.toLowerCase()}
      </p>
    </>
  );
}
