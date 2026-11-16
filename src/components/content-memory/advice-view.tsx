import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Camera, CircleAlert, FlaskConical, Flag, GraduationCap, Megaphone, MessageSquareQuote, Play, Repeat, Rows3, Target } from "lucide-react";
import type { ClientMemory } from "@/server/content-memory";
import type { AdviceItem, AdviceSection, ContentAdvice, PhaseSummary, ShootLine } from "@/server/content-memory/advice";
import type { AdviceRecord, ClientAdvice } from "@/server/content-memory/advice-store";
import { CopyButton, CoverImage, PlayTrigger, type PlayerVideo } from "@/components/content-memory/player";
import { AdviceStatusControl, AdviceStatusPill } from "@/components/content-memory/advice-status";
import { plat, xf } from "@/components/content-memory/shared";
import { ClientReviewControl } from "@/components/content-memory/client-review";
import { defaultText, defaultTitle, insightTier, pendingReviews, type InsightReview } from "@/server/content-memory/client-insights";

type ReviewCtx = { clientId: string; byKey: Map<string, InsightReview> };

/**
 * Contentadvies: "Wat gaan we nu beter doen?"
 * Alle analyses uit het Contentgeheugen vertaald naar instructies voor het team.
 */

const SECTION: Record<AdviceSection, { title: string; sub: string; icon: typeof Flag; bar: string; chip: string }> = {
  meer: { title: "Meer doen", sub: "Bewezen bij deze klant, maar nog te weinig ingezet.", icon: ArrowUpRight, bar: "bg-[var(--color-good)]", chip: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  minder: { title: "Minder doen", sub: "Scoort onder normaal of wordt te vaak herhaald.", icon: ArrowDownRight, bar: "bg-[var(--color-bad)]", chip: "bg-[var(--color-bad-soft)] text-[#a3271c]" },
  blijven: { title: "Blijven toepassen", sub: "Vaste principes die consequent goed werken.", icon: Repeat, bar: "bg-[var(--color-indigo-ink)]", chip: "bg-[var(--color-indigo-ink)] text-white" },
  testen: { title: "Nieuw testen", sub: "Hypotheses en experimenten: nog geen bewijs.", icon: FlaskConical, bar: "bg-[var(--color-warn)]", chip: "bg-[var(--color-warn-soft)] text-[#8a5a00]" },
};

const PHASE_ICON: Record<PhaseSummary["phase"], typeof Flag> = { hook: MessageSquareQuote, midden: Rows3, cta: Megaphone };
const PHASE_LABEL: Record<AdviceItem["phase"], string> = { format: "Format", hook: "Hook", midden: "Middenstuk", cta: "Call to action" };

function ProofPill({ i }: { i: AdviceItem }) {
  const proven = i.proof === "bewezen";
  return (
    <span title={i.proofNote} className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${proven ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-warn-soft)] text-[#8a5a00]"}`}>
      {proven ? "Bewezen" : i.source === "resultaten" ? "Hypothese" : "Experiment"}
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{children}</dt>;
}

function Evidence({ i, videos }: { i: AdviceItem; videos: Map<string, PlayerVideo> }) {
  if (!i.evidence.length) return <p className="text-[12.5px] text-[var(--color-ink-muted)]">Nog geen video&apos;s: dit is een nieuw voorstel.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {i.evidence.map((e) => {
        const pv = videos.get(e.id);
        const tile = (
          <span className="flex w-[190px] items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 hover:border-[var(--color-line-strong)]">
            <span className="relative h-14 w-8 shrink-0 overflow-hidden rounded bg-[var(--color-indigo-ink)]">
              <CoverImage src={e.thumbnail} title={e.title} />
              <span className="absolute inset-0 grid place-items-center"><Play className="size-3 text-white" fill="currentColor" /></span>
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 text-[11.5px] font-medium leading-tight text-[var(--color-ink)]">{e.title}</span>
              <span className="mt-0.5 block text-[11px] tabular-nums text-[var(--color-ink-muted)]">{plat(e.platform)} · {xf(e.perf)} normaal</span>
            </span>
          </span>
        );
        return (
          <li key={e.id}>
            {pv ? <PlayTrigger video={pv}>{tile}</PlayTrigger> : e.url ? <a href={e.url} target="_blank" rel="noreferrer">{tile}</a> : tile}
          </li>
        );
      })}
    </ul>
  );
}

function AdviceCard({ i, record, videos, review }: { i: AdviceItem; record: AdviceRecord | undefined; videos: Map<string, PlayerVideo>; review?: ReviewCtx }) {
  const rv = review?.byKey.get(i.key);
  const s = SECTION[i.section];
  return (
    <article className="relative overflow-hidden rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] pl-[5px]">
      <span className={`absolute inset-y-0 left-0 w-[5px] ${s.bar}`} aria-hidden />
      <div className="px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{PHASE_LABEL[i.phase]}</span>
          <ProofPill i={i} />
          {i.perf != null && i.n ? <span className="text-[11.5px] tabular-nums text-[var(--color-ink-muted)]">{xf(i.perf)} normaal · {i.n} video&apos;s</span> : null}
        </div>
        <h4 className="mt-1 text-[15px] font-semibold leading-snug tracking-tight">{i.title}</h4>
        <p className="mt-1 text-[13.5px] font-medium leading-snug text-[var(--color-ink)]">{i.advice}</p>
        {record ? <div className="mt-2.5"><AdviceStatusControl key={`${record.id}-${record.status}`} id={record.id} status={record.status} manualVerdict={!i.target} /></div> : null}
        {record?.outcome ? <p className="mt-2 rounded-md bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-[12.5px] text-[var(--color-ink)]">{record.outcome.note}</p> : null}
        {review ? (
          <ClientReviewControl
            key={`${i.key}-${rv?.decision ?? "open"}`}
            clientId={review.clientId}
            itemKey={i.key}
            decision={rv?.decision ?? null}
            tier={insightTier(i)}
            defaultTitle={defaultTitle(i)}
            defaultText={defaultText(i)}
            clientTitle={rv?.clientTitle ?? null}
            clientText={rv?.clientText ?? null}
          />
        ) : null}
        <details className="group mt-2.5">
          <summary className="cursor-pointer list-none text-[12.5px] font-medium text-[var(--color-ink-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline">Inzicht, toepassing, meten en bewijs</summary>
          <dl className="mt-2.5 grid gap-2.5 text-[13px] leading-snug">
            <div><Label>Inzicht</Label><dd>{i.insight}</dd></div>
            {i.application ? <div><Label>Toepassing</Label><dd>{i.application}</dd></div> : null}
            <div><Label>Meten</Label><dd>{i.measure}</dd></div>
            <div><Label>Bewijs</Label><dd className="mt-1"><Evidence i={i} videos={videos} /><span className="mt-1 block text-[11.5px] text-[var(--color-ink-muted)]">{i.proofNote}</span></dd></div>
          </dl>
        </details>
      </div>
    </article>
  );
}

function SectionBlock({ k, items, open, videos, empty, review }: { k: AdviceSection; items: AdviceItem[]; open: Record<string, AdviceRecord>; videos: Map<string, PlayerVideo>; empty: string; review?: ReviewCtx }) {
  const s = SECTION[k];
  const Icon = s.icon;
  return (
    <section aria-labelledby={`ca-${k}`} className="flex flex-col gap-3">
      <header className="flex items-center gap-2.5">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${s.chip}`}><Icon className="size-4" /></span>
        <div className="min-w-0">
          <h3 id={`ca-${k}`} className="text-[16px] font-semibold tracking-tight">{s.title} <span className="ml-1 text-[13px] font-medium tabular-nums text-[var(--color-ink-muted)]">{items.length}</span></h3>
          <p className="text-[12.5px] text-[var(--color-ink-muted)]">{s.sub}</p>
        </div>
      </header>
      {items.length ? items.map((i) => <AdviceCard key={i.key} i={i} record={open[i.key]} videos={videos} review={review} />) : <p className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] px-4 py-5 text-[13px] text-[var(--color-ink-muted)]">{empty}</p>}
    </section>
  );
}

function PhaseCard({ p }: { p: PhaseSummary }) {
  const Icon = PHASE_ICON[p.phase];
  const row = (label: string, i: AdviceItem | null, tone: string) =>
    i ? (
      <li className="flex items-start gap-2">
        <span className={`mt-[3px] inline-flex w-[52px] shrink-0 justify-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}>{label}</span>
        <span className="min-w-0 text-[13px] leading-snug"><b className="font-semibold">{i.title}</b>{i.perf != null && i.n ? <span className="text-[var(--color-ink-muted)]"> · {xf(i.perf)} normaal</span> : null}</span>
      </li>
    ) : null;
  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5">
      <h4 className="flex items-center gap-2 text-[14px] font-semibold"><Icon className="size-4 text-[var(--color-ink-muted)]" />{p.title}</h4>
      {p.note ? <p className="mt-2 text-[12.5px] leading-snug text-[var(--color-ink-muted)]">{p.note}</p> : (
        <ul className="mt-2.5 flex flex-col gap-2">
          {row("Doen", p.doen, "bg-[var(--color-good-soft)] text-[#1d6b4c]")}
          {row("Laten", p.laten, "bg-[var(--color-bad-soft)] text-[#a3271c]")}
          {row("Testen", p.testen, "bg-[var(--color-warn-soft)] text-[#8a5a00]")}
        </ul>
      )}
    </div>
  );
}

