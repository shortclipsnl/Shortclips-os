import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { CLIENT_LOGOS } from "./client-logos-data";

/**
 * Zet de geverifieerde klantlogo's in de database (productie). Per klant-slug
 * wordt het logo alleen gezet als er nog géén logo staat — zo overschrijven we
 * nooit een logo dat de founder zelf heeft gekozen. Idempotent: een tweede run
 * doet niets meer. Slugs die (nog) niet in de database bestaan, worden gemeld.
 */
export async function applyClientLogos(): Promise<{
  ok: boolean;
  updated: number;
  alreadySet: number;
  missing: string[];
}> {
  let updated = 0;
  let alreadySet = 0;
  const missing: string[] = [];

  for (const [slug, logoUrl] of Object.entries(CLIENT_LOGOS)) {
    const [row] = await db
      .select({ id: clients.id, logoUrl: clients.logoUrl })
      .from(clients)
      .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
      .limit(1);

    if (!row) {
      missing.push(slug);
      continue;
    }
    if (row.logoUrl) {
      alreadySet++;
      continue;
    }
    await db.update(clients).set({ logoUrl, updatedAt: new Date() }).where(eq(clients.id, row.id));
    updated++;
  }

  return { ok: true, updated, alreadySet, missing };
}
