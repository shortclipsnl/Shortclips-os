"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { videographerContacts, type VideographerContact } from "@/db/schema";
import { ForbiddenError, requireInternal, type Viewer } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { canUseFreelanceVideographers } from "@/server/freelance-videographers-access";
import {
  AVAILABILITY,
  STATUS_KEYS,
  findDuplicate,
  sanitizeProfile,
  type VideographerNote,
  type VideographerStatus,
} from "@/lib/freelance-videographers";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const PATH = "/freelance-videografen";

async function guard(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canUseFreelanceVideographers(viewer)) {
    await auditLog({ viewer, action: "freelance_videographers.denied", entityType: "videographer_contact", outcome: "deny" });
    throw new ForbiddenError("Freelance videografen zijn alleen voor het interne Shortclips team.");
  }
  return viewer;
}

async function load(id: string): Promise<VideographerContact> {
  const [row] = await db.select().from(videographerContacts).where(and(eq(videographerContacts.id, id), isNull(videographerContacts.deletedAt))).limit(1);
  if (!row) throw new ForbiddenError("Freelancer niet gevonden.");
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
    console.error("[freelance-videografen]", error);
    return { ok: false, message: "Opslaan lukte niet. Probeer het opnieuw." };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const touch = (viewerId: string) => ({ updatedById: viewerId, updatedAt: new Date(), lastChangedAt: new Date() });

/** Nieuwe freelance videograaf toevoegen. Een dubbele (nummer, e-mail of volledige naam) wordt geweigerd. */
export async function createVideographer(input: unknown): Promise<Result<{ id: string }>> {
  return run(async () => {
    const viewer = await guard();
    const p = sanitizeProfile(input);
    const existing = await db.select().from(videographerContacts).where(isNull(videographerContacts.deletedAt));
    const dup = findDuplicate({ fullName: p.fullName, phone: p.phone ?? p.whatsapp, email: p.email }, existing);
    if (dup) throw new ForbiddenError(`${dup.match.fullName} staat al in het overzicht (zelfde ${dup.reason}). Open dat profiel om het aan te vullen.`);
    const confirmed = p.availability !== "onbekend";
    const [row] = await db
      .insert(videographerContacts)
      .values({
        ...p,
        availabilityConfirmedAt: confirmed ? sql`current_date` : null,
        availabilityConfirmedById: confirmed ? viewer.id : null,
        source: "handmatig",
        createdById: viewer.id,
        updatedById: viewer.id,
      })
      .returning({ id: videographerContacts.id });
    await auditLog({ viewer, action: "freelance_videographers.create", entityType: "videographer_contact", entityId: row!.id, changes: { fields: ["aangemaakt"], status: p.status } });
    return { id: row!.id };
  });
}

/** Profiel bijwerken. Alleen gewijzigde velden komen in de historie. */
export async function updateVideographer(id: string, input: unknown): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    const cur = await load(id);
    const p = sanitizeProfile(input);
    // Een niet meegestuurde foto laat de bestaande staan; null (bewust verwijderd) wist hem.
    const raw = (input ?? {}) as Record<string, unknown>;
    const next = "photo" in raw ? p : { ...p, photo: cur.photo };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => !same(next[k], cur[k as keyof VideographerContact]));
    if (!changed.length) return {};
    if (changed.some((k) => k === "phone" || k === "whatsapp" || k === "email")) {
      const others = await db.select().from(videographerContacts).where(and(isNull(videographerContacts.deletedAt), sql`${videographerContacts.id} <> ${id}`));
      const dup = findDuplicate({ fullName: "", phone: next.phone ?? next.whatsapp, email: next.email }, others);
      if (dup) throw new ForbiddenError(`Dit ${dup.reason === "telefoon" ? "nummer" : "e-mailadres"} hoort al bij ${dup.match.fullName}.`);
    }
    const availabilityChanged = changed.includes("availability") || changed.includes("availabilityNote");
    await db
      .update(videographerContacts)
      .set({
        ...next,
        ...(availabilityChanged
          ? next.availability === "onbekend"
            ? { availabilityConfirmedAt: null, availabilityConfirmedById: null }
            : { availabilityConfirmedAt: sql`current_date`, availabilityConfirmedById: viewer.id }
          : {}),
        ...touch(viewer.id),
      })
      .where(eq(videographerContacts.id, id));
    await auditLog({
      viewer, action: "freelance_videographers.update", entityType: "videographer_contact", entityId: id,
      changes: { fields: changed, ...(changed.includes("status") ? { status: [cur.status, next.status] } : {}), ...(changed.includes("availability") ? { availability: [cur.availability, next.availability] } : {}) },
    });
    return {};
  });
}

