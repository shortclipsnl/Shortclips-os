"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, salesLeads } from "@/db/schema";
import { requireOwner, ForbiddenError } from "@/server/auth/context";
import { dispatch } from "@/server/automation";
import { createClient } from "@/server/actions/clients";
import { gmail } from "@/server/integrations/gmail";
import { runLeadMailSync } from "@/server/jobs/leads-mail-sync";

export type ActionResult = { ok: boolean; message?: string; slug?: string };

/** "Nu synchroniseren": leest direct de leads-mailmap uit (alleen eigenaar). */
export async function syncLeadsFromMail(): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    if (!gmail.isConfigured) {
      return { ok: false, message: "De Gmail-koppeling is nog niet ingesteld. Zet de Google-sleutels met de scope gmail.readonly (Beheer → Koppelingen)." };
    }
    const res = await runLeadMailSync();
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

/** Leadstatus wijzigen — zoals de statuskolom in Monday. */
export async function setLeadStatus(input: z.infer<typeof statusSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireOwner();
    const p = statusSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige status." };
    await db.update(salesLeads).set({ status: p.data.status, updatedAt: new Date() }).where(eq(salesLeads.id, p.data.id));

    // Automatiseringen aftrappen bij winst/offerte (zoals in Monday).
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
    await requireOwner();
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
    await requireOwner();
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
    await requireOwner();
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
    await requireOwner();

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
