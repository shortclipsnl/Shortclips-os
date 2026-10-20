import "server-only";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, users } from "@/db/schema";

/**
 * Vaste vervangingskoppels: de twee Content Creatives (Milou en Jiska) vervangen
 * elkaar. Is iemand met goedgekeurd verlof, dan nemen de klanten, meldingen en
 * to-do's automatisch over naar de vervanger (en andersom). Eén plek, zodat de
 * regel overal gelijk werkt.
 */
const COVER_PAIRS: Record<string, string> = {
  "milou@shortclips.nl": "jiska@shortclips.nl",
  "jiska@shortclips.nl": "milou@shortclips.nl",
};

export function replacementEmail(email?: string | null): string | null {
  if (!email) return null;
  return COVER_PAIRS[email.toLowerCase()] ?? null;
}

export type ActiveCover = {
  absentId: string;
  absentName: string;
  absentEmail: string;
  replacementId: string | null;
  replacementName: string | null;
};

/**
 * Wie is er op `dateIso` (standaard vandaag) met goedgekeurd verlof, en wie
 * vervangt diegene volgens de vaste koppels.
 */
export async function getActiveCovers(dateIso?: string): Promise<ActiveCover[]> {
  const day = dateIso ?? new Date().toISOString().slice(0, 10);
  const onLeave = await db
    .select({ userId: leaveRequests.userId, name: users.fullName, email: users.email })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.userId))
    .where(
      and(
        eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startOn, day),
        gte(leaveRequests.endOn, day),
      ),
    );
  if (onLeave.length === 0) return [];

  const repEmails = [...new Set(onLeave.map((l) => replacementEmail(l.email)).filter((e): e is string => !!e))];
  const repUsers = repEmails.length
    ? await db
        .select({ id: users.id, email: users.email, name: users.fullName })
        .from(users)
        .where(inArray(sql`lower(${users.email})`, repEmails))
    : [];
  const byEmail = new Map(repUsers.map((u) => [u.email.toLowerCase(), u]));

  return onLeave.map((l) => {
    const re = replacementEmail(l.email);
    const rep = re ? byEmail.get(re) : null;
    return {
      absentId: l.userId,
      absentName: l.name,
      absentEmail: l.email,
      replacementId: rep?.id ?? null,
      replacementName: rep?.name ?? null,
    };
  });
}

/** Map van afwezige userId → vervanger-userId (alleen waar een vervanger bestaat). */
export async function activeCoverMap(): Promise<Map<string, string>> {
  const covers = await getActiveCovers();
  const m = new Map<string, string>();
  for (const c of covers) if (c.replacementId) m.set(c.absentId, c.replacementId);
  return m;
}

/** De afwezige collega's wiens werk `userId` op dit moment overneemt. */
export async function coveringForUser(userId: string): Promise<Array<{ absentId: string; absentName: string }>> {
  const covers = await getActiveCovers();
  return covers.filter((c) => c.replacementId === userId).map((c) => ({ absentId: c.absentId, absentName: c.absentName }));
}
