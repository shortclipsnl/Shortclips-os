import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clients, deliverables } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { getClientReport } from "@/server/client-report";

export type Zekerheid = "bewezen" | "waarschijnlijk" | "hypothese";
export type Finding = { punt: string; zekerheid: Zekerheid };
export type Recommendation = {
  titel: string;
  waarom: string;
  wat: string;
  hoeMeten: string;
  zekerheid: Zekerheid;
};
export type TopVideo = { titel: string; waarom: string; cijfers?: string; zekerheid: Zekerheid };
export type HookInzicht = { hook: string; waarom: string; zekerheid: Zekerheid };
export type FormatInzicht = { format: string; waarom: string; zekerheid: Zekerheid };
export type MindereVideo = { titel: string; les: string };
export type ClientInsights = {
  analysis: { watWerkt: Finding[]; watMinder: Finding[]; ontwikkelingen: string[] };
  verbeterpunten: Recommendation[];
  // Uitbreiding met analyse op videoniveau (optioneel, zodat oudere opgeslagen
  // analyses zonder deze velden blijven werken).
  topVideos?: TopVideo[];
  besteHooks?: HookInzicht[];
  besteFormats?: FormatInzicht[];
  mindereVideos?: MindereVideo[];
  maandvergelijking?: string[];
};

const SYSTEM = `Je bent een senior short-video strateeg bij Shortclips. Je analyseert de resultaten van één klant op basis van de echte cijfers — ook per video — en geeft heldere bevindingen en concrete adviezen voor de volgende opnames, zodat het team én de klant direct begrijpen wat werkt, waarom het werkt en wat beter kan.

Strikte regels (eerlijkheid staat voorop):
- Baseer ALLES uitsluitend op de meegeleverde data. Verzin niets en noem nooit cijfers die er niet staan.
- Onderscheid bewezen resultaten van verklaringen: label elk punt met zekerheid "bewezen" (volgt direct uit de cijfers), "waarschijnlijk" (aannemelijk maar niet hard) of "hypothese" (te testen).
- Per video zijn views, likes, reacties, shares en saves meestal beschikbaar; retentie/uitkijkpercentage (completion) en gemiddelde kijktijd VAAK NIET. Trek conclusies over retentie of kijktijd alleen als completion of avgWatch echt in de data staat; staat het er niet, zeg dan expliciet dat de retentie niet gemeten is en markeer zulke uitspraken als "hypothese".
- Baseer "beste hooks" en "beste formats" op de hook- en formatvelden van de best presterende video's in de data. Ontbreekt de hook of het format, verzin die dan niet.
- Als perVideoCijfersBeschikbaar false is (er zijn geen topVideos meegeleverd): laat topVideos, besteHooks, besteFormats en mindereVideos LEEG ([]), en benoem in ontwikkelingen één keer dat de cijfers per video nog niet via de koppeling beschikbaar zijn. Vul dan wél analysis, maandvergelijking en verbeterpunten op basis van de aggregaten (totalen, per platform, per maand).
- Schrijf in het Nederlands, begrijpelijk en bondig — een klant moet het ook snappen.

Geef exact deze onderdelen:
1. topVideos: de 3 best presterende video's uit de data, elk met titel, waarom het goed presteerde (cijfers + waar mogelijk de hook, het onderwerp en het format) en een korte cijferregel (bijv. 'X weergaven, Y reacties'). Met zekerheidslabel.
2. besteHooks: 2 tot 4 hooks die het sterkst lijken te werken (uit de best presterende video's), met korte onderbouwing en zekerheid. Baseer dit op views/interacties; markeer retentie-uitspraken als hypothese als completion ontbreekt.
3. besteFormats: 1 tot 3 formats die bovengemiddeld presteren (bereik, interactie, kijktijd), met onderbouwing en zekerheid.
4. mindereVideos: 2 tot 3 video's die minder presteerden, elk met een concrete les die we eruit halen.
5. analysis: watWerkt en watMinder (findings met zekerheid) plus ontwikkelingen (korte feitelijke observaties).
6. maandvergelijking: 1 tot 3 regels die de recente maand(en) vergelijken met eerdere maanden en de opvallendste ontwikkelingen benoemen (gebruik perMaand).
7. verbeterpunten: 3 tot 5 concrete aanbevelingen voor de volgende opnamesessie (onderwerpen, hooks én formats), elk met titel, waarom (onderbouwd), wat we aanpassen, hoeMeten en zekerheid. Dit veld mag NOOIT leeg zijn.

JSON-opmaak (STRIKT, anders is het antwoord onbruikbaar):
- Antwoord met UITSLUITEND één geldig JSON-object, zonder tekst eromheen en zonder markdown.
- Gebruik binnen tekstwaarden GEEN dubbele aanhalingstekens; gebruik indien nodig enkele aanhalingstekens.
- Gebruik GEEN letterlijke regeleinden binnen waarden en GEEN trailing komma's.
- Exact dit formaat:
{"topVideos":[{"titel":"...","waarom":"...","cijfers":"...","zekerheid":"bewezen|waarschijnlijk|hypothese"}],"besteHooks":[{"hook":"...","waarom":"...","zekerheid":"..."}],"besteFormats":[{"format":"...","waarom":"...","zekerheid":"..."}],"mindereVideos":[{"titel":"...","les":"..."}],"analysis":{"watWerkt":[{"punt":"...","zekerheid":"..."}],"watMinder":[{"punt":"...","zekerheid":"..."}],"ontwikkelingen":["..."]},"maandvergelijking":["..."],"verbeterpunten":[{"titel":"...","waarom":"...","wat":"...","hoeMeten":"...","zekerheid":"..."}]}`;

