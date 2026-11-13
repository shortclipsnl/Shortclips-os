"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { editorContacts, type EditorContact } from "@/db/schema";
import { ForbiddenError, requireInternal, type Viewer } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { canUseEditorDatabase } from "@/server/editor-database-access";
import {
  AVAILABILITY,
  CATEGORY_KEYS,
  findDuplicate,
  normalizeEmail,
  normalizeLinks,
  normalizeSpecialisations,
  normalizeUrl,
  sanitizeProfile,
  type EditorCategory,
  type EditorNote,
  type ImportCandidate,
} from "@/lib/editor-database";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const PATH = "/editor-database";

async function guard(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canUseEditorDatabase(viewer)) {
    await auditLog({ viewer, action: "editor_database.denied", entityType: "editor_contact", outcome: "deny" });
    throw new ForbiddenError("De Editor database is alleen voor het interne Shortclips team.");
  }
  return viewer;
}

async function load(id: string): Promise<EditorContact> {
  const [row] = await db.select().from(editorContacts).where(and(eq(editorContacts.id, id), isNull(editorContacts.deletedAt))).limit(1);
  if (!row) throw new ForbiddenError("Editor niet gevonden.");
  return row;
}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const out = await fn();
    revalidatePath(PATH);
    return { ok: true, ...out };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    if (error instanceof Error && /^Vul /.test(error.message)) return { ok: false, message: error.message };
    console.error("[editor-database]", error);
    return { ok: false, message: "Opslaan lukte niet. Probeer het opnieuw." };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Nieuwe editor handmatig toevoegen. */
export async function createEditor(input: unknown): Promise<Result<{ id: string }>> {
  return run(async () => {
    const viewer = await guard();
    const p = sanitizeProfile(input);
    const existing = await db.select().from(editorContacts).where(isNull(editorContacts.deletedAt));
    const dup = findDuplicate({ fullName: p.fullName, phone: p.phone ?? p.whatsapp, email: p.email }, existing);
    if (dup) throw new ForbiddenError(`${dup.match.fullName} staat al in de database (zelfde ${dup.reason}). Open dat profiel om het aan te vullen.`);
    const confirmed = p.availability !== "onbekend";
    const [row] = await db
      .insert(editorContacts)
      .values({
        ...p,
        availabilityConfirmedAt: confirmed ? sql`current_date` : null,
        availabilityConfirmedById: confirmed ? viewer.id : null,
        source: "handmatig",
        createdById: viewer.id,
        updatedById: viewer.id,
      })
      .returning({ id: editorContacts.id });
    await auditLog({ viewer, action: "editor_database.create", entityType: "editor_contact", entityId: row!.id, changes: { fields: ["aangemaakt"], category: p.category } });
    return { id: row!.id };
  });
}

/** Profiel bijwerken. Alleen gewijzigde velden komen in de historie. */
export async function updateEditor(id: string, input: unknown): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    const cur = await load(id);
    const p = sanitizeProfile(input);
    const changed = (Object.keys(p) as (keyof typeof p)[]).filter((k) => !same(p[k], cur[k as keyof EditorContact]));
    if (!changed.length) return {};
    const others = await db.select().from(editorContacts).where(and(isNull(editorContacts.deletedAt), sql`${editorContacts.id} <> ${id}`));
    if (changed.some((k) => k === "phone" || k === "whatsapp" || k === "email")) {
      const dup = findDuplicate({ fullName: "", phone: p.phone ?? p.whatsapp, email: p.email }, others);
      if (dup) throw new ForbiddenError(`Dit ${dup.reason === "telefoon" ? "nummer" : "e-mailadres"} hoort al bij ${dup.match.fullName}.`);
    }
    // Een veld dat het team zelf aanpast, telt als bevestigd.
    const unverified = (Array.isArray(cur.unverifiedFields) ? (cur.unverifiedFields as string[]) : []).filter((f) => !changed.includes(f as keyof typeof p));
    const availabilityChanged = changed.includes("availability") || changed.includes("availabilityNote");
    await db
      .update(editorContacts)
      .set({
        ...p,
        unverifiedFields: unverified,
        ...(availabilityChanged
          ? p.availability === "onbekend"
            ? { availabilityConfirmedAt: null, availabilityConfirmedById: null }
            : { availabilityConfirmedAt: sql`current_date`, availabilityConfirmedById: viewer.id }
          : {}),
        updatedById: viewer.id,
        updatedAt: new Date(),
        lastChangedAt: new Date(),
      })
      .where(eq(editorContacts.id, id));
    await auditLog({
      viewer, action: "editor_database.update", entityType: "editor_contact", entityId: id,
      changes: { fields: changed, ...(changed.includes("category") ? { category: [cur.category, p.category] } : {}), ...(changed.includes("availability") ? { availability: [cur.availability, p.availability] } : {}) },
    });
    return {};
  });
}

