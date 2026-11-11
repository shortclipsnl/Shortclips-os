import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, quoteEvents, quotes, salesLeads, syncJobs, users } from "@/db/schema";
import { dispatch } from "@/server/automation";
import { notify } from "@/server/notifications";
import { nextQuoteNumber } from "@/server/quotes/number";
import { putQuotePdf } from "@/server/quotes/storage";
import { pdfPlainText } from "@/server/briefing/guide-highlights";
import {
  PandaDocError,
  downloadDocumentPdf,
  getAuditTrail,
  getDocumentDetails,
  listDocuments,
  type PdAuditEntry,
  type PdDetails,
  type PdListItem,
} from "@/server/quotes/pandadoc-client";
import {
  AUDIT_ACTION,
  GENERIC_EMAIL_DOMAINS,
  companyFromTitle,
  emailDomain,
  extractTotalFromText,
  isInternalEmail,
  mapPandaDocStatus,
  normalizeCompany,
  normalizePandaDocStatus,
  serviceTypeFrom,
  type PortalQuoteStatus,
} from "@/lib/pandadoc";

/**
 * Synchronisatie PandaDoc → portaal. PandaDoc is leidend voor status, data,
 * ontvangers en document; het portaal leest alleen. Per document:
 *  1. details (status, data, ontvangers, verzender)
 *  2. audittrail (verzonden, elke opening, ondertekening) → tijdlijn + kijkcijfers
 *  3. PDF (alleen opnieuw bij een andere status of gewijzigde inhoud)
 *  4. bedrag: PandaDoc-prijstabel, anders uit de PDF, maar alleen als excl. en
 *     incl. btw elkaar bevestigen. Anders blijft het leeg (niets verzinnen).
 *  5. koppeling aan de juiste lead + leadstatus bij een recente wijziging.
 */

type QuoteRow = typeof quotes.$inferSelect;

/** Leadstatus alleen automatisch aanpassen bij wijzigingen van de laatste 30 dagen,
 *  zodat de import van oude offertes geen historische leads omzet. */
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);
const name = (p?: { first_name?: string | null; last_name?: string | null } | null) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || null;
const cap = (s: string | null) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s);

export type SyncDocResult = { quoteId: string; created: boolean; statusChanged: boolean; warnings: string[] };

