"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission } from "@/server/auth/context";
import { getClientCaptionFooter } from "@/server/caption-footer";

export type FooterResult = { ok: boolean; message?: string; footer?: string };

const idSchema = z.string().uuid();

/** De standaard caption-footer van een klant ophalen (opgeslagen of afgeleid). */
export async function getCaptionFooter(clientId: string): Promise<FooterResult> {
  try {
    const viewer = await requirePermission("ai:read");
    if (!idSchema.safeParse(clientId).success) return { ok: false, message: "Onbekende klant." };
    assertClientAccess(viewer, clientId);
    return { ok: true, footer: await getClientCaptionFooter(clientId) };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const saveSchema = z.object({
  clientId: z.string().uuid(),
  footer: z.string().max(4000),
});

/** De standaard caption-footer van een klant aanpassen/vastleggen. */
export async function setCaptionFooter(input: z.infer<typeof saveSchema>): Promise<FooterResult> {
  try {
    const viewer = await requirePermission("ai:read");
    const p = saveSchema.safeParse(input);
    if (!p.success) return { ok: false, message: "Ongeldige invoer." };
    assertClientAccess(viewer, p.data.clientId);
    const footer = p.data.footer.trim();
    await db.update(clients).set({ captionFooter: footer || null, updatedAt: new Date() }).where(eq(clients.id, p.data.clientId));
    revalidatePath("/ai/caption");
    return { ok: true, footer };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
