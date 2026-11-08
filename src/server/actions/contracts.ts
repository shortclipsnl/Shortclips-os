"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { attentionStates, clients, contracts } from "@/db/schema";
import { requireOwner } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { syncContractPeriods } from "@/server/contracts";
import { addDays, endDateFor } from "@/lib/contracts";

/**
 * Contracten & Verlengingen: alle wijzigingen. Uitsluitend voor de eigenaar;
 * elke actie controleert dat zelf (requireOwner), los van de pagina.
 */

export type ActionResult = { ok: boolean; message?: string; id?: string };

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ongeldige datum.");
const optDate = dateStr.optional().or(z.literal("")).transform((v) => v || null);
const optInt = (max: number) =>
  z.union([z.coerce.number().int().min(0).max(max), z.literal(""), z.null()]).optional().transform((v) => (v === "" || v == null ? null : v));
const money = z.coerce.number().min(0, "Het maandbedrag kan niet negatief zijn.").max(1_000_000);
// Herinneringsmomenten in dagen vóór het beslismoment; 0 telt niet (dat is
// het beslismoment zelf, waarvoor al een melding bestaat). Leeg = standaard.
const reminders = z.array(z.coerce.number().int().min(0).max(365)).max(8).optional().nullable()
  .transform((v) => { const list = [...new Set((v ?? []).filter((n) => n > 0))].sort((a, b) => b - a); return list.length ? list : null; });

const termsSchema = z.object({
  startsOn: optDate,
  endsOn: optDate,
  durationMonths: optInt(120),
  monthlyValue: money,
  videosPerMonth: optInt(500),
  autoRenew: z.boolean(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365),
  clientConfirmed: z.boolean().optional().default(false),
  reminderDays: reminders,
  notes: z.string().max(4000).optional().nullable().transform((v) => (v?.trim() ? v.trim() : null)),
});

type Terms = z.output<typeof termsSchema>;

/** Einddatum aanvullen uit start + looptijd; controle op logische datums. */
function normalise(t: Terms): { ok: true; t: Terms } | { ok: false; message: string } {
  const out = { ...t };
  if (!out.endsOn && out.startsOn && out.durationMonths) out.endsOn = endDateFor(out.startsOn, out.durationMonths);
  if (out.startsOn && out.endsOn && out.endsOn < out.startsOn) return { ok: false, message: "De einddatum moet na de startdatum liggen." };
  return { ok: true, t: out };
}

const termValues = (t: Terms) => ({
  startsOn: t.startsOn,
  endsOn: t.endsOn,
  durationMonths: t.durationMonths,
  monthlyValue: t.monthlyValue.toFixed(2),
  videosPerMonth: t.videosPerMonth,
  autoRenew: t.autoRenew,
  noticePeriodDays: t.noticePeriodDays,
  clientConfirmed: t.clientConfirmed,
  reminderDays: t.reminderDays,
  notes: t.notes,
});

function fail(e: unknown, fallback: string): ActionResult {
  if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? fallback };
  return { ok: false, message: e instanceof Error ? e.message : fallback };
}

function refresh(slug?: string | null) {
  revalidatePath("/contracten");
  revalidatePath("/dashboard");
  if (slug) {
    revalidatePath(`/contracten/${slug}`);
    revalidatePath(`/clients/${slug}`);
  }
}

async function clientOf(id: string) {
  const [c] = await db.select({ id: clients.id, slug: clients.slug }).from(clients).where(eq(clients.id, id)).limit(1);
  return c ?? null;
}

async function contractOf(id: string) {
  const [k] = await db.select().from(contracts).where(and(eq(contracts.id, id), isNull(contracts.deletedAt))).limit(1);
  return k ?? null;
}

/**
 * Een contractperiode vastleggen of corrigeren. Zonder contractId wordt er een
 * nieuwe (lopende) periode aangemaakt. Wat de eigenaar vastlegt geldt als
 * gecontroleerd en is daarna beschermd tegen wijzigingen door teamleden.
 */
export async function saveContract(input: z.input<typeof termsSchema> & { clientId: string; contractId?: string | null }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const clientId = z.string().uuid().parse(input.clientId);
    const n = normalise(termsSchema.parse(input));
    if (!n.ok) return n;
    const c = await clientOf(clientId);
    if (!c) return { ok: false, message: "Klant niet gevonden." };

    const values = { ...termValues(n.t), ownerManaged: true, verifiedAt: new Date(), verifiedById: viewer.id, updatedAt: new Date() };
    let id: string;
    if (input.contractId) {
      const k = await contractOf(z.string().uuid().parse(input.contractId));
      if (!k || k.clientId !== clientId) return { ok: false, message: "Contract niet gevonden." };
      await db.update(contracts).set(values).where(eq(contracts.id, k.id));
      id = k.id;
    } else {
      const [row] = await db.insert(contracts).values({ clientId, status: "active", ...values }).returning({ id: contracts.id });
      id = row!.id;
    }
    await auditLog({ viewer, action: input.contractId ? "contract.updated" : "contract.created", entityType: "contract", entityId: id, clientId, changes: termValues(n.t) });
    await syncContractPeriods();
    refresh(c.slug);
    return { ok: true, id };
  } catch (e) {
    return fail(e, "Opslaan mislukt.");
  }
}

