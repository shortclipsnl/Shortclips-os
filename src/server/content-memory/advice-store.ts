import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, contentAdvice } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import {
  advicePromptText,
  buildAdvice,
  measureAdvice,
  provenPatterns,
  type AdviceContext,
  type AdviceItem,
  type AdviceOutcome,
  type AdviceSection,
  type ContentAdvice,
  type CrossPattern,
} from "./advice";
import { shownFormats } from "./strategy";
import type { ClientMemory } from "./index";

/**
 * Contentadvies: opslag van de voortgang en de leerlus.
 *
 * Het advies zelf wordt telkens opnieuw berekend uit de resultaten. Hier wordt
 * bijgehouden wat het team ermee doet (nog toepassen, ingepland, uitgevoerd) en
 * controleert het systeem zelf, aan de hand van de video's die daarna online
 * kwamen, of het advies is toegepast en wat het opleverde.
 */

export type AdviceStatus = "nog_toepassen" | "ingepland" | "uitgevoerd" | "resultaat" | "effectief" | "niet_effectief" | "vervallen";
export const OPEN_STATUSES: AdviceStatus[] = ["nog_toepassen", "ingepland", "uitgevoerd", "resultaat"];
export const STATUS_LABEL: Record<AdviceStatus, string> = {
  nog_toepassen: "Nog toepassen",
  ingepland: "Ingepland",
  uitgevoerd: "Uitgevoerd",
  resultaat: "Resultaat beschikbaar",
  effectief: "Bewezen effectief",
  niet_effectief: "Niet effectief",
  vervallen: "Vervallen",
};

export type AdviceRecord = {
  id: string;
  key: string;
  section: AdviceSection;
  title: string;
  item: AdviceItem;
  status: AdviceStatus;
  measureFrom: string;
  outcome: AdviceOutcome | null;
  statusChangedAt: string;
  closedAt: string | null;
  createdAt: string;
};

export type ClientAdvice = {
  advice: ContentAdvice;
  /** Lopende adviezen, per sleutel. */
  open: Record<string, AdviceRecord>;
  /** Afgesloten met een gemeten oordeel, nieuwste eerst. */
  learned: AdviceRecord[];
  /** Lopend, maar niet meer in het actuele advies (meting loopt door). */
  running: AdviceRecord[];
  month: { planned: number; executed: number; effective: number; ineffective: number };
};

const CROSS_KEY = "content_advice.cross_patterns";
/** Een afgesloten advies komt niet direct terug. */
const COOLDOWN_DAYS: Record<string, number> = { effectief: 60, niet_effectief: 90, vervallen: 90 };
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export function adviceContext(cm: ClientMemory, cross: CrossPattern[] = []): AdviceContext {
  const formatIdeas = shownFormats(cm.memory).flatMap((g) => (cm.strategy?.formatIdeas[g.label]?.ideas ?? []).slice(0, 1).map((i) => ({ base: g.label, name: i.name, description: i.description, hook: i.hook })));
  return {
    clientId: cm.clientId,
    structures: cm.ai.structures,
    styles: cm.strategy?.styles ?? {},
    formatIdeas,
    ideas: cm.ai.ideas,
    cross,
  };
}

export async function loadCrossPatterns(): Promise<CrossPattern[]> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CROSS_KEY)).limit(1);
    const v = row?.value as { patterns?: CrossPattern[] } | undefined;
    return Array.isArray(v?.patterns) ? v!.patterns : [];
  } catch {
    return [];
  }
}

const toRecord = (r: typeof contentAdvice.$inferSelect): AdviceRecord => ({
  id: r.id,
  key: r.key,
  section: r.section as AdviceSection,
  title: r.title,
  item: r.item as AdviceItem,
  status: r.status as AdviceStatus,
  measureFrom: iso(r.measureFrom)!,
  outcome: (r.outcome as AdviceOutcome | null) ?? null,
  statusChangedAt: iso(r.statusChangedAt)!,
  closedAt: iso(r.closedAt),
  createdAt: iso(r.createdAt)!,
});

/**
 * Werkt de adviesregels van één klant bij: nieuwe adviezen vastleggen,
 * verdwenen (nog niet opgepakte) adviezen laten vervallen en bij lopende
 * adviezen controleren of ze zijn toegepast en wat het opleverde.
 * Idempotent: twee keer draaien levert niets dubbels op (unieke index).
 */
