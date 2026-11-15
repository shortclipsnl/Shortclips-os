import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientContacts,
  clientKnowledge,
  clientStrategyProfiles,
  clients,
  contentCompetitors,
  dailyMetrics,
  socialAccounts,
} from "@/db/schema";
import { BRIEFING_FIELDS, BRIEFING_SOURCE } from "@/lib/onboarding-plan";
import { RESEARCH_KNOWLEDGE_SOURCE, platformLabel, type BaselineRow, type InternalBasis } from "@/lib/client-research";

/**
 * Stap 1 van het klantonderzoek: wat weten we zelf al?
 *
 * Alles komt uit bestaande onderdelen van het portaal (klantgegevens, kanalen,
 * de klantbriefing uit het kennismakingsgesprek, concurrenten uit Content
 * Research en de gekoppelde cijfers uit Metricool). Hier wordt niets
 * ingevoerd of gedupliceerd: het onderzoek leest alleen mee.
 */

export type InternalData = {
  clientName: string;
  sector: string | null;
  website: string | null;
  description: string | null;
  contentFocus: string | null;
  startedOn: string | null;
  kanalen: { platform: string; handle: string; url: string | null }[];
  briefing: { title: string; body: string }[];
  /** Overige klantkennis die het team eerder vastlegde (niet uit dit onderzoek zelf). */
  kennis: { category: string; title: string; body: string }[];
  doel: { primary: string | null; secondary: string[]; note: string | null };
  concurrenten: { naam: string; url: string | null; notitie: string | null }[];
  contactpersoon: boolean;
};

export async function collectInternal(clientId: string): Promise<InternalData | null> {
  const [client] = await db
    .select({
      name: clients.name,
      sector: clients.sector,
      website: clients.website,
      description: clients.description,
      contentFocus: clients.contentFocus,
      startedOn: clients.startedOn,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return null;

  const [socials, knowledge, strategy, competitors, contacts] = await Promise.all([
    db
      .select({ platform: socialAccounts.platform, handle: socialAccounts.handle, url: socialAccounts.profileUrl })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.clientId, clientId), eq(socialAccounts.isActive, true))),
    db
      .select({ category: clientKnowledge.category, title: clientKnowledge.title, body: clientKnowledge.body, source: clientKnowledge.source })
      .from(clientKnowledge)
      .where(and(eq(clientKnowledge.clientId, clientId), isNull(clientKnowledge.deletedAt)))
      .orderBy(desc(clientKnowledge.isPinned), desc(clientKnowledge.createdAt))
      .limit(60),
    db
      .select({ primary: clientStrategyProfiles.primaryGoal, secondary: clientStrategyProfiles.secondaryGoals, note: clientStrategyProfiles.strategyNote })
      .from(clientStrategyProfiles)
      .where(eq(clientStrategyProfiles.clientId, clientId))
      .limit(1),
    db
      .select({ naam: contentCompetitors.naam, url: contentCompetitors.url, notitie: contentCompetitors.notitie })
      .from(contentCompetitors)
      .where(and(eq(contentCompetitors.clientId, clientId), eq(contentCompetitors.actief, true), isNull(contentCompetitors.deletedAt)))
      .limit(10),
    db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
      .limit(1),
  ]);

  const briefing = BRIEFING_FIELDS.flatMap((f) => {
    const hit = knowledge.find((k) => k.source === BRIEFING_SOURCE && k.category === f.category && k.body.trim());
    return hit ? [{ title: f.title, body: hit.body.trim() }] : [];
  });
  // Eigen eerdere uitkomsten niet opnieuw als invoer gebruiken: dat zou het
  // onderzoek zijn eigen aannames als feit laten teruglezen.
  const kennis = knowledge
    .filter((k) => k.source !== BRIEFING_SOURCE && k.source !== RESEARCH_KNOWLEDGE_SOURCE && k.source !== "generator")
    .slice(0, 12)
    .map((k) => ({ category: k.category, title: k.title, body: k.body.slice(0, 500) }));

  const s = strategy[0];
  return {
    clientName: client.name,
    sector: client.sector,
    website: client.website,
    description: client.description,
    contentFocus: client.contentFocus,
    startedOn: client.startedOn,
    kanalen: socials.map((x) => ({ platform: x.platform, handle: x.handle, url: x.url })),
    briefing,
    kennis,
    doel: {
      primary: s?.primary ?? null,
      secondary: Array.isArray(s?.secondary) ? (s!.secondary as unknown[]).filter((x): x is string => typeof x === "string") : [],
      note: s?.note ?? null,
    },
    concurrenten: competitors,
    contactpersoon: contacts.length > 0,
  };
}

