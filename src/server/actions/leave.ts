"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { leaveRequests, users } from "@/db/schema";
import { requireInternal, ForbiddenError } from "@/server/auth/context";
import { notify } from "@/server/notifications";
import { dispatch } from "@/server/automation";

export type ActionResult = { ok: boolean; message?: string };

// Een ziekmelding is géén verlofsoort en staat hier bewust niet tussen.
const KINDS = ["vakantie", "vrije dag", "bijzonder verlof"] as const;

const requestSchema = z.object({
  startOn: z.string().min(8, "Kies een startdatum."),
  endOn: z.string().min(8, "Kies een einddatum."),
  kind: z.enum(KINDS).default("vakantie"),
  note: z.string().trim().max(500).optional(),
});

/** Verlof aanvragen voor jezelf. */
export async function requestLeave(input: z.input<typeof requestSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    if (parsed.data.endOn < parsed.data.startOn) return { ok: false, message: "De einddatum ligt vóór de startdatum." };

    const [created] = await db
      .insert(leaveRequests)
      .values({
        userId: viewer.id,
        startOn: parsed.data.startOn,
        endOn: parsed.data.endOn,
        kind: parsed.data.kind,
        note: parsed.data.note || null,
        status: "requested",
      })
      .returning({ id: leaveRequests.id });

    // Meld de goedkeurders (team:write) dat er een aanvraag open staat.
    await notify({
      roles: ["owner"],
      type: "leave_requested",
      level: "info",
      title: `Verlofaanvraag van ${viewer.fullName}`,
      body: `${parsed.data.kind}: ${parsed.data.startOn} t/m ${parsed.data.endOn}`,
      href: "/verlof",
      entityType: "leave_request",
      entityId: created!.id,
      dedupeKey: `leave_requested:${created!.id}`,
    });

    revalidatePath("/verlof");
    return { ok: true, message: "Aanvraag ingediend." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const sickSchema = z.object({
  startOn: z.string().min(8, "Kies een startdatum."),
  endOn: z.string().min(8, "Kies een einddatum."),
});

/**
 * Ziek melden voor jezelf. Een ziekmelding is iets anders dan een verlofaanvraag:
 * er is geen reden nodig, hij hoeft niet goedgekeurd te worden (direct geregeld),
 * en collega's zien hem niet. Alleen de eigenaar wordt op de hoogte gebracht,
 * zodat lopend werk kan worden overgenomen.
 */
export async function reportSick(input: z.input<typeof sickSchema>): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const parsed = sickSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
    if (parsed.data.endOn < parsed.data.startOn) return { ok: false, message: "De einddatum ligt vóór de startdatum." };

    const [created] = await db
      .insert(leaveRequests)
      .values({
        userId: viewer.id,
        startOn: parsed.data.startOn,
        endOn: parsed.data.endOn,
        kind: "ziek",
        note: null,
        // Direct geregistreerd: een ziekmelding wordt niet "goedgekeurd".
        status: "approved",
        reviewedAt: new Date(),
      })
      .returning({ id: leaveRequests.id });

    await notify({
      roles: ["owner"],
      type: "sick_reported",
      level: "warning",
      title: `Ziekmelding: ${viewer.fullName}`,
      body: `${parsed.data.startOn} t/m ${parsed.data.endOn} — bekijk de overdracht op /verlof`,
      href: "/verlof",
      entityType: "leave_request",
      entityId: created!.id,
      dedupeKey: `sick_reported:${created!.id}`,
    });

    revalidatePath("/verlof");
    return { ok: true, message: "Ziekmelding doorgegeven. Beterschap!" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Het totaal aantal vakantieuren (contract) van een teamlid zetten — eigenaar. */
export async function setLeaveHours(userId: string, hours: number): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    if (viewer.primaryRole !== "owner") return { ok: false, message: "Alleen Jarno kan de vakantieuren aanpassen." };
    const h = Math.max(0, Math.min(2000, Math.round(hours)));
    await db.update(users).set({ leaveHoursTotal: h, updatedAt: new Date() }).where(eq(users.id, userId));
    revalidatePath("/verlof");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Een aanvraag goedkeuren of afwijzen — uitsluitend door de eigenaar (Jarno). */
export async function reviewLeave(id: string, decision: "approved" | "rejected"): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    if (viewer.primaryRole !== "owner") return { ok: false, message: "Alleen Jarno kan verlof goedkeuren of afwijzen." };
    const [req] = await db
      .select({ id: leaveRequests.id, userId: leaveRequests.userId, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn })
      .from(leaveRequests)
      .where(eq(leaveRequests.id, id))
      .limit(1);
    if (!req) return { ok: false, message: "Aanvraag niet gevonden." };

    await db
      .update(leaveRequests)
      .set({ status: decision, reviewedById: viewer.id, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(leaveRequests.id, id));

    await notify({
      userIds: [req.userId],
      type: "leave_reviewed",
      level: decision === "approved" ? "success" : "warning",
      title: decision === "approved" ? "Verlof goedgekeurd" : "Verlof afgewezen",
      body: `${req.startOn} t/m ${req.endOn}`,
      href: "/verlof",
      entityType: "leave_request",
      entityId: id,
      dedupeKey: `leave_reviewed:${id}:${decision}`,
    });

    // Bij goedkeuring: capaciteit daalt → automatisering (eigenaar waarschuwen).
    if (decision === "approved") {
      await dispatch({ trigger: "leave.approved", entityType: "leave_request", entityId: id, data: { to: "approved", href: "/verlof" } });
    }

    revalidatePath("/verlof");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Eigen aanvraag intrekken (of door een beheerder). */
export async function cancelLeave(id: string): Promise<ActionResult> {
  try {
    const viewer = await requireInternal();
    const [req] = await db.select({ userId: leaveRequests.userId }).from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
    if (!req) return { ok: false, message: "Aanvraag niet gevonden." };
    if (req.userId !== viewer.id && !viewer.permissions.has("team:write")) {
      return { ok: false, message: "Je kunt alleen je eigen aanvraag intrekken." };
    }
    await db.delete(leaveRequests).where(and(eq(leaveRequests.id, id)));
    revalidatePath("/verlof");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