const SHOOT_TAG: Record<ShootLine["kind"], { label: string; cls: string }> = {
  basis: { label: "Basis", cls: "bg-white/15 text-white" },
  doen: { label: "Doen", cls: "bg-[#c8f0dd] text-[#0f4a33]" },
  laten: { label: "Laten", cls: "bg-[#fbd5d1] text-[#7d1d14]" },
  testen: { label: "Testen", cls: "bg-[#fde6bd] text-[#6b4500]" },
};

export function ContentAdviceView({ cm, data, reviews, embedded = false }: { cm: ClientMemory; data: ClientAdvice; reviews?: InsightReview[]; embedded?: boolean }) {
  const a: ContentAdvice = data.advice;
  // Beoordeling voor het klantportaal: alleen als de pagina de beoordelingen meegeeft.
  const review: ReviewCtx | undefined = reviews ? { clientId: cm.clientId, byKey: new Map(reviews.map((r) => [r.key, r])) } : undefined;
  const pending = reviews ? pendingReviews(a.sections, reviews) : 0;
  const videos = new Map<string, PlayerVideo>(cm.memory.all.map((v) => [v.id, { id: v.id, title: v.title, platform: v.platform, publishedOn: v.publishedOn, views: v.views, embedUrl: v.embedUrl ?? null, externalUrl: v.externalUrl }]));
  const total = a.sections.meer.length + a.sections.minder.length + a.sections.blijven.length + a.sections.testen.length;
  const shootText = [`Volgende opnamedag ${cm.clientName}`, ...a.nextShoot.map((l) => `${SHOOT_TAG[l.kind].label}: ${l.text}${l.proof === "hypothese" ? " (hypothese)" : ""}`)].join("\n");
  const openCount = Object.values(data.open);
  const count = (s: string) => openCount.filter((r) => r.status === s).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {embedded ? null : <h2 className="text-[22px] font-semibold tracking-tight">Contentadvies: wat gaan we nu beter doen?</h2>}
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{cm.clientName} · berekend uit {a.videoCount} video&apos;s van deze klant. Bewezen = minstens vier video&apos;s met een consequent beeld. Al het andere is een hypothese of experiment.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="rounded-full bg-[var(--color-neutral-soft)] px-2.5 py-1 font-medium text-[var(--color-ink-muted)]">{count("nog_toepassen")} nog toepassen</span>
          <span className="rounded-full bg-[var(--color-indigo-ink)] px-2.5 py-1 font-medium text-white">{count("ingepland")} ingepland</span>
          <span className="rounded-full bg-[var(--color-warn-soft)] px-2.5 py-1 font-medium text-[#8a5a00]">{count("uitgevoerd") + count("resultaat")} uitgevoerd</span>
          <span className="rounded-full bg-[var(--color-good-soft)] px-2.5 py-1 font-medium text-[#1d6b4c]">{data.learned.filter((r) => r.status === "effectief").length} bewezen effectief</span>
        </div>
      </header>

      {!a.sufficient ? (
        <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          <span>Nog maar {a.videoCount} video&apos;s met cijfers. Vanaf 8 video&apos;s volgen bewezen adviezen. Wat hieronder staat zijn hypotheses om te testen, geen bewezen aanpak.</span>
        </div>
      ) : null}

      {/* In één oogopslag: hook, middenstuk, call to action */}
      <div className="grid gap-3 md:grid-cols-3">{a.phases.map((p) => <PhaseCard key={p.phase} p={p} />)}</div>

      {/* Prioriteiten en volgende opnamedag */}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <section aria-labelledby="ca-prio" className="rounded-[22px] bg-[var(--color-indigo-ink)] px-5 py-5 text-white sm:px-6">
          <h3 id="ca-prio" className="flex items-center gap-2 text-[16px] font-semibold"><Target className="size-4 text-white/70" />De drie prioriteiten</h3>
          <p className="mt-0.5 text-[12.5px] text-white/65">De verbeterpunten die het grootste verschil kunnen maken.</p>
          {a.priorities.length ? (
            <ol className="mt-4 flex flex-col gap-3">
              {a.priorities.map((i, n) => (
                <li key={i.key} className="flex gap-3 rounded-[14px] bg-white/[0.07] px-3.5 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-[14px] font-bold text-[var(--color-indigo-ink)]">{n + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/60">{SECTION[i.section].title} · {PHASE_LABEL[i.phase]}</span>
                      <ProofPill i={i} />
                    </div>
                    <p className="mt-0.5 text-[14.5px] font-semibold leading-snug">{i.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-white/80">{i.advice}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="mt-4 rounded-[14px] border border-dashed border-white/25 px-4 py-5 text-[13px] text-white/70">Nog geen verbeterpunt dat door de cijfers wordt gedragen.</p>}
        </section>

        <section aria-labelledby="ca-shoot" className="rounded-[22px] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="ca-shoot" className="flex items-center gap-2 text-[16px] font-semibold"><Camera className="size-4 text-[var(--color-ink-muted)]" />Volgende opnamedag</h3>
              <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Neem dit mee in scripts, opname en editorbriefing.</p>
            </div>
            {a.nextShoot.length ? <CopyButton text={shootText} label="Kopieer" /> : null}
          </div>
          {a.nextShoot.length ? (
            <ul className="mt-4 flex flex-col gap-2.5">
              {a.nextShoot.map((l) => (
                <li key={l.key} className="flex items-start gap-2.5">
                  <span className={`mt-[2px] inline-flex w-[54px] shrink-0 justify-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${l.kind === "basis" ? "bg-[var(--color-indigo-ink)] text-white" : SHOOT_TAG[l.kind].cls}`}>{SHOOT_TAG[l.kind].label}</span>
                  <span className="min-w-0 text-[13px] leading-snug">{l.text}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-[13px] text-[var(--color-ink-muted)]">Nog geen aanbevelingen voor de opname. Varieer bewust in hook en afsluiting, zodat zichtbaar wordt wat werkt.</p>}
        </section>
      </div>

      {/* De vier onderdelen */}
      {total && review ? (
        <p className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[13px] leading-snug">
          <b className="font-semibold">Klantportaal: </b>
          {pending ? `${pending} ${pending === 1 ? "inzicht is" : "inzichten zijn"} nog niet beoordeeld. ` : "Alle inzichten zijn beoordeeld. "}
          De klant ziet een inzicht pas in &quot;Wat werkt bij jouw bedrijf?&quot; nadat je het hieronder hebt goedgekeurd. Voor de klant geldt: bewezen vanaf acht video&apos;s, voorlopig vanaf vier, daaronder hypothese.
        </p>
      ) : null}
      {total ? (
        <div className="grid gap-x-5 gap-y-7 lg:grid-cols-2">
          <SectionBlock k="meer" items={a.sections.meer} open={data.open} videos={videos} review={review} empty="Niets dat bewezen werkt en nog te weinig wordt ingezet." />
          <SectionBlock k="minder" items={a.sections.minder} open={data.open} videos={videos} review={review} empty="Niets dat aantoonbaar onder normaal scoort of te vaak wordt herhaald." />
          <SectionBlock k="blijven" items={a.sections.blijven} open={data.open} videos={videos} review={review} empty="Nog geen vast principe dat consequent boven normaal scoort." />
          <SectionBlock k="testen" items={a.sections.testen} open={data.open} videos={videos} review={review} empty="Geen openstaande experimenten." />
        </div>
      ) : null}

      {/* Call to action per doel */}
      {a.ctaGoals.length ? (
        <section aria-labelledby="ca-cta" className="rounded-[22px] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-5 py-5 sm:px-6">
          <h3 id="ca-cta" className="flex items-center gap-2 text-[16px] font-semibold"><Megaphone className="size-4 text-[var(--color-ink-muted)]" />Call to action per doel</h3>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Elke afsluiting is beoordeeld op het doel waarvoor ze bedoeld is, niet alleen op bereik.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {a.ctaGoals.map((g) => (
              <div key={g.goal} className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5">
                <h4 className="text-[13.5px] font-semibold">{g.title}</h4>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {g.rows.map((r) => (
                    <li key={r.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0 truncate">{r.title} <span className="text-[var(--color-ink-muted)]">({r.n})</span></span>
                      <span className={`shrink-0 tabular-nums font-semibold ${r.best ? "text-[#1d6b4c]" : ""}`}>{r.score != null ? `${xf(r.score)} ${g.metric}` : `${xf(r.perf)} normaal`}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11.5px] leading-snug text-[var(--color-ink-muted)]">{g.note}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Leerlus: wat eerder advies heeft opgeleverd */}
      <section aria-labelledby="ca-learn" className="rounded-[22px] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-5 sm:px-6">
        <h3 id="ca-learn" className="flex items-center gap-2 text-[16px] font-semibold"><GraduationCap className="size-4 text-[var(--color-ink-muted)]" />Wat eerder advies heeft opgeleverd</h3>
        <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Het systeem controleert zelf of een advies is toegepast en meet het resultaat op de video&apos;s die daarna online kwamen. Deze maand: {data.month.planned} ingepland, {data.month.executed} uitgevoerd, {data.month.effective} bewezen effectief, {data.month.ineffective} niet effectief.</p>
        {data.learned.length || data.running.length ? (
          <ul className="mt-4 flex flex-col divide-y divide-[var(--color-line)]">
            {[...data.running, ...data.learned].map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold">{r.title} <span className="font-normal text-[var(--color-ink-muted)]">· {SECTION[r.section].title.toLowerCase()}</span></p>
                  <p className="text-[12.5px] text-[var(--color-ink-muted)]">{r.outcome?.note ?? "Meting loopt: nog te weinig video's sinds het advies."}</p>
                </div>
                <AdviceStatusPill status={r.status} />
              </li>
            ))}
          </ul>
        ) : <p className="mt-4 rounded-[14px] border border-dashed border-[var(--color-line-strong)] px-4 py-5 text-[13px] text-[var(--color-ink-muted)]">Nog geen gemeten uitkomsten. Zodra er na een advies minstens drie video&apos;s online staan waarin het is toegepast, verschijnt hier het resultaat.</p>}
      </section>

      {/* Eerlijk over de grenzen van de data */}
      {a.gaps.length ? (
        <details className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--color-ink-muted)]">Wat dit advies niet kan zien ({a.gaps.length})</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[12.5px] text-[var(--color-ink-muted)]">{a.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