export async function syncClientAdvice(cm: ClientMemory, advice: ContentAdvice, ctx: AdviceContext, now = new Date()): Promise<{ created: number; progressed: number; closed: number }> {
  const out = { created: 0, progressed: 0, closed: 0 };
  const rows = await db.select().from(contentAdvice).where(eq(contentAdvice.clientId, cm.clientId));
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status as AdviceStatus));
  const current = [...advice.sections.meer, ...advice.sections.minder, ...advice.sections.testen];
  const byKey = new Map(current.map((i) => [i.key, i]));

  const inCooldown = (key: string) =>
    rows.some((r) => r.key === key && r.closedAt && (r.status !== "vervallen" || r.closedReason === "handmatig") && now.getTime() - new Date(r.closedAt).getTime() < (COOLDOWN_DAYS[r.status] ?? 0) * 86_400_000);

  for (const i of current) {
    if (open.some((r) => r.key === i.key) || inCooldown(i.key)) continue;
    const res = await db.insert(contentAdvice).values({ clientId: cm.clientId, key: i.key, section: i.section, title: i.title.slice(0, 200), item: i, measureFrom: now }).onConflictDoNothing().returning({ id: contentAdvice.id });
    if (res.length) out.created++;
  }

  for (const r of open) {
    const cur = byKey.get(r.key);
    const item = (cur ?? r.item) as AdviceItem;
    const set: Partial<typeof contentAdvice.$inferInsert> = {};
    if (cur) { set.item = cur; set.title = cur.title.slice(0, 200); set.lastSeenAt = now; }

    // Niet meer in het advies en nog door niemand opgepakt: laten vervallen.
    if (!cur && r.status === "nog_toepassen") {
      await db.update(contentAdvice).set({ status: "vervallen", closedReason: "automatisch", closedAt: now, statusChangedAt: now, updatedAt: now }).where(eq(contentAdvice.id, r.id));
      out.closed++;
      continue;
    }

    const since = new Date(r.measureFrom).toISOString().slice(0, 10);
    const { executed, outcome } = measureAdvice(r.section as AdviceSection, item.target, since, cm.memory, ctx, now);
    let status = r.status as AdviceStatus;
    if (executed && (status === "nog_toepassen" || status === "ingepland")) status = "uitgevoerd";
    if (outcome && (status === "uitgevoerd" || status === "resultaat")) status = outcome.verdict ?? "resultaat";
    if (outcome) set.outcome = outcome;
    if (status !== r.status) {
      set.status = status;
      set.statusChangedAt = now;
      set.statusChangedById = null;
      if (status === "effectief" || status === "niet_effectief") { set.closedAt = now; set.closedReason = "automatisch"; out.closed++; } else out.progressed++;
    }
    if (Object.keys(set).length) await db.update(contentAdvice).set({ ...set, updatedAt: now }).where(eq(contentAdvice.id, r.id));
  }
  return out;
}

/** Het actuele advies van een klant, inclusief voortgang. Werkt de regels eerst bij. */
export async function loadClientAdvice(cm: ClientMemory, opts: { sync?: boolean; now?: Date } = {}): Promise<ClientAdvice> {
  const nowMs = (opts.now ?? new Date()).getTime();
  const ctx = adviceContext(cm, await loadCrossPatterns());
  const advice = buildAdvice(cm.memory, ctx);
  if (opts.sync !== false) await syncClientAdvice(cm, advice, ctx).catch((e) => console.error("[contentadvies] sync mislukt", e));
  const rows = (await db.select().from(contentAdvice).where(eq(contentAdvice.clientId, cm.clientId)).orderBy(desc(contentAdvice.statusChangedAt)).catch(() => [])).map(toRecord);

  const open: Record<string, AdviceRecord> = {};
  for (const r of rows) if (OPEN_STATUSES.includes(r.status) && !open[r.key]) open[r.key] = r;
  const closedKeys = new Set(rows.filter((r) => r.closedAt && (r.status === "effectief" || r.status === "niet_effectief") && nowMs - new Date(r.closedAt).getTime() < COOLDOWN_DAYS[r.status] * 86_400_000).map((r) => r.key));
  const skipped = new Set(rows.filter((r) => r.status === "vervallen" && r.closedAt && nowMs - new Date(r.closedAt).getTime() < COOLDOWN_DAYS.vervallen * 86_400_000 && !open[r.key]).map((r) => r.key));
  // Wat al beoordeeld of bewust overgeslagen is, staat niet opnieuw tussen het advies.
  for (const k of ["meer", "minder", "testen"] as AdviceSection[]) advice.sections[k] = advice.sections[k].filter((i) => open[i.key] || (!closedKeys.has(i.key) && !skipped.has(i.key)));
  const visible = new Set([...advice.sections.meer, ...advice.sections.minder, ...advice.sections.testen].map((i) => i.key));
  advice.priorities = advice.priorities.filter((i) => visible.has(i.key));
  advice.nextShoot = advice.nextShoot.filter((l) => l.kind === "basis" || visible.has(l.key));

  const monthStart = new Date(nowMs); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const inMonth = rows.filter((r) => new Date(r.statusChangedAt) >= monthStart);
  return {
    advice,
    open,
    learned: rows.filter((r) => r.status === "effectief" || r.status === "niet_effectief").slice(0, 12),
    running: Object.values(open).filter((r) => !visible.has(r.key)),
    month: {
      planned: inMonth.filter((r) => r.status === "ingepland").length,
      executed: inMonth.filter((r) => r.status === "uitgevoerd" || r.status === "resultaat").length,
      effective: inMonth.filter((r) => r.status === "effectief").length,
      ineffective: inMonth.filter((r) => r.status === "niet_effectief").length,
    },
  };
}

