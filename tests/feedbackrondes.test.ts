import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, deliverables, users } from "@/db/schema";
import { extraFeedbackRoundText, FEEDBACK_ROUND_OPTIONS, isExtraFeedbackRound } from "@/lib/feedback-rounds";
import type { Viewer } from "@/server/auth/context";

/**
 * Feedbackrondes per opname: eigen teller per editingproject, standaard 0,
 * waarschuwing vanaf 2, en alleen zichtbaar voor het kernteam.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let editorId: string;
let clientId: string;
let opnameA: string;
let opnameB: string;

function viewer(email: string, extra: Partial<Viewer> = {}): Viewer {
  return { email, isPortalUser: false, isEditorOnly: false, ...extra } as unknown as Viewer;
}

beforeAll(async () => {
  db = await freshDatabase();
  const [e] = await db.insert(users).values({ email: "editor@example.com", fullName: "Editor Test", status: "active", primaryRole: "editor" }).returning({ id: users.id });
  editorId = e!.id;
  const [c] = await db.insert(clients).values({ slug: "klant-fb", name: "Klant FB", status: "active" }).returning({ id: clients.id });
  clientId = c!.id;
  const rows = await db
    .insert(deliverables)
    .values([
      { clientId, title: "Opname oktober", status: "client_review", editorId },
      { clientId, title: "Opname november", status: "client_review", editorId },
    ])
    .returning({ id: deliverables.id });
  opnameA = rows[0]!.id;
  opnameB = rows[1]!.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe("feedbackrondes", () => {
  it("staat standaard op 0", async () => {
    const all = await db.select({ id: deliverables.id, n: deliverables.feedbackRounds }).from(deliverables).where(eq(deliverables.clientId, clientId));
    expect(all.map((r) => r.n)).toEqual([0, 0]);
  });

  it("opnames van dezelfde klant overschrijven elkaar niet", async () => {
    await db.update(deliverables).set({ feedbackRounds: 3 }).where(eq(deliverables.id, opnameA));
    const [a] = await db.select({ n: deliverables.feedbackRounds }).from(deliverables).where(eq(deliverables.id, opnameA));
    const [b] = await db.select({ n: deliverables.feedbackRounds }).from(deliverables).where(eq(deliverables.id, opnameB));
    expect(a!.n).toBe(3);
    expect(b!.n).toBe(0);
  });

  it("board stuurt de waarde alleen mee als dat expliciet mag", async () => {
    const { listEditorBoard } = await import("@/server/editor-board");
    const asEditor = viewer("editor@example.com", { id: editorId, isEditorOnly: true });
    const zonder = await listEditorBoard(asEditor);
    expect(zonder.every((v) => v.feedbackRounds === null)).toBe(true);
    const met = await listEditorBoard(asEditor, { withFeedbackRounds: true });
    expect(met.find((v) => v.id === opnameA)?.feedbackRounds).toBe(3);
    expect(met.find((v) => v.id === opnameB)?.feedbackRounds).toBe(0);
  });

  it("waarschuwing vanaf ronde 2", () => {
    expect(FEEDBACK_ROUND_OPTIONS).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(isExtraFeedbackRound(0)).toBe(false);
    expect(isExtraFeedbackRound(1)).toBe(false);
    expect(isExtraFeedbackRound(2)).toBe(true);
    expect(isExtraFeedbackRound(6)).toBe(true);
    expect(extraFeedbackRoundText(2)).toContain("tweede feedbackronde");
    expect(extraFeedbackRoundText(4)).toContain("vierde feedbackronde");
    expect(extraFeedbackRoundText(2)).not.toMatch(/€|\d+,\d{2}/);
  });

  it("alleen Jarno, Milou, Jiska en Rutger", async () => {
    const { canManageFeedbackRounds } = await import("@/server/feedback-rounds");
    for (const mail of ["jarno@shortclips.nl", "milou@shortclips.nl", "jiska@shortclips.nl", "rutger@shortclips.nl", "Milou@Shortclips.nl"]) {
      expect(canManageFeedbackRounds(viewer(mail))).toBe(true);
    }
    expect(canManageFeedbackRounds(viewer("max@shortclips.nl"))).toBe(false);
    expect(canManageFeedbackRounds(viewer("fabian@shortclips.nl", { isEditorOnly: true }))).toBe(false);
    expect(canManageFeedbackRounds(viewer("klant@bedrijf.nl", { isPortalUser: true }))).toBe(false);
    expect(canManageFeedbackRounds(null)).toBe(false);
  });
});
