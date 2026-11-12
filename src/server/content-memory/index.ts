import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clients } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import { aiConfigured, runPrompt } from "@/server/ai/client";
import {
  analyzeMemory,
  captionKey,
  EVIDENCE_LABEL,
  type ContentMemory,
  type MemoryGroup,
  type MemoryInput,
} from "./analyze";

/**
 * Contentgeheugen per klant.
 *
 * Bronnen (allemaal bestaand, niets handmatig):
 *  - Metricool: publications + laatste social_metrics-meting per post.
 *  - Contentplanning: scripttitel bij een caption (koppeling via de caption).
 *  - Caption Maker: de gesproken hook bij een caption.
 *  - AI-formatlabels: één keer per video bepaald en bewaard in ai_outputs
 *    (tool "contentgeheugen"), zodat de pagina zelf nooit een AI-call doet.
 *
 * Dezelfde uitkomst voedt het interne Contentgeheugen, het klantportaal en de
 * Script Engine, zodat iedereen met hetzelfde geheugen werkt.
 */

export const MEMORY_TOOL = "contentgeheugen";

export type AiFormat = { name: string; description: string; why: string; reuse: string };
export type AiIdea = { title: string; format: string; hook: string; reason: string };
export type MemoryAi = {
  formats: AiFormat[];
  labels: Record<string, string>;
  ideas: AiIdea[];
  updatedAt: string | null;
  model: string | null;
};

export type ClientMemory = {
  clientId: string;
  clientName: string;
  clientSlug: string;
  memory: ContentMemory;
  ai: MemoryAi;
  aiAvailable: boolean;
};

type Row = {
  id: string;
  platform: string;
  published_at: string | Date | null;
  caption: string | null;
  duration_seconds: number | null;
  external_url: string | null;
  thumb: string | null;
  views: number | string | null;
  likes: number | string | null;
  comments: number | string | null;
  shares: number | string | null;
  saves: number | string | null;
  avg_watch_seconds: number | string | null;
  follower_delta: number | string | null;
};

const rowsOf = <T,>(res: unknown): T[] => (((res as { rows?: unknown[] }).rows ?? res) as T[]);
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Afkappen op hele tekens (geen losse emoji-helft, anders is de JSON naar de AI ongeldig). */
const cut = (t: string, n: number) => Array.from(t).slice(0, n).join("");

const EMPTY_AI: MemoryAi = { formats: [], labels: {}, ideas: [], updatedAt: null, model: null };

async function loadAi(clientId: string): Promise<MemoryAi> {
  const [row] = await db
    .select({ output: aiOutputs.output, updatedAt: aiOutputs.updatedAt })
    .from(aiOutputs)
    .where(and(eq(aiOutputs.clientId, clientId), eq(aiOutputs.tool, MEMORY_TOOL), isNull(aiOutputs.deletedAt)))
    .orderBy(desc(aiOutputs.updatedAt))
    .limit(1);
  if (!row) return EMPTY_AI;
  const o = (row.output ?? {}) as Partial<MemoryAi>;
  return {
    formats: Array.isArray(o.formats) ? o.formats : [],
    labels: o.labels && typeof o.labels === "object" ? o.labels : {},
    ideas: Array.isArray(o.ideas) ? o.ideas : [],
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    model: o.model ?? null,
  };
}

