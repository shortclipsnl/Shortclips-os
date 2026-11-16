import "server-only";
import { desc, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { errorLogs } from "@/db/schema";
import { describeIssue, normalizeIssueMessage, type IssueDescription } from "@/lib/technical-issues";

export type TechnicalIssue = IssueDescription & {
  key: string;
  message: string;
  source: string | null;
  count: number;
  firstAt: Date;
  lastAt: Date;
  /** Nog actief: laatst gezien in de afgelopen 24 uur. */
  active: boolean;
  /** Referentie die een medewerker op het foutscherm ziet (bij portaalfouten). */
  reference: string | null;
  path: string | null;
};

const WINDOW_DAYS = 14;

/**
 * Alle technische fouten van de afgelopen twee weken, samengevoegd per bron en
 * melding: welke koppeling, wat de fout is, wanneer ontstaan, hoe vaak, en welke
 * actie nodig is. Uitsluitend voor de eigenaar (de pagina controleert dat).
 */
export async function technicalIssues(): Promise<TechnicalIssue[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({ source: errorLogs.source, message: errorLogs.message, occurredAt: errorLogs.occurredAt, context: errorLogs.context })
    .from(errorLogs)
    .where(gte(errorLogs.occurredAt, since))
    .orderBy(desc(errorLogs.occurredAt))
    .limit(5000);

  const groups = new Map<string, TechnicalIssue>();
  for (const r of rows) {
    const message = normalizeIssueMessage(r.message ?? "Onbekende fout");
    const key = `${r.source ?? ""}|${message}`;
    const at = r.occurredAt instanceof Date ? r.occurredAt : new Date(r.occurredAt as unknown as string);
    const ctx = (r.context ?? {}) as Record<string, unknown>;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (at < g.firstAt) g.firstAt = at;
      continue;
    }
    groups.set(key, {
      key,
      message,
      source: r.source,
      count: 1,
      firstAt: at,
      lastAt: at,
      active: Date.now() - at.getTime() < 86_400_000,
      reference: typeof ctx.digest === "string" ? ctx.digest : null,
      path: typeof ctx.path === "string" ? ctx.path : null,
      ...describeIssue(r.source, message),
    });
  }

  // Actief en actie nodig eerst, daarna meest recent.
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(b.needsOwner) - Number(a.needsOwner) ||
      b.lastAt.getTime() - a.lastAt.getTime(),
  );
}
