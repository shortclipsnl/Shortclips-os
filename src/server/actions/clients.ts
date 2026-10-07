"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientContacts, clients } from "@/db/schema";
import {
  assertClientAccess,
  ForbiddenError,
  requirePermission,
} from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { enforcePortalAccess } from "@/server/jobs/portal-access";

export type ActionResult = { ok: boolean; message?: string; slug?: string };

/** Velden die de Monday-import normaal overschrijft; eenmaal handmatig gezet,
 *  vergrendelen we ze zodat de nachtelijke sync ze met rust laat. */
const MONDAY_MANAGED = ["name", "status", "coordinatorId", "monthlyRevenue", "startedOn"] as const;

const CLIENT_STATUSES = ["prospect", "onboarding", "active", "paused", "churned"] as const;
type ClientStatus = (typeof CLIENT_STATUSES)[number];

export type ClientInput = {
  name: string;
  legalName?: string | null;
  sector?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  color?: string | null;
  status?: ClientStatus;
  coordinatorId?: string | null;
  videographerId?: string | null;
  monthlyVideoQuota?: number;
  monthlyRevenue?: string | null;
  startedOn?: string | null;
  notes?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "klant"
  );
}

async function uniqueSlug(name: string): Promise<string> {
  const basis = slugify(name);
  let slug = basis;
  let n = 2;
  // Ook soft-deleted klanten bezetten hun slug (unieke kolom), dus geen filter.
  while (true) {
    const [hit] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
    if (!hit) return slug;
    slug = `${basis}-${n++}`;
  }
}

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

/** Primaire contactpersoon bijwerken of aanmaken (of niets doen als leeg). */
async function upsertPrimaryContact(
  clientId: string,
  input: Pick<ClientInput, "contactName" | "contactEmail" | "contactPhone">,
): Promise<void> {
  const fullName = clean(input.contactName);
  const email = clean(input.contactEmail)?.toLowerCase() ?? null;
  const phone = clean(input.contactPhone);
  if (!fullName && !email && !phone) return;

  const [existing] = await db
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
    .orderBy(desc(clientContacts.isPrimary))
    .limit(1);

  if (existing) {
    await db
      .update(clientContacts)
      .set({ fullName: fullName ?? "Contactpersoon", email, phone, isPrimary: true, updatedAt: new Date() })
      .where(eq(clientContacts.id, existing.id));
  } else {
    await db.insert(clientContacts).values({
      clientId,
      fullName: fullName ?? "Contactpersoon",
      email,
      phone,
      isPrimary: true,
    });
  }
}