/** Bouwt de AI-analyse voor een klant uit de echte cijfers en slaat die op.
 *  Gated: zonder ANTHROPIC_API_KEY gebeurt er niets (nette melding). */
export async function generateClientInsights(slug: string, days = 90, trusted = false): Promise<
  { ok: true; insights: ClientInsights; model: string } | { ok: false; reason: "no_provider" | "no_data" | "error"; message?: string }
> {
  // `trusted` = aangeroepen vanuit een vertrouwde server-job zonder sessie.
  const viewer = trusted ? null : await requireInternal();
  if (!aiConfigured()) return { ok: false, reason: "no_provider" };

  const r = await getClientReport(slug, days, trusted);
  if (!r.hasData) return { ok: false, reason: "no_data", message: "Nog geen resultaten om te analyseren." };

  // Recente videotitels als contentcontext.
  const titles = await db
    .select({ title: deliverables.title })
    .from(deliverables)
    .where(and(eq(deliverables.clientId, r.client.id), isNull(deliverables.deletedAt)))
    .orderBy(desc(deliverables.createdAt))
    .limit(30);

  // Per-video cijfers uit de geselecteerde periode, mét de hook en het format uit
  // het gekoppelde script. LET OP: per-video cijfers (social_metrics) zijn er
  // alleen als de per-post-koppeling gevuld is; ontbreekt dat, dan is dit leeg en
  // doen we bewust GEEN uitspraken per video.
  const pvRes = await db.execute(sql`
    with pm as (
      select publication_id, max(views) views, max(likes) likes, max(comments) comments,
             max(shares) shares, max(saves) saves, max(avg_watch_seconds) avg_watch, max(completion_rate) completion
      from social_metrics where client_id = ${r.client.id} group by publication_id
    )
    select d.title as titel, sc.hook as hook, sc.format as format, sc.pillar as pillar,
           to_char(d.published_at, 'YYYY-MM-DD') as datum,
           coalesce(sum(pm.views),0)::int as views, coalesce(sum(pm.likes),0)::int as likes,
           coalesce(sum(pm.comments),0)::int as comments, coalesce(sum(pm.shares),0)::int as shares,
           coalesce(sum(pm.saves),0)::int as saves,
           avg(pm.avg_watch) filter (where pm.avg_watch is not null) as avg_watch,
           avg(pm.completion) filter (where pm.completion is not null) as completion
    from deliverables d
    left join publications p on p.deliverable_id = d.id and p.deleted_at is null
    left join pm on pm.publication_id = p.id
    left join scripts sc on sc.id = d.script_id and sc.deleted_at is null
    where d.client_id = ${r.client.id} and d.deleted_at is null and d.status = 'published'
      and d.published_at >= current_date - ${sql.raw(`interval '${days} days'`)}
    group by d.id, d.title, sc.hook, sc.format, sc.pillar, d.published_at
    order by views desc nulls last, d.published_at desc nulls last
  `);
  const pvRows = ((pvRes as { rows?: unknown[] }).rows ?? (pvRes as unknown as unknown[])) as Array<Record<string, unknown>>;
  const num = (v: unknown) => Number(v ?? 0);
  const videosMetCijfers = pvRows.filter((v) => num(v.views) > 0);
  const perVideoBeschikbaar = videosMetCijfers.length > 0;
  const retentieBeschikbaar = pvRows.some((v) => v.completion != null || v.avg_watch != null);
  const mapVideo = (v: Record<string, unknown>) => ({
    titel: String(v.titel ?? ""),
    datum: v.datum ? String(v.datum) : null,
    views: num(v.views), likes: num(v.likes), reacties: num(v.comments), shares: num(v.shares), saves: num(v.saves),
    gemKijktijdSec: v.avg_watch != null ? Math.round(Number(v.avg_watch)) : null,
    uitkijkpercentage: v.completion != null ? Math.round(Number(v.completion) * 1000) / 10 : null,
    hook: v.hook ? String(v.hook) : null,
    format: v.format ? String(v.format) : null,
    pijler: v.pillar ? String(v.pillar) : null,
  });
  const topVideos = videosMetCijfers.slice(0, 8).map(mapVideo);
  const mindereVideos = videosMetCijfers.length > 3 ? videosMetCijfers.slice(-4).reverse().map(mapVideo) : [];

  const dataBlock = {
    klant: r.client.name,
    periodeDagen: days,
    cijfers: r.totals,
    perPlatform: r.perPlatform,
    perMaand: r.months,
    feitelijkeObservaties: r.observations,
    recenteVideotitels: titles.map((t) => t.title),
    perVideoCijfersBeschikbaar: perVideoBeschikbaar,
    retentiePerVideoBeschikbaar: retentieBeschikbaar,
    topVideos: perVideoBeschikbaar ? topVideos : [],
    mindereVideos: perVideoBeschikbaar ? mindereVideos : [],
  };

  const res = await runJsonPrompt<ClientInsights>({
    system: SYSTEM,
    user: `Analyseer deze klant en geef verbeterpunten. Data (JSON):\n${JSON.stringify(dataBlock)}`,
    // Ruim budget: de volledige analyse heeft nu meer onderdelen (topvideo's,
    // hooks, formats, mindere video's, maandvergelijking + verbeterpunten), dus
    // wat meer tokens zodat het antwoord niet wordt afgekapt.
    maxTokens: 11000,
  });
  if (!res.ok) return { ok: false, reason: res.reason === "no_provider" ? "no_provider" : "error", message: res.error };

  // Normaliseer naar de verwachte vorm: AI-antwoorden wijken soms af (een
  // ontbrekende sleutel, een andere naam). Zo is wat we opslaan én tonen altijd
  // renderbaar en crasht de pagina nooit op een afwijkend model-antwoord.
  const raw = (res.data ?? {}) as Partial<ClientInsights> & { analyse?: ClientInsights["analysis"] };
  const analysis = raw.analysis ?? raw.analyse ?? { watWerkt: [], watMinder: [], ontwikkelingen: [] };
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const insights: ClientInsights = {
    analysis: {
      watWerkt: arr<Finding>(analysis.watWerkt),
      watMinder: arr<Finding>(analysis.watMinder),
      ontwikkelingen: arr<string>(analysis.ontwikkelingen),
    },
    verbeterpunten: arr<Recommendation>(raw.verbeterpunten),
    topVideos: arr<TopVideo>(raw.topVideos),
    besteHooks: arr<HookInzicht>(raw.besteHooks),
    besteFormats: arr<FormatInzicht>(raw.besteFormats),
    mindereVideos: arr<MindereVideo>(raw.mindereVideos),
    maandvergelijking: arr<string>(raw.maandvergelijking),
  };
  // Niets bruikbaars terug → als fout behandelen i.p.v. een leeg kaartje opslaan.
  if (insights.verbeterpunten.length === 0 && insights.analysis.watWerkt.length === 0 && insights.analysis.watMinder.length === 0) {
    return { ok: false, reason: "error", message: "De AI-analyse leverde geen bruikbare uitkomst op. Probeer het opnieuw." };
  }

  await db.insert(aiOutputs).values({
    clientId: r.client.id,
    tool: "insights",
    title: `Resultatenanalyse (${days} dagen)`,
    inputSummary: `${r.totals.views} weergaven · ${r.totals.posts} video's · ${days} dagen`,
    output: insights as unknown as Record<string, unknown>,
    createdById: viewer?.id ?? null,
  });

  return { ok: true, insights, model: res.model };
}

/** Laatst opgeslagen AI-analyse voor een klant (voor pagina en PDF). */
export async function getLatestInsights(clientId: string): Promise<{ insights: ClientInsights; createdAt: Date } | null> {
  const [row] = await db
    .select({ output: aiOutputs.output, createdAt: aiOutputs.createdAt })
    .from(aiOutputs)
    .where(and(eq(aiOutputs.clientId, clientId), eq(aiOutputs.tool, "insights")))
    .orderBy(desc(aiOutputs.createdAt))
    .limit(1);
  if (!row) return null;
  return { insights: row.output as unknown as ClientInsights, createdAt: row.createdAt as Date };
}

/** Of de AI-koppeling actief is (voor de UI). */
export function insightsAvailable(): boolean {
  return aiConfigured();
}
