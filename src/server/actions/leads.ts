"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, salesLeads } from "@/db/schema";
import { requireInternal, requirePermission, ForbiddenError } from "@/server/auth/context";
import { dispatch } from "@/server/automation";
import { createClient } from "@/server/actions/clients";

export type ActionResult = { ok: boolean; message?: string; slug?: string };

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
    await requireInternal();
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

/** Opvolgdatum zetten of wissen. */
export async function setLeadFollowUp(input: z.infer<typeof followUpSchema>): Promise<ActionResult> {
  return wrap(async () => {
    await requireInternal();
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
    await requirePermission("clients:write");

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
