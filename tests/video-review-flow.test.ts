import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Volledige videobeoordeling zonder internet, op een echte (PGlite) database:
 * klant plaatst opmerkingen → verstuurt in één keer → Frame.io krijgt ze op de
 * juiste versie en framestempel → editor vinkt af/antwoordt → nieuwe versie →
 * opnieuw beoordelen → goedkeuren. Plus klantscheiding en foutafhandeling.
 */

type FrameCall = { fileId: string; text: string; timestamp: number | null | undefined };
const frame = {
  created: [] as FrameCall[],
  remote: new Map<string, Array<{ id: string; text: string; timestamp: number | null; created_at: string; completed_at: string | null; file_id: string }>>(),
  failNext: false,
  statusCalls: [] as Array<{ projectId: string; fileIds: string[]; value: unknown }>,
  stack: { parent: "stack-1", children: [] as string[] },
};

vi.mock("@/server/integrations/frameio", () => ({
  frameio: {
    isConfigured: true,
    async createComment(fileId: string, input: { text: string; timestamp?: number | null }) {
      if (frame.failNext) {
        frame.failNext = false;
        // Fout ná het aanmaken (time-out): Frame heeft hem wel, wij weten het niet.
        const id = `fc-${frame.created.length + 1}`;
        frame.created.push({ fileId, text: input.text, timestamp: input.timestamp });
        frame.remote.set(fileId, [...(frame.remote.get(fileId) ?? []), { id, text: input.text, timestamp: input.timestamp ?? null, created_at: new Date().toISOString(), completed_at: null, file_id: fileId }]);
        throw new Error("Time-out bij het externe systeem");
      }
      const id = `fc-${frame.created.length + 1}`;
      frame.created.push({ fileId, text: input.text, timestamp: input.timestamp });
      frame.remote.set(fileId, [...(frame.remote.get(fileId) ?? []), { id, text: input.text, timestamp: input.timestamp ?? null, created_at: new Date().toISOString(), completed_at: null, file_id: fileId }]);
      return { id, file_id: fileId };
    },
    async listCommentsDetailed(fileId: string) {
      return frame.remote.get(fileId) ?? [];
    },
    async getComment(id: string) {
      for (const list of frame.remote.values()) {
        const hit = list.find((c) => c.id === id);
        if (hit) return hit;
      }
      return null;
    },
    async getFileMetadata() {
      return [{ field_definition_id: "fr", field_definition_name: "Frame Rate", value: 50 }];
    },
    async listFieldDefinitions() {
      return [{ id: "status", name: "Status", field_type: "select", mutable: true, field_configuration: { options: [{ id: "o-review", display_name: "Needs Review" }, { id: "o-progress", display_name: "In Progress" }, { id: "o-approved", display_name: "Approved" }] } }];
    },
    async setMetadataValues(projectId: string, fileIds: string[], values: Array<{ value: unknown }>) {
      frame.statusCalls.push({ projectId, fileIds, value: values[0]?.value });
    },
    async getFile(id: string) {
      return { id, parent_id: frame.stack.parent };
    },
    async listVersionStackChildren() {
      return frame.stack.children.map((id) => ({ id, name: id, type: "file" }));
    },
  },
}));

