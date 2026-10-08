"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { contentCalendar } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runJsonPrompt } from "@/server/ai/client";
import { extractDocxText } from "@/server/ai/docx";

export type ActionResult = { ok: boolean; message?: string; id?: string };

const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "linkedin"] as const;
const STATUSES = ["to_prepare", "ready", "scheduled", "published", "failed"] as const;

const itemSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(1, "Geef een titel op.").max(240),
  scheduledOn: z.string().min(8, "Kies een publicatiedatum."),
  platforms: z.array(z.enum(PLATFORMS)).default([]),
  status: z.enum(STATUSES).default("scheduled"),
  notes: z.string().trim().max(2000).nullish(),
});

export async function createCalendarItem(input: z.input<typeof itemSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    const parsed = itemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    assertClientAccess(viewer, parsed.data.clientId);

    const [created] = await db
      .insert(contentCalendar)
      .values({
        clientId: parsed.data.clientId,
        title: parsed.data.title,
        scheduledOn: parsed.data.scheduledOn,
        platforms: parsed.data.platforms,
        status: parsed.data.status,
        notes: parsed.data.notes || null,
        ownerId: viewer.id,
      })
      .returning({ id: contentCalendar.id });

    await auditLog({
      viewer,
      action: "calendar.item_created",
      entityType: "calendar_item",
      entityId: created!.id,
      clientId: parsed.data.clientId,
      changes: { title: parsed.data.title, scheduledOn: parsed.data.scheduledOn, status: parsed.data.status },
    });

    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true, id: created!.id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  scheduledOn: z.string().min(8).optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function updateCalendarItem(
  itemId: string,
  input: z.input<typeof patchSchema>,
): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };

    const [item] = await db
      .select({ id: contentCalendar.id, clientId: contentCalendar.clientId })
      .from(contentCalendar)
      .where(and(eq(contentCalendar.id, itemId), isNull(contentCalendar.deletedAt)))
      .limit(1);
    if (!item) return { ok: false, message: "Publicatie niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.scheduledOn !== undefined) patch.scheduledOn = parsed.data.scheduledOn;
    if (parsed.data.platforms !== undefined) patch.platforms = parsed.data.platforms;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes || null;

    await db.update(contentCalendar).set(patch).where(eq(contentCalendar.id, itemId));

    await auditLog({
      viewer,
      action: "calendar.item_updated",
      entityType: "calendar_item",
      entityId: itemId,
      clientId: item.clientId,
      changes: parsed.data as Record<string, unknown>,
    });

    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteCalendarItem(itemId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("calendar:write");
    const [item] = await db
      .select({ id: contentCalendar.id, clientId: contentCalendar.clientId })
      .from(contentCalendar)
      .where(and(eq(contentCalendar.id, itemId), isNull(contentCalendar.deletedAt)))
      .limit(1);
    if (!item) return { ok: false, message: "Publicatie niet gevonden." };
    assertClientAccess(viewer, item.clientId);

    await db.update(contentCalendar).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(contentCalendar.id, itemId));

    await auditLog({ viewer, action: "calendar.item_deleted", entityType: "calendar_item", entityId: itemId, clientId: item.clientId });

    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Automatisch plannen vanuit scripts
 * ------------------------------------------------------------------ */

/** Herkent de videotitels in een scriptdocument (tekst/PDF/Word) via AI. */
export async function extractScriptTitles(input: {
  clientId: string;
  scriptText?: string;
  pdfBase64?: string;
  docxBase64?: string;
}): Promise<{ ok: true; titles: string[] } | { ok: false; message: string }> {
  try {
    const viewer = await requirePermission("calendar:write");
    assertClientAccess(viewer, input.clientId);

    let text = input.scriptText ?? "";
    if (input.docxBase64) {
      const t = await extractDocxText(input.docxBase64);
      if (t) text = `${text}\n\n${t}`.trim();
    }
    if (!text.trim() && !input.pdfBase64) return { ok: false, message: "Plak scripttekst of upload een PDF/Word-bestand." };

    const system = `Je bent de contentplanner van Shortclips. Je haalt de losse videotitels uit een scriptdocument. Geef alleen de titels terug — kort en bruikbaar als publicatietitel, in dezelfde taal als het document. Verzin geen titels die er niet staan.`;
    const user = `Haal alle afzonderlijke videotitels uit het volgende document. Geef UITSLUITEND geldige JSON terug:
{ "titels": ["titel 1", "titel 2"] }

${text.trim() ? `Document:\n\n${text.trim()}` : "Het document is bijgevoegd."}`;

    const res = await runJsonPrompt<{ titels: string[] }>({
      system,
      user,
      documents: input.pdfBase64 ? [{ base64: input.pdfBase64, mediaType: "application/pdf" }] : [],
      maxTokens: 4000,
    });
    if (!res.ok) {
      return { ok: false, message: res.reason === "no_provider" ? "Er is nog geen AI-sleutel ingesteld — zet ANTHROPIC_API_KEY in .env.local." : res.error ?? "Herkennen mislukt." };
    }
    const titles = (res.data.titels ?? []).map((t) => String(t).trim()).filter(Boolean);
    return { ok: true, titles };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Plant meerdere publicaties in één keer; slaat exacte duplicaten (zelfde klant,
 *  titel én datum) over om dubbele publicaties te voorkomen. */
export async function bulkCreateCalendarItems(input: {
  clientId: string;
  items: Array<{ title: string; scheduledOn: string; platforms: string[]; status?: string }>;
}): Promise<{ ok: boolean; message?: string; created?: number; skipped?: number }> {
  try {
    const viewer = await requirePermission("calendar:write");
    assertClientAccess(viewer, input.clientId);
    const items = input.items.filter((i) => i.title.trim() && i.scheduledOn);
    if (items.length === 0) return { ok: false, message: "Geen geldige publicaties om te plannen." };

    // Bestaande (niet-verwijderde) publicaties van deze klant op de betrokken data.
    const dates = [...new Set(items.map((i) => i.scheduledOn))];
    const existing = await db
      .select({ title: contentCalendar.title, scheduledOn: contentCalendar.scheduledOn })
      .from(contentCalendar)
      .where(and(eq(contentCalendar.clientId, input.clientId), isNull(contentCalendar.deletedAt), inArray(contentCalendar.scheduledOn, dates)));
    const seen = new Set(existing.map((e) => `${e.title.toLowerCase()}|${e.scheduledOn}`));

    let created = 0;
    let skipped = 0;
    for (const it of items) {
      const key = `${it.title.trim().toLowerCase()}|${it.scheduledOn}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const platforms = it.platforms.filter((p) => ["instagram", "tiktok", "youtube", "facebook", "linkedin"].includes(p));
      await db.insert(contentCalendar).values({
        clientId: input.clientId,
        title: it.title.trim(),
        scheduledOn: it.scheduledOn,
        platforms,
        status: (it.status as "scheduled") ?? "scheduled",
        ownerId: viewer.id,
      });
      created++;
    }

    await auditLog({ viewer, action: "calendar.bulk_planned", entityType: "client", entityId: input.clientId, clientId: input.clientId, changes: { created, skipped } });
    revalidatePath("/calendar");
    revalidatePath("/portal/planning");
    return { ok: true, created, skipped };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
