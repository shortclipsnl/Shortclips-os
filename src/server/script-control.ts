import "server-only";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clientAiProfiles, deliverables, reviewComments, reviewThreads, scriptReviewComments, scriptReviewThreads, scriptReviews, scripts } from "@/db/schema";

/**
 * Deterministische onderdelen van de AI Scriptcontrole (Deel 1): deze werken
 * zónder taalmodel. Het AI-oordeel zelf (hook/CTA/kijkersreis/verbeterd script)
 * zit in de action en is env-gated op ANTHROPIC_API_KEY.
 */

/** Standaard spreektempo (woorden/min) voor Nederlandse presentatie. Geen harde
 *  30–35s-norm: de schatting volgt uit het aantal woorden × tempo. */
export const DEFAULT_WPM = 150;

export type SpeakingEstimate = {
  words: number;
  seconds: number;
  wpm: number;
  perSection: { hook: number; body: number; cta: number };
};

const wordCount = (t: string | null | undefined): number =>
  (t ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Schat de spreektijd uit de scripttekst. `wpm` is kalibreerbaar (bijv. met het
 *  gemiddelde tempo van de klant uit Video Intelligence). */
export function estimateSpeakingTime(parts: { hook?: string | null; body?: string | null; cta?: string | null }, wpm = DEFAULT_WPM): SpeakingEstimate {
  const hook = wordCount(parts.hook);
  const body = wordCount(parts.body);
  const cta = wordCount(parts.cta);
  const words = hook + body + cta;
  const seconds = wpm > 0 ? Math.round((words / wpm) * 60) : 0;
  return { words, seconds, wpm, perSection: { hook, body, cta } };
}

/** Eerdere scripts van dezelfde klant met dezelfde pijler of hetzelfde format —
 *  als onderbouwing voor (strategische vs onbedoelde) herhaling. */
export async function findSimilarScripts(clientId: string, scriptId: string, pillar: string | null, format: string | null) {
  if (!pillar && !format) return [];
  const conds = [isNull(scripts.deletedAt), eq(scripts.clientId, clientId), ne(scripts.id, scriptId)];
  const match = [pillar ? eq(scripts.pillar, pillar) : undefined, format ? eq(scripts.format, format) : undefined].filter(Boolean);
  const rows = await db
    .select({ id: scripts.id, title: scripts.title, status: scripts.status, pillar: scripts.pillar, format: scripts.format })
    .from(scripts)
    .where(and(...conds, match.length ? or(...match) : undefined))
    .orderBy(desc(scripts.createdAt))
    .limit(6);
  return rows;
}

export type FeedbackContext = {
  afspraken: string | null;
  aandachtspunten: string | null;
  recenteKlantopmerkingen: string[];
  /** Recente klantfeedback op eerdere SCRIPTS (uit de scriptreviews in het
   *  portaal: opmerkingen op de PDF + algemene feedback). */
  recenteScriptfeedback: string[];
};

/** Bundelt eerdere klantfeedback (Deel 1.7): communicatie-afspraken +
 *  editing-aandachtspunten uit het klantprofiel + recente klant-opmerkingen op
 *  video's. Bron voor "eerdere feedback automatisch meenemen". */
export async function gatherFeedbackContext(clientId: string): Promise<FeedbackContext> {
  const [profile, comments, scriptComments] = await Promise.all([
    db.select({ communication: clientAiProfiles.communicationProfile, editing: clientAiProfiles.editingProfile }).from(clientAiProfiles).where(eq(clientAiProfiles.clientId, clientId)).limit(1),
    db
      .select({ body: reviewComments.body })
      .from(reviewComments)
      .innerJoin(reviewThreads, eq(reviewThreads.id, reviewComments.threadId))
      .innerJoin(deliverables, eq(deliverables.id, reviewThreads.deliverableId))
      .where(and(eq(deliverables.clientId, clientId), eq(reviewThreads.visibility, "client"), isNull(deliverables.deletedAt)))
      .orderBy(desc(reviewComments.createdAt))
      .limit(15),
    // Klantfeedback op eerdere scripts (uit de scriptreviews: opmerkingen op de
    // PDF + algemene feedback). Alleen opmerkingen ván de klant (niet intern).
    db
      .select({ body: scriptReviewComments.body })
      .from(scriptReviewComments)
      .innerJoin(scriptReviewThreads, eq(scriptReviewThreads.id, scriptReviewComments.threadId))
      .innerJoin(scriptReviews, eq(scriptReviews.id, scriptReviewThreads.reviewId))
      .where(and(eq(scriptReviews.clientId, clientId), eq(scriptReviewComments.isInternal, false), eq(scriptReviewThreads.visibility, "client"), isNull(scriptReviews.deletedAt)))
      .orderBy(desc(scriptReviewComments.createdAt))
      .limit(15),
  ]);
  const comm = (profile[0]?.communication ?? {}) as { afspraken?: string };
  const edit = (profile[0]?.editing ?? {}) as { aandachtspunten?: string };
  return {
    afspraken: comm.afspraken?.trim() || null,
    aandachtspunten: edit.aandachtspunten?.trim() || null,
    recenteKlantopmerkingen: comments.map((c) => c.body).filter((b): b is string => Boolean(b && b.trim())).slice(0, 10),
    recenteScriptfeedback: scriptComments.map((c) => c.body).filter((b): b is string => Boolean(b && b.trim())).slice(0, 10),
  };
}

/** De laatst opgeslagen scriptcontrole voor dit script (uit aiOutputs). */
export async function getLatestScriptControl(scriptId: string, clientId: string): Promise<unknown | null> {
  const [row] = await db
    .select({ output: aiOutputs.output })
    .from(aiOutputs)
    .where(and(eq(aiOutputs.clientId, clientId), eq(aiOutputs.tool, "scriptcontrole"), eq(aiOutputs.inputSummary, scriptId)))
    .orderBy(desc(aiOutputs.createdAt))
    .limit(1);
  return row?.output ?? null;
}