let viewer: Record<string, unknown> = {};
vi.mock("@/server/auth/context", async (orig) => {
  const real = await orig<typeof import("@/server/auth/context")>();
  return { ...real, requirePortal: async () => viewer, getViewer: async () => viewer };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/server/audit", () => ({ auditLog: async () => undefined, recordActivity: async () => undefined, logError: async () => undefined }));

describe("videobeoordeling klantportaal", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  const ids = { a: "", b: "", user: "", editor: "", coord: "", day: "", del: "", v1: "", v2: "", vb: "" };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    const [coord] = await db.insert(s.users).values({ email: "milou@test.nl", fullName: "Milou", status: "active", primaryRole: "project_coordinator" }).returning({ id: s.users.id });
    const [editor] = await db.insert(s.users).values({ email: "editor@test.nl", fullName: "Editor", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    const [user] = await db.insert(s.users).values({ email: "klant@kubo.nl", fullName: "Sanne", status: "active", primaryRole: "client", isStaff: false } as never).returning({ id: s.users.id });
    const [a] = await db.insert(s.clients).values({ slug: "kubo", name: "KUBO", coordinatorId: coord!.id }).returning({ id: s.clients.id });
    const [b] = await db.insert(s.clients).values({ slug: "ander", name: "Andere klant" }).returning({ id: s.clients.id });
    Object.assign(ids, { a: a!.id, b: b!.id, user: user!.id, editor: editor!.id, coord: coord!.id });
    const [day] = await db.insert(s.productionDays).values({ clientId: ids.a, title: "Opname", scheduledOn: "2026-12-10" } as never).returning({ id: s.productionDays.id });
    ids.day = day!.id;
    const [del] = await db.insert(s.deliverables).values({ clientId: ids.a, title: "Opname 10 december", status: "client_review", productionDayId: ids.day, editorId: ids.editor }).returning({ id: s.deliverables.id });
    ids.del = del!.id;
    const asset = (clientId: string, file: string, name: string, session: string, dayId: string | null) => ({
      clientId, frameProjectId: `p-${clientId.slice(0, 4)}`, frameFileId: file, mediaFileId: file, name, sessionFolderId: session, sessionName: "SESSIE 3 - 10 DECEMBER", sessionProductionDayId: dayId, sessionCreatedAt: new Date(), versionCount: 1,
    });
    const rows = await db.insert(s.frameAssets).values([asset(ids.a, "f1", "1. Video een.mp4", "sess", ids.day), asset(ids.a, "f2", "2. Video twee.mp4", "sess", ids.day), asset(ids.b, "fb", "Geheim.mp4", "sess-b", null)]).returning({ id: s.frameAssets.id, f: s.frameAssets.frameFileId });
    ids.v1 = rows.find((r) => r.f === "f1")!.id;
    ids.v2 = rows.find((r) => r.f === "f2")!.id;
    ids.vb = rows.find((r) => r.f === "fb")!.id;
    viewer = { id: ids.user, fullName: "Sanne", email: "klant@kubo.nl", isPortalUser: true, clientId: ids.a, clientScope: [ids.a], permissions: new Set(), primaryRole: "client", isEditorOnly: false };
  });
  afterAll(async () => closeDatabase());
  beforeEach(() => {
    frame.failNext = false;
  });

  it("start met 'wacht op beoordeling' voor elke video van de sessie", async () => {
    const { loadVideoReviews } = await import("@/server/video-review");
    const r = await loadVideoReviews(ids.a, [{ id: ids.v1, mediaFileId: "f1", versionCount: 1 }, { id: ids.v2, mediaFileId: "f2", versionCount: 1 }], { key: "feedback", deliverableStatus: "client_review" });
    expect(r.get(ids.v1)?.label).toBe("wacht");
    expect(r.get(ids.v1)?.state.canReview).toBe(true);
  });

  it("concepten blijven lokaal tot 'Feedback versturen'; daarna één bundel naar Frame.io en het team", async () => {
    const act = await import("@/server/actions/video-review");
    expect((await act.addVideoComment({ assetId: ids.v1, timecodeMs: 18_000, body: "Kunnen jullie hier een andere opname gebruiken?" })).ok).toBe(true);
    expect((await act.addVideoComment({ assetId: ids.v1, timecodeMs: 25_500, body: "Logo iets groter" })).ok).toBe(true);
    expect((await act.addVideoComment({ assetId: ids.v1, timecodeMs: null, body: "Muziek mag rustiger" })).ok).toBe(true);
    expect(frame.created.length).toBe(0); // nog niets naar Frame

    // Andermans video: bestaat niet voor deze klant.
    const foreign = await act.addVideoComment({ assetId: ids.vb, timecodeMs: 1000, body: "x" });
    expect(foreign.ok).toBe(false);

    frame.failNext = true; // eerste opmerking: time-out ná aanmaken in Frame
    const res = await act.submitSessionFeedback("sess");
    expect(res.ok).toBe(true);

    // 18 s bij 50 fps = framestempel 900, op exact het bestand (versie) f1.
    const first = frame.created[0]!;
    expect(first.fileId).toBe("f1");
    expect(first.timestamp).toBe(900);
    expect(first.text).toContain("Klantfeedback van Sanne (KUBO) via het Shortclips portaal:");
    expect(frame.created.find((c) => c.text.endsWith("Muziek mag rustiger"))?.timestamp ?? null).toBeNull();

    const rows = await db.select().from(s.portalVideoComments).where(eq(s.portalVideoComments.frameAssetId, ids.v1));
    expect(rows.every((r) => r.status === "submitted")).toBe(true);
    expect(rows.filter((r) => r.syncStatus === "failed").length).toBe(1);

    // Editingproject volgt de bestaande workflow: feedback verwerken + 1 ronde.
    const [d] = await db.select().from(s.deliverables).where(eq(s.deliverables.id, ids.del));
    expect(d!.status).toBe("client_revision");
    expect(d!.clientRevisionRounds).toBe(1);
    const threads = await db.select().from(s.reviewThreads).where(eq(s.reviewThreads.deliverableId, ids.del));
    expect(threads.length).toBe(3);

    // Precies één melding, voor editor + projectmanager, met de juiste tekst.
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.type, "portal.video_feedback"));
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set([ids.editor, ids.coord]));
    expect(notes[0]!.title).toBe("Nieuwe feedback ontvangen van KUBO");
    expect(notes[0]!.body).toBe("Er staan 3 opmerkingen klaar bij video 1 van sessie 3 · 10 december. Bekijk de feedback.");

    expect(frame.statusCalls.at(-1)?.value).toEqual(["o-progress"]);
  });

  it("opnieuw proberen maakt geen dubbele opmerking in Frame.io", async () => {
    const before = frame.created.length;
    await db.update(s.portalVideoComments).set({ updatedAt: new Date(Date.now() - 10 * 60_000) });
    const { runVideoReviewSync } = await import("@/server/video-review-sync");
    const out = await runVideoReviewSync();
    expect(out.retried).toBe(1);
    expect(frame.created.length).toBe(before); // teruggevonden, niet opnieuw geplaatst
    const failed = await db.select().from(s.portalVideoComments).where(eq(s.portalVideoComments.syncStatus, "failed"));
    expect(failed.length).toBe(0);
  });

  it("afvinken en antwoorden in Frame.io komen terug in het portaal (één keer)", async () => {
    const list = frame.remote.get("f1")!;
    list[0]!.completed_at = new Date().toISOString();
    list.push({ id: "team-1", text: "Klopt, we pakken shot 2", timestamp: 905, created_at: new Date(Date.now() + 1000).toISOString(), completed_at: null, file_id: "f1" });
    list.push({ id: "team-2", text: "intern: check kleurcorrectie", timestamp: 902, created_at: new Date(Date.now() + 1000).toISOString(), completed_at: null, file_id: "f1" });
    list.push({ id: "team-3", text: "Losse notitie elders", timestamp: 2000, created_at: new Date(Date.now() + 1000).toISOString(), completed_at: null, file_id: "f1" });
    const { pullFrameUpdates } = await import("@/server/video-review-sync");
    const r1 = await pullFrameUpdates([ids.v1]);
    const r2 = await pullFrameUpdates([ids.v1]);
    expect(r1.completed).toBe(1);
    expect(r1.replies).toBe(1);
    expect(r2.replies).toBe(0);
    const { loadVideoReviews } = await import("@/server/video-review");
    const rev = (await loadVideoReviews(ids.a, [{ id: ids.v1, mediaFileId: "f1", versionCount: 1 }], { key: "verwerken", deliverableStatus: "client_revision" })).get(ids.v1)!;
    const reply = rev.comments.find((c) => c.authorKind === "shortclips")!;
    expect(reply.body).toBe("Klopt, we pakken shot 2");
    expect(rev.comments.find((c) => c.id === reply.parentId)?.timecodeMs).toBe(18_000);
    expect(rev.comments.some((c) => c.body.startsWith("intern"))).toBe(false);
    expect(rev.label).toBe("feedback_verwerken");
  });

  it("een andere klant ziet niets van deze feedback", async () => {
    const { loadVideoReviews } = await import("@/server/video-review");
    const r = await loadVideoReviews(ids.b, [{ id: ids.v1, mediaFileId: "f1", versionCount: 1 }], { key: "feedback", deliverableStatus: "client_review" });
    expect(r.get(ids.v1)?.comments.length).toBe(0);
  });

  it("nieuwe versie: zelfde video, oude feedback blijft bij versie 1, klant beoordeelt opnieuw", async () => {
    frame.stack = { parent: "stack-1", children: ["f1-v2", "f1"] };
    const { applyNewVersion } = await import("@/server/video-review-sync");
    expect((await applyNewVersion("f1-v2")).updated).toBe(true);
    const [row] = await db.select().from(s.frameAssets).where(eq(s.frameAssets.id, ids.v1));
    expect(row!.frameFileId).toBe("stack-1");
    expect(row!.mediaFileId).toBe("f1-v2");
    expect(row!.versionCount).toBe(2);

    await db.update(s.deliverables).set({ status: "client_review" }).where(eq(s.deliverables.id, ids.del));
    const { loadVideoReviews } = await import("@/server/video-review");
    const rev = (await loadVideoReviews(ids.a, [{ id: ids.v1, mediaFileId: "f1-v2", versionCount: 2 }], { key: "feedback", deliverableStatus: "client_review" })).get(ids.v1)!;
    expect(rev.label).toBe("opnieuw_beoordelen");
    expect(rev.comments.length).toBe(0);
    expect(rev.previous.length).toBeGreaterThan(0);
  });

  it("goedkeuren per video; als alles akkoord is gaat het editingproject op goedgekeurd", async () => {
    const act = await import("@/server/actions/video-review");
    const r1 = await act.approvePortalVideo(ids.v1);
    expect(r1.ok).toBe(true);
    let [d] = await db.select().from(s.deliverables).where(eq(s.deliverables.id, ids.del));
    expect(d!.status).toBe("client_review"); // video 2 staat nog open
    expect(frame.statusCalls.at(-1)).toMatchObject({ fileIds: ["f1-v2"], value: ["o-approved"] });

    // Dubbel klikken: geen tweede goedkeuring.
    await act.approvePortalVideo(ids.v1);
    const appr = await db.select().from(s.portalVideoApprovals).where(eq(s.portalVideoApprovals.frameAssetId, ids.v1));
    expect(appr.length).toBe(1);

    const r2 = await act.approvePortalVideo(ids.v2);
    expect(r2.message).toContain("Alle video's");
    [d] = await db.select().from(s.deliverables).where(eq(s.deliverables.id, ids.del));
    expect(d!.status).toBe("approved");

    // Goedgekeurd = niet opnieuw ter beoordeling, geen nieuwe opmerkingen meer.
    const again = await act.addVideoComment({ assetId: ids.v2, timecodeMs: 1000, body: "Toch nog iets" });
    expect(again.ok).toBe(false);
    const open = await db.select().from(s.portalVideoComments).where(and(eq(s.portalVideoComments.frameAssetId, ids.v2), isNull(s.portalVideoComments.deletedAt)));
    expect(open.length).toBe(0);
  });
});
