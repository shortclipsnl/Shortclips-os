import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { sql } from "drizzle-orm";
import { CircleAlert, Film, Megaphone, MessageSquareQuote, PenLine, Play, Sparkles, Trophy, Wand2 } from "lucide-react";
import { db } from "@/db/client";
import { requirePermission, hasClientAccess } from "@/server/auth/context";
import { getContentMemory, type ClientMemory } from "@/server/content-memory";
import type { MemoryGroup, MemorySuccess, MemoryVideo } from "@/server/content-memory/analyze";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { EvidenceBadge, PerfChip, dateNl, nf, pct, plat, xf } from "@/components/content-memory/shared";
import { ClientMemoryView } from "@/components/content-memory/client-view";
import { RefreshMemoryButton } from "@/components/content-memory/refresh-button";
import { CopyButton, MemoryClientStrip, MemoryPlayerProvider, PlayTrigger, type PlayerVideo, type StripClient } from "@/components/content-memory/player";

export const metadata: Metadata = { title: "Contentgeheugen" };
export const dynamic = "force-dynamic";
// "Formats bijwerken" laat de AI alle video's van de klant opnieuw indelen (± 1 minuut).
export const maxDuration = 180;

type ClientRow = { id: string; name: string; slug: string; logo_url: string | null; color: string | null; n: number };

