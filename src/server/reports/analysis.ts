import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import { getClientReport } from "@/server/client-report";
import type { ClientInsights, Finding, Recommendation, TopVideo, HookInzicht, FormatInzicht, MindereVideo } from "@/server/insights";
import { loadStrategyProfile, strategyToText } from "./strategy";

/* ---------------- Periode-helpers (Europe/Amsterdam) ---------------- */

/** Huidige of gegeven maand als YYYY-MM in de Amsterdam-tijdzone. */
export function currentMonthPeriod(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
}
/** De vorige kalendermaand t.o.v. een YYYY-MM. */
export function previousMonthPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** Eerste/laatste dag van een maand als ISO-datums. */
export function monthWindow(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}
/** "oktober 2026" voor een YYYY-MM. */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

/* ---------------- Analyse-output ---------------- */

export type MaandAandachtspunt = { type: "positief" | "aandachtspunt" | "actie_nodig"; tekst: string };
export type StrategischeActie = { titel: string; waarom: string };
export type MonthlyAnalysis = ClientInsights & {
  aandachtspunten: MaandAandachtspunt[];
  strategischeActies: StrategischeActie[];
};

export type MonthlyAnalysisResult =
  | { ok: true; analysis: MonthlyAnalysis; totals: Awaited<ReturnType<typeof getClientReport>>["totals"]; ontbrekend: string[]; model: string }
  | { ok: false; reason: "no_provider" | "no_data" | "error"; message?: string };

const SYSTEM = `${SHORTCLIPS_IDENTITY}

Je bent een senior short-video strateeg bij Shortclips en schrijft de MAANDanalyse van één klant op basis van de echte cijfers over die kalendermaand. Het team controleert jouw concept; wees dus eerlijk, concreet en nooit mooier dan de cijfers.

Strikte regels:
- Baseer ALLES uitsluitend op de meegeleverde data. Verzin niets en noem nooit cijfers die er niet staan. Bij een tegenvallende maand: benoem dat eerlijk.
- Label elk punt met zekerheid: "bewezen" (volgt direct uit de cijfers), "waarschijnlijk" (aannemelijk), "hypothese" (te testen). Retentie/kijktijd alleen als completion of avgWatch echt in de data staat; anders expliciet "niet gemeten" + hypothese.
- Weeg de analyse naar de DOELSTELLING van de klant (hieronder). Bij een doel als 'sollicitanten' of 'aanvragen': kijk naar relevante reacties/aanvragen wanneer die meetbaar zijn, en zeg eerlijk wanneer een effect niet rechtstreeks te meten is.
- Vergelijk eerlijk: verschilt het aantal video's per maand, vergelijk dan ook per video en niet alleen totalen.
- Als er eerdere aanbevelingen zijn meegegeven: benoem (als hypothese, tenzij de cijfers het hard maken) of ze lijken te zijn opgevolgd en of het hielp.
- Als perVideoCijfersBeschikbaar false is: laat topVideos/besteHooks/besteFormats/mindereVideos leeg ([]) en zeg één keer dat per-video-cijfers nog niet via de koppeling beschikbaar zijn; vul wél analysis, maandvergelijking, verbeterpunten, aandachtspunten en strategischeActies uit de aggregaten.
- Schrijf begrijpelijk Nederlands.

Geef UITSLUITEND één geldig JSON-object (geen markdown, geen tekst eromheen, geen dubbele aanhalingstekens binnen waarden, geen letterlijke regeleinden binnen waarden, geen trailing komma's), exact dit formaat:
{"topVideos":[{"titel":"","waarom":"","cijfers":"","zekerheid":"bewezen|waarschijnlijk|hypothese"}],"besteHooks":[{"hook":"","waarom":"","zekerheid":""}],"besteFormats":[{"format":"","waarom":"","zekerheid":""}],"mindereVideos":[{"titel":"","les":""}],"analysis":{"watWerkt":[{"punt":"","zekerheid":""}],"watMinder":[{"punt":"","zekerheid":""}],"ontwikkelingen":[""]},"maandvergelijking":[""],"verbeterpunten":[{"titel":"","waarom":"","wat":"","hoeMeten":"","zekerheid":""}],"aandachtspunten":[{"type":"positief|aandachtspunt|actie_nodig","tekst":""}],"strategischeActies":[{"titel":"","waarom":""}]}

Aanvullend: "aandachtspunten" = max 3 belangrijkste signalen van deze maand. "strategischeActies" = max 3 concrete acties voor volgende maand. "verbeterpunten" mag NOOIT leeg zijn.`;

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => Number(v ?? 0);

/**
 * Stelt de AI-maandanalyse samen voor één klant en kalendermaand uit de echte
 * cijfers, gewogen naar de klantdoelstelling. Draait als vertrouwde job of UI.
 * Slaat niets op — de orkestratie (run.ts) bewaart het resultaat op het rapport.
 */