export async function createClient(input: ClientInput): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("clients:write");
    const name = clean(input.name);
    if (!name) return { ok: false, message: "Geef een klantnaam op." };

    const slug = await uniqueSlug(name);
    const status: ClientStatus = input.status ?? "active";

    // Handmatig aangemaakte klant: de Monday-velden die we nu invullen
    // vergrendelen, zodat een latere Monday-match ze niet overschrijft.
    const managed = new Set<string>(["name", "status"]);
    if (input.coordinatorId) managed.add("coordinatorId");
    if (clean(input.monthlyRevenue)) managed.add("monthlyRevenue");
    if (clean(input.startedOn)) managed.add("startedOn");

    const [created] = await db
      .insert(clients)
      .values({
        slug,
        name,
        legalName: clean(input.legalName),
        sector: clean(input.sector),
        website: clean(input.website),
        logoUrl: clean(input.logoUrl),
        color: clean(input.color),
        status,
        coordinatorId: input.coordinatorId || null,
        videographerId: input.videographerId || null,
        monthlyVideoQuota: input.monthlyVideoQuota ?? 0,
        monthlyRevenue: clean(input.monthlyRevenue) ?? undefined,
        startedOn: clean(input.startedOn) ?? undefined,
        notes: clean(input.notes),
        managedFields: [...managed],
      })
      .returning({ id: clients.id });

    const clientId = created!.id;
    await upsertPrimaryContact(clientId, input);

    await auditLog({
      viewer,
      action: "client.created",
      entityType: "client",
      entityId: clientId,
      clientId,
      changes: { name, slug, status },
    });
    await recordActivity({
      clientId,
      type: "client.created",
      title: `Klant "${name}" aangemaakt`,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });

    revalidatePath("/clients");
    return { ok: true, slug };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateClient(slug: string, input: ClientInput): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("clients:write");
    const [existing] = await db
      .select({
        id: clients.id,
        name: clients.name,
        status: clients.status,
        coordinatorId: clients.coordinatorId,
        monthlyRevenue: clients.monthlyRevenue,
        startedOn: clients.startedOn,
        managedFields: clients.managedFields,
      })
      .from(clients)
      .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
      .limit(1);
    if (!existing) return { ok: false, message: "Klant niet gevonden." };
    assertClientAccess(viewer, existing.id);

    const name = clean(input.name);
    if (!name) return { ok: false, message: "Geef een klantnaam op." };
    const status: ClientStatus = input.status ?? (existing.status as ClientStatus);
    const newRevenue = clean(input.monthlyRevenue);
    const newStarted = clean(input.startedOn);

    // Welke Monday-velden wijzigt de gebruiker? Die vergrendelen we.
    const managed = new Set<string>(existing.managedFields ?? []);
    if (name !== existing.name) managed.add("name");
    if (status !== existing.status) managed.add("status");
    if ((input.coordinatorId || null) !== (existing.coordinatorId ?? null)) managed.add("coordinatorId");
    if (newRevenue !== null && newRevenue !== existing.monthlyRevenue) managed.add("monthlyRevenue");
    if (newStarted !== null && newStarted !== existing.startedOn) managed.add("startedOn");

    await db
      .update(clients)
      .set({
        name,
        legalName: clean(input.legalName),
        sector: clean(input.sector),
        website: clean(input.website),
        logoUrl: clean(input.logoUrl),
        color: clean(input.color),
        status,
        coordinatorId: input.coordinatorId || null,
        videographerId: input.videographerId || null,
        monthlyVideoQuota: input.monthlyVideoQuota ?? 0,
        ...(newRevenue !== null ? { monthlyRevenue: newRevenue } : {}),
        startedOn: newStarted,
        notes: clean(input.notes),
        managedFields: [...managed],
        updatedAt: new Date(),
      })
      .where(eq(clients.id, existing.id));

    await upsertPrimaryContact(existing.id, input);

    await auditLog({
      viewer,
      action: "client.updated",
      entityType: "client",
      entityId: existing.id,
      clientId: existing.id,
      changes: { name, status },
    });

    // Statuswijziging kan portaaltoegang raken (gestopt → dicht, actief → open).
    if (status !== existing.status) await enforcePortalAccess();

    revalidatePath("/clients");
    revalidatePath(`/clients/${slug}`);
    return { ok: true, slug };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Status wijzigen (archiveren = 'churned'/'paused', heractiveren = 'active'). */
export async function setClientStatus(slug: string, status: ClientStatus): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("clients:write");
    if (!CLIENT_STATUSES.includes(status)) return { ok: false, message: "Onbekende status." };
    const [existing] = await db
      .select({ id: clients.id, name: clients.name, managedFields: clients.managedFields })
      .from(clients)
      .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
      .limit(1);
    if (!existing) return { ok: false, message: "Klant niet gevonden." };
    assertClientAccess(viewer, existing.id);

    const managed = new Set<string>(existing.managedFields ?? []);
    managed.add("status");

    await db
      .update(clients)
      .set({ status, managedFields: [...managed], updatedAt: new Date() })
      .where(eq(clients.id, existing.id));

    await auditLog({
      viewer,
      action: "client.status_changed",
      entityType: "client",
      entityId: existing.id,
      clientId: existing.id,
      changes: { status },
    });
    await recordActivity({
      clientId: existing.id,
      type: "client.status_changed",
      title:
        status === "active"
          ? `Klant "${existing.name}" weer op actief gezet`
          : `Klant "${existing.name}" op ${status} gezet`,
      actor: { id: viewer.id, fullName: viewer.fullName },
    });

    await enforcePortalAccess();
    revalidatePath("/clients");
    revalidatePath(`/clients/${slug}`);
    return { ok: true, slug };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Klant verwijderen (soft-delete): verdwijnt overal uit de app en wordt door de
 * Monday-import niet opnieuw aangemaakt. Historische data blijft in de database
 * bewaard en is door een beheerder herstelbaar. Ter bevestiging moet de exacte
 * klantnaam worden meegetypt.
 */
export async function deleteClient(slug: string, confirmName: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("clients:delete");
    const [existing] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
      .limit(1);
    if (!existing) return { ok: false, message: "Klant niet gevonden." };
    assertClientAccess(viewer, existing.id);

    if (confirmName.trim() !== existing.name) {
      return { ok: false, message: "Naam komt niet overeen — verwijderen geannuleerd." };
    }

    await db
      .update(clients)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(clients.id, existing.id));

    await auditLog({
      viewer,
      action: "client.deleted",
      entityType: "client",
      entityId: existing.id,
      clientId: existing.id,
      changes: { name: existing.name },
    });

    // Toegang direct dichtzetten.
    await enforcePortalAccess();
    revalidatePath("/clients");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
