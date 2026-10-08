import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMembers, users } from "@/db/schema";

/**
 * Houdt de teamweergave gelijk met het echte Shortclips-team (shortclips.nl/over-ons).
 * Niet-destructief: personen die niet op de website staan worden alleen uit de
 * teamweergave gehaald (team_members soft-deleted) — hun gebruikersrecord en alle
 * koppelingen (als videograaf/editor in projecten) blijven volledig intact.
 * Idempotent.
 */

// Voornaam -> functie, exact zoals op de website.
const WEBSITE: Record<string, string> = {
  jarno: "Founder & Creative Director",
  milou: "Content Strategist & Social Media Manager",
  jiska: "Content Strategist & Social Media Manager",
  rutger: "Head of Content",
  quinn: "Short Video Creative",
  fabian: "Short Video Creative",
  sam: "Short Video Creative",
  nynke: "Presentatrice",
  max: "Brand Designer",
};

const firstName = (full: string) => full.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

export async function curateTeam(): Promise<{ ok: boolean; getoond: number; verborgen: number; toegevoegd: number }> {
  let shown = 0;
  let hidden = 0;
  let added = 0;

  // 1. Bestaande teamleden langslopen.
  const rows = await db
    .select({ userId: users.id, fullName: users.fullName, tmId: teamMembers.id, tmDeleted: teamMembers.deletedAt })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id));

  const presentFirstNames = new Set<string>();
  for (const r of rows) {
    const fn = firstName(r.fullName);
    presentFirstNames.add(fn);
    if (WEBSITE[fn]) {
      // Hoort erbij: zichtbaar maken + functie gelijkzetten.
      await db
        .update(teamMembers)
        .set({ jobTitle: WEBSITE[fn], deletedAt: null, updatedAt: new Date() })
        .where(eq(teamMembers.id, r.tmId));
      shown++;
    } else if (!r.tmDeleted) {
      // Hoort niet op de website: uit de teamweergave halen (record blijft).
      await db.update(teamMembers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(teamMembers.id, r.tmId));
      hidden++;
    }
  }

  // 2. Ontbrekende website-personen toevoegen (bijv. Nynke, Max).
  for (const [fn, title] of Object.entries(WEBSITE)) {
    if (presentFirstNames.has(fn)) continue;
    const name = fn.charAt(0).toUpperCase() + fn.slice(1);
    const email = `${fn}@shortclips.nl`;
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    let userId = existing?.id;
    if (!userId) {
      const [created] = await db
        .insert(users)
        .values({ email, fullName: name, primaryRole: "content_creator", status: "invited" })
        .returning({ id: users.id });
      userId = created!.id;
    }
    // team_member erbij (of weer zichtbaar).
    const [tm] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.userId, userId!)).limit(1);
    if (tm) {
      await db.update(teamMembers).set({ jobTitle: title, deletedAt: null, updatedAt: new Date() }).where(eq(teamMembers.id, tm.id));
    } else {
      await db.insert(teamMembers).values({ userId: userId!, jobTitle: title, isInternal: true, startedAt: new Date() });
    }
    added++;
  }

  return { ok: true, getoond: shown, verborgen: hidden, toegevoegd: added };
}