export default async function ContentMemoryPage({ searchParams }: { searchParams: Promise<{ klant?: string; weergave?: string }> }) {
  const viewer = await requirePermission("analytics:read");
  const sp = await searchParams;
  const res = await db.execute(sql`
    select c.id, c.name, c.slug, c.logo_url, c.color, count(p.id)::int as n
    from clients c join publications p on p.client_id = c.id and p.deleted_at is null and p.status = 'published'
    where c.deleted_at is null group by c.id order by n desc
  `);
  const options: StripClient[] = (((res as { rows?: unknown[] }).rows ?? res) as ClientRow[])
    .filter((c) => hasClientAccess(viewer, c.id))
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug, logoUrl: c.logo_url, color: c.color, n: Number(c.n) || 0 }));
  const selected = options.find((c) => c.slug === sp.klant) ?? options[0];
  const cm = selected ? await getContentMemory(viewer, selected.id) : null;
  const asClient = sp.weergave === "klant";

  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader
        title="Contentgeheugen"
        description="Wat werkt per klant, waarom het werkt en welke content we opnieuw inzetten. Bouwt zichzelf op uit Metricool, scripts, de contentplanning en de Caption Maker."
        actions={cm ? (
          <>
            <RefreshMemoryButton clientId={cm.clientId} />
            <Link href={`/ai/scriptgenerator?client=${cm.clientId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-medium text-white"><PenLine className="size-3.5" />Script Engine</Link>
          </>
        ) : null}
      />

      {/* 1. Klantselectie */}
      <div className="flex flex-col gap-3">
        <MemoryClientStrip clients={options} activeSlug={selected?.slug} weergave={asClient ? "klant" : "intern"} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {cm ? <DataLine cm={cm} /> : <span />}
          <div className="inline-flex rounded-lg bg-[var(--color-surface-sunken)] p-1 text-sm">
            <Link href={`/contentgeheugen?klant=${selected?.slug ?? ""}`} scroll={false} className={`rounded-md px-3 py-1.5 ${!asClient ? "bg-[var(--color-surface)] font-semibold shadow-sm" : "text-[var(--color-ink-muted)]"}`}>Intern</Link>
            <Link href={`/contentgeheugen?klant=${selected?.slug ?? ""}&weergave=klant`} scroll={false} className={`rounded-md px-3 py-1.5 ${asClient ? "bg-[var(--color-surface)] font-semibold shadow-sm" : "text-[var(--color-ink-muted)]"}`}>Zo ziet de klant het</Link>
          </div>
        </div>
      </div>

      <div className="mt-8">
        {!cm ? (
          <EmptyState title="Nog geen klant met resultaten" description="Zodra Metricool publicaties en cijfers levert, verschijnt hier het geheugen." />
        ) : asClient ? (
          <div className="portal-studio rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-4 sm:p-6"><ClientMemoryView cm={cm} /></div>
        ) : (
          <MemoryPlayerProvider><InternalView cm={cm} /></MemoryPlayerProvider>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Interne weergave
 * ------------------------------------------------------------------ */

function InternalView({ cm }: { cm: ClientMemory }) {
  const m = cm.memory;
  const successes = m.successes ?? [];
  const formats = m.formats.filter((g) => g.n >= 2 && g.medianPerf >= 1).slice(0, 6);
  const hooks = m.topHooks.filter((v) => v.perf >= 1).slice(0, 6);
  const ctas = m.ctas.filter((g) => g.label !== "Geen duidelijke CTA" && g.n >= 2 && g.medianPerf >= 1).slice(0, 4);
  const best = m.topVideos.slice(0, 8);

  return (
    <div className="flex flex-col gap-12">
      {!m.sufficient ? (
        <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          <span>Nog maar {m.videoCount} video&apos;s met cijfers. Vanaf 8 video&apos;s worden successen en patronen getoond. Wat hieronder staat zijn losse voorbeelden, geen bewezen aanpak.</span>
        </div>
      ) : null}

      {/* 2. Terugkerende successen */}
      <Section icon={Sparkles} title={`Terugkerende successen bij ${cm.clientName}`} sub="Alleen wat door meerdere video's gedragen wordt. Klik op een video om hem te bekijken.">
        {successes.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {successes.map((s, i) => <SuccessCard key={i} s={s} />)}
          </div>
        ) : (
          <Empty>{m.sufficient ? "Nog geen succes dat door minstens vier video's consequent gedragen wordt. Zodra er een duidelijk patroon is, verschijnt het hier vanzelf." : "Te weinig video's om successen te bepalen."}</Empty>
        )}
      </Section>

      {/* 3. Best werkende formats */}
      <Section icon={Wand2} title="Best werkende formats" sub="Door AI herkend uit de captions, beoordeeld op echte prestaties. De balk vergelijkt de formats onderling.">
        {formats.length ? <FormatGrid cm={cm} formats={formats} /> : (
          <Empty>{m.formatsLabeled ? "Nog geen format dat bij minstens twee video's boven het normale niveau scoort." : "Nog geen formats herkend. Klik op \"Formats bijwerken\" of wacht op de nachtelijke analyse."}</Empty>
        )}
      </Section>

      {/* 4. Best werkende hooks */}
      <Section icon={MessageSquareQuote} title="Best werkende hooks" sub="De echte openingszin van de best presterende video's. Kopieer en bouw erop voort, niet letterlijk herhalen.">
        {hooks.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {hooks.map((v) => <HookCard key={v.id} v={v} />)}
          </div>
        ) : <Empty>Nog geen hooks die boven het normale niveau scoren.</Empty>}
      </Section>

      {/* 5. Best werkende call to actions */}
      <Section icon={Megaphone} title="Best werkende call to actions" sub="Exacte afsluiters uit de captions. Conversies zijn alleen bekend als de klant formulier- of UTM-data koppelt.">
        {ctas.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {ctas.map((g) => <CtaCard key={g.label} g={g} />)}
          </div>
        ) : <Empty>Nog geen call to action die bij minstens twee video&apos;s boven het normale niveau scoort.</Empty>}
      </Section>

      {/* 6. Beste video's */}
      <Section icon={Trophy} title="Beste video's" sub="Gerangschikt op prestatie t.o.v. het eigen platform (60% weergaven, 40% interactie). Dezelfde video op meerdere platforms telt één keer.">
        {best.length ? (
          <ol className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {best.map((v, i) => <BestVideo key={v.id} v={v} rank={i + 1} clientSlug={cm.clientSlug} />)}
          </ol>
        ) : <Empty>Nog geen video&apos;s met cijfers.</Empty>}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bouwstenen
 * ------------------------------------------------------------------ */

function DataLine({ cm }: { cm: ClientMemory }) {
  const m = cm.memory;
  const parts = [
    `${m.videoCount} video's geanalyseerd`,
    m.measuredFrom ? `${dateNl(m.measuredFrom)} tot ${dateNl(m.measuredTo)}` : null,
    ...m.platforms.slice(0, 3).map((p) => `${plat(p.platform)} ${nf(p.medianViews)} mediaan views`),
    cm.ai.updatedAt ? `formats bijgewerkt ${dateNl(cm.ai.updatedAt)}` : "formats nog niet geanalyseerd",
  ].filter(Boolean);
  const detail = `${m.publicationCount} posts in Metricool; ${m.excludedNonVideo} foto- of aanbodposts en ${m.excludedTooYoung} video's jonger dan 7 dagen niet meegeteld. Formats herkend: ${m.formatsLabeled}/${m.videoCount}. Gesproken hook bekend: ${m.spokenHooks}. Gekoppeld aan contentplanning: ${m.linkedToPlanning}.`;
  return <p className="min-w-0 text-[12.5px] text-[var(--color-ink-muted)]" title={detail}><b className="font-semibold text-[var(--color-ink)]">{cm.clientName}</b> · {parts.join(" · ")}</p>;
}

function Section({ icon: Icon, title, sub, children }: { icon: typeof Sparkles; title: string; sub?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Icon className="size-[18px] text-[var(--color-ink-muted)]" />{title}</h2>
        {sub ? <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">{children}</p>;
}

const toPlayer = (v: MemoryVideo): PlayerVideo => ({ id: v.id, title: v.title, platform: v.platform, publishedOn: v.publishedOn, views: v.views, embedUrl: v.embedUrl ?? null, externalUrl: v.externalUrl });

/** 9:16-thumbnail met afspeelknop; klikken opent de speler. */
function VideoTile({ v, className = "", big = false, rank }: { v: MemoryVideo; className?: string; big?: boolean; rank?: number }) {
  return (
    <PlayTrigger video={toPlayer(v)} className={className}>
      <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-indigo-ink)]">
        <span className="absolute inset-0 grid place-items-center text-white/35"><Film className={big ? "size-7" : "size-4"} strokeWidth={1.5} /></span>
        {v.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbnail} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : null}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
        <span className={`absolute grid place-items-center rounded-full bg-white/90 text-[var(--color-indigo-ink)] shadow-md transition-transform group-hover:scale-110 ${big ? "bottom-3 left-3 size-10" : "bottom-1.5 left-1.5 size-6"}`}>
          <Play className={big ? "size-4 translate-x-px" : "size-3 translate-x-px"} fill="currentColor" />
        </span>
        {big ? <span className="absolute bottom-3.5 right-3 text-[15px] font-bold tabular-nums text-white drop-shadow">{nf(v.views)}</span> : null}
        {rank ? <span className={`absolute left-2 top-2 grid size-7 place-items-center rounded-full text-[12px] font-bold shadow ${rank <= 3 ? "bg-white text-[var(--color-indigo-ink)]" : "bg-black/50 text-white"}`}>{rank}</span> : null}
        {big ? <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-2xs font-medium text-white">{plat(v.platform)}</span> : null}
      </span>
    </PlayTrigger>
  );
}

/** Kleine video met titel en cijfers ernaast. */
function MiniVideo({ v }: { v: MemoryVideo }) {
  return (
    <div className="flex items-center gap-3">
      <VideoTile v={v} className="w-12 shrink-0" />
      <div className="min-w-0 text-xs">
        <div className="line-clamp-2 font-medium text-[var(--color-ink)]">{v.title}</div>
        <div className="mt-0.5 text-[var(--color-ink-muted)]">{plat(v.platform)} · {nf(v.views)} views · {xf(v.perf)} normaal</div>
      </div>
    </div>
  );
}

const KIND: Record<MemorySuccess["kind"], { label: string; color: string }> = {
  format: { label: "Format", color: "var(--color-violet)" },
  hook: { label: "Hook", color: "var(--color-brand-700)" },
  cta: { label: "Call to action", color: "var(--color-good)" },
  formule: { label: "Succesformule", color: "var(--color-warn)" },
  lengte: { label: "Lengte", color: "var(--color-lime)" },
  kijktijd: { label: "Kijktijd", color: "var(--color-lime)" },
};

function SuccessCard({ s }: { s: MemorySuccess }) {
  const k = KIND[s.kind];
  const style = {
    "--k": k.color,
    background: "color-mix(in srgb, var(--k) 8%, var(--color-surface))",
    borderColor: "color-mix(in srgb, var(--k) 30%, var(--color-line))",
  } as CSSProperties;
  return (
    <article style={style} className="flex flex-col gap-3 rounded-[16px] border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--k)" }}>{k.label}</span>
        <EvidenceBadge e={s.evidence} />
      </div>
      <div>
        <h3 className="text-[16px] font-semibold leading-snug">{s.title}</h3>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[26px] font-bold leading-none tabular-nums" style={{ color: "var(--k)" }}>{xf(s.perf)}</span>
          <span className="text-[12.5px] text-[var(--color-ink-muted)]">normaal · {s.hits} van {s.n} video&apos;s</span>
        </div>
        <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">{s.conclusion}</p>
      </div>
      {s.videos.length ? (
        <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-3" style={{ borderColor: "color-mix(in srgb, var(--k) 20%, var(--color-line))" }}>
          {s.videos.slice(0, 3).map((v) => (
            <div key={v.id} className="min-w-0">
              <VideoTile v={v} className="w-full" />
              <div className="mt-1 truncate text-[11.5px] font-semibold tabular-nums">{nf(v.views)} <span className="font-normal text-[var(--color-ink-muted)]">views</span></div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function FormatGrid({ cm, formats }: { cm: ClientMemory; formats: MemoryGroup[] }) {
  const max = Math.max(...formats.map((g) => g.medianPerf), 1.2);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {formats.map((g) => {
        const info = cm.ai.formats.find((f) => f.name === g.label);
        const ex = g.examples[0];
        return (
          <article key={g.label} className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[16px] font-semibold leading-snug">{g.label}</h3>
              <EvidenceBadge e={g.evidence} />
            </div>
            {info?.description ? <p className="-mt-1 line-clamp-2 text-[13px] text-[var(--color-ink-muted)]">{info.description}</p> : null}
            <div>
              <div className="flex items-baseline gap-2">
                <b className="text-[20px] font-bold leading-none tabular-nums text-[var(--color-violet)]">{xf(g.medianPerf)}</b>
                <span className="text-[12.5px] text-[var(--color-ink-muted)]">normaal · {Math.round(g.hitRate * g.n)} van {g.n} boven normaal · {nf(g.medianViews)} views mediaan</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                <div className="h-full rounded-full bg-[var(--color-violet)]" style={{ width: `${Math.max(6, Math.round((g.medianPerf / max) * 100))}%` }} />
              </div>
            </div>
            <div className="rounded-[10px] bg-[var(--color-surface-sunken)] px-3 py-2.5 text-[13px]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Waarom het werkt</div>
              <p className="mt-0.5 line-clamp-3">{info?.why ?? "Uitleg volgt na de eerstvolgende formatanalyse."}</p>
            </div>
            {ex ? <div className="mt-auto border-t border-[var(--color-line)] pt-3"><MiniVideo v={ex} /></div> : null}
          </article>
        );
      })}
    </div>
  );
}

const HOOK_REASON: Record<string, string> = {
  Prijs: "Een concrete prijs maakt direct nieuwsgierig.",
  Getal: "Een getal maakt het meteen concreet.",
  Vraag: "Een vraag laat de kijker meedenken.",
  Nieuwsgierigheid: "Wekt nieuwsgierigheid naar het vervolg.",
  "Spreekt kijker aan": "Spreekt de kijker direct aan.",
  Rondleiding: "Belooft direct iets te laten zien.",
};

function hookWhy(v: MemoryVideo): string {
  const bits: string[] = [];
  const reason = v.hookTypes.map((t) => HOOK_REASON[t]).find(Boolean);
  if (reason) bits.push(reason);
  if (v.viewScore >= 1.3) bits.push(`${xf(v.viewScore)} de normale weergaven.`);
  else if (v.engScore >= 1.3) bits.push(`${xf(v.engScore)} de normale interactie.`);
  if (v.watchedShare != null && v.watchedShare >= 0.5) bits.push(`Gemiddeld ${pct(v.watchedShare, 0)} van de video bekeken.`);
  return bits.join(" ") || "Presteert boven het normale niveau van deze klant.";
}

function HookCard({ v }: { v: MemoryVideo }) {
  return (
    <article className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {v.hookTypes.map((t) => <Badge key={t} tone="violet">{t}</Badge>)}
          <Badge>{v.hookSource === "gesproken" ? "Gesproken hook" : "Uit caption"}</Badge>
        </div>
        <CopyButton text={v.hook} />
      </div>
      <p className="text-[18px] font-semibold leading-snug tracking-tight">&ldquo;{v.hook}&rdquo;</p>
      <p className="text-[12.5px] text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Waarom waarschijnlijk:</span> {hookWhy(v)}</p>
      <div className="mt-auto flex items-center gap-3 border-t border-[var(--color-line)] pt-3">
        <VideoTile v={v} className="w-12 shrink-0" />
        <div className="min-w-0 flex-1 text-xs text-[var(--color-ink-muted)]">
          <div><b className="text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">{nf(v.views)}</b> views</div>
          <div>{plat(v.platform)}{v.publishedOn ? ` · ${dateNl(v.publishedOn)}` : ""}</div>
        </div>
        <PerfChip perf={v.perf} className="shrink-0" />
      </div>
    </article>
  );
}

function CtaCard({ g }: { g: MemoryGroup }) {
  const texts = [...new Set(g.examples.map((e) => e.ctaText).filter((t): t is string => !!t))].slice(0, 2);
  const ex = g.examples.find((e) => e.ctaText) ?? g.examples[0];
  const why = g.verdict === "beter"
    ? `Video's met deze afsluiter scoren structureel hoger dan andere afsluiters.`
    : "Scoort rond of iets boven het normale niveau; nog geen duidelijk verschil met andere afsluiters.";
  return (
    <article className="flex flex-col gap-3 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="good">{g.label}</Badge>
        <EvidenceBadge e={g.evidence} />
      </div>
      {texts.length ? (
        <div className="flex flex-col gap-2">
          {texts.map((t) => (
            <div key={t} className="flex items-start justify-between gap-3">
              <p className="text-[16px] font-semibold leading-snug">&ldquo;{t}&rdquo;</p>
              <CopyButton text={t} />
            </div>
          ))}
        </div>
      ) : <p className="text-[13px] text-[var(--color-ink-muted)]">Geen exacte tekst gevonden in de captions.</p>}
      <p className="text-[12.5px] text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Waarom:</span> {why}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        <span><b className="tabular-nums">{xf(g.medianPerf)}</b> <span className="text-[var(--color-ink-muted)]">normaal</span></span>
        <span><b className="tabular-nums">{Math.round(g.hitRate * g.n)} van {g.n}</b> <span className="text-[var(--color-ink-muted)]">boven normaal</span></span>
        <span><b className="tabular-nums">{pct(g.medianEngagement)}</b> <span className="text-[var(--color-ink-muted)]">engagement</span></span>
      </div>
      {ex ? <div className="mt-auto border-t border-[var(--color-line)] pt-3"><MiniVideo v={ex} /></div> : null}
    </article>
  );
}

function BestVideo({ v, rank, clientSlug }: { v: MemoryVideo; rank: number; clientSlug: string }) {
  const stats: Array<[string, string]> = [
    ["Likes", nf(v.likes)],
    ["Reacties", nf(v.comments)],
    ["Shares", nf(v.shares)],
    ["Kijktijd", v.avgWatchSeconds ? `${Math.round(v.avgWatchSeconds)} s` : "n.b."],
  ];
  return (
    <li className="flex min-w-0 flex-col gap-2.5">
      <VideoTile v={v} big rank={rank} className="w-full" />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span><b className="text-[20px] font-bold tabular-nums tracking-tight">{nf(v.views)}</b> <span className="text-[12px] text-[var(--color-ink-muted)]">views</span></span>
          <PerfChip perf={v.perf} className="shrink-0" />
        </div>
        <h3 className="mt-0.5 line-clamp-2 text-[13.5px] font-semibold leading-snug">{v.title}</h3>
        <div className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{plat(v.platform)}{v.publishedOn ? ` · ${dateNl(v.publishedOn)}` : ""}</div>
      </div>
      <div className="grid grid-cols-4 gap-1 border-y border-[var(--color-line)] py-2">
        {stats.map(([l, val]) => (
          <div key={l} className="min-w-0">
            <div className="truncate text-[13px] font-semibold tabular-nums">{val}</div>
            <div className="truncate text-[10.5px] text-[var(--color-ink-faint)]">{l}</div>
          </div>
        ))}
      </div>
      <p className="line-clamp-3 text-[12px] text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Waarom succesvol:</span> {v.why}</p>
      <Link href={`/clients/${clientSlug}?tab=scripts`} className="text-[12px] font-semibold text-[var(--color-brand-700)] hover:underline">{v.planId ? "Script in Scripting" : "Scripts van deze klant"}</Link>
    </li>
  );
}