/** Categorie snel wijzigen vanuit het overzicht. */
export async function setEditorCategory(id: string, category: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    if (!CATEGORY_KEYS.includes(category as EditorCategory)) throw new ForbiddenError("Onbekende categorie.");
    const cur = await load(id);
    if (cur.category === category) return {};
    const unverified = (Array.isArray(cur.unverifiedFields) ? (cur.unverifiedFields as string[]) : []).filter((f) => f !== "category");
    await db.update(editorContacts).set({ category, unverifiedFields: unverified, updatedById: viewer.id, updatedAt: new Date(), lastChangedAt: new Date() }).where(eq(editorContacts.id, id));
    await auditLog({ viewer, action: "editor_database.category", entityType: "editor_contact", entityId: id, changes: { fields: ["category"], category: [cur.category, category] } });
    return {};
  });
}

/**
 * Beschikbaarheid vastleggen na contact met de editor. Zet altijd de datum en
 * wie het bevestigde; "onbekend" wist de bevestiging.
 */
export async function confirmAvailability(id: string, availability: string, note?: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    if (!AVAILABILITY.some((a) => a.key === availability)) throw new ForbiddenError("Onbekende beschikbaarheid.");
    const cur = await load(id);
    const known = availability !== "onbekend";
    const unverified = (Array.isArray(cur.unverifiedFields) ? (cur.unverifiedFields as string[]) : []).filter((f) => f !== "availability");
    await db
      .update(editorContacts)
      .set({
        availability,
        availabilityNote: typeof note === "string" ? note.trim().slice(0, 300) || null : cur.availabilityNote,
        availabilityConfirmedAt: known ? sql`current_date` : null,
        availabilityConfirmedById: known ? viewer.id : null,
        unverifiedFields: unverified,
        updatedById: viewer.id,
        updatedAt: new Date(),
        lastChangedAt: new Date(),
      })
      .where(eq(editorContacts.id, id));
    await auditLog({ viewer, action: "editor_database.availability", entityType: "editor_contact", entityId: id, changes: { fields: ["availability"], availability: [cur.availability, availability] } });
    return {};
  });
}

/** Favoriet voor het hele team (snel terug te vinden bij spoed). */
export async function toggleEditorFavorite(id: string): Promise<Result<{ favorite: boolean }>> {
  return run(async () => {
    const viewer = await guard();
    const cur = await load(id);
    const favorite = !cur.favorite;
    await db.update(editorContacts).set({ favorite, updatedById: viewer.id, updatedAt: new Date() }).where(eq(editorContacts.id, id));
    await auditLog({ viewer, action: "editor_database.favorite", entityType: "editor_contact", entityId: id, changes: { fields: ["favorite"], favorite } });
    return { favorite };
  });
}

/** Opmerking van het team toevoegen (met naam en datum). */
export async function addEditorNote(id: string, text: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    const body = (text ?? "").trim().slice(0, 2000);
    if (!body) throw new ForbiddenError("De opmerking is leeg.");
    const cur = await load(id);
    const note: EditorNote = { id: randomUUID(), at: new Date().toISOString(), byId: viewer.id, byName: viewer.fullName ?? viewer.email, text: body };
    const notes = [...(Array.isArray(cur.notes) ? (cur.notes as EditorNote[]) : []), note].slice(-200);
    await db.update(editorContacts).set({ notes, updatedById: viewer.id, updatedAt: new Date(), lastChangedAt: new Date() }).where(eq(editorContacts.id, id));
    await auditLog({ viewer, action: "editor_database.note", entityType: "editor_contact", entityId: id, changes: { fields: ["notes"] } });
    return {};
  });
}

/** Geïmporteerde gegevens als gecontroleerd markeren. */
export async function markEditorVerified(id: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    await load(id);
    await db.update(editorContacts).set({ unverifiedFields: [], updatedById: viewer.id, updatedAt: new Date(), lastChangedAt: new Date() }).where(eq(editorContacts.id, id));
    await auditLog({ viewer, action: "editor_database.verified", entityType: "editor_contact", entityId: id, changes: { fields: ["gecontroleerd"] } });
    return {};
  });
}

/** Archiveren (zacht verwijderen): verdwijnt uit het overzicht, blijft herleidbaar. */
export async function archiveEditor(id: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    await load(id);
    await db.update(editorContacts).set({ deletedAt: new Date(), updatedById: viewer.id, updatedAt: new Date() }).where(eq(editorContacts.id, id));
    await auditLog({ viewer, action: "editor_database.archive", entityType: "editor_contact", entityId: id, changes: { fields: ["gearchiveerd"] } });
    return {};
  });
}

export type ImportSummary = { created: number; enriched: number; skipped: number };

/**
 * Contacten importeren (WhatsApp-contactexport als vCard, CSV of geplakte
 * lijst). Bestaande editors worden niet gedupliceerd: alleen lege velden
 * worden aangevuld. Alles uit een import staat als "nog te controleren".
 */
