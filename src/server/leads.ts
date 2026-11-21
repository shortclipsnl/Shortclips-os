import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { clients, leadMailEvents, salesLeads, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";

export const LEAD_STATUSES = ["lead", "offerte", "onderhandeling", "gewonnen", "verloren"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
const OPEN: LeadStatus[] = ["lead", "offerte", "onderhandeling"];

export type LeadRow = {
  id: string;
  company: string;
  contactName: string | null;
  status: string;
  externalStatus: string | null;
  source: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  budget: string | null;
  firstContactOn: string | null;
  followUpOn: string | null;
  leadClass: string | null;
  leadScore: number | null;
  segment: string | null;
  note: string | null;
  ownerName: string | null;
  convertedClientSlug: string | null;
};

/** Alle leads + samenvatting. Intern (sales is een teamfunctie). */
export async function listLeads() {
  await requireInternal();

  const convertedClient = alias(clients, "converted_client");
  const rows = await db
    .select({
      id: salesLeads.id,
      company: salesLeads.company,
      contactName: salesLeads.contactName,
      status: salesLeads.status,
      externalStatus: salesLeads.externalStatus,
      source: salesLeads.source,
      phone: salesLeads.phone,
      email: salesLeads.email,
      website: salesLeads.website,
      budget: salesLeads.budget,
      firstContactOn: salesLeads.firstContactOn,
      followUpOn: salesLeads.followUpOn,
      leadClass: salesLeads.leadClass,
      leadScore: salesLeads.leadScore,
      segment: salesLeads.segment,
      note: salesLeads.note,
      ownerName: users.fullName,
      convertedClientSlug: convertedClient.slug,
    })
    .from(salesLeads)
    .leftJoin(users, eq(users.id, salesLeads.ownerId))
    .leftJoin(convertedClient, eq(convertedClient.id, salesLeads.convertedClientId))
    .where(isNull(salesLeads.deletedAt))
    // Nieuwste leads bovenaan: daar zijn we nu mee bezig.
    .orderBy(sql`${salesLeads.firstContactOn} desc nulls last`, desc(salesLeads.createdAt));

  const today = new Date().toISOString().slice(0, 10);
  const total = rows.length;
  const open = rows.filter((r) => OPEN.includes(r.status as LeadStatus)).length;
  const won = rows.filter((r) => r.status === "gewonnen").length;
  const lost = rows.filter((r) => r.status === "verloren").length;
  const overdue = rows.filter((r) => OPEN.includes(r.status as LeadStatus) && r.followUpOn && r.followUpOn <= today).length;

  const segments = [...new Set(rows.map((r) => r.segment).filter(Boolean))] as string[];
  const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))] as string[];

  return { rows: rows as LeadRow[], summary: { total, open, won, lost, overdue }, segments, sources };
}

export type LeadMailItem = {
  id: string;
  receivedAt: string | null;
  formType: string | null;
  company: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  originalText: string | null;
  reason: string | null;
  leadId: string | null;
  leadCompany: string | null;
  leadStatus: string | null;
};

/**
 * Aanvragen uit de mail die aandacht vragen op de Leads-pagina:
 *  - review: twijfelgevallen die iemand moet beoordelen;
 *  - recent: aanvragen van de laatste 14 dagen die bij een bestaande lead zijn
 *    gezet, zodat een nieuwe vraag van een bestaande relatie niet ongezien blijft.
 */
export async function listLeadMailAttention(): Promise<{ review: LeadMailItem[]; recent: LeadMailItem[] }> {
  await requireInternal();
  const candidate = alias(salesLeads, "candidate_lead");
  const linked = alias(salesLeads, "linked_lead");
  const cols = {
    id: leadMailEvents.id,
    receivedAt: leadMailEvents.receivedAt,
    formType: leadMailEvents.formType,
    company: leadMailEvents.company,
    contactName: leadMailEvents.contactName,
    email: leadMailEvents.email,
    phone: leadMailEvents.phone,
    originalText: leadMailEvents.originalText,
    reason: leadMailEvents.matchReason,
  };
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [review, recent] = await Promise.all([
    db
      .select({ ...cols, leadId: candidate.id, leadCompany: candidate.company, leadStatus: candidate.status })
      .from(leadMailEvents)
      .leftJoin(candidate, eq(candidate.id, leadMailEvents.candidateLeadId))
      .where(eq(leadMailEvents.outcome, "review"))
      .orderBy(desc(leadMailEvents.receivedAt)),
    db
      .select({ ...cols, leadId: linked.id, leadCompany: linked.company, leadStatus: linked.status })
      .from(leadMailEvents)
      .innerJoin(linked, eq(linked.id, leadMailEvents.leadId))
      .where(and(eq(leadMailEvents.outcome, "attached"), gte(leadMailEvents.receivedAt, since)))
      .orderBy(desc(leadMailEvents.receivedAt)),
  ]);
  const iso = <T extends { receivedAt: Date | null }>(r: T) => ({ ...r, receivedAt: r.receivedAt ? new Date(r.receivedAt).toISOString() : null });
  return { review: review.map(iso), recent: recent.map(iso) };
}
