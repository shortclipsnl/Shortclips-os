"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { quotes, salesLeads } from "@/db/schema";
import { ForbiddenError, requireQuotesAccess } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runPandaDocSync } from "@/server/jobs/pandadoc-sync";
import { PandaDocError, changeDocumentStatus, pandadocConfigured } from "@/server/quotes/pandadoc-client";
import { syncPandaDocDocument } from "@/server/quotes/pandadoc-sync";
import { PANDADOC_SETTABLE, allowedManualStatuses, mapPandaDocStatus, type SettableStatus } from "@/lib/pandadoc";

export type PdActionResult = { ok: boolean; message?: string };

function fail(e: unknown): PdActionResult {
  if (e instanceof ForbiddenError) return { ok: false, message: e.message };
  if (e instanceof PandaDocError) return { ok: false, message: e.userMessage };
  return { ok: false, message: e instanceof Error ? e.message : "Er ging iets mis." };
}

function revalidate(id?: string) {
  revalidatePath("/offertes");
  if (id) revalidatePath(`/offertes/${id}`);
  revalidatePath("/leads");
}

/** Knop "Nu synchroniseren" op de Offertepagina. */
export async function syncPandaDocNow(full = false): Promise<PdActionResult> {
  try {
    const viewer = await requireQuotesAccess();
    if (!pandadocConfigured()) return { ok: false, message: "PandaDoc is nog niet gekoppeld: PANDADOC_API_KEY ontbreekt." };
    const res = await runPandaDocSync({ full, triggeredById: viewer.id });
    revalidate();
    return res.ok ? { ok: true, message: "Offertes zijn bijgewerkt vanuit PandaDoc." } : { ok: false, message: res.error ?? "Synchronisatie mislukt." };
  } catch (e) {
    return fail(e);
  }
}

/** Eén offerte direct opnieuw ophalen (detailpagina). */
export async function refreshQuoteFromPandaDoc(quoteId: string): Promise<PdActionResult> {
  try {
    await requireQuotesAccess();
    const [q] = await db.select({ externalId: quotes.externalId, source: quotes.source }).from(quotes).where(eq(quotes.id, quoteId)).limit(1);
    if (!q?.externalId || q.source !== "pandadoc") return { ok: false, message: "Deze offerte komt niet uit PandaDoc." };
    const r = await syncPandaDocDocument(q.externalId, { forcePdf: true });
    revalidate(quoteId);
    return { ok: true, message: r.warnings.length ? `Bijgewerkt. Let op: ${r.warnings.join(" ")}` : "Bijgewerkt vanuit PandaDoc." };
  } catch (e) {
    return fail(e);
  }
}

const statusSchema = z.object({ quoteId: z.string().uuid(), status: z.enum(["ondertekend", "verlopen", "afgewezen"]) });

/**
 * Status wijzigen vanuit het portaal. Alleen de wijzigingen die PandaDoc
 * ondersteunt (Completed, Expired, Declined) en alleen via PandaDoc zelf:
 * we wijzigen nooit lokaal. Daarna halen we het document opnieuw op, zodat
 * portaal en PandaDoc altijd gelijk lopen.
 */
export async function changeQuoteStatusInPandaDoc(input: z.infer<typeof statusSchema>): Promise<PdActionResult> {
  try {
    const viewer = await requireQuotesAccess();
    const p = statusSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige status." };
    const [q] = await db.select().from(quotes).where(and(eq(quotes.id, p.data.quoteId), isNull(quotes.deletedAt))).limit(1);
    if (!q?.externalId || q.source !== "pandadoc") return { ok: false, message: "Deze offerte komt niet uit PandaDoc." };
    const current = mapPandaDocStatus(q.pandadocStatus);
    const target = p.data.status as SettableStatus;
    if (!allowedManualStatuses(current).includes(target)) {
      return { ok: false, message: "Deze statuswijziging staat PandaDoc vanuit de huidige status niet toe." };
    }
    await changeDocumentStatus(q.externalId, PANDADOC_SETTABLE[target].code, `Gewijzigd door ${viewer.email} via het Shortclips-portaal`);
    await syncPandaDocDocument(q.externalId, { forcePdf: true });
    await auditLog({ viewer, action: "quote.status_changed", entityType: "quote", entityId: q.id, changes: { status: target, via: "pandadoc" } }).catch(() => {});
    revalidate(q.id);
    return { ok: true, message: "Status gewijzigd in PandaDoc." };
  } catch (e) {
    return fail(e);
  }
}

const linkSchema = z.object({ quoteId: z.string().uuid(), leadId: z.string().uuid().nullable() });

/** Handmatig koppelen (of ontkoppelen) als de automatische koppeling twijfelt. */
export async function setQuoteLead(input: z.infer<typeof linkSchema>): Promise<PdActionResult> {
  try {
    await requireQuotesAccess();
    const p = linkSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige invoer." };
    if (p.data.leadId) {
      const [lead] = await db.select({ id: salesLeads.id, client: salesLeads.convertedClientId }).from(salesLeads).where(and(eq(salesLeads.id, p.data.leadId), isNull(salesLeads.deletedAt))).limit(1);
      if (!lead) return { ok: false, message: "Lead niet gevonden." };
      await db.update(quotes).set({ leadId: lead.id, leadMatch: "handmatig", ...(lead.client ? { clientId: lead.client } : {}), updatedAt: new Date() }).where(eq(quotes.id, p.data.quoteId));
    } else {
      // Ontkoppelen blijft handmatig staan, zodat de automatische koppeling het niet terugzet.
      await db.update(quotes).set({ leadId: null, leadMatch: "handmatig", updatedAt: new Date() }).where(eq(quotes.id, p.data.quoteId));
    }
    revalidate(p.data.quoteId);
    return { ok: true, message: p.data.leadId ? "Gekoppeld aan de lead." : "Koppeling verwijderd." };
  } catch (e) {
    return fail(e);
  }
}