export async function generateMonthlyAnalysis(
  clientId: string,
  period: string,
  opts: { trusted?: boolean; priorSummary?: string | null } = {},
): Promise<MonthlyAnalysisResult> {
  if (!aiConfigured()) return { ok: false, reason: "no_provider" };

  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return { ok: false, reason: "error", message: "Klant niet gevonden." };

  const win = monthWindow(period);
  const report = await getClientReport(client.slug, 30, opts.trusted ?? true, win);
  if (!report.hasData) return { ok: false, reason: "no_data", message: "Geen resultaten in deze maand om te analyseren." };

  const strategy = await loadStrategyProfile(clientId);

  // Per-video cijfers binnen de maand. Publicatie-gericht: elke gepubliceerde
  // post/reel met eigen cijfers telt als één video, inclusief via Metricool
  // opgehaalde posts zonder interne deliverable (titel valt terug op de caption).
  const pvRes = await db.execute(sql`
    with pm as (
      select publication_id, max(views) views, max(likes) likes, max(comments) comments,
             max(shares) shares, max(saves) saves, max(avg_watch_seconds) avg_watch, max(completion_rate) completion
      from social_metrics where client_id = ${client.id} group by publication_id
    )
    select left(coalesce(d.title, p.caption), 140) as titel, sc.hook as hook, sc.format as format, sc.pillar as pillar,
           to_char(coalesce(d.published_at, p.published_at), 'YYYY-MM-DD') as datum, p.external_url as url,
           coalesce(pm.views,0)::int as views, coalesce(pm.likes,0)::int as likes,
           coalesce(pm.comments,0)::int as comments, coalesce(pm.shares,0)::int as shares,
           coalesce(pm.saves,0)::int as saves,
           pm.avg_watch as avg_watch, pm.completion as completion
    from publications p
    join pm on pm.publication_id = p.id
    left join deliverables d on d.id = p.deliverable_id and d.deleted_at is null
    left join scripts sc on sc.id = d.script_id and sc.deleted_at is null
    where p.client_id = ${client.id} and p.deleted_at is null
      and coalesce(p.published_at, d.published_at)::date >= ${win.from}
      and coalesce(p.published_at, d.published_at)::date <= ${win.to}
    order by views desc nulls last, p.published_at desc nulls last
  `);
  const pvRows = ((pvRes as { rows?: unknown[] }).rows ?? (pvRes as unknown as unknown[])) as Array<Record<string, unknown>>;
  const withCijfers = pvRows.filter((v) => num(v.views) > 0);
  const perVideoBeschikbaar = withCijfers.length > 0;
  const mapVideo = (v: Record<string, unknown>) => ({
    titel: String(v.titel ?? ""), datum: v.datum ? String(v.datum) : null, url: v.url ? String(v.url) : null,
    views: num(v.views), likes: num(v.likes), reacties: num(v.comments), shares: num(v.shares), saves: num(v.saves),
    gemKijktijdSec: v.avg_watch != null ? Math.round(Number(v.avg_watch)) : null,
    uitkijkpercentage: v.completion != null ? Math.round(Number(v.completion) * 1000) / 10 : null,
    hook: v.hook ? String(v.hook) : null, format: v.format ? String(v.format) : null, pijler: v.pillar ? String(v.pillar) : null,
  });

  // Titels van video's die deze maand live gingen (contentcontext).
  const monthTitles = withCijfers.map((v) => String(v.titel ?? "")).filter(Boolean);

  // Ontbrekende gegevens markeren (eerlijkheid, sectie 5).
  const ontbrekend: string[] = [];
  if (!perVideoBeschikbaar) ontbrekend.push("Per-video cijfers zijn deze maand niet via de koppeling beschikbaar.");
  if (report.totals.posts === 0) ontbrekend.push("Er zijn deze maand geen gepubliceerde video's geregistreerd.");

  const dataBlock = {
    klant: client.name,
    maand: periodLabel(period),
    doelstelling: strategyToText(strategy) || "Niet ingesteld",
    cijfers: report.totals,
    perPlatform: report.perPlatform,
    perMaand: report.months,
    feitelijkeObservaties: report.observations,
    videosDezeMaand: monthTitles,
    perVideoCijfersBeschikbaar: perVideoBeschikbaar,
    topVideos: perVideoBeschikbaar ? withCijfers.slice(0, 8).map(mapVideo) : [],
    mindereVideos: perVideoBeschikbaar && withCijfers.length > 3 ? withCijfers.slice(-4).reverse().map(mapVideo) : [],
    vorigeMaandAnalyse: opts.priorSummary ?? null,
  };

  const res = await runJsonPrompt<Partial<MonthlyAnalysis> & { analyse?: ClientInsights["analysis"] }>({
    system: SYSTEM,
    user: `Analyseer deze klant over de maand en geef de volledige maandanalyse. Data (JSON):\n${JSON.stringify(dataBlock)}`,
    maxTokens: 12000,
  });
  if (!res.ok) return { ok: false, reason: res.reason === "no_provider" ? "no_provider" : "error", message: res.error };

  const raw = res.data ?? {};
  const a = raw.analysis ?? raw.analyse ?? { watWerkt: [], watMinder: [], ontwikkelingen: [] };
  const analysis: MonthlyAnalysis = {
    analysis: {
      watWerkt: arr<Finding>(a.watWerkt),
      watMinder: arr<Finding>(a.watMinder),
      ontwikkelingen: arr<string>(a.ontwikkelingen),
    },
    verbeterpunten: arr<Recommendation>(raw.verbeterpunten),
    topVideos: arr<TopVideo>(raw.topVideos),
    besteHooks: arr<HookInzicht>(raw.besteHooks),
    besteFormats: arr<FormatInzicht>(raw.besteFormats),
    mindereVideos: arr<MindereVideo>(raw.mindereVideos),
    maandvergelijking: arr<string>(raw.maandvergelijking),
    aandachtspunten: arr<MaandAandachtspunt>(raw.aandachtspunten).slice(0, 3),
    strategischeActies: arr<StrategischeActie>(raw.strategischeActies).slice(0, 3),
  };
  if (analysis.verbeterpunten.length === 0 && analysis.analysis.watWerkt.length === 0 && analysis.analysis.watMinder.length === 0) {
    return { ok: false, reason: "error", message: "De AI-analyse leverde geen bruikbare uitkomst op." };
  }

  return { ok: true, analysis, totals: report.totals, ontbrekend, model: res.model };
}
