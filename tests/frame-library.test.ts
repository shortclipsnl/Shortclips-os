import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { FrameLibrarySource } from "@/server/jobs/frameio-library";

/**
 * Frame.io-bibliotheek voor het klantportaal, zonder internet:
 *  - sessies = map onder het project (jaarmap wordt overgeslagen);
 *  - version stack telt als één video (nieuwste versie);
 *  - foto's/PDF's worden genegeerd;
 *  - klant A ziet nooit iets van klant B.
 */
const NOW = "2026-11-04T10:00:00Z";
const source: FrameLibrarySource = {
  isConfigured: true,
  async listProjects() {
    return [
      { id: "p-a", name: "KLANT A ", root_folder_id: "root-a" },
      { id: "p-b", name: "Klant B", root_folder_id: "root-b" },
      { id: "p-x", name: "Onbekend project", root_folder_id: "root-x" },
    ];
  },
  async listFolderChildrenAll(folderId) {
    const map: Record<string, unknown[]> = {
      "root-a": [{ id: "y-2026", name: "2026", type: "folder" }],
      "y-2026": [
        { id: "s1", name: "SESSIE 1 - 6 MAART", type: "folder", created_at: "2026-04-08T10:00:00Z", updated_at: NOW },
        { id: "s2", name: "SESSIE 2", type: "folder", created_at: NOW, updated_at: NOW },
      ],
      s1: [
        { id: "a1", name: "01_V3 Horren schoonmaken.mp4", type: "file", media_type: "video/mp4", created_at: NOW },
        { id: "img", name: "foto.jpg", type: "file", media_type: "image/jpeg" },
        { id: "sub", name: "AD - VERKORTE VERSIES", type: "folder" },
      ],
      sub: [{ id: "a2", name: "06 Verhuizen 4-5.mp4", type: "file", media_type: "video/mp4" }],
      s2: [
        { id: "stack", name: "4B. 21 GRADEN.mp4", type: "version_stack", head_version: { id: "head", name: "4B. 21 GRADEN.mp4", type: "file", media_type: "video/mp4" } },
        { id: "pdf", name: "script.pdf", type: "file", media_type: "application/pdf" },
      ],
      "root-b": [{ id: "sb", name: "SESSIE B", type: "folder", created_at: NOW, updated_at: NOW }],
      sb: [{ id: "b1", name: "Geheim B.mp4", type: "file", media_type: "video/mp4" }],
    };
    return (map[folderId] ?? []) as never;
  },
  async getFileThumbnail() {
    return null;
  },
};

describe("Frame.io-bibliotheek (klantportaal)", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  const ids = { a: "", b: "" };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    const [a] = await db.insert(s.clients).values({ slug: "klant-a", name: "Klant A" }).returning({ id: s.clients.id });
    const [b] = await db.insert(s.clients).values({ slug: "klant-b", name: "Klant B" }).returning({ id: s.clients.id });
    ids.a = a!.id;
    ids.b = b!.id;
  });
  afterAll(async () => closeDatabase());

  it("leest sessies, version stacks en submappen correct uit", async () => {
    const { syncFrameLibrary } = await import("@/server/jobs/frameio-library");
    const res = await syncFrameLibrary(undefined, source, { full: true });
    expect(res.ok).toBe(true);

    const rows = await db.select().from(s.frameAssets).where(eq(s.frameAssets.clientId, ids.a));
    expect(rows.map((r) => r.frameFileId).sort()).toEqual(["a1", "a2", "stack"]);
    const stack = rows.find((r) => r.frameFileId === "stack")!;
    expect(stack.mediaFileId).toBe("head");
    expect(stack.sessionName).toBe("SESSIE 2");
    expect(rows.find((r) => r.frameFileId === "a2")!.subfolderName).toBe("AD - VERKORTE VERSIES");
    expect(rows.find((r) => r.frameFileId === "a1")!.sessionName).toBe("SESSIE 1 - 6 MAART");

    // Onbekend project wordt niet gekoppeld.
    const links = await db.select().from(s.clientIntegrations).where(eq(s.clientIntegrations.provider, "frameio"));
    expect(links.map((l) => l.externalId).sort()).toEqual(["p-a", "p-b"]);
  });

  it("toont klant A alleen de eigen sessies en video's", async () => {
    const { getPortalFrameLibrary } = await import("@/server/portal-frame");
    const viewer = { id: "u", clientId: ids.a, clientScope: [ids.a], isPortalUser: true, permissions: new Set<string>(), isEditorOnly: false } as unknown as import("@/server/auth/context").Viewer;
    const lib = await getPortalFrameLibrary(viewer);
    const all = JSON.stringify(lib);
    expect(lib.totalVideos).toBe(3);
    expect(lib.sessions.map((x) => x.title)).toEqual(["Sessie 2", "Sessie 1 · 6 maart"]);
    expect(all).not.toContain("Geheim");
  });

  it("haalt een datum uit de sessienaam", async () => {
    const { dateFromSessionName } = await import("@/server/jobs/frameio-library");
    expect(dateFromSessionName("SESSIE 3 - 24 APRIL", new Date("2026-05-08T00:00:00Z"))).toBe("2026-04-24");
    expect(dateFromSessionName("SESSIE 8", new Date())).toBeNull();
  });
});