async function loadInputs(clientId: string, labels: Record<string, string>): Promise<MemoryInput[]> {
  const [pubRes, planRes, capRes] = await Promise.all([
    db.execute(sql`
      select p.id, p.platform, p.published_at, p.caption, p.duration_seconds, p.external_url,
             coalesce(p.thumbnail_data, p.thumbnail_url) as thumb,
             m.views, m.likes, m.comments, m.shares, m.saves, m.avg_watch_seconds, m.follower_delta
      from publications p
      join lateral (
        select views, likes, comments, shares, saves, avg_watch_seconds, follower_delta
        from social_metrics s where s.publication_id = p.id
        order by s.measured_on desc limit 1
      ) m on true
      where p.client_id = ${clientId} and p.deleted_at is null and p.status = 'published'
    `),
    db.execute(sql`
      select id, title, caption from content_calendar
      where client_id = ${clientId} and deleted_at is null and caption is not null and length(caption) > 20
    `).catch(() => [] as unknown),
    db.execute(sql`
      select ci.hook, ci.caption from caption_items ci
      join caption_sets cs on cs.id = ci.caption_set_id
      where cs.client_id = ${clientId} and cs.deleted_at is null and length(ci.caption) > 20
    `).catch(() => [] as unknown),
  ]);

  const plan = new Map<string, { id: string; title: string }>();
  for (const r of rowsOf<{ id: string; title: string; caption: string }>(planRes)) {
    const k = captionKey(r.caption);
    if (k.length >= 20 && !plan.has(k)) plan.set(k, { id: r.id, title: r.title });
  }
  const caps = new Map<string, string>();
  for (const r of rowsOf<{ hook: string | null; caption: string }>(capRes)) {
    const k = captionKey(r.caption);
    if (k.length >= 20 && r.hook && !caps.has(k)) caps.set(k, r.hook);
  }

  return rowsOf<Row>(pubRes).map((r) => {
    const k = captionKey(r.caption);
    const p = k.length >= 20 ? plan.get(k) : undefined;
    return {
      id: r.id,
      platform: r.platform,
      publishedAt: r.published_at ? new Date(r.published_at) : null,
      caption: r.caption,
      durationSeconds: numOrNull(r.duration_seconds),
      views: num(r.views),
      likes: num(r.likes),
      comments: num(r.comments),
      shares: num(r.shares),
      saves: num(r.saves),
      avgWatchSeconds: numOrNull(r.avg_watch_seconds),
      followerDelta: num(r.follower_delta),
      externalUrl: r.external_url,
      thumbnail: r.thumb && r.thumb.length < 400_000 ? r.thumb : null,
      spokenHook: k.length >= 20 ? caps.get(k) ?? null : null,
      planTitle: p?.title ?? null,
      planId: p?.id ?? null,
      format: labels[r.id] ?? null,
    };
  });
}

/** Korte cache per klant: de pagina en de Script Engine vragen dit vaak achter elkaar op. */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: ClientMemory }>();

