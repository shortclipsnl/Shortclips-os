"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { attentionStates, clientFeedback, clients, contracts } from "@/db/schema";
import { assertClientAccess, requireTeamMember } from "@/server/auth/context";
import { notify } from "@/server/notifications";
import { retentionContext } from "@/server/client-retention";
import { nlHolidaySet } from "@/lib/holidays";
import { addWorkingDays } from "@/lib/workdays";
import { FEEDBACK_SOURCES, routeSignal, suggestFeedback } from "@/lib/client-retention";

export type ActionResult = { ok: boolean; message?: string; id?: string };

const feedbackSchema = z.object({
  clientId: z.string().uuid(),
  source: z.enum(FEEDBACK_SOURCES),
  kind: z.enum(["correctie", "aandacht", "ernstig"]),
  category: z.enum(["kwaliteit", "techniek", "resultaten", "samenwerking", "communicatie", "overig"]),
  summary: z.string().trim().min(4, "Vat de feedback kort samen.").max(240),
  quote: z.string().trim().max(2000).optional().or(z.literal("")),
  followUp: z.string().trim().min(4, "Wat is de vervolgactie?").max(500),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  ownerId: z.string().uuid().optional().or(z.literal("")),
  sourceRef: z.string().max(200).optional(),
});

/**
 * Klantfeedback registreren. Normale correcties worden niet geregistreerd
 * (die horen in Frame.io of de scriptcontrole). Een klacht krijgt automatisch
 * een verantwoordelijke en deadline; een ernstig signaal geeft direct één
 * melding aan de verantwoordelijke (of diens vervanger).
 */
export async function registerClientFeedback(input: z.input<typeof feedbackSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer de invoer." };
    const d = parsed.data;
    assertClientAccess(viewer, d.clientId);
    if (d.kind === "correctie") {
      return { ok: false, message: "Een normale correctie hoef je niet te registreren. Verwerk hem gewoon in Frame.io of de scriptcontrole." };
    }

    const [client] = await db.select({ id: clients.id, name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId })
      .from(clients).where(and(eq(clients.id, d.clientId), isNull(clients.deletedAt))).limit(1);
    if (!client) return { ok: false, message: "Klant niet gevonden." };

    const ctx = await retentionContext();
    const coordKey = client.coordinatorId ? ctx.staffKeyById.get(client.coordinatorId) ?? null : null;
    const chosen = d.ownerId ? ctx.staffKeyById.get(d.ownerId) ?? null : null;
    // Vaste eigenaar opslaan; vervanging bij afwezigheid wordt pas bij het tonen
    // en melden toegepast, zodat het punt teruggaat zodra de eigenaar terug is.
    const ownerKey = chosen ?? routeSignal(d.category === "techniek" ? "techniek" : "feedback", coordKey);
    const ownerId = ctx.staff.get(ownerKey) ?? null;
    const actingOwnerId = ctx.ownerFor(ownerKey);
    const holidays = nlHolidaySet();
    const dueOn = d.dueOn || addWorkingDays(ctx.today, d.kind === "ernstig" ? 1 : 2, holidays);

    const [row] = await db.insert(clientFeedback).values({
      clientId: client.id, source: d.source, kind: d.kind, category: d.category, summary: d.summary,
      quote: d.quote || null, followUp: d.followUp, dueOn, ownerId, status: "open",
      suggestion: suggestFeedback(`${d.summary} ${d.quote ?? ""}`), sourceRef: d.sourceRef ?? null, createdById: viewer.id,
    }).returning({ id: clientFeedback.id });

    // Rij op Aandachtspunten alvast aanmaken (vanaf nu telt de opvolgtijd).
    const key = `retentie-feedback-${row.id}`;
    await db.insert(attentionStates).values({
      signalKey: key, title: d.followUp.slice(0, 160), clientId: client.id, clientLabel: client.name, category: "klant",
      priority: d.kind === "ernstig" ? "hoog" : "normaal", reason: d.summary, assigneeId: null,
      // Ernstig: hieronder direct gemeld, dus de gewone ochtendmelding slaat hem over.
      notifiedAt: d.kind === "ernstig" ? new Date() : null,
    }).onConflictDoNothing({ target: attentionStates.signalKey });

    if (d.kind === "ernstig" && actingOwnerId) {
      await notify({
        userIds: [actingOwnerId], clientId: client.id, type: "retention_urgent", level: "critical",
        title: `${client.name}: klantbehoud in gevaar`,
        body: `${d.summary} · Vervolgactie: ${d.followUp}`.slice(0, 300),
        href: `/clients/${client.slug}?tab=klantbehoud`, entityType: "client_feedback", entityId: row.id,
        dedupeKey: `attention:${key}`,
      });
    }

    revalidatePath(`/clients/${client.slug}`);
    revalidatePath("/kwaliteit");
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Registreren mislukt." };
  }
}

