import "server-only";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { clients, salesLeads, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";

export const LEAD_STATUSES = ["lead", "offerte", "onderhandeling", "gewonnen", "verloren"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
const OPEN: LeadStatus[] = ["lead", "offerte", "onderhandeling"];

export type LeadRow = {
  id: string;
  company: string;
  contactName: string | null;
  status: string;
  mondayStatus: string | null;
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
      mondayStatus: salesLeads.mondayStatus,
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
    .orderBy(sql`${salesLeads.followUpOn} asc nulls last`, desc(salesLeads.updatedAt));

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