/**
 * Verlengen: een nieuwe periode na (of tijdens) de huidige. De vorige periode
 * blijft bewaard als historie. Begint de verlenging eerder dan de oude
 * einddatum (tussentijds verlengen of nieuw maandbedrag), dan eindigt de oude
 * periode de dag ervoor, zodat geen maand dubbel telt.
 */
export async function renewContract(input: z.input<typeof termsSchema> & { contractId: string }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const old = await contractOf(z.string().uuid().parse(input.contractId));
    if (!old) return { ok: false, message: "Contract niet gevonden." };
    const parsed = termsSchema.parse(input);
    const oldEnd = old.endsOn ? String(old.endsOn).slice(0, 10) : null;
    const oldStart = old.startsOn ? String(old.startsOn).slice(0, 10) : null;
    if (!parsed.startsOn) {
      if (!oldEnd) return { ok: false, message: "Vul de startdatum van de verlenging in: de huidige einddatum is onbekend." };
      parsed.startsOn = addDays(oldEnd, 1);
    }
    if (!parsed.durationMonths && !parsed.endsOn) return { ok: false, message: "Kies een looptijd of vul een einddatum in." };
    const n = normalise(parsed);
    if (!n.ok) return n;
    const start = n.t.startsOn!;
    if (oldStart && start <= oldStart) return { ok: false, message: "De verlenging moet na de start van de huidige periode beginnen." };

    const c = await clientOf(old.clientId);
    const [row] = await db.insert(contracts).values({
      clientId: old.clientId, status: "active", ...termValues(n.t), previousContractId: old.id, renewalStatus: "open",
      ownerManaged: true, verifiedAt: new Date(), verifiedById: viewer.id,
    }).returning({ id: contracts.id });

    // De vorige periode: afgesloten als historie. Status "expired" zorgt dat
    // bestaande signaleringen alleen nog naar de nieuwe einddatum kijken.
    const truncate = !oldEnd || oldEnd >= start;
    await db.update(contracts).set({
      status: "expired", renewalStatus: "verlengd", clientConfirmed: true, ownerManaged: true,
      ...(truncate ? { endsOn: addDays(start, -1) } : {}),
      verifiedAt: old.verifiedAt ?? new Date(), verifiedById: old.verifiedById ?? viewer.id, updatedAt: new Date(),
    }).where(eq(contracts.id, old.id));

    await auditLog({ viewer, action: "contract.renewed", entityType: "contract", entityId: row!.id, clientId: old.clientId, changes: { previous: old.id, ...termValues(n.t) } });
    await syncContractPeriods();
    refresh(c?.slug);
    return { ok: true, id: row!.id };
  } catch (e) {
    return fail(e, "Verlengen mislukt.");
  }
}

/** Commerciële status: nog niet besproken of in bespreking (verlengd en beëindigd hebben een eigen actie). */
export async function setRenewalStatus(input: { contractId: string; status: "open" | "in_bespreking"; clientConfirmed?: boolean }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const k = await contractOf(z.string().uuid().parse(input.contractId));
    if (!k) return { ok: false, message: "Contract niet gevonden." };
    const status = z.enum(["open", "in_bespreking"]).parse(input.status);
    await db.update(contracts).set({
      renewalStatus: status, ...(input.clientConfirmed != null ? { clientConfirmed: input.clientConfirmed } : {}), updatedAt: new Date(),
    }).where(eq(contracts.id, k.id));
    await auditLog({ viewer, action: "contract.renewal_status", entityType: "contract", entityId: k.id, clientId: k.clientId, changes: { status } });
    refresh((await clientOf(k.clientId))?.slug);
    return { ok: true };
  } catch (e) {
    return fail(e, "Bijwerken mislukt.");
  }
}

const endSchema = z.object({
  contractId: z.string().uuid(),
  endsOn: dateStr,
  endReason: z.string().max(1000).optional().nullable().transform((v) => (v?.trim() ? v.trim() : null)),
  reactivation: z.enum(["kansrijk", "misschien", "nee"]).optional().nullable().or(z.literal("")).transform((v) => v || null),
});

