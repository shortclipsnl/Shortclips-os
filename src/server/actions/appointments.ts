"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calendarEvents,
  clients,
  deliverables,
  mondayMappings,
  productionDays,
  users,
} from "@/db/schema";
import { ForbiddenError, requireOwner } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { firstNameKey } from "@/lib/editors";

export type ActionResult<T = unknown> = { ok: boolean; message?: string; data?: T };

/**
 * Handmatig een agenda-afspraak uit de review-lijst aan een klant koppelen.
 *
 * De sync koppelt bewust niet "op goed geluk" (nooit stilletjes bij de verkeerde
 * klant), waardoor opnames zonder herkende klant in de review blijven hangen en
 * niet op de editing-boards komen. Deze actie laat de owner dat in één klik
 * rechtzetten: de afspraak wordt als opname aan de klant gehangen (confidence
 * 'manual', zodat een volgende sync 'm met rust laat) en meteen afgeleid naar een
 * opnamedag + editing-opdracht — dezelfde tabellen en dedup-sleutels als de sync.
 */
export async function linkAppointmentToClient(
  eventId: string,
  clientId: string,
): Promise<ActionResult<{ clientName: string }>> {
  try {
    const viewer = await requireOwner();
    if (!eventId || !clientId) return { ok: false, message: "Kies een klant." };

    const [event] = await db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        location: calendarEvents.location,
        startsAt: calendarEvents.startsAt,
        allDay: calendarEvents.allDay,
        status: calendarEvents.status,
      })
      .from(calendarEvents)
      .where(eq(calendarEvents.id, eventId))
      .limit(1);
    if (!event) return { ok: false, message: "Afspraak niet gevonden." };
    if (event.status === "cancelled") return { ok: false, message: "Deze afspraak is geannuleerd." };

    const [client] = await db
      .select({ id: clients.id, name: clients.name, slug: clients.slug, editorName: clients.editorName })
      .from(clients)
      .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (!client) return { ok: false, message: "Klant niet gevonden." };

    // 1) De afspraak handmatig aan de klant hangen, als opname, zodat de
    //    afleiding 'm oppakt én de uursync de koppeling respecteert.
    await db
      .update(calendarEvents)
      .set({
        clientId: client.id,
        kind: "opname",
        matchConfidence: "manual",
        matchReason: `Handmatig gekoppeld aan ${client.name}`,
        matchedBy: ["manual"],
        updatedAt: new Date(),
      })
      .where(eq(calendarEvents.id, event.id));

    // 2) Afleiden naar een opnamedag (+ automatische editing-opdracht), identiek
    //    aan de sync: dedup via de calendar_shoot-koppeling op dit event-id.
    const scheduledOn = event.startsAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    const startTime = event.allDay
      ? null
      : `${event.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}:00`;

    const base = {
      clientId: client.id,
      title: event.title ?? "Opnamedag",
      scheduledOn,
      ...(startTime ? { startTime } : {}),
      ...(event.location ? { locationName: event.location.slice(0, 200) } : {}),
      status: "planned" as const,
      updatedAt: new Date(),
    };

    const [map] = await db
      .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
      .from(mondayMappings)
      .where(and(eq(mondayMappings.entityType, "calendar_shoot"), eq(mondayMappings.itemId, event.id)))
      .limit(1);

    let productionDayId = map?.entityId ?? null;
    if (productionDayId) {
      await db.update(productionDays).set(base).where(eq(productionDays.id, productionDayId));
    } else {
      const [created] = await db.insert(productionDays).values(base).returning({ id: productionDays.id });
      productionDayId = created!.id;
      await db.insert(mondayMappings).values({
        entityType: "calendar_shoot",
        entityId: productionDayId,
        boardId: "google_calendar",
        itemId: event.id,
        lastSyncedAt: new Date(),
      });
    }

    // Videograaf standaard koppelen als er nog geen staat (Luxewagen → Jarno, rest
    // → Rutger) — gelijk aan de sync, zodat de opname meteen compleet op het board
    // staat.
    const [pd] = await db
      .select({ vid: productionDays.videographerId })
      .from(productionDays)
      .where(eq(productionDays.id, productionDayId))
      .limit(1);
    if (pd && !pd.vid) {
      const vgRows = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, ["rutger@shortclips.nl", "jarno@shortclips.nl"]));
      const rutgerId = vgRows.find((r) => r.email.toLowerCase() === "rutger@shortclips.nl")?.id ?? null;
      const jarnoId = vgRows.find((r) => r.email.toLowerCase() === "jarno@shortclips.nl")?.id ?? null;
      const vgId = /luxewagen/i.test(client.name) ? jarnoId : rutgerId;
      if (vgId) await db.update(productionDays).set({ videographerId: vgId, updatedAt: new Date() }).where(eq(productionDays.id, productionDayId));
    }

    // Editing-opdracht (deliverable) aanmaken als die er nog niet is: due = opname
    // + 14 werkdagen, meteen bij de vaste editor van de klant.
    const [existing] = await db
      .select({ id: deliverables.id })
      .from(deliverables)
      .where(and(eq(deliverables.productionDayId, productionDayId), isNull(deliverables.deletedAt)))
      .limit(1);
    if (!existing) {
      let editorId: string | null = null;
      if (client.editorName) {
        // Vaste editor van de klant op voornaam matchen (zoals de sync doet).
        const editorRows = await db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(and(eq(users.primaryRole, "editor"), eq(users.status, "active")));
        const wanted = firstNameKey(client.editorName);
        editorId = editorRows.find((e) => firstNameKey(e.fullName) === wanted)?.id ?? null;
      }
      await db.insert(deliverables).values({
        clientId: client.id,
        productionDayId,
        title: event.title?.slice(0, 240) || `${client.name} — ${scheduledOn}`,
        status: "recorded",
        editorId,
        dueOn: addWorkingDays(scheduledOn, 14, nlHolidaySet()),
        dueOnSource: "auto",
        statusChangedAt: event.startsAt ?? new Date(),
      });
    }

    await auditLog({
      viewer,
      action: "calendar.appointment_linked",
      entityType: "calendar_event",
      entityId: event.id,
      clientId: client.id,
      changes: { title: event.title, clientName: client.name },
    });

    revalidatePath("/settings/integrations");
    revalidatePath("/productions");
    revalidatePath("/videos");
    revalidatePath("/planning");
    revalidatePath(`/clients/${client.slug}`);
    return { ok: true, message: `Gekoppeld aan ${client.name} en op het board gezet.`, data: { clientName: client.name } };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
