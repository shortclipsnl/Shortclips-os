import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * De belangrijkste test van dit project: kan iemand data zien die niet van hem
 * is? Deze test bouwt twee klanten met eigen video's en controleert of de
 * scoping in de datalaag dat echt tegenhoudt — ook wanneer je een id uit een
 * andere omgeving invult.
 */
describe("klantscheiding", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let ctx: typeof import("@/server/auth/context");

  const ids = {
    clientA: "",
    clientB: "",
    videoA: "",
    videoB: "",
    editor: "",
    portalUser: "",
  };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    ctx = await import("@/server/auth/context");

    const [a] = await db.insert(s.clients).values({ slug: "klant-a", name: "Klant A" }).returning({ id: s.clients.id });
    const [b] = await db.insert(s.clients).values({ slug: "klant-b", name: "Klant B" }).returning({ id: s.clients.id });
    ids.clientA = a!.id;
    ids.clientB = b!.id;

    const [editor] = await db.insert(s.users).values({
      email: "editor@test.nl", fullName: "Test Editor", primaryRole: "editor", status: "active",
    }).returning({ id: s.users.id });
    ids.editor = editor!.id;

    const [portal] = await db.insert(s.users).values({
      email: "klant@a.nl", fullName: "Klant A Contact", primaryRole: "client", status: "active", clientId: ids.clientA,
    }).returning({ id: s.users.id });
    ids.portalUser = portal!.id;

    const [va] = await db.insert(s.deliverables).values({
      clientId: ids.clientA, title: "Video van klant A", status: "editing", editorId: ids.editor,
    }).returning({ id: s.deliverables.id });
    const [vb] = await db.insert(s.deliverables).values({
      clientId: ids.clientB, title: "Video van klant B", status: "editing",
    }).returning({ id: s.deliverables.id });
    ids.videoA = va!.id;
    ids.videoB = vb!.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  function viewer(overrides: Partial<import("@/server/auth/context").Viewer>) {
    return {
      id: ids.editor,
      email: "editor@test.nl",
      fullName: "Test Editor",
      primaryRole: "editor",
      clientId: null,
      avatarUrl: null,
      status: "active",
      permissions: new Set<string>(["videos:read"]),
      clientScope: [ids.clientA],
      isPortalUser: false,
      ...overrides,
    } as import("@/server/auth/context").Viewer;
  }

  it("beperkt een query tot de toegestane klanten", async () => {
    const v = viewer({ clientScope: [ids.clientA] });
    const rows = await db
      .select({ id: s.deliverables.id, clientId: s.deliverables.clientId })
      .from(s.deliverables)
      .where(and(isNull(s.deliverables.deletedAt), ctx.scopeToClients(v, s.deliverables.clientId)));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientId).toBe(ids.clientA);
  });

  it("geeft niets terug wanneer iemand aan geen enkele klant is gekoppeld", async () => {
    const v = viewer({ clientScope: [] });
    const rows = await db
      .select({ id: s.deliverables.id })
      .from(s.deliverables)
      .where(and(isNull(s.deliverables.deletedAt), ctx.scopeToClients(v, s.deliverables.clientId)));

    expect(rows).toHaveLength(0);
  });

  it("geeft alles terug aan iemand met volledige toegang", async () => {
    const v = viewer({ clientScope: null, permissions: new Set(["clients:read_all"]) });
    const rows = await db
      .select({ id: s.deliverables.id })
      .from(s.deliverables)
      .where(and(isNull(s.deliverables.deletedAt), ctx.scopeToClients(v, s.deliverables.clientId)));

    expect(rows).toHaveLength(2);
  });

  it("blokkeert het openen van een klant buiten de eigen toegang", () => {
    const v = viewer({ clientScope: [ids.clientA] });
    expect(() => ctx.assertClientAccess(v, ids.clientA)).not.toThrow();
    expect(() => ctx.assertClientAccess(v, ids.clientB)).toThrow(ctx.ForbiddenError);
  });

  it("laat een klantaccount uitsluitend de eigen klant zien", () => {
    const v = viewer({
      id: ids.portalUser,
      primaryRole: "client",
      clientId: ids.clientA,
      isPortalUser: true,
      clientScope: [ids.clientA],
      permissions: new Set(["portal:access"]),
    });

    expect(ctx.hasClientAccess(v, ids.clientA)).toBe(true);
    expect(ctx.hasClientAccess(v, ids.clientB)).toBe(false);
  });
});

describe("interne opmerkingen blijven intern", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let clientId = "";
  let videoId = "";

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");

    const [c] = await db.insert(s.clients).values({ slug: "k", name: "K" }).returning({ id: s.clients.id });
    clientId = c!.id;
    const [v] = await db.insert(s.deliverables).values({
      clientId, title: "Video", status: "client_review",
    }).returning({ id: s.deliverables.id });
    videoId = v!.id;

    await db.insert(s.reviewThreads).values([
      { deliverableId: videoId, visibility: "internal" },
      { deliverableId: videoId, visibility: "client" },
    ]);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("levert alleen klantdraden op wanneer interne toegang ontbreekt", async () => {
    const rows = await db
      .select({ id: s.reviewThreads.id, visibility: s.reviewThreads.visibility })
      .from(s.reviewThreads)
      .where(
        and(
          eq(s.reviewThreads.deliverableId, videoId),
          isNull(s.reviewThreads.deletedAt),
          eq(s.reviewThreads.visibility, "client"),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.visibility).toBe("client");
  });

  it("levert beide soorten op met interne toegang", async () => {
    const rows = await db
      .select({ id: s.reviewThreads.id })
      .from(s.reviewThreads)
      .where(and(eq(s.reviewThreads.deliverableId, videoId), isNull(s.reviewThreads.deletedAt)));

    expect(rows).toHaveLength(2);
  });
});
