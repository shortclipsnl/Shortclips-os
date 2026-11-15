import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { Viewer } from "@/server/auth/context";

/**
 * Feedbacktermijn per klant: een afwijkende klantafspraak werkt door in de
 * videoronde, de correctieversie, het scriptbericht en het overzicht
 * Feedbackstatus. Zonder afwijking geldt de algemene termijn.
 */
describe("Feedbacktermijn per klant", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let milou = "", standaard = "", afwijkend = "";
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const viewer = () => ({ id: milou, clientScope: null, permissions: new Set<string>(), primaryRole: "content_creator" }) as unknown as Viewer;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-11-16T10:00:00+01:00"); // maandag
    db = await freshDatabase();
    s = await import("@/db/schema");
    const [m] = await db.insert(s.users).values({ email: "milou@shortclips.nl", fullName: "Milou Test", status: "active", primaryRole: "content_creator" }).returning({ id: s.users.id });
    milou = m!.id;
    const [a] = await db.insert(s.clients).values({ slug: "standaard", name: "Standaard BV", status: "active", coordinatorId: milou }).returning({ id: s.clients.id });
    const [b] = await db.insert(s.clients).values({ slug: "afwijkend", name: "Afwijkend BV", status: "active", coordinatorId: milou }).returning({ id: s.clients.id });
    standaard = a!.id; afwijkend = b!.id;
    await db.insert(s.clientAgreementOverrides).values({ clientId: afwijkend, overrides: { feedbackDaysVideos: 5, feedbackDaysScripts: 4 } });
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await closeDatabase(); });

  it("algemene termijn en afwijkende klantafspraak", async () => {
    const { getFeedbackDaysByClient, getFeedbackDaysForClient } = await import("@/server/portal-settings");
    const map = await getFeedbackDaysByClient([standaard, afwijkend]);
    expect(map.get(standaard)).toEqual({ scripts: 3, videos: 3, correction: 3 });
    // Geen eigen correctietermijn: die volgt de afwijkende videotermijn van de klant.
    expect(map.get(afwijkend)).toEqual({ scripts: 4, videos: 5, correction: 5 });
    expect(await getFeedbackDaysForClient(afwijkend)).toEqual({ scripts: 4, videos: 5, correction: 5 });
  });

  it("videoronde, klantdeadline en overzicht volgen de termijn van de klant", async () => {
    const svc = await import("@/server/feedback-rounds");
    const mk = async (clientId: string) => {
      const [d] = await db.insert(s.deliverables).values({ clientId, title: "November opname", status: "client_review", statusChangedAt: new Date() }).returning({ id: s.deliverables.id });
      return d!.id;
    };
    const v1 = await mk(standaard);
    const v2 = await mk(afwijkend);
    await svc.syncFeedbackRounds([v1, v2]);
    const rounds = await db.select().from(s.clientFeedbackRounds);
    expect(rounds.find((r) => r.deliverableId === v1)).toMatchObject({ termDays: 3, dueOn: "2026-11-19" });
    expect(rounds.find((r) => r.deliverableId === v2)).toMatchObject({ termDays: 5, dueOn: "2026-11-23" });

    // Het klantportaal toont exact die deadline, om 17:00 Nederlandse tijd.
    const dl = await svc.videoFeedbackDeadlines([
      { deliverableId: v1, clientId: standaard, statusChangedAt: new Date() },
      { deliverableId: v2, clientId: afwijkend, statusChangedAt: new Date() },
    ]);
    expect(dl.get(v1)!.toISOString()).toBe("2026-11-19T16:00:00.000Z");
    expect(dl.get(v2)!.toISOString()).toBe("2026-11-23T16:00:00.000Z");

    const { getFeedbackStatusOverview } = await import("@/server/feedback-overview");
    at("2026-11-20T10:00:00+01:00"); // vrijdag: standaard is verlopen, afwijkend nadert
    const rows = await getFeedbackStatusOverview(viewer());
    expect(rows.find((r) => r.clientId === standaard)).toMatchObject({ kind: "videos", dueDay: "2026-11-19", status: "verlopen", responsibleName: "Milou Test" });
    expect(rows.find((r) => r.clientId === afwijkend)).toMatchObject({ kind: "videos", dueDay: "2026-11-23", status: "nadert" });

    // Klant geeft feedback: de regel wordt "Feedback ontvangen", zonder deadline.
    await db.update(s.deliverables).set({ status: "client_revision", statusChangedAt: new Date() }).where(eq(s.deliverables.id, v1));
    await svc.syncFeedbackRounds([v1]);
    const after = await getFeedbackStatusOverview(viewer());
    expect(after.find((r) => r.clientId === standaard)).toMatchObject({ status: "ontvangen", dueDay: null });
  });

  it("scriptbericht krijgt de termijn en exacte deadline van de klant", async () => {
    const { scriptberichtTermijnen } = await import("@/server/feedback-overview");
    const t = await scriptberichtTermijnen([
      { id: "a", clientId: standaard, reviewId: null },
      { id: "b", clientId: afwijkend, reviewId: null },
    ]);
    expect(t.get("a")).toEqual({ termijn: "3 werkdagen", deadline: "donderdag 19 november om 17:00" });
    expect(t.get("b")).toEqual({ termijn: "4 werkdagen", deadline: "vrijdag 20 november om 17:00" });
  });
});
