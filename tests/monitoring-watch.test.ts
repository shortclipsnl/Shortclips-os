import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * De volledige bewakingsronde tegen een echte testdatabase, met een nep-Frame.io
 * en een nep-mailserver. Bewijst de keten: storing → opgemerkt → zelf herstellen
 * → (lukt niet) → precies één melding aan alleen de beheerder → hersteld.
 */

const sent: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { to: string; subject: string; text: string }) => {
        sent.push(m);
        return { messageId: "x" };
      },
    }),
  },
}));

let frameOutcome: "ok" | "fail" = "ok";
vi.mock("@/server/jobs/frameio-library", () => ({
  syncFrameLibrary: async () => {
    const { db } = await import("@/db/client");
    const { syncJobs } = await import("@/db/schema");
    const now = new Date();
    await db.insert(syncJobs).values({
      provider: "frameio",
      jobType: "frameio.sync_library",
      status: frameOutcome === "ok" ? "success" : "error",
      startedAt: now,
      finishedAt: now,
      error: frameOutcome === "ok" ? null : "Frame.io tijdelijk niet bereikbaar (503)",
    });
    return { ok: frameOutcome === "ok" };
  },
}));

describe("Koppelingsbewaking: volledige ronde", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let watch: typeof import("@/server/monitoring/watch");
  let ownerId = "";
  let editorId = "";

  beforeAll(async () => {
    process.env.FRAMEIO_TOKEN = "test-token";
    process.env.FRAMEIO_ACCOUNT_ID = "acc";
    process.env.SMTP_HOST = "mail.example.test";
    process.env.SMTP_USER = "info@example.test";
    process.env.SMTP_PASSWORD = "geheim";
    db = await freshDatabase();
    s = await import("@/db/schema");
    watch = await import("@/server/monitoring/watch");
    const [o] = await db.insert(s.users).values({ email: "jarno@shortclips.nl", fullName: "Jarno", status: "active", primaryRole: "owner" }).returning({ id: s.users.id });
    const [e] = await db.insert(s.users).values({ email: "editor@shortclips.nl", fullName: "Editor", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    ownerId = o!.id;
    editorId = e!.id;
    // Een geplande taak die net draaide, zodat de planner als "actief" geldt.
    await db.insert(s.syncJobs).values({ provider: "system", jobType: "signals.daily", status: "success", startedAt: new Date(), finishedAt: new Date() });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  async function staleFrame(hoursAgo: number) {
    await db.delete(s.syncJobs).where(eq(s.syncJobs.jobType, "frameio.sync_library"));
    const t = new Date(Date.now() - hoursAgo * 3_600_000);
    await db.insert(s.syncJobs).values({ provider: "frameio", jobType: "frameio.sync_library", status: "success", startedAt: t, finishedAt: t });
  }

  it("tijdelijke uitval: opgemerkt, zelf hersteld, geen melding", async () => {
    await staleFrame(30);
    frameOutcome = "ok";
    const r = await watch.runMonitorWatch({ trigger: "test" });
    expect(r.recoveries).toEqual([{ key: "frameio", job: "frameio.sync_library", ok: true }]);
    const state = await watch.readMonitorState();
    expect(state.open.frameio).toBeUndefined();
    expect(state.history.find((h) => h.key === "frameio")?.autoResolved).toBe(true);
    expect(sent.filter((m) => m.subject.includes("Frame.io"))).toHaveLength(0);
  });

  it("herstel lukt niet: na de wachttijd precies één melding, alleen aan de beheerder", async () => {
    await staleFrame(30);
    frameOutcome = "fail";
    await watch.runMonitorWatch({ trigger: "test" });
    let state = await watch.readMonitorState();
    expect(state.open.frameio?.recoveryAttempts).toBe(1);
    expect(sent.filter((m) => m.subject.includes("Frame.io"))).toHaveLength(0); // nog binnen 30 min

    // Incident 40 minuten oud maken (alsof er tijd verstreken is).
    state.open.frameio!.openedAt = new Date(Date.now() - 40 * 60_000).toISOString();
    await db.update(s.appSettings).set({ value: state }).where(eq(s.appSettings.key, "monitoring.state"));

    await watch.runMonitorWatch({ trigger: "test", force: true });
    const alerts = sent.filter((m) => m.subject === "Storing: Frame.io werkt niet");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.to).toBe("jarno@shortclips.nl");
    expect(alerts[0]!.text).not.toMatch(/geheim|test-token/);

    const ownerNotes = await db.select().from(s.notifications).where(eq(s.notifications.userId, ownerId));
    const editorNotes = await db.select().from(s.notifications).where(eq(s.notifications.userId, editorId));
    expect(ownerNotes.some((n) => n.type === "integration_alert")).toBe(true);
    expect(editorNotes).toHaveLength(0);

    // Volgende ronde: geen tweede melding.
    await watch.runMonitorWatch({ trigger: "test", force: true });
    expect(sent.filter((m) => m.subject === "Storing: Frame.io werkt niet")).toHaveLength(1);
    state = await watch.readMonitorState();
    expect(state.open.frameio?.recoveryAttempts).toBeGreaterThanOrEqual(2);
  });

  it("na herstel: data weer actueel, 'hersteld'-mail en de melding verdwijnt", async () => {
    frameOutcome = "ok";
    await watch.runMonitorWatch({ trigger: "test", force: true });
    const state = await watch.readMonitorState();
    expect(state.open.frameio).toBeUndefined();
    expect(sent.filter((m) => m.subject === "Hersteld: Frame.io werkt weer")).toHaveLength(1);
    const ownerNotes = await db.select().from(s.notifications).where(eq(s.notifications.userId, ownerId));
    expect(ownerNotes.some((n) => n.type === "integration_alert")).toBe(false);
  });

  it("dashboard-overzicht: koppelingen en werkprocessen met status, rest blijft werken", async () => {
    const o = await watch.monitorOverview();
    const frame = o.integrations.find((c) => c.key === "frameio")!;
    expect(frame.level).toBe("ok");
    expect(o.integrations.find((c) => c.key === "google_drive")!.level).toBe("off");
    expect(o.integrations.find((c) => c.key === "pandadoc")!.level).toBe("off");
    expect(o.processes.map((p) => p.key)).toEqual([
      "opnameplanning", "scripting", "editing", "contentplanning", "klantportaal", "resultaten", "taken",
    ]);
    expect(o.processes.find((p) => p.key === "editing")!.level).toBe("ok");
  });

  it("twee rondes tegelijk: de tweede wordt overgeslagen (geen dubbele synchronisatie)", async () => {
    const [a, b] = await Promise.all([watch.runMonitorWatch({ trigger: "a" }), watch.runMonitorWatch({ trigger: "b" })]);
    expect([a.skipped, b.skipped].filter((x) => x === "locked")).toHaveLength(1);
  });
});
