import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { quoteEvents, quoteLines, quoteTemplateVersions, quoteTemplates, quotes, clients, salesLeads } from "@/db/schema";
import { requireOwner } from "@/server/auth/context";
import { notify } from "@/server/notifications";
import { recordActivity } from "@/server/audit";
import { publicQuoteLink } from "@/server/quotes/token";
import type { QuoteContent } from "@/lib/quotes";

export { nextQuoteNumber } from "@/server/quotes/number";

export type QuoteStatus =
  | "concept" | "verzonden" | "bekeken" | "geaccepteerd" | "ondertekend" | "afgewezen" | "verlopen";

const n = (v: unknown) => Number(v ?? 0);

export type QuoteListRow = {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  clientName: string | null;
  recipientCompany: string | null;
  amount: number;
  createdAt: Date;
  lastOpenedAt: Date | null;
  openCount: number;
  link: string | null;
};

export async function getQuotesOverview(): Promise<{
  rows: QuoteListRow[];
  stats: { total: number; concept: number; verzonden: number; bekeken: number; geaccepteerd: number; ondertekend: number; afgewezen: number };
}> {
  await requireOwner();
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      status: quotes.status,
      clientName: clients.name,
      recipientCompany: quotes.recipientCompany,
      amount: quotes.amount,
      createdAt: quotes.createdAt,
      lastOpenedAt: quotes.lastOpenedAt,
      openCount: quotes.openCount,
      publicToken: quotes.publicToken,
    })
    .from(quotes)
    .leftJoin(clients, eq(clients.id, quotes.clientId))
    .where(isNull(quotes.deletedAt))
    .orderBy(desc(quotes.createdAt));

  const list: QuoteListRow[] = rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status as QuoteStatus,
    clientName: r.clientName,
    recipientCompany: r.recipientCompany,
    amount: n(r.amount),
    createdAt: r.createdAt,
    lastOpenedAt: r.lastOpenedAt,
    openCount: r.openCount,
    link: r.publicToken ? publicQuoteLink(r.publicToken) : null,
  }));

  const stats = {
    total: list.length,
    concept: list.filter((r) => r.status === "concept").length,
    verzonden: list.filter((r) => r.status === "verzonden").length,
    bekeken: list.filter((r) => r.status === "bekeken").length,
    geaccepteerd: list.filter((r) => r.status === "geaccepteerd").length,
    ondertekend: list.filter((r) => r.status === "ondertekend").length,
    afgewezen: list.filter((r) => r.status === "afgewezen").length,
  };
  return { rows: list, stats };
}

/** Eén offerte volledig laden (intern, owner-only) incl. regels en gebeurtenissen. */
export async function getQuoteDetail(id: string) {
  await requireOwner();
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, id), isNull(quotes.deletedAt))).limit(1);
  if (!q) return null;
  const [lines, events, client, lead] = await Promise.all([
    db.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(quoteLines.sortOrder),
    db.select().from(quoteEvents).where(eq(quoteEvents.quoteId, id)).orderBy(desc(quoteEvents.occurredAt)),
    q.clientId ? db.select({ id: clients.id, name: clients.name, slug: clients.slug }).from(clients).where(eq(clients.id, q.clientId)).limit(1) : Promise.resolve([]),
    q.leadId ? db.select({ id: salesLeads.id, company: salesLeads.company }).from(salesLeads).where(eq(salesLeads.id, q.leadId)).limit(1) : Promise.resolve([]),
  ]);
  return { quote: q, lines, events, client: client[0] ?? null, lead: lead[0] ?? null };
}

/** Actieve sjablonen met hun huidige versie-inhoud. */
export async function listQuoteTemplates(includeArchived = false) {
  await requireOwner();
  const tpls = await db
    .select()
    .from(quoteTemplates)
    .where(includeArchived ? isNull(quoteTemplates.deletedAt) : and(isNull(quoteTemplates.deletedAt), eq(quoteTemplates.isArchived, false)))
    .orderBy(desc(quoteTemplates.updatedAt));
  return tpls;
}

export async function getTemplateWithVersion(templateId: string) {
  await requireOwner();
  const [tpl] = await db.select().from(quoteTemplates).where(and(eq(quoteTemplates.id, templateId), isNull(quoteTemplates.deletedAt))).limit(1);
  if (!tpl) return null;
  const [ver] = await db
    .select()
    .from(quoteTemplateVersions)
    .where(and(eq(quoteTemplateVersions.templateId, templateId), eq(quoteTemplateVersions.version, tpl.currentVersion)))
    .limit(1);
  return { template: tpl, version: ver ?? null, content: (ver?.content ?? {}) as QuoteContent };
}

/**
 * Registreert dat de offerte is geopend. Wordt alléén aangeroepen vanaf de
 * publieke route wanneer het géén interne preview is, zodat onze eigen
 * voorbeeldweergaven niet meetellen. Verhoogt de teller, zet de tijdstippen,
 * schrijft een gebeurtenis en meldt de eerste opening aan de eigenaar.
 */
export async function recordQuoteOpen(quoteId: string, meta: { ip?: string | null; userAgent?: string | null }): Promise<void> {
  const [q] = await db.select({ status: quotes.status, first: quotes.firstOpenedAt, number: quotes.number, title: quotes.title, clientId: quotes.clientId }).from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!q) return;
  const now = new Date();
  const isFirst = !q.first;

  await db
    .update(quotes)
    .set({
      openCount: sql`${quotes.openCount} + 1`,
      lastOpenedAt: now,
      ...(isFirst ? { firstOpenedAt: now } : {}),
      // Verzonden → bekeken bij de eerste echte opening; latere statussen blijven.
      ...(q.status === "verzonden" ? { status: "bekeken" as const } : {}),
      updatedAt: now,
    })
    .where(eq(quotes.id, quoteId));

  await db.insert(quoteEvents).values({ quoteId, type: "opened", ip: meta.ip ?? null, userAgent: meta.userAgent ?? null });

  if (isFirst) {
    await notify({
      roles: ["owner"],
      type: "quote.opened",
      level: "info",
      title: `Offerte ${q.number} is bekeken`,
      body: `${q.title} is voor het eerst geopend door de klant.`,
      href: `/offertes/${quoteId}`,
      entityType: "quote",
      entityId: quoteId,
      dedupeKey: `quote-opened:${quoteId}`,
    });
    await recordActivity({
      clientId: q.clientId ?? null,
      type: "quote.opened",
      title: `Offerte ${q.number} bekeken`,
      entityType: "quote",
      entityId: quoteId,
    });
  }
}