/** Feedback afronden vanaf de klantpagina, met wat er is gedaan. */
export async function resolveClientFeedback(input: { id: string; resolution: string }): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const id = z.string().uuid().parse(input.id);
    const resolution = z.string().trim().min(4, "Beschrijf kort wat er is gedaan.").max(500).parse(input.resolution);
    const [f] = await db.select({ clientId: clientFeedback.clientId }).from(clientFeedback).where(eq(clientFeedback.id, id)).limit(1);
    if (!f) return { ok: false, message: "Feedback niet gevonden." };
    assertClientAccess(viewer, f.clientId);
    await db.update(clientFeedback).set({ status: "opgelost", resolvedAt: new Date(), resolvedById: viewer.id, resolution, updatedAt: new Date() })
      .where(eq(clientFeedback.id, id));
    // Het punt op Aandachtspunten loopt mee (notitie + afgerond).
    const key = `retentie-feedback-${id}`;
    const note = { at: new Date().toISOString(), userId: viewer.id, name: viewer.fullName.split(" ")[0], text: resolution };
    await db.insert(attentionStates).values({ signalKey: key, status: "klaar", doneAt: new Date(), doneById: viewer.id, notes: [note] })
      .onConflictDoUpdate({ target: attentionStates.signalKey, set: { status: "klaar", doneAt: new Date(), doneById: viewer.id, updatedAt: new Date() } });
    revalidatePath("/kwaliteit");
    revalidatePath("/clients");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Afronden mislukt." };
  }
}

const contractSchema = z.object({
  clientId: z.string().uuid(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Vul een startdatum in."),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  noticePeriodDays: z.coerce.number().int().min(0).max(365),
  autoRenew: z.boolean(),
  renewalMonths: z.coerce.number().int().min(0).max(60).optional(),
});

/**
 * Contractvoorwaarden vastleggen en als gecontroleerd markeren. Alleen de
 * voorwaarden (data, opzegtermijn, verlenging), geen bedragen: die blijven bij
 * Financieel. Zonder actief contract wordt er een aangemaakt.
 */
export async function saveContractTerms(input: z.input<typeof contractSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const parsed = contractSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer de invoer." };
    const d = parsed.data;
    assertClientAccess(viewer, d.clientId);
    if (d.endsOn && d.endsOn <= d.startsOn) return { ok: false, message: "De einddatum moet na de startdatum liggen." };

    const values = {
      startsOn: d.startsOn, endsOn: d.endsOn || null, noticePeriodDays: d.noticePeriodDays, autoRenew: d.autoRenew,
      ...(d.renewalMonths != null ? { renewalMonths: d.renewalMonths } : {}),
      verifiedAt: new Date(), verifiedById: viewer.id, updatedAt: new Date(),
    };
    const [current] = await db.select({ id: contracts.id }).from(contracts)
      .where(and(eq(contracts.clientId, d.clientId), isNull(contracts.deletedAt), eq(contracts.status, "active")))
      .orderBy(desc(contracts.startsOn)).limit(1);
    if (current) await db.update(contracts).set(values).where(eq(contracts.id, current.id));
    else await db.insert(contracts).values({ clientId: d.clientId, status: "active", ...values });

    const [c] = await db.select({ slug: clients.slug }).from(clients).where(eq(clients.id, d.clientId)).limit(1);
    if (c) revalidatePath(`/clients/${c.slug}`);
    revalidatePath("/kwaliteit");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Opslaan mislukt." };
  }
}
