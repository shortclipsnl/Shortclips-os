"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { attentionStates, clientFeedback, clients, type AttentionNote } from "@/db/schema";
import { requireTeamMember } from "@/server/auth/context";
import { notify, clearByDedupe } from "@/server/notifications";
import { listAttentionTeam } from "@/server/attention";

export type ActionResult = { ok: boolean; message?: string };

const PATH = "/kwaliteit";
const key = z.string().min(1).max(200);
const dedupe = (k: string) => `attention:${k}`;

/** Zorgt dat er een rij bestaat (handmatige punten en signalen hebben die al, maar voor de zekerheid). */
async function ensureRow(signalKey: string) {
  await db.insert(attentionStates).values({ signalKey }).onConflictDoNothing({ target: attentionStates.signalKey });
}

/** Status zetten: open, bezig (opgepakt) of klaar (afgerond). */
export async function setAttentionStatus(input: { key: string; status: "open" | "bezig" | "klaar" }): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const k = key.parse(input.key);
    const status = z.enum(["open", "bezig", "klaar"]).parse(input.status);
    await ensureRow(k);
    // Klantbehoud: afronden kan pas als de verbeteractie of afspraak is vastgelegd.
    // Zo blijft altijd terug te lezen wat er met een signaal is gedaan.
    const retention = /^retentie-(resultaten|feedback|contract)-/.test(k);
    const [row] = await db.select({ notes: attentionStates.notes }).from(attentionStates).where(eq(attentionStates.signalKey, k)).limit(1);
    if (retention && status === "klaar" && !(row?.notes ?? []).length) {
      return { ok: false, message: "Leg eerst als notitie vast welke verbeteractie of afspraak er is, dan kun je afronden." };
    }
    await db.update(attentionStates).set({
      status,
      doneAt: status === "klaar" ? new Date() : null,
      doneById: status === "klaar" ? viewer.id : null,
      // Oppakken = jij bent verantwoordelijk.
      ...(status === "bezig" ? { assigneeId: viewer.id } : {}),
      updatedAt: new Date(),
    }).where(eq(attentionStates.signalKey, k));
    if (status === "klaar") await clearByDedupe(dedupe(k));
    // Een klacht die hier wordt opgepakt of afgerond, loopt mee in de registratie.
    const fb = k.match(/^retentie-feedback-([0-9a-f-]{36})$/);
    if (fb) {
      const last = (row?.notes ?? []).at(-1)?.text ?? null;
      await db.update(clientFeedback).set(
        status === "klaar"
          ? { status: "opgelost", resolvedAt: new Date(), resolvedById: viewer.id, resolution: last, updatedAt: new Date() }
          : { status: status === "bezig" ? "opgepakt" : "open", resolvedAt: null, resolvedById: null, updatedAt: new Date() },
      ).where(eq(clientFeedback.id, fb[1]));
    }
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Opslaan mislukt." };
  }
}

/** Toewijzen aan een teamlid. De nieuwe verantwoordelijke krijgt een melding. */
export async function assignAttention(input: { key: string; userId: string; title: string; href?: string | null }): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const k = key.parse(input.key);
    const team = await listAttentionTeam();
    const to = team.find((t) => t.id === input.userId);
    if (!to) return { ok: false, message: "Onbekend teamlid." };
    await ensureRow(k);
    await db.update(attentionStates).set({ assigneeId: to.id, updatedAt: new Date() }).where(eq(attentionStates.signalKey, k));
    if (to.id !== viewer.id) {
      await clearByDedupe(dedupe(k));
      await notify({
        userIds: [to.id], type: "attention_assigned", level: "info",
        title: `${viewer.fullName.split(" ")[0]} heeft een aandachtspunt aan je toegewezen`,
        body: input.title.slice(0, 200), href: "/kwaliteit", dedupeKey: dedupe(k),
      });
    }
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Toewijzen mislukt." };
  }
}

/** Notitie toevoegen ("klant gebeld, belt donderdag terug"). */
export async function addAttentionNote(input: { key: string; text: string }): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const k = key.parse(input.key);
    const text = z.string().trim().min(1).max(500).parse(input.text);
    await ensureRow(k);
    const note: AttentionNote = { at: new Date().toISOString(), userId: viewer.id, name: viewer.fullName.split(" ")[0], text };
    await db.update(attentionStates).set({
      notes: sql`${attentionStates.notes} || ${JSON.stringify([note])}::jsonb`,
      updatedAt: new Date(),
    }).where(eq(attentionStates.signalKey, k));
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Notitie opslaan mislukt." };
  }
}

const manualSchema = z.object({
  client: z.string().trim().min(1, "Vul een klant of afdeling in.").max(160),
  title: z.string().trim().min(2, "Wat moet er gebeuren?").max(160),
  area: z.enum(["editing", "klant", "opname", "script", "resultaat", "overig"]),
  priority: z.enum(["hoog", "normaal", "laag"]),
  assigneeId: z.string().uuid(),
});

/** Handmatig aandachtspunt, voor dingen die het systeem niet zelf signaleert. */
export async function createAttentionItem(input: z.input<typeof manualSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const parsed = manualSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    const d = parsed.data;
    const team = await listAttentionTeam();
    if (!team.some((t) => t.id === d.assigneeId)) return { ok: false, message: "Onbekend teamlid." };
    const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients)
      .where(sql`lower(${clients.name}) = lower(${d.client})`).limit(1);
    const k = `manual-${crypto.randomUUID()}`;
    await db.insert(attentionStates).values({
      signalKey: k, manual: "true", title: d.title, clientId: client?.id ?? null, clientLabel: client?.name ?? d.client,
      category: d.area, priority: d.priority, assigneeId: d.assigneeId, createdById: viewer.id,
      reason: `Handmatig toegevoegd door ${viewer.fullName.split(" ")[0]}`, notifiedAt: new Date(),
    });
    if (d.assigneeId !== viewer.id) {
      await notify({
        userIds: [d.assigneeId], clientId: client?.id ?? null, type: "attention_assigned", level: d.priority === "hoog" ? "warning" : "info",
        title: `Nieuw aandachtspunt van ${viewer.fullName.split(" ")[0]}`,
        body: `${client?.name ?? d.client} · ${d.title}`, href: "/kwaliteit", dedupeKey: dedupe(k),
      });
    }
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Toevoegen mislukt." };
  }
}
