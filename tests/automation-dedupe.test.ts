import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Automatiseringen maken niets dubbel (#3): dezelfde regel meerdere keren
 * draaien op dezelfde entiteit levert één open taak op; verandert de periode,
 * dan hoort daar een nieuwe taak bij.
 */
describe("Automation engine — taken worden niet dubbel aangemaakt", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let engine: typeof import("@/server/automation");
  const entityId = randomUUID();

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    engine = await import("@/server/automation");

    await db.insert(s.automationRules).values({
      key: "contract60",
      name: "Contract loopt af",
      trigger: "schedule.daily",
      conditions: {},
      actions: [{ type: "create_task", title: "Verlenging bespreken" }],
      isEnabled: true,
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("maakt bij drie runs op dezelfde dag één taak", async () => {
    const event = { trigger: "schedule.daily", entityType: "contract", entityId, data: { periodKey: "2027-01" } };
    await engine.dispatch(event);
    await engine.dispatch(event);
    await engine.dispatch(event);

    const open = await db
      .select({ id: s.tasks.id })
      .from(s.tasks)
      .where(and(eq(s.tasks.entityId, entityId), isNull(s.tasks.deletedAt)));
    expect(open.length).toBe(1);
    expect(open[0]).toBeTruthy();
  });

  it("maakt bij een nieuwe periode wel een aparte taak", async () => {
    await engine.dispatch({ trigger: "schedule.daily", entityType: "contract", entityId, data: { periodKey: "2027-07" } });
    const all = await db.select({ id: s.tasks.id }).from(s.tasks).where(eq(s.tasks.entityId, entityId));
    expect(all.length).toBe(2);
  });
});
