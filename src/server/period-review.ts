import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientImprovements, clientReports, clients } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import { loadClientMemory } from "@/server/content-memory";
import type { MemoryGroup } from "@/server/content-memory/analyze";
import type { PortalResults } from "@/server/portal";
import { PORTAL_CONTENTGEHEUGEN_LIVE } from "@/lib/feature-flags";
import {
  amsToday,
  capitalize,
  describePeriod,
  monthKeyOf,
  monthLabel,
  monthsOfQuarter,
  quarterKeyOf,
  shiftMonthKey,
  shiftQuarterKey,
  type PeriodMode,
} from "@/lib/portal-periods";

/**
 * Periodeoverzicht bij de resultaten: managementsamenvatting, wat werkt,
 * bedrijfsimpact en advies. Alles is afgeleid van bestaande gegevens:
 *  - de cijfers van de gekozen periode (dezelfde PortalResults als de pagina);
 *  - het Contentgeheugen van de klant (wordt zelf uit alle resultaten berekend);
 *  - door het team goedgekeurde verbeterpunten en gepubliceerde maandanalyses.
 * Er wordt niets opgeslagen en niets door AI geschreven: zo kan er nooit een
 * niet-gecontroleerde tekst bij de klant komen, en blijft er één bron.
 *
 * Elke regel is gemarkeerd als "gemeten" (rechtstreeks uit de cijfers) of
 * "afgeleid" (een conclusie die we uit de cijfers trekken).
 */

export type ReviewAudience = "klant" | "intern";
export type Basis = "gemeten" | "afgeleid";

export type ReviewWork = { label: string; value: string; quote: string | null; status: "bewezen" | "veelbelovend"; detail: string };
export type ReviewAdvice = { kind: "behouden" | "verbeteren" | "testen"; title: string; text: string; source: "resultaten" | "team" | "voorstel" };
export type ReviewMonth = { key: string; label: string; views: number; reach: number; followers: number; videos: number; measured: boolean };
export type ReviewImpactRow = { label: string; value: string; note: string };

export type PeriodReview = {
  mode: PeriodMode;
  label: string;
  prevLabel: string | null;
  complete: boolean;
  /** Maanden binnen het kwartaal (alleen bij kwartaal). */
  months: ReviewMonth[];
  /** True als het kwartaaltotaal ook weergaven bevat van kanalen zonder dagcijfers. */
  monthsPartial: boolean;
  summary: { bereikt: string; waarde: string; verbeteren: string } | null;
  works: ReviewWork[];
  /** Zinnen over deze periode zelf (gemeten). */
  highlights: string[];
  /** Uitleg wanneer er nog te weinig video's zijn voor conclusies. */
  worksNote: string | null;
  impact: { gemeten: ReviewImpactRow[]; afgeleid: string[]; nietGemeten: ReviewImpactRow[] };
  advice: ReviewAdvice[];
  /** Gepubliceerde maandanalyse van de gekozen maand (bestaande maandrapportage). */
  monthlyReport: { id: string; label: string } | null;
  /** Gepubliceerde maandanalyses binnen het gekozen kwartaal. */
  quarterReports: Array<{ id: string; label: string }>;
  memoryHref: string | null;
  intern: {
    reliability: string;
    recs: Array<{ kind: string; title: string; text: string; status: string }>;
    strong: Array<{ title: string; detail: string }>;
    weak: Array<{ title: string; detail: string }>;
    trends: string[];
    flops: Array<{ title: string; detail: string }>;
    /** Maandrapporten in de periode met hun controlestatus. */
    reports: Array<{ id: string; label: string; status: string }>;
  } | null;
};

const nf = (n: number) => Math.round(n).toLocaleString("nl-NL");
const fx = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;
const rowsOf = <T,>(res: unknown): T[] => (((res as { rows?: unknown[] }).rows ?? res) as T[]);
const DIM: Record<MemoryGroup["dimension"], string> = { format: "Format", hook: "Opening", cta: "Afsluiting", lengte: "Lengte" };
const WORK_LABEL: Record<string, string> = { format: "Type video", hook: "Opening", lengte: "Videolengte", filmstijl: "Manier van filmen" };

function pctSentence(pct: number | null, what: string, prevLabel: string | null, partial: boolean): string | null {
  if (pct === null || !prevLabel) return null;
  const versus = partial ? `dezelfde dagen in ${prevLabel}` : prevLabel;
  if (pct === 0) return `Dat is gelijk aan ${versus}.`;
  return `Dat is ${Math.abs(pct)}% ${pct > 0 ? "meer" : "minder"} ${what} dan in ${versus}.`;
}

