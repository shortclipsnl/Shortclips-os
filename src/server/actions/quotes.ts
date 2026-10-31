"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  quotes,
  quoteLines,
  quoteEvents,
  quoteTemplates,
  quoteTemplateVersions,
  clients,
  clientContacts,
  salesLeads,
} from "@/db/schema";
import { ForbiddenError, requireOwner } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { DEFAULT_TEMPLATE_CONTENT, sumLines, substituteContent, type QuoteContent, type QuoteLineInput } from "@/lib/quotes";
import { nextQuoteNumber } from "@/server/quotes";
import { newQuoteToken, peekQuoteByToken, publicQuoteLink } from "@/server/quotes/token";
import { quoteContentHash } from "@/server/quotes/content";
import { putQuotePdf } from "@/server/quotes/storage";
import { fetchSignhostSignedFiles, signhostConfigured, startSignhostSigning, SIGNHOST_STATUS_SIGNED } from "@/server/quotes/signhost";
import { setCompanyInfo, type CompanyInfo } from "@/server/quotes/company";

export type ActionResult = { ok: boolean; message?: string };

/** Shortclips' eigen bedrijfsgegevens voor op de offerte/PDF. Owner-only. */
export async function saveCompanyInfo(patch: Partial<CompanyInfo>): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    await setCompanyInfo(patch, viewer.id);
    revalidatePath("/offertes/instellingen");
    return { ok: true, message: "Bedrijfsgegevens opgeslagen." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

async function reqMeta() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
    origin: `${proto}://${host}`,
  };
}

/* ============================ Sjablonen ============================ */

