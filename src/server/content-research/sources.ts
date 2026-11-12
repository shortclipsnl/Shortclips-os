import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge, contentCompetitors, contentIdeas, publications } from "@/db/schema";
import { getClientAiProfile, type CaptionProfile } from "@/server/ai/knowledge";
import { loadDna } from "./content-dna";
import { listClientDriveScriptLinks, getClientDriveScriptTexts } from "@/server/scripts/drive-scripts";
import { analysePosts, type PostAnalysis, type PostRow } from "./post-performance";

/**
 * De vier databronnen van Content Research, op één plek opgehaald. Alles leest
 * uit bestaande tabellen (geen tweede database): postmetingen, Drive-scripts,
 * concurrenten en het klantgeheugen (client_knowledge).
 */

/* ----------------------------- A. Statistieken ----------------------------- */

export async function loadPostAnalysis(clientId: string, days = 365): Promise<PostAnalysis> {
  const res = await db.execute(sql`
    select p.id as publication_id, p.platform as platform, p.published_at as published_at,
           p.caption as caption, p.external_url as url,
           m.views, m.likes, m.comments, m.shares, m.saves, m.completion_rate, m.avg_watch_seconds
    from publications p
    join lateral (
      select views, likes, comments, shares, saves, completion_rate, avg_watch_seconds
      from social_metrics sm
      where sm.publication_id = p.id
      order by sm.measured_on desc
      limit 1
    ) m on true
    where p.client_id = ${clientId}
      and p.deleted_at is null
      and coalesce(p.published_at, p.created_at) > now() - (${days} || ' days')::interval
  `);
  const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as Array<Record<string, unknown>>;
  const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
  const posts: PostRow[] = rows.map((r) => ({
    publicationId: String(r.publication_id),
    platform: String(r.platform ?? ""),
    publishedAt: (r.published_at as Date | string | null) ?? null,
    caption: (r.caption as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    views: num(r.views),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    saves: num(r.saves),
    completionRate: r.completion_rate == null ? null : Number(r.completion_rate),
    avgWatchSeconds: r.avg_watch_seconds == null ? null : Number(r.avg_watch_seconds),
  }));
  return analysePosts(posts);
}

/* ------------------------------ B. Eerdere scripts ------------------------------ */

export type PriorScripts = {
  /** Aantal scriptdocumenten in de Drive-map van de klant. */
  count: number;
  /** Bestandsnamen (nieuwste eerst) met link: de onderwerpen die al behandeld zijn. */
  recent: Array<{ name: string; url: string | null; modifiedAt: string | null }>;
  /** Uitgelezen tekst van de recentste Word/Google Docs-scripts (indien beschikbaar). */
  texts: Array<{ name: string; text: string }>;
};

export async function loadPriorScripts(clientId: string, opts: { readTexts?: boolean } = {}): Promise<PriorScripts> {
  const links = (await listClientDriveScriptLinks([clientId], 40).catch(() => new Map())).get(clientId) ?? [];
  const texts = opts.readTexts ? await getClientDriveScriptTexts(clientId, 3).catch(() => []) : [];
  return { count: links.length, recent: links, texts };
}

export function priorScriptsToText(p: PriorScripts): string {
  if (p.count === 0 && p.texts.length === 0) return "";
  const lines = [
    `EERDERE SCRIPTS IN GOOGLE DRIVE (${p.count} documenten; bestandsnaam = sessie/onderwerp):`,
    ...p.recent.slice(0, 40).map((s) => `- ${s.name}${s.modifiedAt ? ` (${s.modifiedAt.slice(0, 10)})` : ""}`),
  ];
  for (const t of p.texts) {
    lines.push("", `INHOUD "${t.name}" (ingekort):`, t.text.slice(0, 3500));
  }
  return lines.join("\n");
}

/* -------------------------------- C. Concurrenten -------------------------------- */

export type CompetitorRow = typeof contentCompetitors.$inferSelect;

export async function loadCompetitors(clientId: string): Promise<CompetitorRow[]> {
  return db
    .select()
    .from(contentCompetitors)
    .where(and(eq(contentCompetitors.clientId, clientId), isNull(contentCompetitors.deletedAt)))
    .orderBy(desc(contentCompetitors.actief), contentCompetitors.naam);
}

export function competitorsToText(list: CompetitorRow[]): string {
  const active = list.filter((c) => c.actief);
  const ignored = list.filter((c) => !c.actief);
  if (active.length === 0 && ignored.length === 0) return "";
  const handle = (c: CompetitorRow) =>
    [c.url, c.tiktok && `TikTok ${c.tiktok}`, c.instagram && `Instagram ${c.instagram}`, c.youtube && `YouTube ${c.youtube}`]
      .filter(Boolean)
      .join(", ");
  const lines: string[] = [];
  if (active.length) {
    lines.push("BEKENDE CONCURRENTEN / VERGELIJKBARE BEDRIJVEN (onderzoek deze gericht):");
    for (const c of active) lines.push(`- ${c.naam}${handle(c) ? ` (${handle(c)})` : ""}${c.notitie ? ` — ${c.notitie}` : ""}`);
  }
  if (ignored.length) {
    lines.push("", "DOOR HET TEAM UITGESLOTEN (niet opnieuw voorstellen):");
    for (const c of ignored) lines.push(`- ${c.naam}`);
  }
  return lines.join("\n");
}

/* ------------------------------- D. Klantgeheugen ------------------------------- */

export async function loadClientMemoryCount(clientId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clientKnowledge)
    .where(and(eq(clientKnowledge.clientId, clientId), isNull(clientKnowledge.deletedAt)));
  return row?.n ?? 0;
}

