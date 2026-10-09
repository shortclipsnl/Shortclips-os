import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMembers, users } from "@/db/schema";

/**
 * Houdt de teamweergave gelijk met het echte Shortclips-team, verdeeld in
 * intern team en freelancers. Niet-destructief: personen die niet in de lijst
 * staan worden alleen uit de teamweergave gehaald (team_members soft-deleted) —
 * hun gebruikersrecord en koppelingen blijven intact. Idempotent.
 */

// Naamcorrecties (oude voornaam -> nieuwe volledige naam). Nynke is Fries; zowel
// een eerdere "Nienke"-schrijfwijze als "nynke" worden naar "Nynke" gezet.
const RENAMES: Record<string, string> = { sam: "Sem", nynke: "Nynke", nienke: "Nynke", jiska: "Jeska Batema" };
// Placeholder-personen (voornaam) die ik eerder onterecht aanmaakte en nu weer
// opruim (soft-delete gebruiker + teamlid). Baatema bleek de achternaam van Jeska.
const REMOVE = ["baatema"];

// Voornaam -> { functie, intern? }. Intern = Team Shortclips, anders freelancer.
const TEAM: Record<string, { title: string; internal: boolean }> = {
  jarno: { title: "Founder & Creative Director", internal: true },
  milou: { title: "Content Strategist & Social Media Manager", internal: true },
  jeska: { title: "Content Strategist & Social Media Manager", internal: true },
  rutger: { title: "Head of Content", internal: true },
  fabian: { title: "Short Video Creative", internal: false },
  max: { title: "Brand Designer", internal: false },
  nynke: { title: "Presentatrice", internal: false },
  quinn: { title: "Short Video Creative", internal: false },
  sem: { title: "Short Video Creative", internal: false },
};

const firstName = (full: string) => full.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

export async function curateTeam(): Promise<{ ok: boolean; getoond: number; verborgen: number; toegevoegd: number; hernoemd: number }> {
  let shown = 0;
  let hidden = 0;
  let added = 0;
  let renamed = 0;

  // 0. Naamcorrecties + opruimen placeholders.
  const allUsers = await db.select({ id: users.id, fullName: users.fullName }).from(users);
  for (const u of allUsers) {
    const fn = firstName(u.fullName);
    if (REMOVE.includes(fn)) {
      // Placeholder opruimen: teamlid én gebruiker soft-deleten.
      await db.update(teamMembers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(teamMembers.userId, u.id));
      await db.update(users).set({ deletedAt: new Date(), status: "suspended", updatedAt: new Date() }).where(eq(users.id, u.id));
      continue;
    }
    if (RENAMES[fn] && u.fullName.trim() !== RENAMES[fn]) {
      await db.update(users).set({ fullName: RENAMES[fn], updatedAt: new Date() }).where(eq(users.id, u.id));
      renamed++;
    }
  }

  // 1. Bestaande teamleden langslopen.
  const rows = await db
    .select({ userId: users.id, fullName: users.fullName, tmId: teamMembers.id, tmDeleted: teamMembers.deletedAt })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id));

  const present = new Set<string>();
  for (const r of rows) {
    const fn = firstName(r.fullName);
    present.add(fn);
    const def = TEAM[fn];
    if (def) {
      await db
        .update(teamMembers)
        .set({ jobTitle: def.title, isInternal: def.internal, deletedAt: null, updatedAt: new Date() })
        .where(eq(teamMembers.id, r.tmId));
      shown++;
    } else if (!r.tmDeleted) {
      await db.update(teamMembers).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(teamMembers.id, r.tmId));
      hidden++;
    }
  }

  // 2. Ontbrekende teamleden toevoegen.
  for (const [fn, def] of Object.entries(TEAM)) {
    if (present.has(fn)) continue;
    const name = fn.charAt(0).toUpperCase() + fn.slice(1);
    const email = `${fn}@shortclips.nl`;
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    let userId = existing?.id;
    if (!userId) {
      const [created] = await db.insert(users).values({ email, fullName: name, primaryRole: "content_creator", status: "invited" }).returning({ id: users.id });
      userId = created!.id;
    }
    const [tm] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.userId, userId!)).limit(1);
    if (tm) {
      await db.update(teamMembers).set({ jobTitle: def.title, isInternal: def.internal, deletedAt: null, updatedAt: new Date() }).where(eq(teamMembers.id, tm.id));
    } else {
      await db.insert(teamMembers).values({ userId: userId!, jobTitle: def.title, isInternal: def.internal, startedAt: new Date() });
    }
    added++;
  }

  return { ok: true, getoond: shown, verborgen: hidden, toegevoegd: added, hernoemd: renamed };
}