export async function getContentMemory(viewer: Viewer, clientId: string): Promise<ClientMemory | null> {
  assertClientAccess(viewer, clientId);
  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [c] = await db.select({ id: clients.id, name: clients.name, slug: clients.slug }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
  if (!c) return null;
  const ai = await loadAi(clientId);
  const inputs = await loadInputs(clientId, ai.labels);
  const value: ClientMemory = { clientId: c.id, clientName: c.name, clientSlug: c.slug, memory: analyzeMemory(inputs), ai, aiAvailable: aiConfigured() };
  cache.set(clientId, { at: Date.now(), value });
  return value;
}

export function clearContentMemoryCache(clientId?: string) {
  if (clientId) cache.delete(clientId);
  else cache.clear();
}

/** Formatbeschrijving uit de AI-analyse bij een formatgroep. */
export function formatInfo(cm: ClientMemory, name: string): AiFormat | null {
  return cm.ai.formats.find((f) => f.name === name) ?? null;
}

/* ------------------------------------------------------------------ *
 * AI: formats herkennen (één keer per video, nachtelijks of via knop)
 * ------------------------------------------------------------------ */

const SYSTEM = `Je bent contentanalist bij Shortclips, een bureau voor short video. Je krijgt de gepubliceerde video's van één klant (openingszin, caption, prestatie t.o.v. het normale niveau van die klant).
Taak:
1. Herken 3 tot 7 terugkerende contentformats bij DEZE klant (bijv. "Woningtour met prijsvraag", "Wijkportret", "Vacaturevideo"). Korte, herkenbare Nederlandse namen. Gebruik bestaande formatnamen opnieuw als ze passen.
2. Geef elke video precies één format.
3. Per format: description (1 zin: wat het is), why (1 zin: waarom het waarschijnlijk werkt of niet, gebaseerd op de cijfers; noem het een verklaring, geen bewijs), reuse (1 zin: hoe het team dit format concreet opnieuw inzet of aanpast).
4. Drie nieuwe contentideeën die voortbouwen op de best presterende video's: title, format (één van jouw formatnamen), hook (een nieuwe openingszin in de stijl van wat werkte, geen kopie), reason (1 zin, verwijs naar welke video's dit onderbouwen).
Verzin geen cijfers. Antwoord ALLEEN met geldige JSON: {"formats":[{"name","description","why","reuse"}],"labels":{"<id>":"<formatnaam>"},"ideas":[{"title","format","hook","reason"}]}`;

export async function refreshContentMemoryAi(clientId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; labeled: number; reason?: string }> {
  if (!aiConfigured()) return { ok: false, labeled: 0, reason: "Geen AI-sleutel ingesteld" };
  const prev = await loadAi(clientId);
  const inputs = await loadInputs(clientId, prev.labels);
  const memory = analyzeMemory(inputs.map((v) => ({ ...v, format: null })));
  const scored = memory.all;
  const unlabeled = scored.filter((v) => !prev.labels[v.id]);
  if (!opts.force && unlabeled.length === 0 && prev.updatedAt) return { ok: true, labeled: 0 };
  if (scored.length < 3) return { ok: false, labeled: 0, reason: "Te weinig video's" };

  const list = scored
    .slice(0, 150)
    .map((v) => `id=${v.id} | ${v.platform} | ${v.perf.toFixed(2)}x normaal | opening: "${cut(v.hook, 160)}" | caption: ${cut(v.caption.replace(/\s+/g, " "), 260)}`)
    .join("\n");
  const existing = prev.formats.length ? `Bestaande formatnamen (hergebruik waar het past): ${prev.formats.map((f) => f.name).join(", ")}\n\n` : "";
  const res = await runPrompt({ system: SYSTEM, user: `${existing}Video's:\n${list}`, maxTokens: 8000, cacheSystem: true });
  if (!res.ok) return { ok: false, labeled: 0, reason: res.error ?? res.reason };

  let parsed: Partial<MemoryAi>;
  try {
    const json = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, labeled: 0, reason: "AI-antwoord was geen geldige JSON" };
  }
  const known = new Set(scored.map((v) => v.id));
  const labels: Record<string, string> = { ...prev.labels };
  let labeled = 0;
  for (const [id, f] of Object.entries(parsed.labels ?? {})) {
    if (known.has(id) && typeof f === "string" && f.trim()) {
      labels[id] = f.trim().slice(0, 60);
      labeled++;
    }
  }
  // Zelfde caption op een ander platform krijgt hetzelfde format.
  const byKey = new Map<string, string>();
  for (const v of inputs) if (labels[v.id]) byKey.set(captionKey(v.caption), labels[v.id]);
  for (const v of inputs) if (!labels[v.id] && byKey.get(captionKey(v.caption))) labels[v.id] = byKey.get(captionKey(v.caption))!;

  const output: MemoryAi = {
    formats: (parsed.formats ?? []).filter((f) => f && f.name).slice(0, 8),
    labels,
    ideas: (parsed.ideas ?? []).filter((i) => i && i.title).slice(0, 5),
    updatedAt: new Date().toISOString(),
    model: res.model,
  };

  const [existingRow] = await db.select({ id: aiOutputs.id }).from(aiOutputs)
    .where(and(eq(aiOutputs.clientId, clientId), eq(aiOutputs.tool, MEMORY_TOOL), isNull(aiOutputs.deletedAt))).limit(1);
  if (existingRow) {
    await db.update(aiOutputs).set({ output, updatedAt: new Date(), inputSummary: `${scored.length} video's geanalyseerd` }).where(eq(aiOutputs.id, existingRow.id));
  } else {
    await db.insert(aiOutputs).values({ clientId, tool: MEMORY_TOOL, title: "Contentgeheugen: formats", inputSummary: `${scored.length} video's geanalyseerd`, output });
  }
  clearContentMemoryCache(clientId);
  return { ok: true, labeled };
}

/** Nachtelijke job: formats bijwerken voor klanten met nieuwe, nog niet gelabelde video's. */
export async function runContentMemoryRefresh(): Promise<{ clients: number; labeled: number; skipped: number }> {
  const res = await db.execute(sql`
    select distinct p.client_id from publications p
    where p.deleted_at is null and p.status = 'published'
  `);
  let labeled = 0, done = 0, skipped = 0;
  const started = Date.now();
  for (const r of rowsOf<{ client_id: string }>(res)) {
    // Tijdbudget per run (jobs mogen maximaal 300 sec): de rest volgt bij de volgende run.
    if (Date.now() - started > 200_000) { skipped++; continue; }
    try {
      const out = await refreshContentMemoryAi(r.client_id);
      if (out.ok) { done++; labeled += out.labeled; } else skipped++;
    } catch {
      skipped++;
    }
  }
  return { clients: done, labeled, skipped };
}

