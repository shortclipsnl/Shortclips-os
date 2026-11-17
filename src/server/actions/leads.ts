"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, leadMailEvents, salesLeads, users } from "@/db/schema";
import { requireLeadsAccess, ForbiddenError } from "@/server/auth/context";
import { dispatch } from "@/server/automation";
import { createClient } from "@/server/actions/clients";
import { imapLeads } from "@/server/integrations/imap-leads";
import { runLeadImapSync } from "@/server/jobs/leads-imap-sync";

export type ActionResult = { ok: boolean; message?: string; slug?: string };

/** "Nu synchroniseren": leest direct de IMAP-leadsmap uit (alleen eigenaar). */
export async function syncLeadsFromMail(): Promise<ActionResult> {
  return wrap(async () => {
    await requireLeadsAccess();
    if (!imapLeads.isConfigured) {
      return { ok: false, message: "De IMAP-koppeling is nog niet ingesteld. Zet IMAP_HOST, IMAP_USER en IMAP_PASSWORD (Beheer → Koppelingen)." };
    }
    const res = await runLeadImapSync();
    revalidatePath("/leads");
    if (!res.ok) return { ok: false, message: res.error ?? "Synchroniseren mislukt. Probeer het later opnieuw." };
    return { ok: true };
  });
}

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["lead", "offerte", "onderhandeling", "gewonnen", "verloren"]),
});

/** Leadstatus wijzigen — zoals een statuskolom. */
export async function setLeadStatus(input: z.infer<typeof statusSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireLeadsAccess();
    const p = statusSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige status." };
    await db.update(salesLeads).set({ status: p.data.status, updatedAt: new Date() }).where(eq(salesLeads.id, p.data.id));

    // Automatiseringen aftrappen bij winst/offerte.
    const trigger = p.data.status === "gewonnen" ? "lead.won" : p.data.status === "offerte" ? "lead.quote_sent" : null;
    if (trigger) {
      await dispatch({ trigger, entityType: "sales_lead", entityId: p.data.id, data: { to: p.data.status, href: "/leads" } });
    }

    revalidatePath("/leads");
    return { ok: true };
  });
}

const followUpSchema = z.object({
  id: z.string().uuid(),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

const createLeadSchema = z.object({
  company: z.string().trim().min(1, "Geef een bedrijfs-/leadnaam op.").max(200),
  contactName: z.string().trim().max(160).optional(),
  email: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().max(40).optional(),
});

/** Handmatig een nieuwe lead toevoegen vanuit het leadsoverzicht. */
export async function createLead(input: z.infer<typeof createLeadSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireLeadsAccess();
    const p = createLeadSchema.safeParse(input);
    if (!p.success) return { ok: false, message: p.error.issues[0]?.message };
    const v = p.data;
    await db.insert(salesLeads).values({
      company: v.company,
      contactName: v.contactName || null,
      email: v.email || null,
      phone: v.phone || null,
      source: v.source || "Handmatig",
      status: "lead",
      segment: String(new Date().getFullYear()),
      firstContactOn: new Date().toISOString().slice(0, 10),
      note: "Handmatig toegevoegd.",
    });
    revalidatePath("/leads");
    return { ok: true };
  });
}

const sourceSchema = z.object({
  id: z.string().uuid(),
  source: z.string().trim().max(40).nullable(),
});

/** De bron van een lead zetten (waar de lead binnenkwam). */
export async function setLeadSource(input: z.infer<typeof sourceSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireLeadsAccess();
    const p = sourceSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige bron." };
    await db.update(salesLeads).set({ source: p.data.source || null, updatedAt: new Date() }).where(eq(salesLeads.id, p.data.id));
    revalidatePath("/leads");
    return { ok: true };
  });
}

/** Opvolgdatum zetten of wissen. */
export async function setLeadFollowUp(input: z.infer<typeof followUpSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireLeadsAccess();
    const p = followUpSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige datum." };
    await db.update(salesLeads).set({ followUpOn: p.data.followUpOn, updatedAt: new Date() }).where(eq(salesLeads.id, p.data.id));
    revalidatePath("/leads");
    return { ok: true };
  });
}

/**
 * Een lead omzetten naar een klant — zonder gegevens opnieuw in te voeren.
 * Neemt bedrijfsnaam, contactpersoon, contactgegevens, website, verwacht
 * maandbedrag en startdatum over, maakt de klant aan (incl. contract- en
 * contactpersoon-skelet) en markeert de lead als gewonnen + gekoppeld.
 * Vereist clients:write; voorkomt dubbele klanten door de koppeling te bewaren.
 */
