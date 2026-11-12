import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowUpRight, BrainCircuit, CircleAlert, FileText, Lightbulb, Megaphone, MessageSquareQuote, PenLine, Repeat2, Sparkles, TrendingDown, TrendingUp, Trophy, Wand2 } from "lucide-react";
import { db } from "@/db/client";
import { requirePermission, hasClientAccess } from "@/server/auth/context";
import { getContentMemory, type ClientMemory } from "@/server/content-memory";
import type { MemoryGroup, MemoryVideo } from "@/server/content-memory/analyze";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { EvidenceBadge, PerfChip, Thumb, dateNl, nf, pct, plat, xf } from "@/components/content-memory/shared";
import { ClientMemoryView } from "@/components/content-memory/client-view";
import { RefreshMemoryButton } from "@/components/content-memory/refresh-button";

export const metadata: Metadata = { title: "Contentgeheugen" };
export const dynamic = "force-dynamic";
// "Formats bijwerken" laat de AI alle video's van de klant opnieuw indelen (± 1 minuut).
export const maxDuration = 180;

type ClientOpt = { id: string; name: string; slug: string; n: number };

export default async function ContentMemoryPage({ searchParams }: { searchParams: Promise<{ klant?: string; weergave?: string }> }) {
  const viewer = await requirePermission("analytics:read");
  const sp = await searchParams;
  const res = await db.execute(sql`
    select c.id, c.name, c.slug, count(p.id)::int as n
    from clients c join publications p on p.client_id = c.id and p.deleted_at is null and p.status = 'published'
    where c.deleted_at is null group by c.id order by n desc
  `);
  const options = (((res as { rows?: unknown[] }).rows ?? res) as ClientOpt[]).filter((c) => hasClientAccess(viewer, c.id));
  const selected = options.find((c) => c.slug === sp.klant) ?? options[0];
  const cm = selected ? await getContentMemory(viewer, selected.id) : null;
  const asClient = sp.weergave === "klant";

  return (
    <div className="mx-auto max-w-[1240px]">
      <PageHeader
        title="Contentgeheugen"
        description="Wat aantoonbaar werkt per klant: formats, hooks, call to actions en video's. Bouwt zichzelf op uit Metricool, de contentplanning en de Caption Maker. De Script Engine gebruikt hetzelfde geheugen."
        actions={cm ? <RefreshMemoryButton clientId={cm.clientId} /> : null}
      />

      <form className="mb-5 flex flex-wrap items-center gap-2" action="/contentgeheugen">
        <select name="klant" defaultValue={selected?.slug} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          {options.map((c) => <option key={c.id} value={c.slug}>{c.name} · {c.n} posts</option>)}
        </select>
        <input type="hidden" name="weergave" value={asClient ? "klant" : "intern"} />
        <button className="rounded-lg bg-[var(--color-indigo-ink)] px-3 py-2 text-sm font-medium text-white">Toon</button>
        <div className="ml-auto inline-flex rounded-lg bg-[var(--color-surface-sunken)] p-1 text-sm">
          <Link href={`/contentgeheugen?klant=${selected?.slug ?? ""}`} className={`rounded-md px-3 py-1.5 ${!asClient ? "bg-[var(--color-surface)] font-semibold shadow-sm" : "text-[var(--color-ink-muted)]"}`}>Intern</Link>
          <Link href={`/contentgeheugen?klant=${selected?.slug ?? ""}&weergave=klant`} className={`rounded-md px-3 py-1.5 ${asClient ? "bg-[var(--color-surface)] font-semibold shadow-sm" : "text-[var(--color-ink-muted)]"}`}>Zo ziet de klant het</Link>
        </div>
      </form>

      {!cm ? (
        <EmptyState title="Nog geen klant met resultaten" description="Zodra Metricool publicaties en cijfers levert, verschijnt hier het geheugen." />
      ) : asClient ? (
        <div className="portal-studio rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-4 sm:p-6"><ClientMemoryView cm={cm} /></div>
      ) : (
        <InternalView cm={cm} />
      )}
    </div>
  );
}