/* ------------------------------------------------------------------ *
 * Script Engine: het geheugen als briefing voor de schrijver
 * ------------------------------------------------------------------ */

const ev = (g: MemoryGroup) => `${EVIDENCE_LABEL[g.evidence].toLowerCase()}, ${g.n} video's`;
const x = (n: number) => `${n.toFixed(1)}x`;

export function contentMemoryPromptText(cm: ClientMemory, opts: { isAd?: boolean } = {}): string {
  const m = cm.memory;
  if (!m.videoCount) return "";
  const head = `CONTENTGEHEUGEN VAN ${cm.clientName.toUpperCase()} (automatisch opgebouwd uit ${m.videoCount} gepubliceerde video's met echte Metricool-cijfers; prestatie = t.o.v. het normale niveau van deze klant op hetzelfde platform).`;
  if (!m.sufficient) return `${head}\nNog te weinig video's voor patronen. Gebruik onderstaande voorbeelden alleen als inspiratie, niet als bewezen aanpak.\n${m.topHooks.slice(0, 3).map((v) => `- "${v.hook}" (${v.views} views)`).join("\n")}`;
  const solid = (g: MemoryGroup) => g.evidence === "aannemelijk" || g.evidence === "sterk";
  const fmtLines = m.formats.filter((g) => g.n >= 2).slice(0, 5).map((g) => {
    const info = formatInfo(cm, g.label);
    return `- ${g.label}: ${x(g.medianPerf)} normaal (${ev(g)})${g.trend && g.trend !== "stabiel" ? `, wordt ${g.trend}` : ""}${info?.reuse ? `. Toepassen: ${info.reuse}` : ""}`;
  });
  const worse = [...m.formats, ...m.hooks, ...m.ctas, ...m.lengths].filter((g) => g.verdict === "slechter" && g.n >= 3);
  const parts = [
    head,
    opts.isAd ? "LET OP: dit is organisch bereik, geen bewijs dat iets in een advertentie converteert." : "Bouw voort op wat bewezen werkt, vermijd wat aantoonbaar minder werkt. Kopieer nooit letterlijk een eerdere hook. Het zijn verbanden, geen bewezen oorzaken.",
    m.patterns.length ? `Sterkste patronen:\n- ${m.patterns.join("\n- ")}` : "",
    fmtLines.length ? `Formats (best eerst):\n${fmtLines.join("\n")}` : "",
    m.formulas.length ? `Succesformules:\n${m.formulas.map((f) => `- ${f.format ? `${f.format} + ` : ""}hook met ${f.hookType.toLowerCase()} + CTA "${f.cta.toLowerCase()}" (${f.hits} van ${f.n} sterk)`).join("\n")}` : "",
    `Hooks die het best werkten (echte openingszinnen):\n${m.topHooks.slice(0, 6).map((v) => `- "${v.hook}" (${v.platform}, ${x(v.perf)} normaal)`).join("\n")}`,
    m.ctas.filter((g) => g.verdict === "beter" && solid(g)).length ? `CTA's die werken: ${m.ctas.filter((g) => g.verdict === "beter" && solid(g)).map((g) => `${g.label} (${x(g.medianPerf)})`).join(", ")}.` : "",
    worse.length ? `Werkt minder (vermijd of pas aan): ${worse.slice(0, 5).map((g) => `${g.label} (${x(g.medianPerf)}, ${g.n} video's)`).join("; ")}.` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Contentgeheugen-tekst voor de Script Engine op basis van alleen een klant-id. */
export async function contentMemoryTextForClient(viewer: Viewer, clientId: string, opts: { isAd?: boolean } = {}): Promise<string> {
  const cm = await getContentMemory(viewer, clientId).catch(() => null);
  return cm ? contentMemoryPromptText(cm, opts) : "";
}