export async function convertLeadToClient(leadId: string): Promise<ActionResult> {
  return wrap(async () => {
    await requireLeadsAccess();

    const [lead] = await db.select().from(salesLeads).where(eq(salesLeads.id, leadId)).limit(1);
    if (!lead) return { ok: false, message: "Lead niet gevonden." };

    // Al omgezet? Dan de bestaande klant teruggeven (geen dubbele klant).
    if (lead.convertedClientId) {
      const [existing] = await db.select({ slug: clients.slug }).from(clients).where(eq(clients.id, lead.convertedClientId)).limit(1);
      if (existing) return { ok: true, slug: existing.slug, message: "Deze lead is al een klant." };
    }

    const expectedMonthly = Number(lead.expectedMonthly) > 0 ? String(lead.expectedMonthly) : null;
    const res = await createClient({
      name: lead.company,
      website: lead.website,
      status: "active",
      monthlyRevenue: expectedMonthly,
      startedOn: lead.startOn,
      notes: [lead.note, lead.source ? `Bron: ${lead.source}` : null].filter(Boolean).join("\n") || null,
      contactName: lead.contactName,
      contactEmail: lead.email,
      contactPhone: lead.phone,
    });
    if (!res.ok || !res.slug) return { ok: false, message: res.message ?? "Aanmaken klant mislukt." };

    const [created] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, res.slug)).limit(1);
    await db
      .update(salesLeads)
      .set({ status: "gewonnen", convertedClientId: created?.id ?? null, updatedAt: new Date() })
      .where(eq(salesLeads.id, leadId));

    revalidatePath("/leads");
    revalidatePath("/clients");
    return { ok: true, slug: res.slug };
  });
}

const resolveMailSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["create", "attach", "ignore"]),
});

/**
 * Een twijfelgeval uit de mail afhandelen (iedereen met toegang tot Leads):
 *  - create: als nieuwe lead toevoegen;
 *  - attach: als contactmoment bij de voorgestelde bestaande lead zetten;
 *  - ignore: niets mee doen (blijft in het register, komt niet terug).
 */
export async function resolveLeadMail(input: z.infer<typeof resolveMailSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireLeadsAccess();
    const p = resolveMailSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige keuze." };
    const [ev] = await db.select().from(leadMailEvents).where(eq(leadMailEvents.id, p.data.id)).limit(1);
    if (!ev || ev.outcome !== "review") return { ok: false, message: "Deze aanvraag is al afgehandeld." };
    const { attachMailToLead, createLeadFromMail } = await import("@/server/leads/intake");
    const receivedAt = ev.receivedAt ?? ev.createdAt;
    const parsed = {
      company: ev.company,
      contactName: ev.contactName,
      email: ev.email,
      phone: ev.phone,
      website: ev.website,
      formType: ev.formType ?? "Website (contactformulier)",
      original: ev.originalText ?? "",
      source: ev.formType === "Rocket Leads" ? "Rocket leads" : "Website contactformulier",
    };

    if (p.data.action === "ignore") {
      await db.update(leadMailEvents).set({ outcome: "ignored", resolvedAt: new Date(), updatedAt: new Date() }).where(eq(leadMailEvents.id, ev.id));
    } else if (p.data.action === "attach") {
      if (!ev.candidateLeadId) return { ok: false, message: "Er is geen bestaande lead om aan te koppelen." };
      const ok = await attachMailToLead(ev.candidateLeadId, parsed, receivedAt);
      if (!ok) return { ok: false, message: "De bestaande lead is niet meer gevonden." };
      await db.update(leadMailEvents).set({ outcome: "attached", leadId: ev.candidateLeadId, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(leadMailEvents.id, ev.id));
    } else {
      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)))
        .limit(1);
      // Geen melding: deze lead wordt hier bewust met de hand toegevoegd.
      const id = await createLeadFromMail(parsed, receivedAt, owner?.id ?? null, ev.messageId, false);
      if (!id) return { ok: false, message: "Er bestaat al een lead voor deze mail." };
      await db.update(leadMailEvents).set({ outcome: "created", leadId: id, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(leadMailEvents.id, ev.id));
    }
    revalidatePath("/leads");
    return { ok: true };
  });
}
