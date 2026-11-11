import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { quoteEvents, quoteLines, quoteTemplateVersions, quoteTemplates, quotes, clients, salesLeads, users } from "@/db/schema";
import { requireQuotesAccess } from "@/server/auth/context";
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
  source: string;
  externalId: string | null;
  clientName: string | null;
  clientSlug: string | null;
  recipientCompany: string | null;
  contactName: string | null;
  contactEmail: string | null;
  serviceType: string | null;
  /** Bedrag excl. btw; null = onbekend (niet uit PandaDoc of PDF te bevestigen). */
  amount: number | null;
  createdAt: Date;
  sentAt: Date | null;
  firstOpenedAt: Date | null;
  lastOpenedAt: Date | null;
  openCount: number;
  signedAt: Date | null;
  expiresOn: Date | null;
  leadId: string | null;
  leadCompany: string | null;
  leadMatch: string | null;
  ownerName: string | null;
  syncError: string | null;
  link: string | null;
};

export type QuotesStats = {
  total: number;
  open: number;
  openValue: number;
  openWithoutAmount: number;
  signed: number;
  declined: number;
  expired: number;
  conversion: number | null;
};

const OPEN_STATUSES = new Set(["verzonden", "bekeken"]);
const SIGNED_STATUSES = new Set(["ondertekend", "geaccepteerd"]);

export async function getQuotesOverview(): Promise<{ rows: QuoteListRow[]; stats: QuotesStats; owners: string[] }> {
  await requireQuotesAccess();
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      status: quotes.status,
      source: quotes.source,
      externalId: quotes.externalId,
      clientName: clients.name,
      clientSlug: clients.slug,
      recipientCompany: quotes.recipientCompany,
      contactName: quotes.recipientContactName,
      contactEmail: quotes.recipientEmail,
      serviceType: quotes.serviceType,
      amount: quotes.amount,
      amountSource: quotes.amountSource,
      createdAt: quotes.createdAt,
      sentAt: quotes.sentAt,
      firstOpenedAt: quotes.firstOpenedAt,
      lastOpenedAt: quotes.lastOpenedAt,
      openCount: quotes.openCount,
      acceptedAt: quotes.acceptedAt,
      expiresOn: quotes.expiresOn,
      leadId: quotes.leadId,
      leadCompany: salesLeads.company,
      leadMatch: quotes.leadMatch,
      senderName: quotes.senderName,
      ownerName: users.fullName,
      syncError: quotes.syncError,
      publicToken: quotes.publicToken,
    })
    .from(quotes)
    .leftJoin(clients, eq(clients.id, quotes.clientId))
    .leftJoin(salesLeads, eq(salesLeads.id, quotes.leadId))
    .leftJoin(users, eq(users.id, quotes.createdById))
    .where(isNull(quotes.deletedAt))
    .orderBy(sql`coalesce(${quotes.sentAt}, ${quotes.createdAt}) desc`);

  const list: QuoteListRow[] = rows.map((r) => {
    // Handmatige (oude) offertes: bedrag uit de regels. PandaDoc: alleen als bevestigd.
    const known = r.source !== "pandadoc" ? n(r.amount) > 0 : !!r.amountSource;
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      status: (r.status === "geaccepteerd" && r.source === "pandadoc" ? "ondertekend" : r.status) as QuoteStatus,
      source: r.source,
      externalId: r.externalId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      recipientCompany: r.recipientCompany,
      contactName: r.contactName,
      contactEmail: r.contactEmail,
      serviceType: r.serviceType,
      amount: known ? n(r.amount) : null,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      firstOpenedAt: r.firstOpenedAt,
      lastOpenedAt: r.lastOpenedAt,
      openCount: r.openCount,
      signedAt: r.acceptedAt,
      expiresOn: r.expiresOn,
      leadId: r.leadId,
      leadCompany: r.leadCompany,
      leadMatch: r.leadMatch,
      ownerName: r.ownerName ?? r.senderName,
      syncError: r.syncError,
      link: r.publicToken ? publicQuoteLink(r.publicToken) : null,
    };
  });

  const open = list.filter((r) => OPEN_STATUSES.has(r.status));
  const signed = list.filter((r) => SIGNED_STATUSES.has(r.status)).length;
  const declined = list.filter((r) => r.status === "afgewezen").length;
  const expired = list.filter((r) => r.status === "verlopen").length;
  const done = signed + declined + expired;
  const stats: QuotesStats = {
    total: list.length,
    open: open.length,
    openValue: open.reduce((s, r) => s + (r.amount ?? 0), 0),
    openWithoutAmount: open.filter((r) => r.amount == null).length,
    signed,
    declined,
    expired,
    conversion: done ? signed / done : null,
  };
  const owners = [...new Set(list.map((r) => r.ownerName).filter(Boolean))] as string[];
  return { rows: list, stats, owners };
}

