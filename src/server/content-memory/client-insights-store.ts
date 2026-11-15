import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentInsightReviews } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import type { AdviceItem, AdviceRef } from "./advice";
import { loadClientAdvice, type ClientAdvice } from "./advice-store";
import { buildClientInsights, type ClientInsights, type InsightReview, type ReviewDecision } from "./client-insights";
import type { ClientMemory } from "./index";

/**
 * Klantinzichten: opslag van de beoordeling door het team en het samenstellen
 * van "Wat werkt bij jouw bedrijf?" voor het klantportaal.
 */

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export async function loadInsightReviews(clientId: string): Promise<InsightReview[]> {
  const rows = await db.select().from(contentInsightReviews).where(eq(contentInsightReviews.clientId, clientId)).catch(() => []);
  return rows.map((r) => ({ key: r.key, decision: r.decision as ReviewDecision, clientTitle: r.clientTitle, clientText: r.clientText, reviewedAt: iso(r.reviewedAt) }));
}

/** Het team keurt een inzicht goed voor de klant, past de tekst aan of verbergt het. */
export async function setInsightReview(
  viewer: Viewer,
  clientId: string,
  input: { key: string; decision: ReviewDecision; clientTitle?: string | null; clientText?: string | null; item?: AdviceItem | null },
): Promise<{ ok: boolean; message: string }> {
  assertClientAccess(viewer, clientId);
  const key = input.key.slice(0, 200);
  if (!key) return { ok: false, message: "Inzicht niet gevonden." };
  const clientTitle = input.clientTitle?.trim().slice(0, 200) || null;
  const clientText = input.clientText?.trim().slice(0, 600) || null;
  const now = new Date();
  const values = { decision: input.decision, clientTitle, clientText, reviewedById: viewer.id, reviewedAt: now, updatedAt: now, ...(input.item ? { item: input.item } : {}) };
  const [existing] = await db.select({ id: contentInsightReviews.id }).from(contentInsightReviews).where(and(eq(contentInsightReviews.clientId, clientId), eq(contentInsightReviews.key, key))).limit(1);
  if (existing) await db.update(contentInsightReviews).set(values).where(eq(contentInsightReviews.id, existing.id));
  else await db.insert(contentInsightReviews).values({ clientId, key, ...values, item: input.item ?? {} });
  return { ok: true, message: input.decision === "tonen" ? "Zichtbaar voor de klant" : "Niet zichtbaar voor de klant" };
}

function videoLookup(cm: ClientMemory): (id: string) => AdviceRef | null {
  const byId = new Map(cm.memory.all.map((v) => [v.id, v]));
  return (id) => {
    const v = byId.get(id);
    return v ? { id: v.id, title: v.title, platform: v.platform, url: v.externalUrl, perf: v.perf, views: v.views, thumbnail: v.thumbnail, publishedOn: v.publishedOn } : null;
  };
}

/** De klantweergave uit een al geladen advies (interne pagina). */
export function clientInsightsFrom(cm: ClientMemory, ca: ClientAdvice, reviews: InsightReview[]): ClientInsights {
  return buildClientInsights({ sections: ca.advice.sections, open: ca.open, running: ca.running, learned: ca.learned, reviews, videoRef: videoLookup(cm) });
}

/**
 * De klantweergave voor het portaal. Leest alleen: de voortgang wordt door de
 * dagelijkse job en de interne pagina bijgewerkt, nooit door een klantbezoek.
 */
export async function getClientInsights(viewer: Viewer, cm: ClientMemory): Promise<ClientInsights | null> {
  assertClientAccess(viewer, cm.clientId);
  try {
    const reviews = await loadInsightReviews(cm.clientId);
    if (!reviews.some((r) => r.decision === "tonen")) return null;
    const ca = await loadClientAdvice(cm, { sync: false });
    return clientInsightsFrom(cm, ca, reviews);
  } catch (e) {
    console.error("[klantinzichten] laden mislukt", e);
    return null;
  }
}