export async function createTemplate(input: { name: string; description?: string }): Promise<ActionResult & { id?: string }> {
  try {
    const viewer = await requireOwner();
    const name = input.name.trim();
    if (!name) return { ok: false, message: "Geef het sjabloon een naam." };
    const [tpl] = await db.insert(quoteTemplates).values({ name: name.slice(0, 160), description: input.description ?? null, createdById: viewer.id }).returning({ id: quoteTemplates.id });
    await db.insert(quoteTemplateVersions).values({ templateId: tpl!.id, version: 1, content: DEFAULT_TEMPLATE_CONTENT, createdById: viewer.id });
    await auditLog({ viewer, action: "quote.template_created", entityType: "quote_template", entityId: tpl!.id });
    revalidatePath("/offertes/sjablonen");
    return { ok: true, id: tpl!.id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Sjabloon bijwerken = een nieuwe versie opslaan (eerdere offertes blijven ongewijzigd). */
export async function updateTemplate(input: { id: string; name?: string; content: QuoteContent }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const [tpl] = await db.select().from(quoteTemplates).where(and(eq(quoteTemplates.id, input.id), isNull(quoteTemplates.deletedAt))).limit(1);
    if (!tpl) return { ok: false, message: "Sjabloon niet gevonden." };
    const nextVersion = tpl.currentVersion + 1;
    await db.insert(quoteTemplateVersions).values({ templateId: tpl.id, version: nextVersion, content: input.content, createdById: viewer.id });
    await db.update(quoteTemplates).set({ currentVersion: nextVersion, name: input.name?.trim()?.slice(0, 160) ?? tpl.name, updatedAt: new Date() }).where(eq(quoteTemplates.id, tpl.id));
    await auditLog({ viewer, action: "quote.template_updated", entityType: "quote_template", entityId: tpl.id, changes: { version: nextVersion } });
    revalidatePath("/offertes/sjablonen");
    revalidatePath(`/offertes/sjablonen/${tpl.id}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function duplicateTemplate(id: string): Promise<ActionResult & { id?: string }> {
  try {
    const viewer = await requireOwner();
    const [tpl] = await db.select().from(quoteTemplates).where(and(eq(quoteTemplates.id, id), isNull(quoteTemplates.deletedAt))).limit(1);
    if (!tpl) return { ok: false, message: "Sjabloon niet gevonden." };
    const [ver] = await db.select().from(quoteTemplateVersions).where(and(eq(quoteTemplateVersions.templateId, id), eq(quoteTemplateVersions.version, tpl.currentVersion))).limit(1);
    const [copy] = await db.insert(quoteTemplates).values({ name: `${tpl.name} (kopie)`, description: tpl.description, createdById: viewer.id }).returning({ id: quoteTemplates.id });
    await db.insert(quoteTemplateVersions).values({ templateId: copy!.id, version: 1, content: (ver?.content ?? DEFAULT_TEMPLATE_CONTENT) as QuoteContent, createdById: viewer.id });
    revalidatePath("/offertes/sjablonen");
    return { ok: true, id: copy!.id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function archiveTemplate(id: string, archived: boolean): Promise<ActionResult> {
  try {
    await requireOwner();
    await db.update(quoteTemplates).set({ isArchived: archived, updatedAt: new Date() }).where(eq(quoteTemplates.id, id));
    revalidatePath("/offertes/sjablonen");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/* ============================ Offertes ============================ */

const createSchema = z.object({
  templateId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
});

/** Nieuwe offerte uit een sjabloon (of leeg). Snapshot de sjablooninhoud en
 *  prefill de ontvanger uit de klant of lead. Start als concept. */
export async function createQuote(input: z.input<typeof createSchema>): Promise<ActionResult & { id?: string }> {
  try {
    const viewer = await requireOwner();
    const p = createSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Ongeldig." };
    const { templateId, clientId, leadId, title } = p.data;

    // Ontvanger prefillen.
    let recipientCompany: string | null = null, recipientContactName: string | null = null, recipientEmail: string | null = null;
    if (clientId) {
      const [c] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
      const [ct] = await db.select({ fullName: clientContacts.fullName, email: clientContacts.email }).from(clientContacts).where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true))).limit(1);
      recipientCompany = c?.name ?? null;
      recipientContactName = ct?.fullName ?? null;
      recipientEmail = ct?.email ?? null;
    } else if (leadId) {
      const [l] = await db.select({ company: salesLeads.company, contactName: salesLeads.contactName, email: salesLeads.email }).from(salesLeads).where(eq(salesLeads.id, leadId)).limit(1);
      recipientCompany = l?.company ?? null;
      recipientContactName = l?.contactName ?? null;
      recipientEmail = l?.email ?? null;
    }

    // Sjablooninhoud ophalen + placeholders invullen.
    let content: QuoteContent = DEFAULT_TEMPLATE_CONTENT;
    let templateVersionId: string | null = null;
    if (templateId) {
      const [tpl] = await db.select().from(quoteTemplates).where(eq(quoteTemplates.id, templateId)).limit(1);
      if (tpl) {
        const [ver] = await db.select().from(quoteTemplateVersions).where(and(eq(quoteTemplateVersions.templateId, templateId), eq(quoteTemplateVersions.version, tpl.currentVersion))).limit(1);
        if (ver) {
          templateVersionId = ver.id;
          content = ver.content as QuoteContent;
        }
      }
    }
    content = substituteContent(content, {
      bedrijf: recipientCompany ?? "",
      contactpersoon: recipientContactName ?? "",
      offertenaam: title,
      datum: new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }),
    });

    // Standaard prijsregels uit het sjabloon overnemen als startregels.
    const defaults = (content.defaultLines ?? []).filter((l) => l.description?.trim());
    const amount = defaults.length ? sumLines(defaults) : 0;

    const number = await nextQuoteNumber();
    const [q] = await db.insert(quotes).values({
      number, title: title.slice(0, 200), status: "concept",
      clientId: clientId ?? null, leadId: leadId ?? null, templateVersionId,
      recipientCompany, recipientContactName, recipientEmail,
      content, amount: amount.toFixed(2), createdById: viewer.id,
    }).returning({ id: quotes.id });

    if (defaults.length) {
      await db.insert(quoteLines).values(defaults.map((l, i) => ({
        quoteId: q!.id, description: l.description.slice(0, 240),
        quantity: l.quantity.toFixed(2), unitPrice: l.unitPrice.toFixed(2),
        lineTotal: (Math.round(l.quantity * l.unitPrice * 100) / 100).toFixed(2), sortOrder: i,
      })));
    }

    await db.insert(quoteEvents).values({ quoteId: q!.id, type: "created" });
    await auditLog({ viewer, action: "quote.created", entityType: "quote", entityId: q!.id, clientId: clientId ?? null });
    revalidatePath("/offertes");
    return { ok: true, id: q!.id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

const lineSchema = z.object({ description: z.string().trim().max(240), quantity: z.coerce.number().min(0), unitPrice: z.coerce.number().min(0) });
const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  recipientCompany: z.string().trim().max(200).optional(),
  recipientContactName: z.string().trim().max(160).optional(),
  recipientEmail: z.string().trim().max(320).optional(),
  content: z.any(),
  lines: z.array(lineSchema).max(100),
  notes: z.string().trim().max(2000).optional(),
  expiresOn: z.string().optional(),
});

/** Concept bijwerken: tekst, ontvanger, regels. Alleen zolang nog niet definitief. */
export async function updateQuoteDraft(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const p = updateSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Ongeldig." };
    const [q] = await db.select({ status: quotes.status, isReadOnly: quotes.isReadOnly }).from(quotes).where(eq(quotes.id, p.data.id)).limit(1);
    if (!q) return { ok: false, message: "Offerte niet gevonden." };
    if (q.isReadOnly || q.status === "geaccepteerd" || q.status === "ondertekend") return { ok: false, message: "Een geaccepteerde/ondertekende offerte kan niet meer worden gewijzigd." };

    const lines = p.data.lines as QuoteLineInput[];
    const amount = sumLines(lines);

    await db.update(quotes).set({
      title: p.data.title.slice(0, 200),
      recipientCompany: p.data.recipientCompany || null,
      recipientContactName: p.data.recipientContactName || null,
      recipientEmail: p.data.recipientEmail || null,
      content: p.data.content as QuoteContent,
      amount: amount.toFixed(2),
      notes: p.data.notes || null,
      expiresOn: p.data.expiresOn ? new Date(p.data.expiresOn) : null,
      updatedAt: new Date(),
    }).where(eq(quotes.id, p.data.id));

    // Regels volledig vervangen.
    await db.delete(quoteLines).where(eq(quoteLines.quoteId, p.data.id));
    if (lines.length) {
      await db.insert(quoteLines).values(lines.map((l, i) => ({
        quoteId: p.data.id, description: l.description.slice(0, 240),
        quantity: l.quantity.toFixed(2), unitPrice: l.unitPrice.toFixed(2),
        lineTotal: (Math.round(l.quantity * l.unitPrice * 100) / 100).toFixed(2), sortOrder: i,
      })));
    }

    await auditLog({ viewer, action: "quote.updated", entityType: "quote", entityId: p.data.id });
    revalidatePath(`/offertes/${p.data.id}`);
    revalidatePath("/offertes");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function duplicateQuote(id: string): Promise<ActionResult & { id?: string }> {
  try {
    const viewer = await requireOwner();
    const [q] = await db.select().from(quotes).where(and(eq(quotes.id, id), isNull(quotes.deletedAt))).limit(1);
    if (!q) return { ok: false, message: "Offerte niet gevonden." };
    const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(quoteLines.sortOrder);
    const number = await nextQuoteNumber();
    const [copy] = await db.insert(quotes).values({
      number, title: `${q.title} (kopie)`, status: "concept",
      clientId: q.clientId, leadId: q.leadId, templateVersionId: q.templateVersionId,
      recipientCompany: q.recipientCompany, recipientContactName: q.recipientContactName, recipientEmail: q.recipientEmail,
      content: q.content, amount: q.amount, notes: q.notes, createdById: viewer.id,
    }).returning({ id: quotes.id });
    if (lines.length) {
      await db.insert(quoteLines).values(lines.map((l) => ({ quoteId: copy!.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, sortOrder: l.sortOrder })));
    }
    revalidatePath("/offertes");
    return { ok: true, id: copy!.id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function deleteQuote(id: string): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    await db.update(quotes).set({ deletedAt: new Date() }).where(eq(quotes.id, id));
    await auditLog({ viewer, action: "quote.deleted", entityType: "quote", entityId: id });
    revalidatePath("/offertes");
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Publieke link genereren + status naar "verzonden" (jij deelt 'm zelf per mail). */
export async function markQuoteSent(id: string): Promise<ActionResult & { link?: string }> {
  try {
    const viewer = await requireOwner();
    const [q] = await db.select().from(quotes).where(and(eq(quotes.id, id), isNull(quotes.deletedAt))).limit(1);
    if (!q) return { ok: false, message: "Offerte niet gevonden." };

    // Bestaand token hergebruiken (zelfde link blijft werken), anders genereren.
    const token = q.publicToken ?? newQuoteToken();
    const patch: Record<string, unknown> = { updatedAt: new Date(), publicToken: token };
    if (q.status === "concept") { patch.status = "verzonden"; patch.sentAt = new Date(); }
    await db.update(quotes).set(patch).where(eq(quotes.id, id));
    await db.insert(quoteEvents).values({ quoteId: id, type: "sent" });

    // Gekoppelde lead naar "offerte" zetten (pre-sale fase).
    if (q.leadId) {
      await db.update(salesLeads).set({ status: "offerte", updatedAt: new Date() }).where(and(eq(salesLeads.id, q.leadId), isNull(salesLeads.deletedAt)));
    }

    await auditLog({ viewer, action: "quote.sent", entityType: "quote", entityId: id, clientId: q.clientId ?? null });
    revalidatePath(`/offertes/${id}`);
    revalidatePath("/offertes");
    return { ok: true, link: publicQuoteLink(token) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Opnieuw een verse link maken (bijv. als de oude gelekt is). Owner-only. */
export async function regenerateQuoteLink(id: string): Promise<ActionResult & { link?: string }> {
  try {
    await requireOwner();
    const token = newQuoteToken();
    await db.update(quotes).set({ publicToken: token, updatedAt: new Date() }).where(eq(quotes.id, id));
    return { ok: true, link: publicQuoteLink(token) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    throw e;
  }
}

/* ===================== Publiek: accepteren / ondertekenen ===================== */

const acceptSchema = z.object({ token: z.string().min(10), name: z.string().trim().min(2).max(160) });

/**
 * Publiek (geen sessie): de klant accepteert de offerte digitaal. We leggen een
 * bewijsrecord vast (naam, tijdstip, inhoud-hash, IP, user-agent, akkoordtekst),
 * zetten de status op geaccepteerd en maken de offerte onveranderlijk. Als
 * Signhost is ingesteld, start daarna het ondertekenen (QES) via startQuoteSigning.
 */
export async function acceptQuote(input: z.input<typeof acceptSchema>): Promise<ActionResult & { signingAvailable?: boolean }> {
  const p = acceptSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Vul je naam in om te accepteren." };
  const q = await peekQuoteByToken(p.data.token);
  if (!q) return { ok: false, message: "Offerte niet gevonden of de link is niet meer geldig." };
  if (q.status === "geaccepteerd" || q.status === "ondertekend") return { ok: false, message: "Deze offerte is al geaccepteerd." };
  if (q.status === "afgewezen") return { ok: false, message: "Deze offerte is afgewezen." };

  const meta = await reqMeta();
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, q.id)).orderBy(quoteLines.sortOrder);
  const contentHash = quoteContentHash({
    content: q.content as QuoteContent,
    lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    amount: Number(q.amount), title: q.title, recipientCompany: q.recipientCompany,
  });

  const now = new Date();
  await db.update(quotes).set({
    status: "geaccepteerd", acceptedAt: now, acceptedByName: p.data.name.slice(0, 160),
    contentHash, isReadOnly: true,
    acceptanceEvidence: {
      name: p.data.name, at: now.toISOString(), ip: meta.ip, userAgent: meta.userAgent,
      contentHash, consent: "Ik ga akkoord met deze offerte en de bijbehorende voorwaarden.",
    },
    updatedAt: now,
  }).where(eq(quotes.id, q.id));
  await db.insert(quoteEvents).values({ quoteId: q.id, type: "accepted", ip: meta.ip, userAgent: meta.userAgent, meta: { name: p.data.name } });

  await notify({ roles: ["owner"], type: "quote.accepted", level: "success", title: `Offerte ${q.number} geaccepteerd 🎉`, body: `${p.data.name} heeft "${q.title}" geaccepteerd.`, href: `/offertes/${q.id}`, entityType: "quote", entityId: q.id, dedupeKey: `quote-accepted:${q.id}` });
  await recordActivity({ clientId: q.clientId ?? null, type: "quote.accepted", title: `Offerte ${q.number} geaccepteerd`, entityType: "quote", entityId: q.id });

  revalidatePath(`/offertes/${q.id}`);
  revalidatePath("/offertes");
  return { ok: true, signingAvailable: signhostConfigured() };
}

/** Publiek: start de gekwalificeerde ondertekening (QES) via Signhost. Geeft de
 *  SignUrl terug om de klant heen te sturen. */
export async function startQuoteSigning(token: string): Promise<ActionResult & { signUrl?: string }> {
  const q = await peekQuoteByToken(token);
  if (!q) return { ok: false, message: "Offerte niet gevonden." };
  if (!signhostConfigured()) return { ok: false, message: "Ondertekenen is nog niet ingesteld." };
  if (!q.recipientEmail) return { ok: false, message: "Geen e-mailadres voor de ondertekenaar bekend." };
  if (q.status === "ondertekend") return { ok: false, message: "Al ondertekend." };

  const meta = await reqMeta();
  // Offerte-PDF ophalen via de eigen PDF-route (token-geauthenticeerd).
  const pdfRes = await fetch(`${meta.origin}/api/offertes/${token}/pdf`, { headers: { cookie: "" } });
  if (!pdfRes.ok) return { ok: false, message: "Kon de offerte-PDF niet genereren." };
  const pdf = Buffer.from(await pdfRes.arrayBuffer());

  const start = await startSignhostSigning({
    pdf, fileName: `Offerte-${q.number}.pdf`,
    signerEmail: q.recipientEmail, signerName: q.recipientContactName ?? undefined,
    postbackUrl: `${meta.origin}/api/offertes/signhost/webhook`,
    requireQualified: true,
  });
  await db.update(quotes).set({ signhostTransactionId: start.transactionId, updatedAt: new Date() }).where(eq(quotes.id, q.id));
  await db.insert(quoteEvents).values({ quoteId: q.id, type: "signature_started", meta: { transactionId: start.transactionId } });
  return { ok: true, signUrl: start.signUrl ?? undefined };
}

const declineSchema = z.object({ token: z.string().min(10), reason: z.string().trim().max(500).optional() });
export async function declineQuote(input: z.input<typeof declineSchema>): Promise<ActionResult> {
  const p = declineSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Ongeldig." };
  const q = await peekQuoteByToken(p.data.token);
  if (!q) return { ok: false, message: "Offerte niet gevonden." };
  if (q.status === "geaccepteerd" || q.status === "ondertekend") return { ok: false, message: "Deze offerte is al geaccepteerd." };
  const meta = await reqMeta();
  await db.update(quotes).set({ status: "afgewezen", declinedAt: new Date(), updatedAt: new Date() }).where(eq(quotes.id, q.id));
  await db.insert(quoteEvents).values({ quoteId: q.id, type: "declined", ip: meta.ip, userAgent: meta.userAgent, meta: { reason: p.data.reason ?? null } });
  await notify({ roles: ["owner"], type: "quote.declined", level: "warning", title: `Offerte ${q.number} afgewezen`, body: p.data.reason ? `Reden: ${p.data.reason}` : undefined, href: `/offertes/${q.id}`, entityType: "quote", entityId: q.id, dedupeKey: `quote-declined:${q.id}` });
  revalidatePath(`/offertes/${q.id}`);
  return { ok: true };
}

/* ===================== Signhost webhook-afhandeling ===================== */

/** Verwerkt een Signhost-postback: bij "signed" het document + bewijs opslaan. */
export async function handleSignhostPostback(transactionId: string, status: number): Promise<void> {
  if (status !== SIGNHOST_STATUS_SIGNED) return;
  const [q] = await db.select().from(quotes).where(eq(quotes.signhostTransactionId, transactionId)).limit(1);
  if (!q) return;
  const { signedPdf, receipt } = await fetchSignhostSignedFiles(transactionId, `offerte-${q.number}`);
  const signedPath = signedPdf ? await putQuotePdf(q.id, "signed", signedPdf).catch(() => null) : null;
  const receiptPath = receipt ? await putQuotePdf(q.id, "receipt", receipt).catch(() => null) : null;
  await db.update(quotes).set({ status: "ondertekend", signedPdfPath: signedPath, signingReceiptPath: receiptPath, isReadOnly: true, updatedAt: new Date() }).where(eq(quotes.id, q.id));
  await db.insert(quoteEvents).values({ quoteId: q.id, type: "signed", meta: { transactionId } });
  await notify({ roles: ["owner"], type: "quote.signed", level: "success", title: `Offerte ${q.number} ondertekend ✍️`, body: `"${q.title}" is met een gekwalificeerde e-handtekening ondertekend.`, href: `/offertes/${q.id}`, entityType: "quote", entityId: q.id, dedupeKey: `quote-signed:${q.id}` });
}