/** Offertes per lead (voor de Leadspagina): nieuwste eerst. */
export type LeadQuoteSummary = {
  id: string;
  status: QuoteStatus;
  amount: number | null;
  sentAt: Date | null;
  firstOpenedAt: Date | null;
  openCount: number;
  signedAt: Date | null;
  count: number;
};

export async function getQuotesByLead(): Promise<Map<string, LeadQuoteSummary>> {
  const rows = await db
    .select({
      id: quotes.id, leadId: quotes.leadId, status: quotes.status, source: quotes.source, amount: quotes.amount, amountSource: quotes.amountSource,
      sentAt: quotes.sentAt, createdAt: quotes.createdAt, firstOpenedAt: quotes.firstOpenedAt, openCount: quotes.openCount, acceptedAt: quotes.acceptedAt,
    })
    .from(quotes)
    .where(and(isNull(quotes.deletedAt), sql`${quotes.leadId} is not null`))
    .orderBy(sql`coalesce(${quotes.sentAt}, ${quotes.createdAt}) desc`);
  const map = new Map<string, LeadQuoteSummary>();
  for (const r of rows) {
    const prev = map.get(r.leadId!);
    if (prev) { prev.count++; continue; }
    map.set(r.leadId!, {
      id: r.id,
      status: (r.status === "geaccepteerd" && r.source === "pandadoc" ? "ondertekend" : r.status) as QuoteStatus,
      amount: (r.source !== "pandadoc" ? n(r.amount) > 0 : !!r.amountSource) ? n(r.amount) : null,
      sentAt: r.sentAt,
      firstOpenedAt: r.firstOpenedAt,
      openCount: r.openCount,
      signedAt: r.acceptedAt,
      count: 1,
    });
  }
  return map;
}

/** Eén offerte volledig laden (intern, owner-only) incl. regels en gebeurtenissen. */
export async function getQuoteDetail(id: string) {
  await requireQuotesAccess();
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, id), isNull(quotes.deletedAt))).limit(1);
  if (!q) return null;
  const [lines, events, client, lead] = await Promise.all([
    db.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(quoteLines.sortOrder),
    db.select().from(quoteEvents).where(eq(quoteEvents.quoteId, id)).orderBy(desc(quoteEvents.occurredAt)),
    q.clientId ? db.select({ id: clients.id, name: clients.name, slug: clients.slug }).from(clients).where(eq(clients.id, q.clientId)).limit(1) : Promise.resolve([]),
    q.leadId ? db.select({ id: salesLeads.id, company: salesLeads.company, status: salesLeads.status, contactName: salesLeads.contactName, email: salesLeads.email, phone: salesLeads.phone }).from(salesLeads).where(eq(salesLeads.id, q.leadId)).limit(1) : Promise.resolve([]),
  ]);
  return { quote: q, lines, events, client: client[0] ?? null, lead: lead[0] ?? null };
}

/** Actieve sjablonen met hun huidige versie-inhoud. */
export async function listQuoteTemplates(includeArchived = false) {
  await requireQuotesAccess();
  const tpls = await db
    .select()
    .from(quoteTemplates)
    .where(includeArchived ? isNull(quoteTemplates.deletedAt) : and(isNull(quoteTemplates.deletedAt), eq(quoteTemplates.isArchived, false)))
    .orderBy(desc(quoteTemplates.updatedAt));
  return tpls;
}

export async function getTemplateWithVersion(templateId: string) {
  await requireQuotesAccess();
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