export async function getClientAdvice(viewer: Viewer, cm: ClientMemory): Promise<ClientAdvice> {
  assertClientAccess(viewer, cm.clientId);
  return loadClientAdvice(cm);
}

/** Handmatige statuswijziging door het team. */
export async function setAdviceStatus(viewer: Viewer, id: string, status: AdviceStatus): Promise<{ ok: boolean; message: string }> {
  const [row] = await db.select().from(contentAdvice).where(eq(contentAdvice.id, id)).limit(1);
  if (!row) return { ok: false, message: "Advies niet gevonden." };
  assertClientAccess(viewer, row.clientId);
  const item = row.item as AdviceItem;
  // Een eindoordeel komt uit de meting; alleen bij een advies zonder meetbaar kenmerk beoordeelt het team zelf.
  if ((status === "effectief" || status === "niet_effectief" || status === "resultaat") && item.target) return { ok: false, message: "Het oordeel volgt automatisch uit de resultaten." };
  const now = new Date();
  const closing = status === "effectief" || status === "niet_effectief" || status === "vervallen";
  try {
    await db.update(contentAdvice).set({
      status,
      statusChangedAt: now,
      statusChangedById: viewer.id,
      closedAt: closing ? now : null,
      closedReason: closing ? "handmatig" : null,
      // Opnieuw openen of inplannen: vanaf nu tellen de nieuwe video's.
      ...(status === "ingepland" && row.status === "nog_toepassen" ? { measureFrom: now } : {}),
      updatedAt: now,
    }).where(eq(contentAdvice.id, id));
  } catch {
    return { ok: false, message: "Opslaan lukte niet. Er loopt al een advies met dezelfde inhoud." };
  }
  return { ok: true, message: STATUS_LABEL[status] };
}

/** Voor de Script Engine: het actuele advies plus de gemeten uitkomsten van eerder advies. */
export async function adviceTextForClient(cm: ClientMemory): Promise<string> {
  const ca = await loadClientAdvice(cm, { sync: false });
  return advicePromptText(ca.advice, ca.learned.map((r) => ({ title: r.title, verdict: r.status as "effectief" | "niet_effectief" })));
}

/**
 * Dagelijkse job (na Metricool en het Contentgeheugen):
 *  1. patronen die bij meerdere klanten bewezen zijn vastleggen (voor "Nieuw testen");
 *  2. per actieve klant het advies bijwerken en de effectmeting uitvoeren.
 */
export async function runContentAdvice(): Promise<{ clients: number; created: number; progressed: number; closed: number; crossPatterns: number }> {
  const { loadClientMemory, ACTIVE_STATUSES } = await import("./index");
  const started = Date.now();
  const res = await db.execute(sql`
    select distinct p.client_id from publications p
    join clients c on c.id = p.client_id and c.deleted_at is null
    where p.deleted_at is null and p.status = 'published' and c.status::text in (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)})`);
  const ids = (((res as { rows?: unknown[] }).rows ?? res) as Array<{ client_id: string }>).map((r) => r.client_id);
  const memories: ClientMemory[] = [];
  for (const id of ids) {
    if (Date.now() - started > 150_000) break;
    const cm = await loadClientMemory(id).catch(() => null);
    if (cm?.memory.videoCount) memories.push(cm);
  }

  const agg = new Map<string, CrossPattern & { perfs: number[] }>();
  for (const cm of memories) {
    for (const p of provenPatterns(cm.memory, adviceContext(cm))) {
      const k = `${p.dimension}:${p.label}`;
      const a = agg.get(k) ?? { dimension: p.dimension, label: p.label, clientIds: [], medianPerf: 0, perfs: [] };
      a.clientIds.push(cm.clientId);
      a.perfs.push(p.medianPerf);
      agg.set(k, a);
    }
  }
  const patterns: CrossPattern[] = [...agg.values()].filter((a) => a.clientIds.length >= 2).map(({ perfs, ...a }) => ({ ...a, medianPerf: Math.round((perfs.reduce((x, y) => x + y, 0) / perfs.length) * 100) / 100 }));
  const now = new Date();
  const value = { at: now.toISOString(), patterns };
  await db.insert(appSettings)
    .values({ key: CROSS_KEY, value, category: "contentgeheugen", description: "Patronen die bij meerdere klanten bewezen zijn (Contentadvies)" })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });

  const out = { clients: 0, created: 0, progressed: 0, closed: 0, crossPatterns: patterns.length };
  for (const cm of memories) {
    if (Date.now() - started > 240_000) break;
    try {
      const ctx = adviceContext(cm, patterns);
      const r = await syncClientAdvice(cm, buildAdvice(cm.memory, ctx), ctx, now);
      out.clients++; out.created += r.created; out.progressed += r.progressed; out.closed += r.closed;
    } catch (e) {
      console.error("[contentadvies] klant overgeslagen", cm.clientId, e);
    }
  }
  return out;
}


