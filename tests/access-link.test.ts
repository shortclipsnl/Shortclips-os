import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Persoonlijke inloglink voor het klantportaal (één tik vanuit WhatsApp).
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

describe("inloglink: pure regels", () => {
  it("staat alleen paden binnen het portaal toe", async () => {
    const { safePortalPath } = await import("@/lib/access-link");
    expect(safePortalPath("/portal/scripts/abc")).toBe("/portal/scripts/abc");
    expect(safePortalPath("/portal?x=1")).toBe("/portal?x=1");
    expect(safePortalPath("/portalkwaad")).toBe("/portal");
    expect(safePortalPath("//kwaadaardig.nl")).toBe("/portal");
    expect(safePortalPath("https://kwaadaardig.nl/portal")).toBe("/portal");
    expect(safePortalPath("/portal/\\evil")).toBe("/portal");
    expect(safePortalPath("/dashboard")).toBe("/portal");
    expect(safePortalPath(null)).toBe("/portal");
  });

  it("bouwt een link die herkenbaar blijft als portaallink", async () => {
    const { buildAccessUrl, hasAccessToken, stripAccessParam } = await import("@/lib/access-link");
    const token = "a".repeat(43);
    const url = buildAccessUrl("https://portaal.shortclips.nl/", "/portal/scripts/1234abcd-0000", token);
    expect(url).toBe(`https://portaal.shortclips.nl/portal/scripts/1234abcd-0000?t=${token}`);
    expect(hasAccessToken(url)).toBe(true);
    expect(hasAccessToken("https://portaal.shortclips.nl/portal/scripts/1")).toBe(false);
    expect(stripAccessParam("/portal/videos", `?t=${token}&x=2`)).toBe("/portal/videos?x=2");
    expect(stripAccessParam("/portal/videos", `?t=${token}`)).toBe("/portal/videos");
  });

  it("een persoonlijke link slaagt voor de bestaande scriptberichtcontrole", async () => {
    const { checkMessage } = await import("@/lib/scriptbericht");
    const url = `https://portaal.shortclips.nl/portal/scripts/1234abcd-0000?t=${"b".repeat(43)}`;
    const res = checkMessage({ methode: "portal", link: url, text: `Bekijk: ${url}`, clientId: "c1", ownReviewId: "1234abcd-0000", foreign: [] });
    expect(res.ok).toBe(true);
  });
});

describe("inloglink op de database", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let userId: string;

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    const [client] = await db.insert(s.clients).values({ slug: "link-a", name: "Link A", status: "active" }).returning({ id: s.clients.id });
    const [user] = await db
      .insert(s.users)
      .values({ email: "link@klant.nl", fullName: "Linda Klant", primaryRole: "client", clientId: client!.id, status: "active" })
      .returning({ id: s.users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  function tokenOf(url: string) {
    return new URL(url).searchParams.get("t")!;
  }

  it("maakt, controleert en telt een link; bewaart alleen de hash", async () => {
    const links = await import("@/server/auth/access-links");
    const res = await links.createAccessLink({ userId, targetPath: "/portal/scripts/xyz", createdById: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const token = tokenOf(res.url);
    const rows = await db.select().from(s.portalAccessLinks);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);

    const info = await links.peekAccessLink(token);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.targetPath).toBe("/portal/scripts/xyz");
    expect(info.clientName).toBe("Link A");

    // Controleren verbruikt niets (linkvoorbeelden van WhatsApp).
    await links.peekAccessLink(token);
    const [before] = await db.select().from(s.portalAccessLinks);
    expect(before!.useCount).toBe(0);

    expect(await links.consumeAccessLink(info.linkId)).toBe(true);
    const [after] = await db.select().from(s.portalAccessLinks);
    expect(after!.useCount).toBe(1);
  });

  it("weigert een onbekend, verlopen of opgebruikt token", async () => {
    const { eq } = await import("drizzle-orm");
    const links = await import("@/server/auth/access-links");
    expect((await links.peekAccessLink("x".repeat(43))).ok).toBe(false);
    expect((await links.peekAccessLink("kort")).ok).toBe(false);

    const res = await links.createAccessLink({ userId, targetPath: "/portal", createdById: null });
    if (!res.ok) throw new Error("geen link");
    const token = tokenOf(res.url);
    const info = await links.peekAccessLink(token);
    if (!info.ok) throw new Error("ongeldig");
    await db.update(s.portalAccessLinks).set({ useCount: 10 }).where(eq(s.portalAccessLinks.id, info.linkId));
    expect(await links.peekAccessLink(token)).toEqual({ ok: false, reason: "expired" });
    expect(await links.consumeAccessLink(info.linkId)).toBe(false);

    await db.update(s.portalAccessLinks).set({ useCount: 0, expiresAt: new Date(Date.now() - 1000) }).where(eq(s.portalAccessLinks.id, info.linkId));
    expect(await links.peekAccessLink(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("trekt links in bij een gepauzeerde klant en weigert inactieve accounts", async () => {
    const { eq } = await import("drizzle-orm");
    const links = await import("@/server/auth/access-links");
    const { revokeClientAppAccess } = await import("@/server/auth/client-app-access");
    const res = await links.createAccessLink({ userId, targetPath: "/portal/videos", createdById: null });
    if (!res.ok) throw new Error("geen link");
    const token = tokenOf(res.url);
    await revokeClientAppAccess(userId);
    expect(await links.peekAccessLink(token)).toEqual({ ok: false, reason: "invalid" });

    const again = await links.createAccessLink({ userId, targetPath: "/portal/videos", createdById: null });
    if (!again.ok) throw new Error("geen link");
    await db.update(s.users).set({ status: "suspended" }).where(eq(s.users.id, userId));
    expect(await links.peekAccessLink(tokenOf(again.url))).toEqual({ ok: false, reason: "inactive" });
    const blocked = await links.createAccessLink({ userId, targetPath: "/portal", createdById: null });
    expect(blocked.ok).toBe(false);
  });

  it("maakt geen links voor teamaccounts", async () => {
    const links = await import("@/server/auth/access-links");
    const [staff] = await db
      .insert(s.users)
      .values({ email: "team@shortclips.nl", fullName: "Team", primaryRole: "owner", status: "active" })
      .returning({ id: s.users.id });
    const res = await links.createAccessLink({ userId: staff!.id, targetPath: "/portal", createdById: null });
    expect(res.ok).toBe(false);
  });
});