/** Portaal: het overzicht van de eigen klant. */
export async function getPeriodReview(viewer: Viewer, r: PortalResults): Promise<PeriodReview | null> {
  if (!viewer.clientId) return null;
  return buildPeriodReview(viewer.clientId, r, "klant");
}

/** Intern: het overzicht voor één klant (klantversie of uitgebreide interne versie). */
export async function getPeriodReviewForClient(viewer: Viewer, clientId: string, r: PortalResults, audience: ReviewAudience): Promise<PeriodReview> {
  assertClientAccess(viewer, clientId);
  return buildPeriodReview(clientId, r, audience);
}

async function buildPeriodReview(clientId: string, r: PortalResults, audience: ReviewAudience): Promise<PeriodReview> {
  const today = amsToday();
  const p = describePeriod(r.periodKey, r.periodStart, r.periodEnd, today);
  const isQuarter = p.mode === "kwartaal";
  const calendar = p.mode !== "vrij";
  const partial = calendar && !p.complete;
  const prevLabel = p.prevLabel ?? null;
  const periodMonths = isQuarter ? monthsOfQuarter(p.key) : p.mode === "maand" ? [p.key] : [];

  const [[client], cm, reportRows, improvementRows, impactRes] = await Promise.all([
    db.select({ slug: clients.slug, name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1),
    loadClientMemory(clientId).catch(() => null),
    periodMonths.length
      ? db
          .select({ id: clientReports.id, period: clientReports.period, status: clientReports.status })
          .from(clientReports)
          .where(and(eq(clientReports.clientId, clientId), eq(clientReports.periodType, "month"), inArray(clientReports.period, periodMonths), isNull(clientReports.deletedAt)))
          .orderBy(desc(clientReports.period))
      : Promise.resolve([] as Array<{ id: string; period: string; status: string }>),
    db
      .select({ period: clientImprovements.period, content: clientImprovements.content })
      .from(clientImprovements)
      .where(and(eq(clientImprovements.clientId, clientId), eq(clientImprovements.status, "approved"), isNull(clientImprovements.deletedAt)))
      .orderBy(desc(clientImprovements.period))
      .limit(1),
    // Linkklikken, conversies en profielbezoeken: alleen als een koppeling ze per video levert.
    db.execute(sql`
      select count(*) filter (where lc is not null)::int n_lc, coalesce(sum(lc),0)::int lc,
             count(*) filter (where cv is not null)::int n_cv, coalesce(sum(cv),0)::int cv,
             coalesce(sum(pv),0)::int pv
      from (
        select p.id, max(sm.link_clicks) lc, max(sm.conversions) cv, max(sm.profile_visits) pv
        from publications p join social_metrics sm on sm.publication_id = p.id
        where p.client_id = ${clientId} and p.deleted_at is null and p.published_at is not null
          and p.published_at::date between ${r.periodStart} and ${r.periodEnd}
        group by p.id
      ) x`).catch(() => null),
  ]);

  /* ---------------- Maanden binnen het kwartaal ---------------- */
  const months: ReviewMonth[] = isQuarter
    ? periodMonths
        .filter((k) => `${k}-01` <= today)
        .map((k) => {
          const pts = r.series.filter((s) => s.date.slice(0, 7) === k);
          return {
            key: k,
            label: monthLabel(k),
            views: pts.reduce((a, s) => a + s.views, 0),
            reach: pts.reduce((a, s) => a + s.reach, 0),
            followers: pts.reduce((a, s) => a + s.followers, 0),
            videos: r.videos.filter((v) => v.publishedAt.slice(0, 7) === k).length,
            measured: pts.length > 0,
          };
        })
    : [];
  const monthsPartial = isQuarter && months.reduce((a, m) => a + m.views, 0) < r.metrics.views;

  /* ---------------- Wat werkt (Contentgeheugen) ---------------- */
  const m = cm?.memory ?? null;
  const works: ReviewWork[] = (cm?.playbook?.items ?? [])
    .filter((i) => i.key !== "script" && i.value && i.status !== "onvoldoende")
    .map((i) => ({
      label: WORK_LABEL[i.key] ?? i.title,
      value: i.value!,
      quote: i.quote,
      status: i.status === "bewezen" ? ("bewezen" as const) : ("veelbelovend" as const),
      detail: `${i.perf != null ? `${fx(i.perf)} het normale niveau, ` : ""}${i.n} video's`,
    }));
  const worksNote = !m || m.videoCount === 0
    ? "Er zijn nog geen video's met resultaten om conclusies uit te trekken."
    : !m.sufficient
      ? `Conclusies volgen vanaf ongeveer acht video's met resultaten. Nu zijn het er ${m.videoCount}.`
      : works.length === 0
        ? "Er is nog geen onderdeel dat duidelijk beter werkt dan de rest."
        : null;

  // Deze periode zelf: hoe scoorden de video's die in de periode zijn geplaatst?
  const inPeriod = (m?.all ?? []).filter((v) => v.publishedOn && v.publishedOn >= r.periodStart && v.publishedOn <= r.periodEnd);
  const strongNow = inPeriod.filter((v) => v.perf >= 1.2).sort((a, b) => b.perf - a.perf);
  const highlights: string[] = [];
  if (inPeriod.length >= 3 && strongNow.length > 0) {
    highlights.push(`${strongNow.length} van de ${inPeriod.length} video's uit ${p.label} scoorden duidelijk boven het normale niveau van dit account.`);
  }
  if (strongNow[0]) highlights.push(`Sterkste video van de periode: "${strongNow[0].title}" (${fx(strongNow[0].perf)} het normale niveau).`);
  if (strongNow[0]?.hook) highlights.push(`Opening die het best werkte: "${strongNow[0].hook}".`);

  /* ---------------- Bedrijfsimpact ---------------- */
  const imp = (impactRes ? rowsOf<Record<string, number>>(impactRes)[0] : null) ?? {};
  const gemeten: ReviewImpactRow[] = [];
  if (r.metrics.reach > 0) gemeten.push({ label: "Bereik", value: nf(r.metrics.reach), note: "Zo vaak kwam de content bij mensen in beeld." });
  if (r.metrics.views > 0) gemeten.push({ label: "Weergaven", value: nf(r.metrics.views), note: "Zo vaak zijn de video's bekeken." });
  if (r.metrics.followerGrowth !== 0) gemeten.push({ label: "Nieuwe volgers", value: `${r.metrics.followerGrowth > 0 ? "+" : ""}${nf(r.metrics.followerGrowth)}`, note: "Mensen die het bedrijf zijn gaan volgen." });
  if (r.metrics.engagements > 0) gemeten.push({ label: "Interacties", value: nf(r.metrics.engagements), note: "Likes, reacties, shares en opgeslagen video's." });
  if (r.valuableInteractions > 0) gemeten.push({ label: "Gedeeld en opgeslagen", value: nf(r.valuableInteractions), note: "Kijkers die de video doorstuurden of bewaarden." });
  if (Number(imp.pv ?? 0) > 0) gemeten.push({ label: "Profielbezoeken", value: nf(Number(imp.pv)), note: "Kijkers die doorklikten naar het profiel." });
  if (Number(imp.n_lc ?? 0) > 0) gemeten.push({ label: "Linkklikken", value: nf(Number(imp.lc ?? 0)), note: "Kliks vanuit de video's naar de website." });
  if (Number(imp.n_cv ?? 0) > 0) gemeten.push({ label: "Conversies", value: nf(Number(imp.cv ?? 0)), note: "Geregistreerde acties na het bekijken van een video." });

  const afgeleid: string[] = [];
  if (r.metrics.reach > 0 || r.metrics.views > 0) {
    const grew = r.deltas.reach !== null ? r.deltas.reach : r.deltas.views;
    afgeleid.push(
      grew !== null && grew >= 5
        ? "Naamsbekendheid: het bereik groeide ten opzichte van de vorige periode. Meer mensen kwamen dus met het bedrijf in aanraking."
        : "Naamsbekendheid: de content hield het bedrijf in beeld bij de doelgroep. Hoe vaak mensen het bedrijf daardoor herkennen, is niet rechtstreeks te meten.",
    );
  }
  if (r.metrics.followerGrowth > 0) afgeleid.push("Groeiend eigen publiek: nieuwe volgers zien volgende video's vanzelf terug, zonder extra kosten.");
  if (r.valuableInteractions > 0) afgeleid.push("Betrokkenheid: video's die worden gedeeld of opgeslagen bereiken ook mensen buiten de eigen volgers.");

  const nietGemeten: ReviewImpactRow[] = [];
  const needLink = "Niet gemeten. Hiervoor is een koppeling met de websitestatistieken of een aanvraagregistratie nodig.";
  nietGemeten.push({ label: "Websitebezoeken", value: "–", note: needLink });
  nietGemeten.push({ label: "Aanvragen", value: "–", note: needLink });
  if (Number(imp.n_cv ?? 0) === 0) nietGemeten.push({ label: "Conversies", value: "–", note: needLink });

  /* ---------------- Advies ---------------- */
  // Alleen voor de lopende of de laatst afgeronde periode: het advies gaat over nu.
  const recent = !calendar
    ? true
    : isQuarter
      ? p.key >= shiftQuarterKey(quarterKeyOf(today), -1)
      : p.key >= shiftMonthKey(monthKeyOf(today), -1);
  const advice: ReviewAdvice[] = [];
  if (recent) {
    const proven = works.find((w) => w.status === "bewezen") ?? works[0];
    if (proven) advice.push({ kind: "behouden", title: proven.value, text: `${proven.label} die bij dit account het best werkt. Dit blijven we inzetten.`, source: "resultaten" });
    // Door het team goedgekeurde verbeterpunten (al zichtbaar op de resultatenpagina).
    const imprv = improvementRows[0];
    const lastMonth = periodMonths[periodMonths.length - 1];
    if (imprv && (!lastMonth || imprv.period >= periodMonths[0]!)) {
      const c = (imprv.content ?? {}) as Record<string, unknown>;
      const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
      for (const t of [...arr(c.optimalisaties), ...arr(c.volgendeMaand)].slice(0, 2)) advice.push({ kind: "verbeteren", title: t, text: "Verbeterpunt van het team, op basis van de resultaten.", source: "team" });
    }
    if (m?.sufficient) {
      const idea = cm?.ai.ideas[0];
      if (idea) advice.push({ kind: "testen", title: idea.title, text: "Nieuw idee dat voortbouwt op wat werkt. Nog niet getest.", source: "voorstel" });
      else if (m.topHooks[0]) advice.push({ kind: "testen", title: `Nieuwe openingen in de stijl van "${m.topHooks[0].hook}"`, text: "Variaties op de opening die de meeste aandacht trok.", source: "resultaten" });
    }
  }

  /* ---------------- Managementsamenvatting ---------------- */
  let summary: PeriodReview["summary"] = null;
  if (r.hasData) {
    const vids = r.metrics.publishedVideos;
    const parts: string[] = [];
    parts.push(
      `In ${p.label}${partial ? " (tot en met vandaag)" : ""} ${vids > 0 ? `plaatsten we ${nf(vids)} ${vids === 1 ? "video" : "video's"}. De content werd` : "werd de content"} ${nf(r.metrics.views)} keer bekeken${r.metrics.reach > 0 ? ` en haalde een bereik van ${nf(r.metrics.reach)}` : ""}.`,
    );
    if (r.metrics.followerGrowth > 0) parts.push(`Er kwamen ${nf(r.metrics.followerGrowth)} volgers bij.`);
    const cmp = pctSentence(r.deltas.views, "weergaven", prevLabel, partial);
    if (cmp) parts.push(cmp);

    const waarde: string[] = [];
    if (r.metrics.reach > 0) waarde.push(`Het bedrijf kwam ${nf(r.metrics.reach)} keer in beeld bij de doelgroep. Dat is gemeten bereik en de basis voor naamsbekendheid.`);
    if (r.metrics.engagements > 0) waarde.push(`Kijkers reageerden ${nf(r.metrics.engagements)} keer met een like, reactie, share of bewaarde video.`);
    if (Number(imp.n_lc ?? 0) > 0) waarde.push(`Vanuit de video's werd ${nf(Number(imp.lc ?? 0))} keer doorgeklikt naar de website.`);
    waarde.push("Websitebezoeken en aanvragen worden nog niet gemeten in het portaal. Daarover doen we daarom geen uitspraak.");

    const strip = (t: string) => t.replace(/\.$/, "");
    const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} en ${xs[xs.length - 1]}`);
    const byKind = (k: ReviewAdvice["kind"]) => advice.filter((x) => x.kind === k).map((x) => strip(x.title));
    const verb = advice.length
      ? [
          byKind("behouden").length ? `We houden vast aan: ${join(byKind("behouden"))}.` : "",
          byKind("verbeteren").length ? `We verbeteren: ${join(byKind("verbeteren"))}.` : "",
          byKind("testen").length ? `We testen: ${join(byKind("testen"))}.` : "",
        ].filter(Boolean).join(" ")
      : recent
        ? "Het advies voor de volgende periode volgt zodra er genoeg video's met resultaten zijn."
        : "Het actuele advies staat bij de meest recente periode.";
    summary = { bereikt: parts.join(" "), waarde: waarde.join(" "), verbeteren: verb };
  }

  /* ---------------- Rapportages ---------------- */
  const published = reportRows.filter((x) => x.status === "gepubliceerd");
  const monthlyReport = p.mode === "maand" && published[0] ? { id: published[0].id, label: capitalize(monthLabel(published[0].period)) } : null;
  const quarterReports = isQuarter ? published.map((x) => ({ id: x.id, label: capitalize(monthLabel(x.period)) })).reverse() : [];

  /* ---------------- Intern ---------------- */
  let intern: PeriodReview["intern"] = null;
  if (audience === "intern") {
    const groups = m ? [...m.formats, ...m.hooks, ...m.ctas, ...m.lengths] : [];
    const describe = (g: MemoryGroup) => `${fx(g.medianPerf)} normaal over ${g.n} video's, ${Math.round(g.hitRate * g.n)} boven gemiddeld`;
    const dna = cm?.dna ?? null;
    intern = {
      reliability: dna ? `${dna.reliability.label}. ${dna.reliability.note}` : "Nog geen gegevens in het Contentgeheugen.",
      recs: dna
        ? (["behouden", "verbeteren", "testen"] as const)
            .map((k) => dna.recommendations[k])
            .filter((a): a is NonNullable<typeof a> => !!a)
            .map((a) => ({ kind: a.kind, title: a.title, text: a.text, status: a.status === "bewezen" ? "Bewezen" : a.source === "voorstel" ? "Nieuw voorstel" : "Voorlopig" }))
        : [],
      strong: groups
        .filter((g) => g.verdict === "beter" && g.n >= 3 && g.label !== "Geen duidelijke CTA")
        .sort((a, b) => b.medianPerf - a.medianPerf)
        .slice(0, 4)
        .map((g) => ({ title: `${DIM[g.dimension]}: ${g.label}`, detail: describe(g) })),
      weak: groups
        .filter((g) => g.verdict === "slechter" && g.n >= 3)
        .sort((a, b) => a.medianPerf - b.medianPerf)
        .slice(0, 4)
        .map((g) => ({ title: `${DIM[g.dimension]}: ${g.label}`, detail: describe(g) })),
      trends: groups
        .filter((g) => g.trend && g.trend !== "stabiel" && g.n >= 4)
        .slice(0, 4)
        .map((g) => `${DIM[g.dimension]} "${g.label}" wordt ${g.trend === "sterker" ? "sterker" : "zwakker"} (tweede helft van de video's tegenover de eerste helft).`),
      flops: inPeriod
        .filter((v) => v.perf <= 0.7)
        .sort((a, b) => a.perf - b.perf)
        .slice(0, 3)
        .map((v) => ({ title: v.title, detail: `${fx(v.perf)} normaal, ${nf(v.views)} weergaven${v.format ? `, format ${v.format}` : ""}` })),
      reports: reportRows.map((x) => ({ id: x.id, label: capitalize(monthLabel(x.period)), status: x.status })).reverse(),
    };
  }

  const memoryHref = audience === "intern"
    ? client ? `/contentgeheugen?klant=${client.slug}` : null
    : PORTAL_CONTENTGEHEUGEN_LIVE ? "/portal/contentgeheugen" : null;

  return {
    mode: p.mode,
    label: p.label,
    prevLabel,
    complete: p.complete,
    months,
    monthsPartial,
    summary,
    works,
    highlights: audience === "klant" ? highlights.slice(0, 2) : highlights,
    worksNote,
    impact: { gemeten, afgeleid, nietGemeten },
    advice,
    monthlyReport,
    quarterReports,
    memoryHref,
    intern,
  };
}

/** De samenvatting als platte tekst, om te kopiëren of door te sturen. */
export function summaryText(clientName: string, review: PeriodReview): string {
  if (!review.summary) return "";
  return [
    `Shortclips ${review.mode === "kwartaal" ? "kwartaaloverzicht" : "overzicht"} ${review.label}, ${clientName}`,
    "",
    "Wat heeft Shortclips bereikt?",
    review.summary.bereikt,
    "",
    "Welke waarde heeft dit opgeleverd?",
    review.summary.waarde,
    "",
    "Wat gaan we verbeteren?",
    review.summary.verbeteren,
  ].join("\n");
}


