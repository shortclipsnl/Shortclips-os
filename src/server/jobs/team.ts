import "server-only";
import { eq, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

/**
 * Zet (of maakt) een teamlid met telefoonnummer, voor bellen/WhatsApp in het
 * portaal. Nummers zijn runtime-data, bewust niet in de code vastgelegd.
 */
export async function setTeamContact(
  name: string,
  phone: string,
  role: "project_coordinator" | "videographer" = "videographer",
) {
  const existing = await db
    .update(users)
    .set({ phone, updatedAt: new Date() })
    .where(ilike(users.fullName, `${name}%`))
    .returning({ id: users.id, fullName: users.fullName });

  if (existing.length > 0) {
    return { ok: true, created: false, updated: existing.map((r) => r.fullName) };
  }

  // Nog geen gebruiker → aanmaken (email op voornaam).
  const first = name.trim().split(/\s+/)[0]!.toLowerCase();
  const email = `${first}@shortclips.nl`;
  const [byEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (byEmail) {
    await db.update(users).set({ fullName: name, phone, updatedAt: new Date() }).where(eq(users.id, byEmail.id));
    return { ok: true, created: false, updated: [name] };
  }
  const [created] = await db
    .insert(users)
    .values({ email, fullName: name, phone, primaryRole: role, status: "active" })
    .returning({ id: users.id, fullName: users.fullName });
  return { ok: true, created: true, updated: [created!.fullName] };
}
