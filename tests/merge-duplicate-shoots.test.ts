import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { mergeDuplicateShoots } from "@/server/jobs/calendar-sync";

/**
 * De Google Agenda-sync mocht geen dubbele opnamedagen opleveren: dezelfde opname
 * staat vaak in meerdere agenda's (soms met een andere titel/tijd), maar dat is
 * één opname. Deze test bewijst de ontdubbeling: per klant + datum blijft er één
 * over, editwerk blijft behouden, en de agenda-koppelingen wijzen naar de
 * behouden opname.
 */
describe("mergeDuplicateShoots", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let clientId = "";

  beforeEach(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    const [c] = await db.insert(s.clients).values({ slug: "cb", name: "CB automobielen" }).returning({ id: s.clients.id });
    clientId = c!.id;
  });
  afterAll(async () => { await closeDatabase(); });

  async function makeShoot(createdAt: Date, work: boolean) {
    const [pd] = await db.insert(s.productionDays).values({ clientId, title: "Opnamedag", scheduledOn: "2026-11-23", status: "planned", createdAt, updatedAt: createdAt })
      .returning({ id: s.productionDays.id });
    const pdId = pd!.id;
    const [d] = await db.insert(s.deliverables).values({
      clientId, productionDayId: pdId, title: "CB #1",
      status: work ? "editing" : "recorded",
      currentVersion: work ? 1 : 0,
    }).returning({ id: s.deliverables.id });
    await db.insert(s.calendarMappings).values({ entityType: "calendar_shoot", entityId: pdId, boardId: "google_calendar", itemId: `evt-${pdId}`, lastSyncedAt: new Date() });
    return { pdId, deliverableId: d!.id };
  }

  const alive = async (pdId: string) =>
    (await db.select({ id: s.productionDays.id }).from(s.productionDays).where(and(eq(s.productionDays.id, pdId), isNull(s.productionDays.deletedAt)))).length > 0;
  const mappingTarget = async (pdId: string) =>
    (await db.select({ e: s.calendarMappings.entityId }).from(s.calendarMappings).where(eq(s.calendarMappings.itemId, `evt-${pdId}`)))[0]?.e ?? null;

  it("houdt de opname mét editwerk en verwijdert de lege duplicaten", async () => {
    const empty1 = await makeShoot(new Date("2026-10-01T09:00:00Z"), false);
    const work = await makeShoot(new Date("2026-10-02T09:00:00Z"), true);
    const empty2 = await makeShoot(new Date("2026-10-03T09:00:00Z"), false);

    const n = await mergeDuplicateShoots();
    expect(n).toBe(2);

    expect(await alive(work.pdId)).toBe(true);     // werk blijft
    expect(await alive(empty1.pdId)).toBe(false);  // leeg weg
    expect(await alive(empty2.pdId)).toBe(false);

    // Agenda-koppelingen van de lege opnames wijzen nu naar de behouden opname.
    expect(await mappingTarget(empty1.pdId)).toBe(work.pdId);
    expect(await mappingTarget(empty2.pdId)).toBe(work.pdId);

    // De lege opdrachten zijn soft-deleted, de echte blijft.
    const liveDeliverables = await db.select({ id: s.deliverables.id }).from(s.deliverables).where(isNull(s.deliverables.deletedAt));
    expect(liveDeliverables.map((d) => d.id)).toEqual([work.deliverableId]);
  });

  it("houdt de oudste als geen enkel duplicaat editwerk heeft", async () => {
    const oldest = await makeShoot(new Date("2026-10-01T09:00:00Z"), false);
    const mid = await makeShoot(new Date("2026-10-02T09:00:00Z"), false);
    const newest = await makeShoot(new Date("2026-10-03T09:00:00Z"), false);

    expect(await mergeDuplicateShoots()).toBe(2);
    expect(await alive(oldest.pdId)).toBe(true);
    expect(await alive(mid.pdId)).toBe(false);
    expect(await alive(newest.pdId)).toBe(false);
  });

  it("doet niets bij één opname per klant+datum", async () => {
    await makeShoot(new Date("2026-10-01T09:00:00Z"), false);
    expect(await mergeDuplicateShoots()).toBe(0);
  });

  it("laat twee opnames met ieder editwerk staan (nooit werk weggooien)", async () => {
    const w1 = await makeShoot(new Date("2026-10-01T09:00:00Z"), true);
    const w2 = await makeShoot(new Date("2026-10-02T09:00:00Z"), true);
    expect(await mergeDuplicateShoots()).toBe(0);
    expect(await alive(w1.pdId)).toBe(true);
    expect(await alive(w2.pdId)).toBe(true);
  });
});