/** Status snel wijzigen (bijv. op niet actief zetten) vanuit het overzicht of profiel. */
export async function setVideographerStatus(id: string, status: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    if (!STATUS_KEYS.includes(status as VideographerStatus)) throw new ForbiddenError("Onbekende status.");
    const cur = await load(id);
    if (cur.status === status) return {};
    await db.update(videographerContacts).set({ status, ...touch(viewer.id) }).where(eq(videographerContacts.id, id));
    await auditLog({ viewer, action: "freelance_videographers.status", entityType: "videographer_contact", entityId: id, changes: { fields: ["status"], status: [cur.status, status] } });
    return {};
  });
}

/**
 * Beschikbaarheid vastleggen na contact met de freelancer. Zet altijd de datum
 * en wie het bevestigde; "onbekend" wist de bevestiging. Nooit automatisch.
 */
export async function confirmVideographerAvailability(id: string, availability: string, note?: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    if (!AVAILABILITY.some((a) => a.key === availability)) throw new ForbiddenError("Onbekende beschikbaarheid.");
    const cur = await load(id);
    const known = availability !== "onbekend";
    await db
      .update(videographerContacts)
      .set({
        availability,
        availabilityNote: typeof note === "string" ? note.trim().slice(0, 300) || null : cur.availabilityNote,
        availabilityConfirmedAt: known ? sql`current_date` : null,
        availabilityConfirmedById: known ? viewer.id : null,
        ...touch(viewer.id),
      })
      .where(eq(videographerContacts.id, id));
    await auditLog({ viewer, action: "freelance_videographers.availability", entityType: "videographer_contact", entityId: id, changes: { fields: ["availability"], availability: [cur.availability, availability] } });
    return {};
  });
}

/** Interne opmerking toevoegen (met naam en datum). */
export async function addVideographerNote(id: string, text: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    const body = (text ?? "").trim().slice(0, 2000);
    if (!body) throw new ForbiddenError("De opmerking is leeg.");
    const cur = await load(id);
    const note: VideographerNote = { id: randomUUID(), at: new Date().toISOString(), byId: viewer.id, byName: viewer.fullName ?? viewer.email, text: body };
    const notes = [...(Array.isArray(cur.notes) ? (cur.notes as VideographerNote[]) : []), note].slice(-200);
    await db.update(videographerContacts).set({ notes, ...touch(viewer.id) }).where(eq(videographerContacts.id, id));
    await auditLog({ viewer, action: "freelance_videographers.note", entityType: "videographer_contact", entityId: id, changes: { fields: ["notes"] } });
    return {};
  });
}

/** Archiveren (zacht verwijderen): verdwijnt uit het overzicht, blijft herleidbaar. Normaal zet je iemand op niet actief. */
export async function archiveVideographer(id: string): Promise<Result> {
  return run(async () => {
    const viewer = await guard();
    await load(id);
    await db.update(videographerContacts).set({ deletedAt: new Date(), updatedById: viewer.id, updatedAt: new Date() }).where(eq(videographerContacts.id, id));
    await auditLog({ viewer, action: "freelance_videographers.archive", entityType: "videographer_contact", entityId: id, changes: { fields: ["gearchiveerd"] } });
    return {};
  });
}
