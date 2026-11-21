import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientContacts, clients, leadMailEvents, salesLeads, users } from "@/db/schema";
import { dispatch } from "@/server/automation";
import { parseLeadMail, type ParsedLeadMail } from "./mail-parser";
import { matchLeadMail, type MatchClient, type MatchLead } from "./matching";

/**
 * Verwerkt één mail uit de leadsmap tot precies één regel in het register
 * (lead_mail_events) en, afhankelijk van de herkenning:
 *  - nieuwe lead (status "lead", bron volgens het formulier), of
 *  - contactmoment bij een bestaande lead (notitie aangevuld, lege
 *    contactvelden gevuld; status, offertes en bestaande notities blijven), of
 *  - twijfelgeval voor handmatige beoordeling op de Leads-pagina.
 * Een mail die al in het register staat wordt nooit opnieuw verwerkt.
 */

export type IncomingLeadMail = {
  messageId: string;
  from: string | null;
  replyTo: string | null;
  subject: string | null;
  date: Date | null;
  body: string;
};

export type IntakeOutcome = "created" | "attached" | "review" | "ignored" | "skipped";

export type IntakeContext = {
  leads: MatchLead[];
  clients: MatchClient[];
  ownerId: string | null;
};

function amsterdamDate(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(d);
}
function dmy(isoDate: string): string {
  return isoDate.split("-").reverse().join("-");
}
function squash(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Leest de gegevens die nodig zijn om aanvragen te herkennen (één keer per run). */
export async function loadIntakeContext(): Promise<IntakeContext> {
  const [leadRows, clientRows, contactRows, ownerRows] = await Promise.all([
    db
      .select({ id: salesLeads.id, company: salesLeads.company, contactName: salesLeads.contactName, email: salesLeads.email, phone: salesLeads.phone, website: salesLeads.website })
      .from(salesLeads)
      .where(isNull(salesLeads.deletedAt)),
    db.select({ id: clients.id, name: clients.name, status: clients.status, website: clients.website }).from(clients).where(isNull(clients.deletedAt)),
    db.select({ clientId: clientContacts.clientId, email: clientContacts.email, phone: clientContacts.phone }).from(clientContacts),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)))
      .limit(1),
  ]);
  return {
    leads: leadRows,
    clients: clientRows.map((c) => ({
      name: c.name,
      status: c.status ? String(c.status) : null,
      website: c.website,
      emails: contactRows.filter((x) => x.clientId === c.id && x.email).map((x) => x.email as string),
      phones: contactRows.filter((x) => x.clientId === c.id && x.phone).map((x) => x.phone as string),
    })),
    ownerId: ownerRows[0]?.id ?? null,
  };
}

/** Welke van deze Message-ID's zijn al verwerkt (register of oudere import op de lead zelf)? */
export async function knownMessageIds(ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (!chunk.length) continue;
    const [a, b] = await Promise.all([
      db.select({ m: leadMailEvents.messageId }).from(leadMailEvents).where(inArray(leadMailEvents.messageId, chunk)),
      db.select({ m: salesLeads.externalId }).from(salesLeads).where(inArray(salesLeads.externalId, chunk)),
    ]);
    for (const r of a) known.add(r.m);
    for (const r of b) if (r.m) known.add(r.m);
  }
  return known;
}

function eventValues(msg: IncomingLeadMail, p: ParsedLeadMail) {
  return {
    messageId: msg.messageId.slice(0, 400),
    receivedAt: msg.date && !isNaN(msg.date.getTime()) ? msg.date : null,
    formType: p.formType,
    company: p.company,
    contactName: p.contactName,
    email: p.email,
    phone: p.phone,
    website: p.website,
    originalText: p.original,
  };
}

/** Nieuwe lead aanmaken uit een geparste aanvraag. */
export async function createLeadFromMail(
  p: Pick<ParsedLeadMail, "company" | "contactName" | "email" | "phone" | "website" | "formType" | "original"> & { source: string },
  receivedAt: Date,
  ownerId: string | null,
  externalId: string | null,
  notify: boolean,
): Promise<string | null> {
  const day = amsterdamDate(receivedAt);
  const hasCompany = p.company && squash(p.company).length > 0;
  const company = (hasCompany ? p.company! : (p.contactName ?? p.email?.split("@")[1] ?? "Onbekende lead")).slice(0, 200);
  const contactName = p.contactName && squash(p.contactName) !== squash(company) ? p.contactName : null;
  const inserted = await db
    .insert(salesLeads)
    .values({
      company,
      contactName,
      email: p.email,
      phone: p.phone,
      website: p.website,
      source: p.source.slice(0, 40),
      status: "lead",
      segment: day.slice(0, 4),
      note: `Aanvraag van ${dmy(day)} via ${p.formType}:\n${p.original.trim()}`,
      firstContactOn: day,
      ownerId,
      externalId,
    })
    .onConflictDoNothing()
    .returning({ id: salesLeads.id });
  const id = inserted[0]?.id ?? null;
  if (id && notify) {
    await dispatch({ trigger: "lead.created", entityType: "sales_lead", entityId: id, data: { to: "lead", href: "/leads" } }).catch(() => {});
  }
  return id;
}