export async function importEditors(input: { candidates: ImportCandidate[]; category: string; sourceLabel: string; source: "whatsapp_export" | "csv_import" }): Promise<Result<ImportSummary>> {
  return run(async () => {
    const viewer = await guard();
    const category = CATEGORY_KEYS.includes(input.category as EditorCategory) ? input.category : "potentieel";
    const source = input.source === "whatsapp_export" ? "whatsapp_export" : "csv_import";
    const sourceLabel = (input.sourceLabel ?? "").trim().slice(0, 120) || (source === "whatsapp_export" ? "WhatsApp Business export" : "Import");
    const list = Array.isArray(input.candidates) ? input.candidates.slice(0, 500) : [];
    const existing = await db.select().from(editorContacts).where(isNull(editorContacts.deletedAt));
    const summary: ImportSummary = { created: 0, enriched: 0, skipped: 0 };
    const now = new Date().toISOString();

    for (const raw of list) {
      const fullName = typeof raw?.fullName === "string" ? raw.fullName.trim().slice(0, 160) : "";
      const c = {
        fullName,
        phone: typeof raw?.phone === "string" ? raw.phone.trim().slice(0, 40) || null : null,
        email: normalizeEmail(raw?.email),
        portfolioUrl: normalizeUrl(raw?.portfolioUrl),
        links: normalizeLinks(raw?.links),
        specialisations: normalizeSpecialisations(raw?.specialisations),
        ratePerVideo: typeof raw?.ratePerVideo === "number" && raw.ratePerVideo > 0 ? Math.round(raw.ratePerVideo) : null,
        note: typeof raw?.note === "string" ? raw.note.trim().slice(0, 1000) || null : null,
      };
      if (!c.fullName && !c.phone && !c.email) { summary.skipped++; continue; }
      const importNote: EditorNote[] = c.note ? [{ id: randomUUID(), at: now, byId: viewer.id, byName: `Import (${sourceLabel})`, text: c.note }] : [];
      const dup = findDuplicate(c, existing);

      if (dup) {
        const e = dup.match;
        const fill: Partial<EditorContact> = {};
        const filled: string[] = [];
        if (!e.phone && !e.whatsapp && c.phone) { fill.phone = c.phone; filled.push("phone"); }
        if (!e.email && c.email) { fill.email = c.email; filled.push("email"); }
        if (!e.portfolioUrl && c.portfolioUrl) { fill.portfolioUrl = c.portfolioUrl; filled.push("portfolioUrl"); }
        const curLinks = normalizeLinks(e.links);
        const newLinks = c.links.filter((l) => !curLinks.some((x) => x.url === l.url) && l.url !== e.portfolioUrl);
        if (newLinks.length) { fill.links = [...curLinks, ...newLinks]; filled.push("links"); }
        const curSpecs = normalizeSpecialisations(e.specialisations);
        const specs = normalizeSpecialisations([...curSpecs, ...c.specialisations]);
        if (specs.length > curSpecs.length) { fill.specialisations = specs; filled.push("specialisations"); }
        if (e.ratePerVideo == null && c.ratePerVideo) { fill.ratePerVideo = c.ratePerVideo; filled.push("ratePerVideo"); }
        if (importNote.length) { fill.notes = [...(Array.isArray(e.notes) ? (e.notes as EditorNote[]) : []), ...importNote]; filled.push("notes"); }
        if (!filled.length) { summary.skipped++; continue; }
        const unverified = Array.from(new Set([...(Array.isArray(e.unverifiedFields) ? (e.unverifiedFields as string[]) : []), ...filled.filter((f) => f !== "notes")]));
        await db.update(editorContacts).set({ ...fill, unverifiedFields: unverified, updatedById: viewer.id, updatedAt: new Date(), lastChangedAt: new Date() }).where(eq(editorContacts.id, e.id));
        Object.assign(e, fill);
        await auditLog({ viewer, action: "editor_database.import_enrich", entityType: "editor_contact", entityId: e.id, changes: { fields: filled, source: sourceLabel } });
        summary.enriched++;
        continue;
      }

      const unverified = [
        "fullName",
        ...(c.phone ? ["phone"] : []),
        ...(c.email ? ["email"] : []),
        ...(c.portfolioUrl ? ["portfolioUrl"] : []),
        ...(c.specialisations.length ? ["specialisations"] : []),
        ...(c.ratePerVideo ? ["ratePerVideo"] : []),
        "category",
      ];
      const [row] = await db
        .insert(editorContacts)
        .values({
          fullName: c.fullName || c.phone || c.email || "Onbekende naam",
          phone: c.phone,
          email: c.email,
          portfolioUrl: c.portfolioUrl,
          links: c.links,
          specialisations: c.specialisations,
          ratePerVideo: c.ratePerVideo,
          category,
          workedWithUs: category === "actief" || category === "backup" ? "ja" : category === "potentieel" ? "nee" : "onbekend",
          notes: importNote,
          unverifiedFields: unverified,
          source,
          sourceLabel,
          createdById: viewer.id,
          updatedById: viewer.id,
        })
        .returning();
      existing.push(row!);
      await auditLog({ viewer, action: "editor_database.import_create", entityType: "editor_contact", entityId: row!.id, changes: { fields: ["aangemaakt via import"], source: sourceLabel, category } });
      summary.created++;
    }
    return summary;
  });
}
