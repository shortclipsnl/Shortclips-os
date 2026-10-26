import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientImprovements, users } from "@/db/schema";
import { type Viewer } from "@/server/auth/context";

/**
 * "Wat gaan we verbeteren?" — per klant per maand een verbeterplan dat op de
 * resultatenpagina van de klant verschijnt. Concept staat alleen intern; na
 * goedkeuring door de content creative wordt het zichtbaar voor de klant.
 */

export type ImprovementContent = {
  watWerkt: string[];
  watMinder: string[];
  volgendeWeek: string[];
  volgendeMaand: string[];
  formats: string[];
  optimalisaties: string[];
};

export const EMPTY_IMPROVEMENT: ImprovementContent = {
  watWerkt: [], watMinder: [], volgendeWeek: [], volgendeMaand: [], formats: [], optimalisaties: [],
};

export function currentPeriod(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
}

function normalize(raw: unknown): ImprovementContent {
  const r = (raw ?? {}) as Partial<Record<keyof ImprovementContent, unknown>>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 8) : []);
  return {
    watWerkt: arr(r.watWerkt), watMinder: arr(r.watMinder), volgendeWeek: arr(r.volgendeWeek),
    volgendeMaand: arr(r.volgendeMaand), formats: arr(r.formats), optimalisaties: arr(r.optimalisaties),
  };
}

export const hasAnyImprovement = (c: ImprovementContent): boolean =>
  c.watWerkt.length + c.watMinder.length + c.volgendeWeek.length + c.volgendeMaand.length + c.formats.length + c.optimalisaties.length > 0;

/** Intern: het verbeterplan voor een klant+periode (concept of goedgekeurd). */
export async function getImprovementPlan(clientId: string, period: string): Promise<{
  content: ImprovementContent; status: string; approvedAt: string | null; approvedByName: string | null;
} | null> {
  const [row] = await db
    .select({ content: clientImprovements.content, status: clientImprovements.status, approvedAt: clientImprovements.approvedAt, approvedByName: users.fullName })
    .from(clientImprovements)
    .leftJoin(users, eq(users.id, clientImprovements.approvedById))
    .where(and(eq(clientImprovements.clientId, clientId), eq(clientImprovements.period, period), isNull(clientImprovements.deletedAt)))
    .limit(1);
  if (!row) return null;
  return { content: normalize(row.content), status: row.status, approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null, approvedByName: row.approvedByName ?? null };
}

/** Portaal: het meest recente, goedgekeurde verbeterplan van de ingelogde klant. */
export async function getApprovedImprovementForClient(viewer: Viewer): Promise<{ period: string; content: ImprovementContent; approvedAt: string | null } | null> {
  const clientId = viewer.clientId;
  if (!clientId) return null;
  const [row] = await db
    .select({ period: clientImprovements.period, content: clientImprovements.content, approvedAt: clientImprovements.approvedAt })
    .from(clientImprovements)
    .where(and(eq(clientImprovements.clientId, clientId), eq(clientImprovements.status, "approved"), isNull(clientImprovements.deletedAt)))
    .orderBy(desc(clientImprovements.period))
    .limit(1);
  if (!row) return null;
  const content = normalize(row.content);
  if (!hasAnyImprovement(content)) return null;
  return { period: row.period, content, approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null };
}

export { normalize as normalizeImprovement };
