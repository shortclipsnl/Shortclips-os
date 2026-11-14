import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { sql } from "drizzle-orm";
import { Camera, ChevronDown, CircleAlert, Clock, Dna, FlaskConical, Lightbulb, Megaphone, MessageSquareQuote, PenLine, Repeat, ScrollText, Sparkles, Trophy, Wand2 } from "lucide-react";
import { db } from "@/db/client";
import { requirePermission, hasClientAccess } from "@/server/auth/context";
import { ACTIVE_STATUSES, getContentMemory, type ClientMemory } from "@/server/content-memory";
import { getHookAlternatives, hookKey, shownHooks } from "@/server/content-memory/hook-alternatives";
import { shownFormats, strategyMissing } from "@/server/content-memory/strategy";
import type { PlayItem, PlayStatus, Playbook } from "@/server/content-memory/playbook";
import { StrategyAutoFill } from "@/components/content-memory/strategy-autofill";
import type { MemoryGroup, MemorySuccess, MemoryVideo } from "@/server/content-memory/analyze";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { EvidenceBadge, PerfChip, dateNl, nf, pct, plat, xf } from "@/components/content-memory/shared";
import { ClientMemoryView } from "@/components/content-memory/client-view";
import { RefreshMemoryButton } from "@/components/content-memory/refresh-button";
import { CopyButton, CoverImage, MemoryClientStrip, MemoryPlayerProvider, PlayTrigger, Slider, type PlayerVideo, type StripClient } from "@/components/content-memory/player";
import { HookAltsPanel, HookAltsProvider, HookPrinciple } from "@/components/content-memory/hook-alternatives";
import { ThumbBackfill } from "@/components/content-memory/thumb-backfill";
import { ContentDnaView } from "@/components/content-memory/dna-view";

export const metadata: Metadata = { title: "Contentgeheugen" };
export const dynamic = "force-dynamic";
// "Formats bijwerken" en het aanvullen van alternatieve hooks laten de AI werken (± 1 minuut).
export const maxDuration = 180;

type ClientRow = { id: string; name: string; slug: string; logo_url: string | null; color: string | null; status: string; n: number };

