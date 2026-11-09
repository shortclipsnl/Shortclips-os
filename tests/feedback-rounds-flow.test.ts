import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Feedbacktermijn klant van begin tot eind op een echte (test)database:
 * naar Feedback klant → ronde start → werkdag 3 om 09:00 melding + taak voor
 * alléén de vaste verantwoordelijke → klant reageert → taak vervalt, melding weg.
 */
describe("Feedbacktermijn klant (flow)", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let svc: typeof import("@/server/feedback-rounds");
  let milou = "", jiska = "", editor = "", clientId = "", videoId = "";

  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const reminderTasks = () => db.select().from(s.tasks).where(like(s.tasks.dedupeKey, "feedbackronde:%"));
  const notes = (userId: string) => db.select().from(s.notifications).where(and(eq(s.notifications.userId, userId), eq(s.notifications.type, "feedback.reminder")));
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    await db.update(s.deliverables).set({ status: status as "client_review", statusChangedAt: new Date(), ...extra }).where(eq(s.deliverables.id, videoId));
    await svc.syncFeedbackRounds([videoId]);
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-11-09T10:00:00+01:00"); // maandag
    db = await freshDatabase();
    s = await import("@/db/schema");
    svc = await import("@/server/feedback-rounds");
    const [m] = await db.insert(s.users).values({ email: "milou@shortclips.nl", fullName: "Milou", status: "active", primaryRole: "content_creator" }).returning({ id: s.users.id });
    const [j] = await db.insert(s.users).values({ email: "jiska@shortclips.nl", fullName: "Jiska", status: "active", primaryRole: "content_creator" }).returning({ id: s.users.id });
    const [e] = await db.insert(s.users).values({ email: "quinn@x.nl", fullName: "Quinn", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    milou = m!.id; jiska = j!.id; editor = e!.id;
    const [c] = await db.insert(s.clients).values({ slug: "klant-x", name: "Klant X", status: "active", coordinatorId: milou }).returning({ id: s.clients.id });
    clientId = c!.id;
    const [d] = await db.insert(s.deliverables).values({ clientId, title: "November opname", status: "internal_review", editorId: editor, statusChangedAt: new Date() }).returning({ id: s.deliverables.id });
    videoId = d!.id;
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await closeDatabase(); });

  it("ronde start bij Feedback klant en telt werkdagen", async () => {
    await setStatus("client_review");
    const rounds = await db.select().from(s.clientFeedbackRounds);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ roundNumber: 1, termDays: 3, startedOn: "2026-11-09", dueOn: "2026-11-12" });
    at("2026-11-11T10:00:00+01:00");
    const term = (await svc.getFeedbackTerms([videoId])).get(videoId)!;
    expect(term).toMatchObject({ title: "Dag 2 van 3", sub: "Nog 1 werkdag", tone: "oranje" });
  });

  it("werkdag 3: pas om 09:00, alleen naar de verantwoordelijke, nooit dubbel", async () => {
    await setStatus("client_review");
    at("2026-11-11T12:00:00+01:00"); // dag 2
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(0);
    at("2026-11-12T08:30:00+01:00"); // dag 3, vóór 09:00
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(0);
    at("2026-11-12T09:00:00+01:00");
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(1);
    // Nogmaals draaien (volgend uur, herstart): niets extra.
    at("2026-11-12T10:00:00+01:00");
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(0);
    await svc.syncFeedbackRounds();

    const t = await reminderTasks();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ title: "Feedbackherinnering sturen: Klant X", assigneeId: milou, clientId, entityType: "deliverable", entityId: videoId, status: "todo", dueOn: "2026-11-12" });
    expect(await notes(milou)).toHaveLength(1);
    expect((await notes(milou))[0]).toMatchObject({ title: "Feedbackherinnering: Klant X", href: `/videos/${videoId}` });
    expect(await notes(jiska)).toHaveLength(0);
    expect(await notes(editor)).toHaveLength(0);
    const { taskHref } = await import("@/lib/task-links");
    expect(taskHref(t[0]!)).toBe(`/videos/${videoId}`);
  });

  it("vrijdag verstuurd: herinnering pas op woensdag (weekend telt niet)", async () => {
    at("2026-11-06T16:00:00+01:00");
    await setStatus("client_review");
    at("2026-11-10T09:30:00+01:00"); // dinsdag = dag 2
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(0);
    at("2026-11-11T09:30:00+01:00"); // woensdag = dag 3
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(1);
  });

  it("klant reageert: ronde stopt, taak vervalt, melding verdwijnt; nieuwe ronde = nieuwe termijn", async () => {
    await setStatus("client_review");
    at("2026-11-12T09:05:00+01:00");
    await svc.createDueFeedbackReminders();
    // Klant geeft feedback.
    await setStatus("client_revision", { clientRevisionRounds: 1 });
    const [r1] = await db.select().from(s.clientFeedbackRounds);
    expect(r1!.endedAt).not.toBeNull();
    expect(r1!.endedStatus).toBe("client_revision");
    expect((await reminderTasks())[0]!.status).toBe("cancelled");
    expect(await notes(milou)).toHaveLength(0);
    expect((await svc.getFeedbackTerms([videoId])).size).toBe(0); // teller gestopt

    // Feedback verwerkt, opnieuw naar de klant: ronde 2 met eigen termijn.
    at("2026-11-16T11:00:00+01:00");
    await setStatus("client_review");
    const rounds = await db.select().from(s.clientFeedbackRounds).orderBy(s.clientFeedbackRounds.roundNumber);
    expect(rounds.map((r) => r.roundNumber)).toEqual([1, 2]);
    expect(rounds[1]).toMatchObject({ startedOn: "2026-11-16", dueOn: "2026-11-19", endedAt: null });
    at("2026-11-19T09:00:00+01:00");
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(1);
    expect(await reminderTasks()).toHaveLength(2); // eerdere ronde blijft geregistreerd
  });

  it("afgevinkte taak blijft afgevinkt en geeft 'herinnering verstuurd'", async () => {
    await setStatus("client_review");
    at("2026-11-12T09:00:00+01:00");
    await svc.createDueFeedbackReminders();
    const [t] = await reminderTasks();
    await db.update(s.tasks).set({ status: "done", completedAt: new Date() }).where(eq(s.tasks.id, t!.id));
    expect((await svc.getFeedbackTerms([videoId])).get(videoId)!.reminder).toBe("verstuurd");
    at("2026-11-13T10:00:00+01:00");
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(0);
    expect((await svc.getFeedbackTerms([videoId])).get(videoId)).toMatchObject({ title: "Klant te laat" });
    await setStatus("approved");
    expect((await reminderTasks())[0]!.status).toBe("done"); // afgevinkt blijft afgevinkt
  });

  it("geen herinnering naar een editor of bij een niet actieve klant", async () => {
    await db.update(s.clients).set({ coordinatorId: editor }).where(eq(s.clients.id, clientId));
    await setStatus("client_review");
    at("2026-11-12T09:00:00+01:00");
    const res = await svc.createDueFeedbackReminders();
    expect(res).toMatchObject({ reminded: 0, skippedNoOwner: 1 });
    expect(await notes(editor)).toHaveLength(0);

    await db.update(s.clients).set({ coordinatorId: milou, status: "paused" }).where(eq(s.clients.id, clientId));
    expect((await svc.createDueFeedbackReminders()).reminded).toBe(0);
  });

  it("bestaande opvolgtaak van de oude regel telt als herinnering (geen dubbele taak)", async () => {
    await setStatus("client_review");
    await db.insert(s.tasks).values({ clientId, title: "Klant opvolgen over openstaande feedback", status: "todo", assigneeId: milou, entityType: "deliverable", entityId: videoId, source: "automation", dedupeKey: `client_silent_for_5_days:${videoId}:` });
    at("2026-11-12T09:00:00+01:00");
    expect(await svc.createDueFeedbackReminders()).toMatchObject({ reminded: 0, covered: 1 });
    expect(await reminderTasks()).toHaveLength(0);
    expect(await svc.remindedDeliverables([videoId])).toEqual(new Set([videoId]));
  });
});
