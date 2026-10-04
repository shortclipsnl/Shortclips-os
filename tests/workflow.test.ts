import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * De pipeline van opname tot publicatie, plus de automatiseringen die daaraan
 * hangen. Deze test bewijst dat een statuswissel echt gevolgen heeft: een
 * goedkeuringsverzoek, een taak en een melding ontstaan vanzelf.
 */
describe("video pipeline en automatiseringen", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let automation: typeof import("@/server/automation");

  let clientId = "";
  let videoId = "";
  let coordinatorId = "";

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    automation = await import("@/server/automation");

    const [coordinator] = await db
      .insert(s.users)
      .values({
        email: "coord@test.nl",
        fullName: "Coördinator",
        primaryRole: "project_coordinator",
        status: "active",
      })
      .returning({ id: s.users.id });
    coordinatorId = coordinator!.id;

    const [client] = await db
      .insert(s.clients)
      .values({ slug: "test", name: "Testklant", coordinatorId })
      .returning({ id: s.clients.id });
    clientId = client!.id;

    const [video] = await db
      .insert(s.deliverables)
      .values({ clientId, title: "Testvideo", status: "internal_review" })
      .returning({ id: s.deliverables.id });
    videoId = video!.id;

    // De regels die ook in productie draaien.
    await db.insert(s.automationRules).values([
      {
        key: "video_to_client_review_notifies_client",
        name: "Naar klantcontrole",
        trigger: "video.status_changed",
        conditions: { to: "client_review" },
        actions: [
          { type: "create_approval", kind: "video" },
          { type: "notify_client", title: "Nieuwe video klaar" },
        ],
        isEnabled: true,
      },
      {
        key: "approved_video_creates_publish_task",
        name: "Na goedkeuring inplannen",
        trigger: "video.status_changed",
        conditions: { to: "approved" },
        actions: [
          { type: "create_task", title: "Video inplannen voor publicatie", priority: "high" },
          { type: "set_video_status", status: "ready_to_publish" },
        ],
        isEnabled: true,
      },
      {
        key: "uitgeschakelde_regel",
        name: "Mag niet draaien",
        trigger: "video.status_changed",
        conditions: { to: "client_review" },
        actions: [{ type: "create_task", title: "Zou niet moeten bestaan" }],
        isEnabled: false,
      },
    ]);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("maakt een goedkeuringsverzoek aan zodra de video naar klantcontrole gaat", async () => {
    await automation.dispatch({
      trigger: "video.status_changed",
      clientId,
      entityType: "deliverable",
      entityId: videoId,
      data: { from: "internal_review", to: "client_review", coordinatorId },
    });

    const approvals = await db
      .select()
      .from(s.approvals)
      .where(eq(s.approvals.entityId, videoId));

    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.status).toBe("pending");
    expect(approvals[0]!.kind).toBe("video");
  });

  it("draait geen uitgeschakelde regels", async () => {
    const tasks = await db.select().from(s.tasks);
    expect(tasks.some((t) => t.title === "Zou niet moeten bestaan")).toBe(false);
  });

  it("maakt na goedkeuring een publicatietaak en zet de status door", async () => {
    await automation.dispatch({
      trigger: "video.status_changed",
      clientId,
      entityType: "deliverable",
      entityId: videoId,
      data: { from: "client_review", to: "approved", coordinatorId },
    });

    const tasks = await db.select().from(s.tasks).where(eq(s.tasks.entityId, videoId));
    expect(tasks.some((t) => t.title === "Video inplannen voor publicatie")).toBe(true);
    expect(tasks[0]!.priority).toBe("high");
    expect(tasks[0]!.assigneeId).toBe(coordinatorId);

    const [video] = await db
      .select({ status: s.deliverables.status })
      .from(s.deliverables)
      .where(eq(s.deliverables.id, videoId));
    expect(video!.status).toBe("ready_to_publish");
  });

  it("legt elke uitvoering vast met resultaat", async () => {
    const runs = await db.select().from(s.automationRuns);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const run of runs) {
      expect(run.status).toBe("success");
      expect(run.finishedAt).not.toBeNull();
    }
  });

  it("negeert regels waarvan de voorwaarde niet klopt", async () => {
    const before = (await db.select().from(s.automationRuns)).length;

    await automation.dispatch({
      trigger: "video.status_changed",
      clientId,
      entityType: "deliverable",
      entityId: videoId,
      data: { from: "approved", to: "editing" },
    });

    const after = (await db.select().from(s.automationRuns)).length;
    expect(after).toBe(before);
  });
});

describe("meldingen worden niet gedupliceerd", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let notify: typeof import("@/server/notifications").notify;
  let userId = "";

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    notify = (await import("@/server/notifications")).notify;

    const [user] = await db
      .insert(s.users)
      .values({ email: "u@test.nl", fullName: "Gebruiker", primaryRole: "owner", status: "active" })
      .returning({ id: s.users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("plaatst dezelfde melding maar één keer", async () => {
    const input = {
      userIds: [userId],
      type: "video.overdue",
      title: "Video is te laat",
      dedupeKey: "video_overdue:abc:2026-08-18",
    };

    const first = await notify(input);
    const second = await notify(input);

    expect(first).toBe(1);
    expect(second).toBe(0);

    const rows = await db.select().from(s.notifications);
    expect(rows).toHaveLength(1);
  });

  it("plaatst wel een melding met een andere sleutel", async () => {
    const count = await notify({
      userIds: [userId],
      type: "video.overdue",
      title: "Andere video is te laat",
      dedupeKey: "video_overdue:def:2026-08-18",
    });
    expect(count).toBe(1);
  });
});
