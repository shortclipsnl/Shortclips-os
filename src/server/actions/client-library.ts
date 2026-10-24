"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientEditingGuides, clients } from "@/db/schema";
import { requireInternal, ForbiddenError } from "@/server/auth/context";
import { canManageLibrary } from "@/server/client-library";

export type ActionResult = { ok: boolean; message?: string };

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Een Editing Guide (PDF) voor een klant uploaden. Alleen interne medewerkers met
 * beheerrechten; editors kunnen uitsluitend bekijken. Een nieuwe upload wordt de
 * meest recente versie — editors zien die automatisch.
 */
export async function uploadEditingGuide(
  clientId: string,
  file: { fileName: string; base64: string; contentType?: string; sizeBytes?: number },
): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await requireInternal();
    if (!canManageLibrary(viewer)) return { ok: false, message: "Alleen een interne beheerder kan de Editing Guide uploaden." };

    const [client] = await db.select({ id: clients.id, slug: clients.slug }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
    if (!client) return { ok: false, message: "Klant niet gevonden." };

    const base64 = (file.base64 ?? "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!base64) return { ok: false, message: "Geen bestand ontvangen." };
    const contentType = file.contentType || "application/pdf";
    if (!contentType.includes("pdf")) return { ok: false, message: "Alleen een PDF-bestand wordt ondersteund." };
    const sizeBytes = file.sizeBytes ?? Math.floor((base64.length * 3) / 4);
    if (sizeBytes > MAX_BYTES) return { ok: false, message: "Het bestand is te groot (max 25 MB)." };

    await db.insert(clientEditingGuides).values({
      clientId,
      fileName: (file.fileName || "Editing Guide.pdf").slice(0, 300),
      contentType,
      dataBase64: base64,
      sizeBytes,
      uploadedById: viewer.id,
    });

    revalidatePath(`/mijn-klanten/${client.slug}`);
    revalidatePath("/mijn-klanten");
    revalidatePath(`/clients/${client.slug}`);
    return { ok: true };
  });
}

/** De huidige Editing Guide van een klant verwijderen (soft delete). */
export async function removeEditingGuide(clientId: string): Promise<ActionResult> {
  return wrap(async () => {
    const viewer = await requireInternal();
    if (!canManageLibrary(viewer)) return { ok: false, message: "Geen toegang." };
    const [client] = await db.select({ slug: clients.slug }).from(clients).where(eq(clients.id, clientId)).limit(1);
    await db.update(clientEditingGuides).set({ deletedAt: new Date() }).where(and(eq(clientEditingGuides.clientId, clientId), isNull(clientEditingGuides.deletedAt)));
    if (client) {
      revalidatePath(`/mijn-klanten/${client.slug}`);
      revalidatePath("/mijn-klanten");
    }
    return { ok: true };
  });
}
