import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { addDaysIso, deadlineView, dueReminder, phaseFor } from "@/lib/planning-deadline";

vi.mock("@/server/audit", () => ({ auditLog: async () => undefined, recordActivity: async () => undefined }));

/**
 * Afteller contentplanning (21 dagen):
 *  1. Statussen en kleuren volgen exact 21-11 / 10-4 / 3-1 / 0.
 *  2. Herinneringen: alleen het laatst bereikte moment, nooit dubbel.
 *  3. Eén actieve deadline per klant; delen start er geen tweede.
 *  4. Automatisch afgerond pas als er iets bij de klant lag en nu niets meer.
 */

describe("statussen (puur)", () => {
  const start = "2026-11-09";
  const at = (day: number) => deadlineView({ startedOn: start, deadlineOn: addDaysIso(start, 21), status: "active" }, addDaysIso(start, day));
  it("21 tot 11 dagen groen, 10 tot 4 oranje, 3 tot 1 rood, 0 deadline bereikt", () => {
    expect(at(0).daysLeft).toBe(21);
    expect(at(0).phase).toBe("ruim");
    expect(at(10).phase).toBe("ruim"); // 11 dagen over
    expect(at(11).phase).toBe("dichterbij"); // 10 dagen over
    expect(at(17).phase).toBe("dichterbij"); // 4
    expect(at(18).phase).toBe("actie"); // 3
    expect(at(20).phase).toBe("actie"); // 1
    expect(at(21).phase).toBe("bereikt");
    expect(at(21).clientLabel).toBe("Deadline bereikt");
    expect(at(25).remainingLabel).toBe("Verlopen");
    expect(at(25).progress).toBe(1);
    expect(at(7).progress).toBeCloseTo(1 / 3);
  });
  it("afgerond wint altijd", () => {
    expect(phaseFor(-5, true)).toBe("afgerond");
    expect(deadlineView({ startedOn: start, deadlineOn: addDaysIso(start, 21), status: "completed" }, start).teamLabel).toBe("Afgerond");
  });
  it("herinneringen op dag 0, 14, 18 en 21", () => {
    const d = { startedOn: start, deadlineOn: addDaysIso(start, 21), status: "active" };
    expect(dueReminder(d, addDaysIso(start, 0))).toBe("start");
    expect(dueReminder(d, addDaysIso(start, 13))).toBe("start");
    expect(dueReminder(d, addDaysIso(start, 14))).toBe("d14");
    expect(dueReminder(d, addDaysIso(start, 18))).toBe("d18");
    expect(dueReminder(d, addDaysIso(start, 21))).toBe("d21");
    expect(dueReminder(d, addDaysIso(start, 30))).toBeNull();
    expect(dueReminder({ ...d, status: "completed" }, addDaysIso(start, 18))).toBeNull();
  });
});

describe("deadline per klant", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let pd: typeof import("@/server/planning-deadlines");
  let A = "";

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    pd = await import("@/server/planning-deadlines");
    A = (await db.insert(s.clients).values({ slug: "klant-a", name: "Klant A", status: "active", weHandlePosting: true }).returning({ id: s.clients.id }))[0]!.id;
  });
  afterAll(async () => closeDatabase());

  it("start één keer, een tweede start doet niets", async () => {
    expect(await pd.startDeadlineIfNone(A, null)).toBe(true);
    expect(await pd.startDeadlineIfNone(A, null)).toBe(false);
    const rows = await db.select().from(s.planningDeadlines).where(eq(s.planningDeadlines.clientId, A));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("active");
  });

  it("niets open vanaf de start → blijft lopen; script bij klant en daarna akkoord → automatisch afgerond", async () => {
    await pd.evaluateDeadlines([A]);
    expect((await pd.activeDeadlineFor(A))).not.toBeNull();

    const [sc] = await db.insert(s.scripts).values({ clientId: A, title: "Script 1", status: "client_review" }).returning({ id: s.scripts.id });
    await pd.evaluateDeadlines([A]);
    const mid = await pd.loadClientDeadline(A);
    expect(mid!.actions.scriptsOpen).toBe(1);
    expect(mid!.view.done).toBe(false);

    await db.update(s.scripts).set({ status: "approved", approvedAt: new Date() }).where(eq(s.scripts.id, sc!.id));
    const after = await pd.loadClientDeadline(A);
    expect(after!.view.done).toBe(true);
    expect(after!.completedVia).toBe("auto");
    expect(after!.actions.scriptsDone).toBe(1);
    expect(await pd.activeDeadlineFor(A)).toBeNull();
  });

  it("na afronden kan er weer een nieuwe deadline starten", async () => {
    expect(await pd.startDeadlineIfNone(A, null)).toBe(true);
  });
});