/**
 * Beëindigen: de klant stopt per de einddatum. Tot die datum blijft de klant
 * gewoon actief; daarna gaat hij automatisch naar Niet actief.
 */
export async function endContract(input: z.input<typeof endSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const d = endSchema.parse(input);
    const k = await contractOf(d.contractId);
    if (!k) return { ok: false, message: "Contract niet gevonden." };
    const start = k.startsOn ? String(k.startsOn).slice(0, 10) : null;
    if (start && d.endsOn < start) return { ok: false, message: "De einddatum ligt voor de start van het contract." };
    await db.update(contracts).set({
      renewalStatus: "beeindigd", endsOn: d.endsOn, endReason: d.endReason, reactivation: d.reactivation,
      clientConfirmed: false, ownerManaged: true, verifiedAt: k.verifiedAt ?? new Date(), verifiedById: k.verifiedById ?? viewer.id,
      updatedAt: new Date(),
    }).where(eq(contracts.id, k.id));
    await auditLog({ viewer, action: "contract.ended", entityType: "contract", entityId: k.id, clientId: k.clientId, changes: { endsOn: d.endsOn, endReason: d.endReason, reactivation: d.reactivation } });
    await syncContractPeriods();
    refresh((await clientOf(k.clientId))?.slug);
    return { ok: true };
  } catch (e) {
    return fail(e, "Beëindigen mislukt.");
  }
}

/** Beëindiging terugdraaien (klant gaat toch door): verlengstatus weer open. */
export async function undoEnd(input: { contractId: string }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const k = await contractOf(z.string().uuid().parse(input.contractId));
    if (!k) return { ok: false, message: "Contract niet gevonden." };
    if (k.status === "terminated") return { ok: false, message: "Deze samenwerking is al afgesloten. Leg een nieuw contract vast." };
    await db.update(contracts).set({ renewalStatus: "open", endReason: null, reactivation: null, updatedAt: new Date() }).where(eq(contracts.id, k.id));
    await auditLog({ viewer, action: "contract.end_undone", entityType: "contract", entityId: k.id, clientId: k.clientId });
    refresh((await clientOf(k.clientId))?.slug);
    return { ok: true };
  } catch (e) {
    return fail(e, "Terugdraaien mislukt.");
  }
}

/** Heractivatie-inschatting en reden bijwerken bij een gestopte klant. */
export async function updateEndNotes(input: { contractId: string; endReason?: string | null; reactivation?: string | null }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const k = await contractOf(z.string().uuid().parse(input.contractId));
    if (!k) return { ok: false, message: "Contract niet gevonden." };
    const reactivation = z.enum(["kansrijk", "misschien", "nee"]).nullable().parse(input.reactivation || null);
    const endReason = input.endReason?.trim() ? input.endReason.trim().slice(0, 1000) : null;
    await db.update(contracts).set({ endReason, reactivation, updatedAt: new Date() }).where(eq(contracts.id, k.id));
    await auditLog({ viewer, action: "contract.end_notes", entityType: "contract", entityId: k.id, clientId: k.clientId });
    refresh((await clientOf(k.clientId))?.slug);
    return { ok: true };
  } catch (e) {
    return fail(e, "Opslaan mislukt.");
  }
}

/**
 * Een herinnering afhandelen. Dezelfde fase komt niet terug; de volgende fase
 * (of een nieuwe einddatum) wel.
 */
export async function handleContractAttention(input: { key: string; clientId?: string | null }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const key = z.string().regex(/^contract-owner:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}:[a-z0-9_]+$/).parse(input.key);
    await db.insert(attentionStates)
      .values({ signalKey: key, status: "klaar", doneAt: new Date(), doneById: viewer.id, clientId: input.clientId ?? null })
      .onConflictDoUpdate({ target: attentionStates.signalKey, set: { status: "klaar", doneAt: new Date(), doneById: viewer.id, updatedAt: new Date() } });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e, "Afhandelen mislukt.");
  }
}

/** Gegevens als gecontroleerd markeren zonder iets te wijzigen. */
export async function verifyContract(input: { contractId: string }): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const k = await contractOf(z.string().uuid().parse(input.contractId));
    if (!k) return { ok: false, message: "Contract niet gevonden." };
    await db.update(contracts).set({ verifiedAt: new Date(), verifiedById: viewer.id, ownerManaged: true, updatedAt: new Date() }).where(eq(contracts.id, k.id));
    await auditLog({ viewer, action: "contract.verified", entityType: "contract", entityId: k.id, clientId: k.clientId });
    refresh((await clientOf(k.clientId))?.slug);
    return { ok: true };
  } catch (e) {
    return fail(e, "Bijwerken mislukt.");
  }
}