/* ------------------------------- Tone of voice ------------------------------- */

/**
 * Hoe deze klant communiceert, uit bestaande bronnen (geen extra invoer):
 * Content DNA, het captionprofiel, tone-of-voice-inzichten uit het klantgeheugen
 * en de laatste echte captions die namens de klant zijn gepubliceerd.
 */
export async function loadToneOfVoice(clientId: string): Promise<string> {
  const [dnaBundle, profile, memory, captions] = await Promise.all([
    loadDna(clientId).catch(() => null),
    getClientAiProfile(clientId).catch(() => null),
    db
      .select({ title: clientKnowledge.title, body: clientKnowledge.body })
      .from(clientKnowledge)
      .where(and(
        eq(clientKnowledge.clientId, clientId),
        isNull(clientKnowledge.deletedAt),
        sql`${clientKnowledge.category} in ('tone_of_voice', 'avoid_words', 'hook_style', 'recurring_correction')`,
      ))
      .limit(12)
      .catch(() => []),
    db
      .select({ caption: publications.caption })
      .from(publications)
      .where(and(eq(publications.clientId, clientId), isNull(publications.deletedAt), sql`length(coalesce(${publications.caption}, '')) > 30`))
      .orderBy(desc(publications.publishedAt))
      .limit(8)
      .catch(() => []),
  ]);
  const lines: string[] = [];
  const dna = dnaBundle?.dna;
  if (dna?.toneOfVoice) lines.push(`Tone of voice (Content DNA): ${dna.toneOfVoice}`);
  if (dna?.gewensteUitstraling) lines.push(`Gewenste uitstraling: ${dna.gewensteUitstraling}`);
  if (dna?.doelgroep) lines.push(`Doelgroep: ${dna.doelgroep}`);
  if (dna?.creatieveBeperkingen?.length) lines.push(`Niet doen: ${dna.creatieveBeperkingen.join(" · ")}`);
  const cp = (profile?.captionProfile ?? {}) as CaptionProfile;
  if (cp.toneOfVoice) lines.push(`Tone of voice (captionprofiel): ${cp.toneOfVoice}`);
  if (cp.schrijfstijl) lines.push(`Schrijfstijl: ${cp.schrijfstijl}`);
  for (const m of memory) lines.push(`Klantgeheugen: ${m.title}: ${m.body}`);
  const seen = new Set<string>();
  const samples = captions
    .map((c) => (c.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 280))
    .filter((c) => c && !seen.has(c) && seen.add(c))
    .slice(0, 6);
  if (samples.length) lines.push(`Zo communiceert de klant zelf (recente captions):\n- ${samples.join("\n- ")}`);
  return lines.join("\n");
}

/* ------------------------- Eerdere ideeën + hun uitkomst ------------------------- */

/**
 * Eerdere ideeën met hun status. Zo weet het onderzoek wat al voorgesteld,
 * gebruikt of afgewezen is, en wat na publicatie goed presteerde.
 */
export async function loadIdeaHistory(clientId: string): Promise<{ text: string; rejectedText: string; hashes: Set<string>; afgewezen: number }> {
  const rows = await db
    .select({ titel: contentIdeas.titel, concept: contentIdeas.concept, status: contentIdeas.status, hash: contentIdeas.dedupeHash, reden: contentIdeas.rejectionReason })
    .from(contentIdeas)
    .where(and(eq(contentIdeas.clientId, clientId), isNull(contentIdeas.deletedAt)))
    .orderBy(desc(contentIdeas.createdAt))
    .limit(200);
  const hashes = new Set(rows.map((r) => r.hash).filter((h): h is string => Boolean(h)));
  const label: Record<string, string> = {
    nieuw: "voorgesteld, nog niet beoordeeld",
    favoriet: "interessant bevonden",
    opgeslagen: "bewaard voor later",
    doorgestuurd: "doorgestuurd naar scripting",
    gebruikt: "al gebruikt",
    afgewezen: "niet relevant",
    gearchiveerd: "gearchiveerd",
  };
  const text = rows
    .map((r) => `- [${label[r.status] ?? r.status}] ${r.titel}${r.reden ? ` (reden: ${r.reden})` : ""}${r.concept ? `: ${r.concept.slice(0, 120)}` : ""}`)
    .join("\n");
  const rejected = rows.filter((r) => r.status === "afgewezen");
  const rejectedText = rejected.map((r) => `- ${r.titel}${r.reden ? ` (reden: ${r.reden})` : ""}`).join("\n");
  return { text, rejectedText, hashes, afgewezen: rejected.length };
}
