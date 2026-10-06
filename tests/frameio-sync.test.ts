import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { FrameSource } from "@/server/jobs/frameio-sync";

/**
 * Bewijst de volledige Frame.io-keten zonder internet, met een nepbron:
 *   project → (veilig) aan klant gekoppeld → video's → klantfeedback.
 * En de harde eis: video's/feedback van klant A komen nooit bij klant B.
 */

/** Nepbron: twee klantprojecten met video's (A ook in een submap) + 1 opmerking. */
const source: FrameSource = {
  isConfigured: true,
  async listProjects() {
    return [
      { id: "p-a", name: "Klant A", root_folder_id: "f-a" },
      { id: "p-b", name: "Klant B", root_folder_id: "f-b" },
    ];
  },
  async getProject(projectId) {
    return { id: projectId, name: projectId, root_folder_id: `f-${projectId.slice(-1)}` };
  },
  async listFolderChildren(folderId) {
    if (folderId === "f-a") {
      return [
        { id: "vid-a1", name: "Video A1.mp4", type: "file", media_type: "video/mp4", view_url: "https://frame.io/a1", status: "needs_review" },
        { id: "sub-a", name: "Oude versies", type: "folder" },
        { id: "doc-a", name: "briefing.pdf", type: "file", media_type: "application/pdf" },
      ];
    }
    if (folderId === "sub-a") {
      return [{ id: "vid-a2", name: "Video A2.mov", type: "file", media_type: "video/quicktime" }];
    }
    if (folderId === "f-b") {
      return [{ id: "vid-b1", name: "Video B1.mp4", type: "file", media_type: "video/mp4" }];
    }
    return [];
  },
  async listComments(fileId) {
    if (fileId === "vid-a1") {
      return [{ id: "cmt-1", text: "Mooi, intro iets korter?", timestamp: 12.5, completed: false }];
    }
    return [];
  },
};

describe("Frame.io-keten (mock-bron)", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let jobs: typeof import("@/server/jobs/frameio-sync");
  const ids = { clientA: "", clientB: "" };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    jobs = await import("@/server/jobs/frameio-sync");

    const [a] = await db.insert(s.clients).values({ slug: "klant-a", name: "Klant A" }).returning({ id: s.clients.id });
    const [b] = await db.insert(s.clients).values({ slug: "klant-b", name: "Klant B" }).returning({ id: s.clients.id });
    ids.clientA = a!.id;
    ids.clientB = b!.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("koppelt een project automatisch alleen bij precies één naamgenoot", async () => {
    const res = await jobs.pullFrameProjects(undefined, source);
    expect(res.ok).toBe(true);

    const links = await db
      .select({ clientId: s.clientIntegrations.clientId, externalId: s.clientIntegrations.externalId })
      .from(s.clientIntegrations)
      .where(eq(s.clientIntegrations.provider, "frameio"));

    expect(links).toHaveLength(2);
    expect(links.find((l) => l.externalId === "p-a")?.clientId).toBe(ids.clientA);
    expect(links.find((l) => l.externalId === "p-b")?.clientId).toBe(ids.clientB);
  });

  it("maakt video's aan per klant — recursief, alleen videobestanden", async () => {
    const res = await jobs.pullFrameDeliverables(undefined, source);
    expect(res.ok).toBe(true);

    const aVideos = await db
      .select({ title: s.deliverables.title, frameAssetId: s.deliverables.frameAssetId, status: s.deliverables.status })
      .from(s.deliverables)
      .where(eq(s.deliverables.clientId, ids.clientA));

    // vid-a1 + vid-a2 (submap), NIET de pdf.
    expect(aVideos.map((v) => v.frameAssetId).sort()).toEqual(["vid-a1", "vid-a2"]);
    // Frame.io is het klant-reviewgereedschap → standaard "client_review".
    expect(aVideos.find((v) => v.frameAssetId === "vid-a1")?.status).toBe("client_review");
  });

  it("houdt video's van klanten strikt gescheiden", async () => {
    const bVideos = await db
      .select({ frameAssetId: s.deliverables.frameAssetId })
      .from(s.deliverables)
      .where(eq(s.deliverables.clientId, ids.clientB));
    expect(bVideos.map((v) => v.frameAssetId)).toEqual(["vid-b1"]);

    // Geen enkele video van klant A hoort bij klant B.
    const leaked = await db
      .select({ id: s.deliverables.id })
      .from(s.deliverables)
      .where(and(eq(s.deliverables.clientId, ids.clientB), eq(s.deliverables.frameAssetId, "vid-a1")));
    expect(leaked).toHaveLength(0);
  });

  it("haalt feedback op als klant-zichtbare draad op de juiste video", async () => {
    const res = await jobs.pullFrameComments(undefined, source);
    expect(res.ok).toBe(true);

    const [video] = await db
      .select({ id: s.deliverables.id })
      .from(s.deliverables)
      .where(eq(s.deliverables.frameAssetId, "vid-a1"))
      .limit(1);

    const threads = await db
      .select({ id: s.reviewThreads.id, visibility: s.reviewThreads.visibility, timecodeMs: s.reviewThreads.timecodeMs })
      .from(s.reviewThreads)
      .where(eq(s.reviewThreads.deliverableId, video!.id));
    expect(threads).toHaveLength(1);
    expect(threads[0]!.visibility).toBe("client");
    expect(threads[0]!.timecodeMs).toBe(12500);

    const comments = await db
      .select({ body: s.reviewComments.body, source: s.reviewComments.source })
      .from(s.reviewComments)
      .where(eq(s.reviewComments.threadId, threads[0]!.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain("intro iets korter");
    expect(comments[0]!.source).toBe("frameio");
  });

  it("is idempotent: nog een keer draaien maakt geen duplicaten", async () => {
    await jobs.pullFrameDeliverables(undefined, source);
    await jobs.pullFrameComments(undefined, source);

    const aVideos = await db
      .select({ id: s.deliverables.id })
      .from(s.deliverables)
      .where(eq(s.deliverables.clientId, ids.clientA));
    expect(aVideos).toHaveLength(2);

    const [video] = await db
      .select({ id: s.deliverables.id })
      .from(s.deliverables)
      .where(eq(s.deliverables.frameAssetId, "vid-a1"))
      .limit(1);
    const threads = await db
      .select({ id: s.reviewThreads.id })
      .from(s.reviewThreads)
      .where(eq(s.reviewThreads.deliverableId, video!.id));
    expect(threads).toHaveLength(1);
  });
});