export default async function ContentMemoryPage({ searchParams }: { searchParams: Promise<{ klant?: string; weergave?: string; alle?: string }> }) {
  const viewer = await requirePermission("analytics:read");
  const sp = await searchParams;
  const showAll = sp.alle === "1";
  const res = await db.execute(sql`
    select c.id, c.name, c.slug, c.logo_url, c.color, c.status::text status, count(p.id)::int as n
    from clients c join publications p on p.client_id = c.id and p.deleted_at is null and p.status = 'published'
    where c.deleted_at is null group by c.id order by n desc
  `);
  const all = (((res as { rows?: unknown[] }).rows ?? res) as ClientRow[]).filter((c) => hasClientAccess(viewer, c.id));
  // Standaard alleen actieve klanten (status uit de klantadministratie). Historische gegevens blijven bestaan.
  const visible = showAll ? all : all.filter((c) => ACTIVE_STATUSES.includes(c.status));
  const inactiveCount = all.length - all.filter((c) => ACTIVE_STATUSES.includes(c.status)).length;
  const options: StripClient[] = visible.map((c) => ({ id: c.id, name: c.name, slug: c.slug, logoUrl: c.logo_url, color: c.color, n: Number(c.n) || 0 }));
  const selected = options.find((c) => c.slug === sp.klant) ?? options[0];
  const cm = selected ? await getContentMemory(viewer, selected.id) : null;
  const asClient = sp.weergave === "klant";
  const alts = cm && !asClient ? await getHookAlternatives(cm.clientId) : {};
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { klant: selected?.slug, weergave: asClient ? "klant" : undefined, alle: showAll ? "1" : undefined, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/contentgeheugen?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader
        title="Contentgeheugen"
        description="Wat werkt per klant, waarom het werkt en hoe we het opnieuw inzetten. Bouwt zichzelf op uit Metricool, scripts, de contentplanning en de Caption Maker."
        actions={cm ? (
          <>
            <RefreshMemoryButton clientId={cm.clientId} />
            <Link href={`/ai/scriptgenerator?client=${cm.clientId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-medium text-white"><PenLine className="size-3.5" />Script Engine</Link>
          </>
        ) : null}
      />

      {/* Klantselectie */}
      <div className="flex flex-col gap-3">
        <MemoryClientStrip clients={options} activeSlug={selected?.slug} weergave={asClient ? "klant" : "intern"} extraQuery={showAll ? "&alle=1" : ""} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          {cm ? <DataLine cm={cm} /> : <span />}
          <div className="flex flex-wrap items-center gap-3">
            {inactiveCount > 0 ? (
              <Link href={qs({ alle: showAll ? "" : "1", klant: showAll ? undefined : selected?.slug })} scroll={false} className="text-[12.5px] font-medium text-[var(--color-ink-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline">
                {showAll ? "Alleen actieve klanten" : `Ook niet-actieve klanten (${inactiveCount})`}
              </Link>
            ) : null}
            <div className="inline-flex rounded-lg bg-[var(--color-surface-sunken)] p-1 text-sm">
              <Link href={qs({ weergave: "" })} scroll={false} className={`rounded-md px-3 py-1.5 ${!asClient ? "bg-[var(--color-surface)] font-semibold shadow-sm" : "text-[var(--color-ink-muted)]"}`}>Intern</Link>
              <Link href={qs({ weergave: "klant" })} scroll={false} className={`rounded-md px-3 py-1.5 ${asClient ? "bg-[var(--color-surface)] font-semibold shadow-sm" : "text-[var(--color-ink-muted)]"}`}>Zo ziet de klant het</Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {cm ? <ThumbBackfill clientId={cm.clientId} missing={cm.memory.all.filter((v) => !v.thumbnail).length} /> : null}
        {!cm ? (
          <EmptyState title="Nog geen actieve klant met resultaten" description="Zodra Metricool publicaties en cijfers levert, verschijnt hier het geheugen." />
        ) : asClient ? (
          <div className="portal-studio rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-4 sm:p-6"><ClientMemoryView cm={cm} /></div>
        ) : (
          <MemoryPlayerProvider>
            <StrategyAutoFill key={`s-${cm.clientId}`} clientId={cm.clientId} needed={strategyMissing(cm.memory, cm.strategy)} />
            <HookAltsProvider key={cm.clientId} clientId={cm.clientId} initial={alts} keys={shownHooks(cm.memory).map(hookKey)}>
              <InternalView cm={cm} />
            </HookAltsProvider>
          </MemoryPlayerProvider>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Interne weergave: vijf banen, elk met een eigen achtergrondvlak
 * ------------------------------------------------------------------ */

function InternalView({ cm }: { cm: ClientMemory }) {
  const m = cm.memory;
  const successes = m.successes ?? [];
  const formats = shownFormats(m);
  const hooks = shownHooks(m);
  const ctas = m.ctas.filter((g) => g.label !== "Geen duidelijke CTA" && g.n >= 2 && g.medianPerf >= 1).slice(0, 4);
  const best = m.topVideos.slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      {!m.sufficient ? (
        <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-4 py-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
          <span>Nog maar {m.videoCount} video&apos;s met cijfers. Vanaf 8 video&apos;s worden successen en patronen getoond. Wat hieronder staat zijn losse voorbeelden, geen bewezen aanpak.</span>
        </div>
      ) : null}

      {/* 1. Content DNA: wat werkt, waarom, en wat doen we bij de volgende opnames */}
      <Band n={1} tone="plain" icon={Dna} title={`Content DNA · ${cm.clientName}`} sub="Automatisch berekend uit uitsluitend de resultaten van deze klant, per platform vergeleken. Bewezen = consequent bij minstens vier video's; voorlopig = wijst die kant op, nog bevestigen.">
        <ContentDnaView dna={cm.dna} clientName={cm.clientName} />
        <PlaybookView p={cm.playbook} />
      </Band>

      {/* 2. Beste video's: de blikvanger */}
      <Band n={2} tone="hero" icon={Trophy} title="Beste video's" sub="Gerangschikt op prestatie t.o.v. het eigen platform (60% weergaven, 40% interactie). Klik om af te spelen.">
        {best.length ? (
          <Slider label="Beste video's">
            {best.map((v, i) => <BestVideoCard key={v.id} v={v} rank={i + 1} clientSlug={cm.clientSlug} />)}
          </Slider>
        ) : <Empty dark>Nog geen video&apos;s met cijfers.</Empty>}
      </Band>

      {/* 3. Terugkerende successen */}
      <Band n={3} tone="plain" icon={Repeat} title="Terugkerende successen" sub="Patronen die door meerdere video's gedragen worden. Eén video is nooit een patroon.">
        {successes.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {successes.map((s, i) => <SuccessCard key={i} s={s} top={i === 0} />)}
          </div>
        ) : (
          <Empty>{m.sufficient ? "Nog geen succes dat door minstens vier video's consequent gedragen wordt. Zodra er een duidelijk patroon is, verschijnt het hier vanzelf." : "Te weinig video's om successen te bepalen."}</Empty>
        )}
      </Band>

      {/* 4. Best werkende formats + nieuwe formatvoorstellen */}
      <Band n={4} tone="tint" icon={Wand2} title="Best werkende formats" sub="Door AI herkend uit de captions, beoordeeld op echte prestaties. Onder elk succesvol format staan nieuwe formats om te testen.">
        {formats.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {formats.map((g) => <FormatCard key={g.label} cm={cm} g={g} />)}
          </div>
        ) : (
          <Empty>{m.formatsLabeled ? "Nog geen format dat bij minstens twee video's boven het normale niveau scoort." : "Nog geen formats herkend. Klik op \"Formats bijwerken\" of wacht op de nachtelijke analyse."}</Empty>
        )}
      </Band>

      {/* 5. Best werkende hooks + drie alternatieven */}
      <Band n={5} tone="plain" icon={MessageSquareQuote} title="Best werkende hooks" sub="De echte openingszin van de best presterende video's, met drie nieuwe hooks op hetzelfde principe voor de volgende scripts.">
        {hooks.length ? (
          <div className="flex flex-col gap-4">
            {hooks.map((v) => <HookCard key={v.id} v={v} />)}
          </div>
        ) : <Empty>Nog geen hooks die boven het normale niveau scoren.</Empty>}
      </Band>

      {/* 6. Best werkende call to actions */}
      <Band n={6} tone="tint" icon={Megaphone} title="Best werkende call to actions" sub="Exacte afsluiters uit de captions. Conversies zijn alleen bekend als de klant formulier- of UTM-data koppelt.">
        {ctas.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {ctas.map((g) => <CtaCard key={g.label} g={g} />)}
          </div>
        ) : <Empty>Nog geen call to action die bij minstens twee video&apos;s boven het normale niveau scoort.</Empty>}
      </Band>
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

const BAND: Record<"hero" | "plain" | "tint", string> = {
  hero: "bg-[var(--color-indigo-ink)] text-white border-transparent",
  plain: "bg-[var(--color-surface)] border-[var(--color-line)]",
  tint: "bg-[var(--color-surface-2)] border-[var(--color-line)]",
};

function Band({ n, tone, icon: Icon, title, sub, children }: { n: number; tone: keyof typeof BAND; icon: typeof Sparkles; title: string; sub?: string; children: ReactNode }) {
  const hero = tone === "hero";
  return (
    <section className={`scroll-mt-20 rounded-[22px] border px-4 py-6 sm:px-7 sm:py-8 ${BAND[tone]}`} aria-labelledby={`cg-sec-${n}`}>
      <div className="mb-5 flex items-start gap-3 pr-0 sm:pr-24">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl text-[13px] font-bold tabular-nums ${hero ? "bg-white/12 text-white" : "bg-[var(--color-indigo-ink)] text-white"}`}>{String(n).padStart(2, "0")}</span>
        <div className="min-w-0">
          <h2 id={`cg-sec-${n}`} className="flex items-center gap-2 text-[19px] font-semibold tracking-tight"><Icon className={`size-[18px] ${hero ? "text-white/70" : "text-[var(--color-ink-muted)]"}`} />{title}</h2>
          {sub ? <p className={`mt-0.5 text-[13px] ${hero ? "text-white/65" : "text-[var(--color-ink-muted)]"}`}>{sub}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-center text-sm ${dark ? "border-white/25 text-white/70" : "border-[var(--color-line-strong)] text-[var(--color-ink-muted)]"}`}>{children}</p>;
}

const toPlayer = (v: MemoryVideo): PlayerVideo => ({ id: v.id, title: v.title, platform: v.platform, publishedOn: v.publishedOn, views: v.views, embedUrl: v.embedUrl ?? null, externalUrl: v.externalUrl });
const secs = (s: number) => `${Math.round(s)} sec`;

/** 9:16-omslag met afspeelknop; klikken opent de speler. */
function VideoTile({ v, className = "", big = false, rank }: { v: MemoryVideo; className?: string; big?: boolean; rank?: number }) {
  return (
    <PlayTrigger video={toPlayer(v)} className={className}>
      <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-[12px] border border-[var(--color-line)] bg-[var(--color-indigo-ink)]">
        <CoverImage src={v.thumbnail} title={v.hook || v.title} big={big} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 to-transparent" />
        <span className={`absolute grid place-items-center rounded-full bg-white/92 text-[var(--color-indigo-ink)] shadow-md transition-transform group-hover:scale-110 ${big ? "bottom-3 left-3 size-11" : "bottom-1.5 left-1.5 size-6"}`}>
          <PlayIcon big={big} />
        </span>
        {big ? <span className="absolute bottom-3.5 right-3 text-[16px] font-bold tabular-nums text-white drop-shadow">{nf(v.views)}</span> : null}
        {rank ? <span className={`absolute left-2.5 top-2.5 grid size-8 place-items-center rounded-full text-[13px] font-bold shadow ${rank <= 3 ? "bg-white text-[var(--color-indigo-ink)]" : "bg-black/55 text-white"}`}>{rank}</span> : null}
        {big ? <span className="absolute right-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-2xs font-medium text-white">{plat(v.platform)}</span> : null}
      </span>
    </PlayTrigger>
  );
}

function PlayIcon({ big }: { big: boolean }) {
  return <svg viewBox="0 0 24 24" className={big ? "size-4 translate-x-px" : "size-3 translate-x-px"} fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>;
}

/** Alleen cijfers die het platform echt levert. */
function videoStats(v: MemoryVideo): Array<[string, string, string?]> {
  const out: Array<[string, string, string?]> = [];
  if (v.avgWatchSeconds && v.avgWatchSeconds > 0) out.push(["Gem. kijktijd", secs(v.avgWatchSeconds)]);
  if (v.retention != null) out.push(["Retentie", pct(v.retention, 0), "Gemiddeld deel van de video dat bekeken werd"]);
  out.push(["Interacties", nf(v.interactions), "Likes, reacties, shares en opgeslagen samen"]);
  if (v.reach) out.push(["Bereik", nf(v.reach)]);
  out.push(["Likes", nf(v.likes)]);
  out.push(["Reacties", nf(v.comments)]);
  if (v.shares > 0) out.push(["Shares", nf(v.shares)]);
  if (v.saves > 0) out.push(["Opgeslagen", nf(v.saves)]);
  return out.slice(0, 6);
}

function BestVideoCard({ v, rank, clientSlug }: { v: MemoryVideo; rank: number; clientSlug: string }) {
  return (
    <article role="listitem" className="flex w-[78vw] max-w-[270px] shrink-0 snap-start flex-col overflow-hidden rounded-[18px] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_8px_30px_rgba(0,0,30,.25)] sm:w-[250px]">
      <VideoTile v={v} big rank={rank} className="w-full [&>span]:rounded-none [&>span]:border-0" />
      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span><b className="text-[22px] font-bold tabular-nums tracking-tight">{nf(v.views)}</b> <span className="text-[12px] text-[var(--color-ink-muted)]">weergaven</span></span>
          <PerfChip perf={v.perf} className="shrink-0" />
        </div>
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug">{v.title}</h3>
        <dl className="grid grid-cols-3 gap-x-2 gap-y-2 border-y border-[var(--color-line)] py-2.5">
          {videoStats(v).map(([l, val, tip]) => (
            <div key={l} className="min-w-0" title={tip}>
              <dd className="truncate text-[13.5px] font-semibold tabular-nums">{val}</dd>
              <dt className="truncate text-[10.5px] text-[var(--color-ink-faint)]">{l}</dt>
            </div>
          ))}
        </dl>
        <p className="line-clamp-3 text-[12px] text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Waarom succesvol:</span> {v.why}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-0.5 text-[11.5px]">
          <span className="text-[var(--color-ink-faint)]">{plat(v.platform)}{v.publishedOn ? ` · ${dateNl(v.publishedOn)}` : ""}</span>
          <Link href={`/clients/${clientSlug}?tab=scripts`} className="font-semibold text-[var(--color-brand-700)] hover:underline">{v.planId ? "Script" : "Scripts"}</Link>
        </div>
      </div>
    </article>
  );
}

const KIND: Record<MemorySuccess["kind"], { label: string; color: string; icon: typeof Sparkles }> = {
  format: { label: "Format", color: "var(--color-violet)", icon: Wand2 },
  hook: { label: "Hook", color: "var(--color-brand-700)", icon: MessageSquareQuote },
  cta: { label: "Call to action", color: "var(--color-good)", icon: Megaphone },
  formule: { label: "Succesformule", color: "var(--color-warn)", icon: Lightbulb },
  lengte: { label: "Lengte", color: "var(--color-lime)", icon: Clock },
  kijktijd: { label: "Kijktijd", color: "var(--color-lime)", icon: Clock },
};

function SuccessCard({ s, top }: { s: MemorySuccess; top: boolean }) {
  const k = KIND[s.kind];
  const Icon = k.icon;
  const style = {
    "--k": k.color,
    background: `color-mix(in srgb, var(--k) ${top ? 12 : 6}%, var(--color-surface))`,
    borderColor: `color-mix(in srgb, var(--k) ${top ? 45 : 28}%, var(--color-line))`,
  } as CSSProperties;
  return (
    <article style={style} className={`flex flex-col gap-3 rounded-[16px] border p-4 ${top ? "ring-1 ring-[color:var(--k)]/30" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--k)" }}><Icon className="size-3.5" />{top ? `Sterkste succes · ${k.label}` : k.label}</span>
        <EvidenceBadge e={s.evidence} />
      </div>
      <div className="flex items-end justify-between gap-3">
        <h3 className="text-[16px] font-semibold leading-snug">{s.title}</h3>
        <span className="shrink-0 text-right">
          <span className="block text-[28px] font-bold leading-none tabular-nums" style={{ color: "var(--k)" }}>{xf(s.perf)}</span>
          <span className="text-[11px] text-[var(--color-ink-muted)]">normaal</span>
        </span>
      </div>
      <p className="-mt-1 text-[13px] text-[var(--color-ink-muted)]"><b className="font-semibold text-[var(--color-ink)]">{s.hits} van {s.n}</b> video&apos;s · {s.conclusion.replace(/^\d+ van \d+ video's[^.]*\.\s*/, "")}</p>
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

/** Feitelijke kenmerken van een format, afgeleid uit de video's zelf. */
function formatTraits(all: MemoryVideo[], label: string): string[] {
  const vs = all.filter((v) => v.format === label);
  const win = vs.filter((v) => v.perf >= 1);
  const base = win.length >= 2 ? win : vs;
  if (!base.length) return [];
  const top = (vals: string[]) => {
    const c = new Map<string, number>();
    for (const x of vals) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  const out: string[] = [];
  const h = top(base.flatMap((v) => v.hookTypes.filter((t) => t !== "Stelling")));
  if (h && h[1] >= Math.max(2, base.length / 2)) out.push(`Hook met ${h[0].toLowerCase()} (${h[1]} van ${base.length})`);
  const c = top(base.map((v) => v.cta).filter((x) => x !== "Geen duidelijke CTA"));
  if (c && c[1] >= Math.max(2, base.length / 2)) out.push(`Afsluiter: ${c[0].toLowerCase()}`);
  const med = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const d = med(base.map((v) => v.durationSeconds ?? 0).filter((x) => x > 0));
  if (d) out.push(`Rond ${Math.round(d)} sec`);
  const r = med(base.map((v) => v.retention ?? -1).filter((x) => x >= 0));
  if (r != null && base.filter((v) => v.retention != null).length >= 2) out.push(`${pct(r, 0)} bekeken`);
  const e = med(base.map((v) => v.engScore));
  if (e && e >= 1.3) out.push(`${xf(e)} de normale interactie`);
  return out.slice(0, 4);
}

function FormatCard({ cm, g }: { cm: ClientMemory; g: MemoryGroup }) {
  const info = cm.ai.formats.find((f) => f.name === g.label);
  const ex = g.examples[0];
  const traits = formatTraits(cm.memory.all, g.label);
  const ideas = cm.strategy?.formatIdeas[g.label]?.ideas ?? [];
  return (
    <article className="flex flex-col gap-4 rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm">
    <div className="flex gap-4">
      {ex ? (
        <div className="w-[118px] shrink-0 sm:w-[150px]">
          <VideoTile v={ex} big className="w-full" />
          <div className="mt-1.5 text-[11px] text-[var(--color-ink-muted)]">Voorbeeld · {plat(ex.platform)}</div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-violet)]">Format</div>
            <h3 className="text-[17px] font-semibold leading-snug">{g.label}</h3>
          </div>
          <EvidenceBadge e={g.evidence} />
        </div>
        <div className="flex items-baseline gap-2">
          <b className="text-[22px] font-bold leading-none tabular-nums text-[var(--color-violet)]">{xf(g.medianPerf)}</b>
          <span className="text-[12px] text-[var(--color-ink-muted)]">normaal · {Math.round(g.hitRate * g.n)} van {g.n} boven normaal · {nf(g.medianViews)} views mediaan</span>
        </div>
        <p className="text-[13px] leading-snug"><span className="font-semibold">Waarom het werkt:</span> {info?.why ?? "Uitleg volgt na de eerstvolgende formatanalyse."}</p>
        {traits.length ? (
          <div className="flex flex-wrap gap-1.5">
            {traits.map((t) => <span key={t} className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2 py-0.5 text-[11.5px] font-medium">{t}</span>)}
          </div>
        ) : null}
        <div className="mt-auto rounded-[10px] bg-[var(--color-violet-soft)] px-3 py-2 text-[13px] leading-snug">
          <span className="font-semibold text-[var(--color-violet)]">Advies:</span> {info?.reuse ?? "Plan dit format opnieuw in en varieer het onderwerp."}
        </div>
      </div>
    </div>
      <FormatIdeasPanel format={g.label} ideas={ideas} pending={!cm.strategy} />
    </article>
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
  if (v.retention != null && v.retention >= 0.5) bits.push(`Gemiddeld ${pct(v.retention, 0)} van de video bekeken.`);
  return bits.join(" ") || "Presteert boven het normale niveau van deze klant.";
}

function MiniStats({ v }: { v: MemoryVideo }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span><b className="text-[15px] font-semibold tabular-nums text-[var(--color-ink)]">{nf(v.views)}</b> weergaven</span>
        <span><b className="font-semibold tabular-nums text-[var(--color-ink)]">{nf(v.interactions)}</b> interacties</span>
        {v.avgWatchSeconds ? <span><b className="font-semibold tabular-nums text-[var(--color-ink)]">{secs(v.avgWatchSeconds)}</b> kijktijd</span> : null}
        {v.retention != null ? <span><b className="font-semibold tabular-nums text-[var(--color-ink)]">{pct(v.retention, 0)}</b> retentie</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="truncate">{plat(v.platform)}{v.publishedOn ? ` · ${dateNl(v.publishedOn)}` : ""}</span>
        <PerfChip perf={v.perf} className="shrink-0" />
      </div>
    </div>
  );
}

function HookCard({ v }: { v: MemoryVideo }) {
  const key = hookKey(v);
  return (
    <article className="grid gap-4 rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm lg:grid-cols-[1.1fr_1fr] lg:p-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 rounded-md bg-[var(--color-indigo-ink)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-white">Originele hook</span>
            {v.hookTypes.map((t) => <Badge key={t} tone="violet">{t}</Badge>)}
            <Badge>{v.hookSource === "gesproken" ? "Gesproken" : "Uit caption"}</Badge>
          </div>
          <CopyButton text={v.hook} />
        </div>
        <p className="text-[20px] font-semibold leading-snug tracking-tight">&ldquo;{v.hook}&rdquo;</p>
        <p className="text-[13px] text-[var(--color-ink-muted)]"><span className="font-semibold text-[var(--color-ink)]">Waarom het werkt:</span> <HookPrinciple hookKey={key} fallback={hookWhy(v)} /></p>
        <div className="mt-auto flex items-center gap-3 border-t border-[var(--color-line)] pt-3">
          <VideoTile v={v} className="w-[58px] shrink-0" />
          <MiniStats v={v} />
        </div>
      </div>
      <HookAltsPanel hookKey={key} />
    </article>
  );
}

function CtaCard({ g }: { g: MemoryGroup }) {
  const withText = g.examples.filter((e) => e.ctaText);
  const texts = [...new Set(withText.map((e) => e.ctaText as string))].slice(0, 2);
  const ex = withText[0] ?? g.examples[0];
  const why = g.verdict === "beter"
    ? `Video's met deze afsluiter scoren ${xf(g.medianPerf)} het normale niveau; ${Math.round(g.hitRate * g.n)} van de ${g.n} scoorden boven gemiddeld.`
    : `Scoort rond of iets boven het normale niveau (${xf(g.medianPerf)}); nog geen duidelijk verschil met andere afsluiters.`;
  return (
    <article className="flex flex-col gap-3 rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="mr-1 rounded-md bg-[var(--color-indigo-ink)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-white">Originele tekst</span>
          <Badge tone="good">{g.label}</Badge>
        </div>
        <EvidenceBadge e={g.evidence} />
      </div>
      {texts.length ? (
        <div className="flex flex-col gap-2">
          {texts.map((t) => (
            <div key={t} className="flex items-start justify-between gap-3">
              <p className="text-[17px] font-semibold leading-snug">&ldquo;{t}&rdquo;</p>
              <CopyButton text={t} />
            </div>
          ))}
        </div>
      ) : <p className="text-[13px] text-[var(--color-ink-muted)]">Geen exacte tekst gevonden in de captions.</p>}
      <p className="text-[13px] text-[var(--color-ink-muted)]"><span className="font-semibold text-[var(--color-ink)]">Waarom het werkt:</span> {why}</p>
      {ex ? (
        <div className="mt-auto flex items-center gap-3 border-t border-[var(--color-line)] pt-3">
          <VideoTile v={ex} className="w-[58px] shrink-0" />
          <MiniStats v={ex} />
        </div>
      ) : null}
    </article>
  );
}


/* ------------------------------------------------------------------ *
 * Nieuwe formatvoorstellen onder een succesvol format
 * ------------------------------------------------------------------ */

function FormatIdeasPanel({ format, ideas, pending }: { format: string; ideas: Array<{ name: string; description: string; why: string; hook: string }>; pending: boolean }) {
  return (
    <div className="rounded-[16px] bg-[var(--color-indigo-ink)] p-4 text-white">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--color-indigo-ink)]"><FlaskConical className="size-3" />Nieuwe formats om te testen</span>
        <span className="text-[12px] text-white/65">Gebaseerd op het succes van &ldquo;{format}&rdquo;</span>
      </div>
      {ideas.length ? (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {ideas.map((i) => (
            <div key={i.name} className="flex flex-col gap-1.5 rounded-[12px] bg-[var(--color-surface)] p-3 text-[var(--color-ink)]">
              <h4 className="text-[14.5px] font-semibold leading-snug">{i.name}</h4>
              <p className="text-[12.5px] leading-snug text-[var(--color-ink-muted)]">{i.description}</p>
              <p className="text-[12.5px] leading-snug"><span className="font-semibold">Waarom kansrijk:</span> {i.why}</p>
              {i.hook ? (
                <div className="mt-auto flex items-start justify-between gap-2 border-t border-[var(--color-line)] pt-2">
                  <p className="text-[13px] font-medium italic leading-snug">&ldquo;{i.hook}&rdquo;</p>
                  <CopyButton text={i.hook} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2.5 text-[12.5px] text-white/70">{pending ? "Voorstellen worden gemaakt op basis van de resultaten van dit format..." : "Voorstellen volgen bij de volgende analyse (elke ochtend)."}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Wat werkt voor deze klant
 * ------------------------------------------------------------------ */

const STATUS: Record<PlayStatus, { label: string; cls: string }> = {
  bewezen: { label: "Bewezen", cls: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  indicatie: { label: "Indicatie, nog testen", cls: "bg-[var(--color-warn-soft)] text-[#8a5a00]" },
  onvoldoende: { label: "Te weinig data", cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
};

function StatusPill({ s }: { s: PlayStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[s].cls}`}>{STATUS[s].label}</span>;
}

const PLAY_ICON: Record<PlayItem["key"], typeof Sparkles> = { format: Wand2, hook: MessageSquareQuote, lengte: Clock, filmstijl: Camera, script: ScrollText };

function PlaybookView({ p }: { p: Playbook }) {
  const style = p.items.find((i) => i.key === "filmstijl");
  const script = p.items.find((i) => i.key === "script");
  if (!style && !script) return null;
  return (
    <details className="group mt-4 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface-2)]">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
          <span className="font-semibold">Filmstijl en scriptopbouw</span>
          {style ? <span className="inline-flex items-center gap-1.5 text-[var(--color-ink-muted)]"><Camera className="size-3.5" />{style.value ?? "Nog geen conclusie"}<StatusPill s={style.status} /></span> : null}
          {script ? <span className="inline-flex items-center gap-1.5 text-[var(--color-ink-muted)]"><ScrollText className="size-3.5" />Scriptopbouw<StatusPill s={script.status} /></span> : null}
        </span>
        <ChevronDown className="size-4 text-[var(--color-ink-muted)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-4 border-t border-[var(--color-line)] p-4">
        {style ? <div className="max-w-[420px]"><PlayCard i={style} /></div> : null}
        {script ? (
          <article className="rounded-[18px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-[16px] font-semibold"><ScrollText className="size-4 text-[var(--color-ink-muted)]" />{script.title}</h3>
                <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">{script.detail}</p>
              </div>
              <StatusPill s={script.status} />
            </div>
            {p.script ? (
              <ol className="mt-4 grid gap-2.5 md:grid-cols-5">
                {([["Opening", p.script.opening], ["Informatie", p.script.informatie], ["Tempo", p.script.tempo], ["Spanning", p.script.spanning], ["Afsluiting", p.script.cta]] as const).map(([l, t], n) => (
                  <li key={l} className="flex flex-col gap-1.5 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3">
                    <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]"><span className="grid size-5 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-[10.5px] font-bold text-white">{n + 1}</span>{l}</span>
                    <p className="text-[13px] leading-snug">{t || "Geen duidelijk patroon."}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </article>
        ) : null}
        {p.updatedAt ? <p className="text-[11.5px] text-[var(--color-ink-faint)]">Filmstijl en scriptopbouw geanalyseerd op {dateNl(p.updatedAt)}; wordt automatisch bijgewerkt zodra er nieuwe resultaten zijn.</p> : null}
      </div>
    </details>
  );
}

function PlayCard({ i }: { i: PlayItem }) {
  const Icon = PLAY_ICON[i.key];
  return (
    <article className={`flex flex-col gap-2.5 rounded-[16px] border p-4 ${i.status === "bewezen" ? "border-[var(--color-indigo-ink)]/30 bg-[var(--color-surface)] shadow-sm" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]"><Icon className="size-3.5" />{i.title}</span>
        <StatusPill s={i.status} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <h3 className={`text-[18px] font-semibold leading-snug ${i.value ? "" : "text-[var(--color-ink-muted)]"}`}>{i.value ?? "Nog geen conclusie"}</h3>
        {i.perf != null && i.value ? <span className="shrink-0 text-right"><b className="block text-[22px] font-bold leading-none tabular-nums">{xf(i.perf)}</b><span className="text-[10.5px] text-[var(--color-ink-muted)]">normaal</span></span> : null}
      </div>
      {i.quote && i.value ? (
        <div className="flex items-start justify-between gap-2 rounded-[10px] bg-[var(--color-surface-sunken)] px-2.5 py-2">
          <p className="text-[13px] font-medium leading-snug">&ldquo;{i.quote}&rdquo;</p>
          <CopyButton text={i.quote} />
        </div>
      ) : null}
      <p className="text-[12.5px] leading-snug text-[var(--color-ink-muted)]">{i.detail}</p>
      {i.metrics.length && i.value ? (
        <dl className="mt-auto grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-[var(--color-line)] pt-2.5">
          {i.metrics.map((mt) => (
            <div key={mt.label} className="min-w-0">
              <dd className="truncate text-[13.5px] font-semibold tabular-nums">{mt.value}</dd>
              <dt className="text-[10.5px] text-[var(--color-ink-faint)]">{mt.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      {i.example && i.value ? (
        <div className="flex items-center gap-2.5 border-t border-[var(--color-line)] pt-2.5">
          <VideoTile v={i.example} className="w-[44px] shrink-0" />
          <div className="min-w-0 text-[11.5px] text-[var(--color-ink-muted)]"><div className="line-clamp-2 font-medium text-[var(--color-ink)]">{i.example.title}</div>{nf(i.example.views)} weergaven · {plat(i.example.platform)}</div>
        </div>
      ) : null}
    </article>
  );
}