export async function syncPandaDocDocument(documentId: string, opts: { forcePdf?: boolean } = {}): Promise<SyncDocResult> {
  const warnings: string[] = [];
  const [existing] = await db.select().from(quotes).where(eq(quotes.externalId, documentId)).limit(1);

  let details: PdDetails;
  try {
    details = await getDocumentDetails(documentId);
  } catch (e) {
    if (existing && e instanceof PandaDocError && e.status === 404) {
      await db.update(quotes).set({ syncError: "Dit document bestaat niet meer in PandaDoc.", syncedAt: new Date() }).where(eq(quotes.id, existing.id));
      return { quoteId: existing.id, created: false, statusChanged: false, warnings: [e.userMessage] };
    }
    throw e;
  }

  const rawStatus = normalizePandaDocStatus(details.status);
  const status = mapPandaDocStatus(details.status);
  const title = (details.name ?? existing?.title ?? "Offerte").slice(0, 200);

  // --- Audittrail (openingen e.d.). Zonder beheerdersrechten: doorgaan zonder. ---
  let audit: PdAuditEntry[] | null = null;
  try {
    audit = await getAuditTrail(documentId);
  } catch (e) {
    warnings.push(e instanceof PandaDocError ? e.userMessage : "Activiteit kon niet worden opgehaald.");
  }

  // --- Ontvangers: alleen externe ondertekenaars tellen als klant. ---
  const clientRecipients = (details.recipients ?? []).filter((r) => r.email && !isInternalEmail(r.email));
  const primary = clientRecipients.find((r) => r.recipient_type === "signer") ?? clientRecipients[0] ?? null;
  const recipientEmail = primary?.email?.toLowerCase() ?? existing?.recipientEmail ?? null;
  const contactName = cap(name(primary)) ?? existing?.recipientContactName ?? null;

  // --- PDF + bedrag ---
  const contentModified = toDate((details as { content_date_modified?: string }).content_date_modified ?? details.date_modified);
  const needPdf =
    opts.forcePdf ||
    !existing?.originalPdfPath ||
    existing.pdfForStatus !== rawStatus ||
    (contentModified && existing.pandadocModifiedAt && contentModified.getTime() > existing.pandadocModifiedAt.getTime());

  let pdfPath = existing?.originalPdfPath ?? null;
  let pdfForStatus = existing?.pdfForStatus ?? null;
  let pdfText: string | null = null;
  if (needPdf) {
    try {
      const bytes = await downloadDocumentPdf(documentId, status === "ondertekend");
      const stored = await putQuotePdf(`pandadoc-${documentId}`, "original", bytes).catch(() => null);
      if (stored) { pdfPath = stored; pdfForStatus = rawStatus; }
      pdfText = await pdfPlainText(bytes).catch(() => null);
    } catch (e) {
      warnings.push(e instanceof PandaDocError ? `PDF: ${e.userMessage}` : "PDF kon niet worden opgehaald.");
    }
  }

  let amount: string | null = existing?.amount && Number(existing.amount) > 0 ? existing.amount : null;
  let amountInclVat = existing?.amountInclVat ?? null;
  let amountSource = existing?.amountSource ?? null;
  const pricing = Number(details.grand_total?.amount ?? 0);
  if (pricing > 0) {
    amount = pricing.toFixed(2); amountInclVat = null; amountSource = "pricing";
  } else if (pdfText) {
    const total = extractTotalFromText(pdfText);
    if (total) { amount = total.exclVat.toFixed(2); amountInclVat = total.inclVat.toFixed(2); amountSource = "pdf"; }
    else if (amountSource !== "pricing") { amount = null; amountInclVat = null; amountSource = null; }
  }

  // --- Openingen door de klant (eigen previews tellen niet mee). ---
  const opens = (audit ?? [])
    .filter((a) => a.action === 8 && !isInternalEmail(a.user?.email))
    .map((a) => new Date(a.date_created))
    .sort((a, b) => a.getTime() - b.getTime());

  const sender = details.sent_by ?? details.created_by ?? null;
  const senderEmail = sender?.email?.toLowerCase() ?? null;
  const [senderUser] = senderEmail
    ? await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${senderEmail}`, isNull(users.deletedAt))).limit(1)
    : [];

  const completedAt = toDate(details.date_completed);
  const values = {
    title,
    status,
    pandadocStatus: rawStatus,
    pandadocModifiedAt: contentModified,
    recipientCompany: companyFromTitle(title) ?? existing?.recipientCompany ?? null,
    recipientContactName: contactName,
    recipientEmail,
    amount: amount ?? "0",
    amountInclVat,
    amountSource,
    currency: details.grand_total?.currency ?? existing?.currency ?? "EUR",
    serviceType: serviceTypeFrom(title, pdfText) ?? existing?.serviceType ?? null,
    sentAt: toDate(details.date_sent) ?? existing?.sentAt ?? null,
    acceptedAt: status === "ondertekend" ? completedAt ?? existing?.acceptedAt ?? null : null,
    acceptedByName: status === "ondertekend" ? contactName : null,
    declinedAt: status === "afgewezen" ? existing?.declinedAt ?? toDate(details.date_modified) : null,
    expiresOn: toDate(details.expiration_date),
    ...(audit ? { openCount: opens.length, firstOpenedAt: opens[0] ?? null, lastOpenedAt: opens.at(-1) ?? null } : {}),
    senderEmail,
    senderName: cap(name(sender)),
    createdById: senderUser?.id ?? existing?.createdById ?? null,
    originalPdfPath: pdfPath,
    pdfForStatus,
    source: "pandadoc",
    isReadOnly: true,
    syncedAt: new Date(),
    syncError: warnings.length ? warnings.join(" ") : null,
    updatedAt: new Date(),
    ...(details.date_created ? { createdAt: new Date(details.date_created) } : {}),
  };

  let quoteId: string;
  let created = false;
  if (existing) {
    await db.update(quotes).set(values).where(eq(quotes.id, existing.id));
    quoteId = existing.id;
  } else {
    const number = await nextQuoteNumber();
    const inserted = await db
      .insert(quotes)
      .values({ ...values, number, externalId: documentId, content: { blocks: [] } })
      .onConflictDoNothing()
      .returning({ id: quotes.id });
    if (inserted[0]) { quoteId = inserted[0].id; created = true; }
    else {
      // Gelijktijdig aangemaakt (webhook + periodieke sync): bijwerken.
      const [row] = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.externalId, documentId)).limit(1);
      if (!row) throw new Error(`Offerte ${documentId} kon niet worden opgeslagen.`);
      await db.update(quotes).set(values).where(eq(quotes.id, row.id));
      quoteId = row.id;
    }
  }

  await writeEvents(quoteId, documentId, audit, details, status, values.declinedAt);

  const prevStatus = (existing?.status ?? null) as PortalQuoteStatus | "geaccepteerd" | null;
  const statusChanged = prevStatus !== status;
  const [fresh] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (fresh) {
    await linkQuoteToLead(fresh);
    if (statusChanged || created) await applyQuoteEffects(fresh, prevStatus, !!existing?.firstOpenedAt);
  }

  return { quoteId, created, statusChanged, warnings };
}

/** Tijdlijn: elke audittrail-regel één keer (unieke externalId). */
async function writeEvents(
  quoteId: string,
  documentId: string,
  audit: PdAuditEntry[] | null,
  details: PdDetails,
  status: PortalQuoteStatus,
  declinedAt: Date | null,
) {
  const rows: (typeof quoteEvents.$inferInsert)[] = [];
  if (audit) {
    for (const a of audit) {
      const meta = AUDIT_ACTION[a.action];
      if (!meta) continue;
      // Eigen openingen (preview door Shortclips) niet in de tijdlijn.
      if (meta.type === "opened" && isInternalEmail(a.user?.email)) continue;
      // Handtekening van Shortclips zelf is geen klantactiviteit.
      if (meta.type === "signature" && isInternalEmail(a.user?.email)) continue;
      rows.push({ quoteId, type: meta.type, externalId: `pd:${a.id}`, actor: a.user?.email ?? null, occurredAt: new Date(a.date_created), meta: { source: "pandadoc", action: a.action } });
    }
  } else {
    // Zonder audittrail: alleen wat zeker is uit de documentdata.
    const pairs: [string, string | null | undefined][] = [["created", details.date_created], ["sent", details.date_sent], ["signed", details.date_completed]];
    for (const [type, at] of pairs) if (at) rows.push({ quoteId, type, externalId: `pd:${documentId}:${type}`, occurredAt: new Date(at), meta: { source: "pandadoc" } });
  }
  if (status === "afgewezen" && declinedAt) rows.push({ quoteId, type: "declined", externalId: `pd:${documentId}:declined`, occurredAt: declinedAt, meta: { source: "pandadoc" } });
  if (status === "verlopen") rows.push({ quoteId, type: "expired", externalId: `pd:${documentId}:expired`, occurredAt: toDate(details.expiration_date) && toDate(details.expiration_date)!.getTime() < Date.now() ? toDate(details.expiration_date)! : new Date(), meta: { source: "pandadoc" } });
  if (rows.length) await db.insert(quoteEvents).values(rows).onConflictDoNothing();
}

/**
 * Koppelt een offerte aan de juiste lead, in volgorde van betrouwbaarheid:
 *  1. exact e-mailadres van de ontvanger
 *  2. zelfde (niet-algemeen) e-maildomein, alleen als er precies één lead past
 *  3. exact dezelfde bedrijfsnaam, alleen als er precies één lead past
 * Twijfel = niet koppelen (dan handmatig). Een handmatige koppeling blijft staan.
 * Er worden nooit leads aangemaakt, zodat er geen dubbele leads ontstaan.
 */
export async function linkQuoteToLead(q: QuoteRow): Promise<void> {
  if (q.leadMatch === "handmatig") return;

  const leads = await db
    .select({ id: salesLeads.id, company: salesLeads.company, email: salesLeads.email, website: salesLeads.website, convertedClientId: salesLeads.convertedClientId, status: salesLeads.status })
    .from(salesLeads)
    .where(isNull(salesLeads.deletedAt));

  const email = q.recipientEmail?.toLowerCase() ?? null;
  const domain = emailDomain(email);
  let match: { lead: (typeof leads)[number]; how: "email" | "domein" | "naam" } | null = null;

  if (email) {
    const hits = leads.filter((l) => l.email?.trim().toLowerCase() === email);
    if (hits.length >= 1) match = { lead: pickBest(hits), how: "email" };
  }
  if (!match && domain && !GENERIC_EMAIL_DOMAINS.has(domain)) {
    const hits = leads.filter((l) => emailDomain(l.email) === domain || (l.website ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] === domain);
    if (hits.length === 1) match = { lead: hits[0]!, how: "domein" };
  }
  const company = normalizeCompany(q.recipientCompany);
  if (!match && company.length >= 3) {
    const hits = leads.filter((l) => normalizeCompany(l.company) === company);
    if (hits.length === 1) match = { lead: hits[0]!, how: "naam" };
  }

  // Bestaande klant (verlenging zonder lead): koppel aan de klant.
  let clientId = q.clientId ?? match?.lead.convertedClientId ?? null;
  if (!clientId && company.length >= 3) {
    const all = await db.select({ id: clients.id, name: clients.name, legalName: clients.legalName }).from(clients).where(isNull(clients.deletedAt));
    const hits = all.filter((c) => normalizeCompany(c.name) === company || normalizeCompany(c.legalName) === company);
    if (hits.length === 1) clientId = hits[0]!.id;
  }

  if (!match) {
    if (clientId !== q.clientId) await db.update(quotes).set({ clientId }).where(eq(quotes.id, q.id));
    return;
  }
  if (match.lead.id === q.leadId && match.how === q.leadMatch && clientId === q.clientId) return;
  await db.update(quotes).set({ leadId: match.lead.id, leadMatch: match.how, clientId }).where(eq(quotes.id, q.id));
  // Lead zonder e-mail: aanvullen met het adres uit PandaDoc (feitelijk gegeven).
  if (!match.lead.email && email) await db.update(salesLeads).set({ email, updatedAt: new Date() }).where(eq(salesLeads.id, match.lead.id));
}

/** Bij meerdere leads met hetzelfde adres: de open lead, anders de nieuwste. */
function pickBest<T extends { status: string }>(hits: T[]): T {
  return hits.find((h) => ["lead", "offerte", "onderhandeling"].includes(h.status)) ?? hits[0]!;
}

/** Leadstatus + meldingen bij een recente statuswijziging. */
async function applyQuoteEffects(q: QuoteRow, prev: string | null, wasOpened: boolean): Promise<void> {
  const now = Date.now();
  const recent = (d: Date | null) => !!d && now - d.getTime() <= RECENT_MS;
  const label = q.recipientCompany ?? q.title;

  if (q.leadId) {
    const [lead] = await db.select({ status: salesLeads.status }).from(salesLeads).where(eq(salesLeads.id, q.leadId)).limit(1);
    if (lead) {
      if (q.status === "ondertekend" && recent(q.acceptedAt) && lead.status !== "gewonnen") {
        await db.update(salesLeads).set({ status: "gewonnen", updatedAt: new Date() }).where(eq(salesLeads.id, q.leadId));
        await dispatch({ trigger: "lead.won", entityType: "sales_lead", entityId: q.leadId, data: { to: "gewonnen", href: "/leads", via: "pandadoc" } });
      } else if ((q.status === "verzonden" || q.status === "bekeken") && recent(q.sentAt) && lead.status === "lead") {
        await db.update(salesLeads).set({ status: "offerte", updatedAt: new Date() }).where(eq(salesLeads.id, q.leadId));
      }
    }
  }

  if (q.status === "bekeken" && !wasOpened && recent(q.firstOpenedAt)) {
    await notify({ roles: ["owner"], type: "quote.opened", level: "info", title: `${label} heeft de offerte geopend`, body: q.title, href: `/offertes/${q.id}`, entityType: "quote", entityId: q.id, dedupeKey: `quote-opened:${q.id}` });
  }
  if (q.status === "ondertekend" && prev !== "ondertekend" && recent(q.acceptedAt)) {
    await notify({ roles: ["owner"], type: "quote.signed", level: "success", title: `${label} heeft de offerte ondertekend`, body: q.title, href: `/offertes/${q.id}`, entityType: "quote", entityId: q.id, dedupeKey: `quote-signed:${q.id}` });
  }
  if (q.status === "afgewezen" && prev !== "afgewezen" && recent(q.declinedAt)) {
    await notify({ roles: ["owner"], type: "quote.declined", level: "warning", title: `${label} heeft de offerte afgewezen`, body: q.title, href: `/offertes/${q.id}`, entityType: "quote", entityId: q.id, dedupeKey: `quote-declined:${q.id}` });
  }
}

export type SyncAllReport = { seen: number; synced: number; created: number; skipped: number; failed: number; complete: boolean; errors: string[] };

/**
 * Alle documenten bijwerken. `full` = alles (eerste import / nachtelijke
 * controle); anders alleen wat sinds de laatste volledige run in PandaDoc
 * gewijzigd is. Stopt netjes binnen het tijdsbudget; de volgende run pakt de rest.
 */
export async function syncAllPandaDoc(opts: { full?: boolean; budgetMs?: number; log?: (m: string) => void } = {}): Promise<SyncAllReport> {
  const log = opts.log ?? (() => {});
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const report: SyncAllReport = { seen: 0, synced: 0, created: 0, skipped: 0, failed: 0, complete: true, errors: [] };

  let modifiedFrom: Date | undefined;
  if (!opts.full) {
    const [last] = await db
      .select({ startedAt: syncJobs.startedAt })
      .from(syncJobs)
      .where(and(eq(syncJobs.jobType, "pandadoc.sync"), eq(syncJobs.status, "success")))
      .orderBy(desc(syncJobs.startedAt))
      .limit(1);
    if (last?.startedAt) modifiedFrom = new Date(last.startedAt.getTime() - 60 * 60 * 1000);
  }
  log(modifiedFrom ? `Wijzigingen sinds ${modifiedFrom.toISOString()}` : "Volledige synchronisatie");

  const items: PdListItem[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await listDocuments({ page, count: 100, modifiedFrom });
    items.push(...batch);
    if (batch.length < 100) break;
  }
  report.seen = items.length;

  const known = items.length
    ? await db.select({ externalId: quotes.externalId, pandadocStatus: quotes.pandadocStatus, syncedAt: quotes.syncedAt }).from(quotes).where(inArray(quotes.externalId, items.map((i) => i.id)))
    : [];
  const byId = new Map(known.map((k) => [k.externalId, k]));

  for (const item of items) {
    if (Date.now() > deadline) { report.complete = false; log("Tijdsbudget op; de volgende run gaat verder."); break; }
    const k = byId.get(item.id);
    const modified = toDate(item.date_modified);
    if (k?.syncedAt && k.pandadocStatus === normalizePandaDocStatus(item.status) && modified && modified.getTime() <= k.syncedAt.getTime()) {
      report.skipped++;
      continue;
    }
    try {
      const res = await syncPandaDocDocument(item.id);
      report.synced++;
      if (res.created) report.created++;
      if (res.warnings.length) log(`${item.name ?? item.id}: ${res.warnings.join(" ")}`);
    } catch (e) {
      report.failed++;
      const msg = e instanceof PandaDocError ? e.userMessage : e instanceof Error ? e.message : String(e);
      report.errors.push(`${item.name ?? item.id}: ${msg}`);
      log(`Mislukt: ${item.name ?? item.id}: ${msg}`);
      // Sleutel ongeldig: direct stoppen, de rest faalt ook.
      if (e instanceof PandaDocError && e.status === 401) { report.complete = false; break; }
    }
  }
  return report;
}

/** Laatste synchronisatie voor de statusregel op de Offertepagina. */
export async function lastPandaDocSync() {
  const [row] = await db
    .select({ status: syncJobs.status, finishedAt: syncJobs.finishedAt, startedAt: syncJobs.startedAt, error: syncJobs.error, log: syncJobs.log, failed: syncJobs.itemsFailed })
    .from(syncJobs)
    .where(eq(syncJobs.jobType, "pandadoc.sync"))
    .orderBy(desc(syncJobs.startedAt))
    .limit(1);
  return row ?? null;
}