/** Aanvraag als contactmoment bij een bestaande lead zetten. Wijzigt nooit de status. */
export async function attachMailToLead(
  leadId: string,
  p: Pick<ParsedLeadMail, "email" | "phone" | "website" | "formType" | "original">,
  receivedAt: Date,
): Promise<boolean> {
  const [lead] = await db.select().from(salesLeads).where(eq(salesLeads.id, leadId)).limit(1);
  if (!lead) return false;
  const day = amsterdamDate(receivedAt);
  const marker = `[Aanvraag ${dmy(day)} via ${p.formType}]`;
  const set: Partial<typeof salesLeads.$inferInsert> = {};
  if (!lead.email && p.email) set.email = p.email;
  if (!lead.phone && p.phone) set.phone = p.phone;
  if (!lead.website && p.website) set.website = p.website;
  if (!lead.firstContactOn) set.firstContactOn = day;
  if (!(lead.note ?? "").includes(marker)) {
    set.note = `${(lead.note ?? "").trimEnd()}${lead.note ? "\n\n" : ""}${marker}\n${p.original.trim()}`;
  }
  if (Object.keys(set).length) {
    await db.update(salesLeads).set({ ...set, updatedAt: new Date() }).where(eq(salesLeads.id, leadId));
  }
  return true;
}

export async function processLeadMail(msg: IncomingLeadMail, ctx: IntakeContext, opts: { notify?: boolean } = {}): Promise<IntakeOutcome> {
  const p = parseLeadMail({ from: msg.from, replyTo: msg.replyTo, subject: msg.subject, body: msg.body });
  const receivedAt = msg.date && !isNaN(msg.date.getTime()) ? msg.date : new Date();
  const base = eventValues(msg, p);

  // Eerst de registerregel claimen: bestaat de Message-ID al, dan doet deze run niets.
  const [claimed] = await db
    .insert(leadMailEvents)
    .values({ ...base, outcome: "ignored", matchReason: "In behandeling" })
    .onConflictDoNothing()
    .returning({ id: leadMailEvents.id });
  if (!claimed) return "skipped";
  const finish = async (outcome: Exclude<IntakeOutcome, "skipped">, values: Partial<typeof leadMailEvents.$inferInsert>) => {
    await db.update(leadMailEvents).set({ outcome, ...values, updatedAt: new Date() }).where(eq(leadMailEvents.id, claimed.id));
    return outcome;
  };

  try {
    if (!p.email && !p.phone && !p.company && !p.contactName) {
      return await finish("ignored", { matchReason: "Geen bruikbare contactgegevens in de mail" });
    }

    const match = matchLeadMail({ company: p.company, contactName: p.contactName, email: p.email, phone: p.phone }, ctx.leads, ctx.clients);

    if (match.kind === "existing") {
      await attachMailToLead(match.leadId, p, receivedAt);
      return await finish("attached", { leadId: match.leadId, matchReason: match.reason.slice(0, 300), resolvedAt: new Date() });
    }
    if (match.kind === "review") {
      return await finish("review", { candidateLeadId: match.candidateLeadId, matchReason: match.reason.slice(0, 300) });
    }

    const id = await createLeadFromMail(p, receivedAt, ctx.ownerId, base.messageId, opts.notify ?? true);
    if (!id) return await finish("ignored", { matchReason: "Lead met deze Message-ID bestond al" });
    // Volgende mails in dezelfde run herkennen deze nieuwe lead meteen.
    ctx.leads.push({ id, company: p.company ?? p.contactName ?? "", contactName: p.contactName, email: p.email, phone: p.phone, website: p.website });
    return await finish("created", { leadId: id, matchReason: "Geen bestaande lead of klant gevonden", resolvedAt: new Date() });
  } catch (error) {
    // Mislukt de verwerking, dan de claim vrijgeven zodat de volgende run het opnieuw probeert.
    await db.delete(leadMailEvents).where(eq(leadMailEvents.id, claimed.id)).catch(() => {});
    throw error;
  }
}