function InternalView({ cm }: { cm: ClientMemory }) {
  const m = cm.memory;
  const fmt = (name: string) => cm.ai.formats.find((f) => f.name === name);
  const topFormats = m.formats.filter((g) => g.n >= 2).slice(0, 3);
  const weak = [...m.formats, ...m.hooks, ...m.ctas, ...m.lengths].filter((g) => g.verdict === "slechter" && g.n >= 2).sort((a, b) => a.medianPerf - b.medianPerf);
  const moving = m.formats.concat(m.hooks).filter((g) => g.trend === "sterker" || g.trend === "zwakker");
  const goodCtas = m.ctas.filter((g) => g.label !== "Geen duidelijke CTA");

  return (
    <div className="flex flex-col gap-5">
      {/* Basis: waar komt dit vandaan? */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-ink-muted)]">
        <span><b className="text-[var(--color-ink)]">{m.videoCount}</b> video&apos;s geanalyseerd ({m.publicationCount} posts in Metricool, {m.excludedNonVideo} foto/aanbodposts en {m.excludedTooYoung} te jonge video&apos;s niet meegeteld)</span>
        {m.measuredFrom ? <span>Periode {dateNl(m.measuredFrom)} tot {dateNl(m.measuredTo)}</span> : null}
        <span>Formats herkend: {m.formatsLabeled}/{m.videoCount}{cm.ai.updatedAt ? ` · bijgewerkt ${dateNl(cm.ai.updatedAt)}` : " · nog niet geanalyseerd"}</span>
        <span>Gesproken hook bekend: {m.spokenHooks} · gekoppeld aan planning: {m.linkedToPlanning}</span>
      </div>

      {!m.sufficient ? (
        <div className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-4 py-3 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0" />Nog maar {m.videoCount} video&apos;s met cijfers. Vanaf 8 video&apos;s worden patronen getoond; hieronder alleen losse voorbeelden.</div>
      ) : null}

      {/* Sterkste patronen: zelfde presentatie als in het klantportaal */}
      <section className="rounded-[18px] bg-[var(--color-indigo-ink)] p-6 text-white">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/60"><Sparkles className="size-4" /> Sterkste patronen</div>
        <h2 className="mt-1 text-xl font-semibold">Terugkerende succesfactoren bij {cm.clientName}</h2>
        {m.patterns.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {m.patterns.map((p, i) => <div key={i} className="flex gap-3 rounded-xl bg-white/[0.07] p-3.5 text-[14px]"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-[12px] font-bold text-[var(--color-indigo-ink)]">{i + 1}</span>{p}</div>)}
          </div>
        ) : <p className="mt-3 text-sm text-white/70">Nog geen patroon dat door minstens vier video&apos;s gedragen wordt.</p>}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {m.platforms.slice(0, 4).map((p) => (
          <Card key={p.platform}><div className="text-xs text-[var(--color-ink-muted)]">{plat(p.platform)} · {p.n} video&apos;s</div><div className="mt-1 text-2xl font-semibold tabular-nums">{nf(p.medianViews)}</div><div className="text-xs text-[var(--color-ink-muted)]">mediaan views per video · {pct(p.medianEngagement)} engagement · {nf(p.totalViews)} totaal</div></Card>
        ))}
      </div>

      {/* 1. Formats */}
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><Wand2 className="size-4" />Best werkende formats</span>} subtitle="Door AI herkend uit de captions, beoordeeld op echte prestaties. Inzetten = vaker plannen, aanpassen = andere invalshoek." />
        {topFormats.length ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {topFormats.map((g) => {
              const info = fmt(g.label);
              return (
                <div key={g.label} className="flex flex-col gap-3 rounded-xl border border-[var(--color-line)] p-4">
                  <div className="flex items-start justify-between gap-2"><div className="text-base font-semibold leading-snug">{g.label}</div><EvidenceBadge e={g.evidence} /></div>
                  <div className="flex flex-wrap items-center gap-2 text-xs"><PerfChip perf={g.medianPerf} /><span>{Math.round(g.hitRate * g.n)} van {g.n} boven normaal</span><TrendBadge g={g} /></div>
                  {info ? <dl className="grid gap-1.5 text-[13px]"><dt className="font-medium">Waarom het werkt (verklaring)</dt><dd className="text-[var(--color-ink-muted)]">{info.why}</dd><dt className="font-medium">Opnieuw toepassen</dt><dd className="text-[var(--color-ink-muted)]">{info.reuse}</dd></dl> : <p className="text-[13px] text-[var(--color-ink-muted)]">Formatanalyse volgt na de eerstvolgende bijwerking.</p>}
                  <div className="mt-auto flex flex-col gap-2 border-t border-[var(--color-line)] pt-3">{g.examples.map((v) => <MiniVideo key={v.id} v={v} />)}</div>
                </div>
              );
            })}
          </div>
        ) : <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen formats herkend. Klik op &quot;Formats bijwerken&quot; of wacht op de nachtelijke analyse.</p>}
        {m.formats.length > 3 ? <GroupTable groups={m.formats.slice(3)} title="Overige formats" /> : null}
      </Card>

      {/* 2. Hooks */}
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><MessageSquareQuote className="size-4" />Best werkende hooks</span>} subtitle="De exacte openingszin uit de video (gesproken hook uit de Caption Maker, anders de eerste zin van de caption)." />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--color-ink-muted)]"><th className="pb-2 pr-3">Hook</th><th className="pb-2 pr-3">Video</th><th className="pb-2 pr-3 text-right">Resultaat</th><th className="pb-2">Waarom waarschijnlijk</th></tr></thead>
            <tbody>
              {m.topHooks.slice(0, 8).map((v) => (
                <tr key={v.id} className="border-t border-[var(--color-line)] align-top">
                  <td className="py-2.5 pr-3"><div className="font-semibold">“{v.hook}”</div><div className="mt-1 flex flex-wrap gap-1">{v.hookTypes.map((t) => <Badge key={t}>{t}</Badge>)}<Badge tone="violet">{v.hookSource === "gesproken" ? "gesproken hook" : "uit caption"}</Badge></div></td>
                  <td className="py-2.5 pr-3"><MiniVideo v={v} /></td>
                  <td className="py-2.5 pr-3 text-right tabular-nums"><div className="font-semibold">{nf(v.views)} views</div><PerfChip perf={v.perf} />{v.avgWatchSeconds ? <div className="text-xs text-[var(--color-ink-muted)]">{Math.round(v.avgWatchSeconds)} sec bekeken</div> : null}</td>
                  <td className="py-2.5 text-[13px] text-[var(--color-ink-muted)]">{v.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <GroupTable groups={m.hooks} title="Hooktypes voor deze klant" />
      </Card>

      {/* 3. CTA's */}
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><Megaphone className="size-4" />Call to actions</span>} subtitle="Type, exacte tekst uit de caption, bijbehorende video en resultaat. Conversies (aanvragen) zijn alleen bekend als de klant UTM- of formulierdata koppelt." />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {goodCtas.map((g) => {
            const ex = g.examples.find((e) => e.ctaText) ?? g.examples[0];
            return (
              <div key={g.label} className={`rounded-xl border p-4 ${g.verdict === "slechter" ? "border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)]/40" : "border-[var(--color-line)]"}`}>
                <div className="flex items-start justify-between gap-2"><div className="font-semibold">{g.label}</div><div className="flex gap-1.5"><PerfChip perf={g.medianPerf} /><EvidenceBadge e={g.evidence} /></div></div>
                <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{g.n} video&apos;s · {pct(g.medianEngagement)} engagement (mediaan) · {Math.round(g.hitRate * 100)}% boven normaal</div>
                {ex?.ctaText ? <div className="mt-2.5 rounded-lg bg-[var(--color-surface-sunken)] p-2.5 text-[13px] italic">“{ex.ctaText}”</div> : null}
                {ex ? <div className="mt-2.5"><MiniVideo v={ex} /></div> : null}
                <p className="mt-2 text-[12.5px] text-[var(--color-ink-muted)]">{g.verdict === "beter" ? "Waarschijnlijk effectief: video's met deze afsluiter scoren structureel hoger." : g.verdict === "slechter" ? "Werkt minder: kies bij dit doel een andere afsluiter of test een variant." : "Geen duidelijk verschil met andere afsluiters."}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 4. Beste video's */}
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><Trophy className="size-4" />Beste video&apos;s</span>} subtitle="Gerangschikt op prestatie t.o.v. het eigen platform (60% views, 40% engagement)." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {m.topVideos.slice(0, 8).map((v, i) => (
            <div key={v.id} className="flex gap-4 rounded-xl border border-[var(--color-line)] p-3.5">
              <Thumb v={v} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
                <div className="flex items-start justify-between gap-2"><div className="font-semibold leading-snug">#{i + 1} {v.title}</div><PerfChip perf={v.perf} className="shrink-0" /></div>
                <div className="text-xs text-[var(--color-ink-muted)]">{plat(v.platform)} · {dateNl(v.publishedOn)}{v.durationSeconds ? ` · ${v.durationSeconds} sec` : ""}</div>
                <div className="grid grid-cols-4 gap-2 text-xs"><Kv k="Views" v={nf(v.views)} /><Kv k="Interacties" v={nf(v.interactions)} /><Kv k="Engagement" v={pct(v.engagementRate)} /><Kv k="Kijktijd" v={v.avgWatchSeconds ? `${Math.round(v.avgWatchSeconds)} s${v.watchedShare != null ? ` (${pct(v.watchedShare, 0)})` : ""}` : "n.b."} /></div>
                <div className="text-xs"><b>Hook:</b> “{v.hook}” · <b>Format:</b> {v.format ?? "nog niet bepaald"} · <b>CTA:</b> {v.cta}</div>
                <div className="text-xs text-[var(--color-ink-muted)]"><b className="text-[var(--color-ink)]">Waarom:</b> {v.why}</div>
                <div className="mt-auto flex gap-3 pt-1 text-xs font-semibold">
                  {v.externalUrl ? <a href={v.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-700)]">Bekijk video <ArrowUpRight className="size-3" /></a> : null}
                  <Link href={`/clients/${cm.clientSlug}?tab=scripts`} className="inline-flex items-center gap-1 text-[var(--color-brand-700)]"><FileText className="size-3" />{v.planId ? "Script in Scripting" : "Scripts van deze klant"}</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Wat werkt niet */}
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><TrendingDown className="size-4" />Wat werkt minder</span>} subtitle="Formats, hooks, CTA's en lengtes die structureel onder het normale niveau blijven." />
          {weak.length ? <ul className="mt-3 flex flex-col divide-y divide-[var(--color-line)] text-sm">{weak.slice(0, 7).map((g) => <li key={g.dimension + g.label} className="flex items-center justify-between gap-3 py-2"><span><span className="text-xs uppercase text-[var(--color-ink-muted)]">{DIM[g.dimension]}</span><br />{g.label}</span><span className="flex shrink-0 items-center gap-1.5"><PerfChip perf={g.medianPerf} /><EvidenceBadge e={g.evidence} /></span></li>)}</ul> : <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Niets dat aantoonbaar onder het normale niveau blijft.</p>}
          {m.flopVideos.length ? <><div className="mt-4 text-xs font-semibold uppercase text-[var(--color-ink-muted)]">Zwakste video&apos;s</div><div className="mt-2 flex flex-col gap-2">{m.flopVideos.slice(0, 3).map((v) => <MiniVideo key={v.id} v={v} showPerf />)}</div></> : null}
        </Card>

        {/* Ontwikkeling */}
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><TrendingUp className="size-4" />Ontwikkeling door de tijd</span>} subtitle="Eerste helft van de periode tegenover de tweede helft." />
          {moving.length ? <ul className="mt-3 flex flex-col divide-y divide-[var(--color-line)] text-sm">{moving.map((g) => <li key={g.dimension + g.label} className="flex items-center justify-between gap-3 py-2"><span><span className="text-xs uppercase text-[var(--color-ink-muted)]">{DIM[g.dimension]}</span><br />{g.label}</span><TrendBadge g={g} /></li>)}</ul> : <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Geen duidelijke verschuivingen, of nog te weinig video&apos;s per periode.</p>}
        </Card>
      </div>

      {/* Succesformules */}
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><Repeat2 className="size-4" />Herbruikbare succesformules</span>} subtitle="Dezelfde combinatie van format, hooktype en CTA bij meerdere sterke video's (minimaal 2 sterke video's en 60% raak)." />
        {m.formulas.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {m.formulas.map((f, i) => (
              <div key={i} className="rounded-xl border border-[var(--color-line)] p-4">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{f.format ? <><Badge tone="ink">{f.format}</Badge>+</> : null}<Badge tone="info">Hook: {f.hookType}</Badge>+<Badge tone="lime">CTA: {f.cta}</Badge></div>
                <div className="mt-2 text-xs text-[var(--color-ink-muted)]">{f.hits} van {f.n} video&apos;s sterk · mediaan {xf(f.medianPerf)} normaal</div>
                <div className="mt-2.5 flex flex-col gap-2">{f.examples.slice(0, 2).map((v) => <MiniVideo key={v.id} v={v} />)}</div>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen combinatie die bij meerdere sterke video&apos;s terugkomt.</p>}
      </Card>

      {/* Voor het team: direct toepasbaar */}
      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><BrainCircuit className="size-4" />Voor nieuwe scripts</span>} subtitle="Dit gaat automatisch mee in de briefing van de Script Engine voor deze klant." action={<Link href={`/ai/scriptgenerator?client=${cm.clientId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-medium text-white"><PenLine className="size-3.5" />Naar Script Engine</Link>} />
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4 text-[13px]">
          <Block title="Opnieuw inzetten" items={m.formats.filter((g) => g.verdict === "beter" && g.n >= 2).map((g) => `${g.label} (${xf(g.medianPerf)}, ${g.n} video's)`)} empty="Nog geen format dat duidelijk bovengemiddeld scoort." />
          <Block title="Hooks hergebruiken of doorontwikkelen" items={m.topHooks.slice(0, 4).map((v) => `“${v.hook}”`)} empty="Nog geen hooks." />
          <Block title="Minder goed werkende scriptonderdelen" items={weak.filter((g) => g.dimension !== "format").slice(0, 4).map((g) => `${DIM[g.dimension]}: ${g.label} (${xf(g.medianPerf)})`)} empty="Geen onderdelen die aantoonbaar minder werken." />
          <Block title="Contentideeën uit de resultaten" items={cm.ai.ideas.map((i) => `${i.title}: “${i.hook}”`)} empty="Ideeën verschijnen na de eerstvolgende analyse." icon />
        </div>
      </Card>
    </div>
  );
}

const DIM: Record<MemoryGroup["dimension"], string> = { format: "Format", hook: "Hooktype", cta: "CTA", lengte: "Lengte" };

function TrendBadge({ g }: { g: MemoryGroup }) {
  if (g.trend === "sterker") return <Badge tone="good">Wordt sterker</Badge>;
  if (g.trend === "zwakker") return <Badge tone="warn">Verliest effect</Badge>;
  return null;
}

function Kv({ k, v }: { k: string; v: string }) {
  return <div><div className="font-semibold tabular-nums text-[var(--color-ink)]">{v}</div><div className="text-[var(--color-ink-muted)]">{k}</div></div>;
}

function MiniVideo({ v, showPerf = false }: { v: MemoryVideo; showPerf?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Thumb v={v} size="sm" />
      <div className="min-w-0 text-xs">
        <div className="line-clamp-2 font-medium text-[var(--color-ink)]">{v.title}</div>
        <div className="text-[var(--color-ink-muted)]">{plat(v.platform)} · {nf(v.views)} views{showPerf ? ` · ${xf(v.perf)} normaal` : ""}</div>
      </div>
    </div>
  );
}

function GroupTable({ groups, title }: { groups: MemoryGroup[]; title: string }) {
  if (!groups.length) return null;
  return (
    <div className="mt-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{title}</div>
      <div className="mt-2 flex flex-col gap-1.5">
        {groups.map((g) => (
          <div key={g.label} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-3 text-sm">
            <span className="truncate">{g.label} <span className="text-xs text-[var(--color-ink-muted)]">· {g.n} video&apos;s</span></span>
            <span className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"><span className="block h-full rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${Math.round(g.hitRate * 100)}%` }} /></span>
            <span className="flex items-center gap-1.5"><span className="w-10 text-right text-xs tabular-nums">{Math.round(g.hitRate * 100)}%</span><PerfChip perf={g.medianPerf} /><EvidenceBadge e={g.evidence} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({ title, items, empty, icon = false }: { title: string; items: string[]; empty: string; icon?: boolean }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-sunken)] p-3.5">
      <div className="flex items-center gap-1.5 font-semibold">{icon ? <Lightbulb className="size-3.5" /> : null}{title}</div>
      {items.length ? <ul className="mt-2 flex flex-col gap-1.5">{items.map((t, i) => <li key={i} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--color-indigo-ink)]" />{t}</li>)}</ul> : <p className="mt-2 text-[var(--color-ink-muted)]">{empty}</p>}
    </div>
  );
}