/** Interne gegevens als tekstblok voor de onderzoeksinstructie. */
export function internalToText(d: InternalData): string {
  const lines: string[] = [`Bedrijf: ${d.clientName}`];
  if (d.website) lines.push(`Website: ${d.website}`);
  if (d.sector) lines.push(`Branche: ${d.sector}`);
  if (d.description) lines.push(`Omschrijving: ${d.description}`);
  if (d.contentFocus) lines.push(`Wij maken voor deze klant: ${d.contentFocus === "beide" ? "organische content en advertenties" : d.contentFocus === "advertentie" ? "advertenties" : "organische content"}`);
  if (d.kanalen.length) {
    lines.push("Opgegeven socialmediakanalen:");
    for (const k of d.kanalen) lines.push(`- ${platformLabel(k.platform)}: ${k.handle}${k.url ? ` (${k.url})` : ""}`);
  } else {
    lines.push("Socialmediakanalen: niet opgegeven, zoek ze zelf op en controleer of ze bij dit bedrijf horen.");
  }
  const goals = [d.doel.primary, ...d.doel.secondary].filter(Boolean);
  if (goals.length) lines.push(`Doelstellingen: ${goals.join(", ")}`);
  if (d.doel.note) lines.push(`Strategie in één zin: ${d.doel.note}`);
  if (d.briefing.length) {
    lines.push("", "KLANTBRIEFING UIT HET KENNISMAKINGSGESPREK:");
    for (const b of d.briefing) lines.push(`- ${b.title}: ${b.body}`);
  }
  if (d.kennis.length) {
    lines.push("", "OVERIGE KLANTKENNIS VAN HET TEAM:");
    for (const k of d.kennis) lines.push(`- ${k.title}: ${k.body}`);
  }
  return lines.join("\n");
}

export function competitorsToText(d: InternalData): string {
  if (!d.concurrenten.length) return "";
  return ["CONCURRENTEN DIE WIJ AL KENNEN (neem deze mee en vul aan tot drie tot vijf):", ...d.concurrenten.map((c) => `- ${c.naam}${c.url ? ` (${c.url})` : ""}${c.notitie ? `: ${c.notitie}` : ""}`)].join("\n");
}

export function basisOf(d: InternalData, linkedRows: number): InternalBasis {
  return {
    website: d.website,
    kanalen: d.kanalen,
    briefingVelden: d.briefing.length,
    gekoppeldeCijfers: linkedRows > 0,
    contactpersoon: d.contactpersoon,
  };
}

/**
 * Cijfers uit gekoppelde accounts (Metricool) op de onderzoeksdatum: het
 * laatst bekende volgersaantal en de totalen over de laatste 30 dagen, per
 * platform. Alleen platformen waar echt data van binnenkomt.
 */
export async function linkedBaseline(clientId: string, today: string): Promise<BaselineRow[]> {
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 30);
  const fromDay = from.toISOString().slice(0, 10);

  const totals = await db
    .select({
      platform: dailyMetrics.platform,
      views: sql<number>`coalesce(sum(${dailyMetrics.views}), 0)::int`,
      reach: sql<number>`coalesce(sum(${dailyMetrics.reach}), 0)::int`,
      engagements: sql<number>`coalesce(sum(${dailyMetrics.engagements}), 0)::int`,
      posts: sql<number>`coalesce(sum(${dailyMetrics.postsPublished}), 0)::int`,
      days: sql<number>`count(*)::int`,
    })
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.clientId, clientId), gte(dailyMetrics.measuredOn, fromDay), sql`${dailyMetrics.platform} is not null`))
    .groupBy(dailyMetrics.platform);

  const platforms = totals.map((t) => t.platform).filter((p): p is NonNullable<typeof p> => p !== null);
  const followerRows = platforms.length
    ? await db
        .select({ platform: dailyMetrics.platform, followers: dailyMetrics.followers, measuredOn: dailyMetrics.measuredOn })
        .from(dailyMetrics)
        .where(and(eq(dailyMetrics.clientId, clientId), inArray(dailyMetrics.platform, platforms), sql`${dailyMetrics.followers} > 0`))
        .orderBy(desc(dailyMetrics.measuredOn))
        .limit(400)
    : [];

  const rows: BaselineRow[] = [];
  const add = (platform: string, metric: BaselineRow["metric"], value: number, gemetenOp: string) =>
    rows.push({ id: `gekoppeld-${platform}-${metric}`, platform, metric, value, herkomst: "gekoppeld", bron: "Metricool", gemetenOp });

  for (const t of totals) {
    if (!t.platform || t.days === 0) continue;
    const latest = followerRows.find((f) => f.platform === t.platform);
    if (latest) add(t.platform, "volgers", latest.followers, String(latest.measuredOn));
    // Een totaal van nul over 30 dagen is geen meting maar het ontbreken ervan.
    if (t.views > 0) add(t.platform, "weergaven_30d", t.views, today);
    if (t.reach > 0) add(t.platform, "bereik_30d", t.reach, today);
    if (t.engagements > 0) add(t.platform, "interacties_30d", t.engagements, today);
    if (t.posts > 0) add(t.platform, "posts_30d", t.posts, today);
  }
  return rows;
}
