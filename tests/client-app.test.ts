import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Klant-app (PWA): spelregels voor push, aflevering, isolatie van het
 * meldingencentrum en de inlogcode per e-mail.
 */

// Push werkt alleen met VAPID-sleutels; in de test zetten we nep-sleutels en
// vangen we de pushdienst af.
process.env.VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.RESEND_API_KEY = "re_test";
process.env.MAIL_FROM = "Shortclips <test@shortclips.nl>";

const sent: { endpoint: string; body: string }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      if (failWith) {
        const err = Object.assign(new Error("gone"), { statusCode: failWith });
        throw err;
      }
      sent.push({ endpoint: sub.endpoint, body });
      return { statusCode: 201 };
    },
  },
}));

// Cookies en headers van Next nabootsen voor de inlogcode.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

// E-mail afvangen zodat we de code kunnen lezen.
const mails: { to: string | string[]; subject: string; text: string }[] = [];
vi.mock("@/server/email", async (orig) => {
  const actual = await orig<typeof import("@/server/email")>();
  return {
    ...actual,
    emailConfigured: () => true,
    sendEmail: async (input: { to: string | string[]; subject: string; text: string }) => {
      mails.push(input);
      return { sent: true, id: "test" };
    },
  };
});

type Schema = typeof import("@/db/schema");
type Viewer = import("@/server/auth/context").Viewer;

function viewerFor(userId: string, clientId: string): Viewer {
  return {
    id: userId,
    email: "contact@klant.nl",
    fullName: "Klantcontact",
    primaryRole: "client",
    clientId,
    avatarUrl: null,
    status: "active",
    permissions: new Set<string>(["portal:access"]),
    clientScope: [clientId],
    isPortalUser: true,
    isEditorOnly: false,
  } as Viewer;
}

// Woensdag 12:00 Nederlandse tijd (buiten stille uren).
const NOON = new Date("2026-11-04T11:00:00Z");
const LATE = new Date("2026-11-04T22:30:00Z");

describe("push-spelregels", () => {
  it("herkent stille uren in Nederlandse tijd", async () => {
    const rules = await import("@/lib/push-rules");
    expect(rules.isQuietHours(NOON)).toBe(false);
    expect(rules.isQuietHours(LATE)).toBe(true);
    expect(rules.isQuietHours(new Date("2026-11-04T06:30:00Z"))).toBe(true); // 07:30 NL
    expect(rules.isQuietHours(new Date("2026-11-04T07:05:00Z"))).toBe(false); // 08:05 NL
  });

  it("bundelt meldingen van dezelfde soort, maar nooit handmatige", async () => {
    const { bundlePending } = await import("@/lib/push-rules");
    const t = new Date();
    const out = bundlePending([
      { id: "1", type: "video_review", title: "a", body: null, href: "/portal/videos/1", createdAt: t },
      { id: "2", type: "video_review", title: "b", body: null, href: "/portal/videos/2", createdAt: t },
      { id: "3", type: "manual", title: "m1", body: null, href: "/portal", createdAt: t },
      { id: "4", type: "manual", title: "m2", body: null, href: "/portal", createdAt: t },
    ]);
    expect(out).toHaveLength(3);
    const video = out.find((p) => p.tag === "video_review")!;
    expect(video.title).toBe("2 video's staan klaar voor je feedback");
    expect(video.href).toBe("/portal/videos");
    expect(video.notificationIds).toEqual(["1", "2"]);
    expect(out.slice(0, 2).every((p) => p.tag.startsWith("manual:"))).toBe(true);
  });

  it("laat nooit een link buiten het portaal toe", async () => {
    const { safePortalHref } = await import("@/lib/push-rules");
    expect(safePortalHref("/portal/videos/1")).toBe("/portal/videos/1");
    expect(safePortalHref("https://kwaadaardig.nl")).toBe("/portal");
    expect(safePortalHref("//kwaadaardig.nl")).toBe("/portal");
    expect(safePortalHref("/dashboard")).toBe("/portal");
    expect(safePortalHref("/portal\\..\\x")).toBe("/portal");
  });
});

describe("klant-app op de database", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: Schema;
  let a: { clientId: string; userId: string };
  let b: { clientId: string; userId: string };

  async function seed(tag: string) {
    const [client] = await db
      .insert(s.clients)
      .values({ slug: `app-${tag}`, name: `App ${tag}`, status: "active" })
      .returning({ id: s.clients.id });
    const [user] = await db
      .insert(s.users)
      .values({ email: `${tag}@klant.nl`, fullName: `Contact ${tag}`, primaryRole: "client", clientId: client!.id, status: "active" })
      .returning({ id: s.users.id });
    return { clientId: client!.id, userId: user!.id };
  }

  async function subscribe(userId: string, clientId: string, endpoint: string) {
    await db.insert(s.pushSubscriptions).values({ userId, clientId, endpoint, p256dh: "p256dh-test-key", auth: "auth-key" });
  }

  async function pending(userId: string, clientId: string, type: string, title: string, at: Date = NOON) {
    const [row] = await db
      .insert(s.notifications)
      .values({ userId, clientId, type, title, href: "/portal", pushState: "pending", createdAt: new Date(at.getTime() - 3_600_000) })
      .returning({ id: s.notifications.id });
    return row!.id;
  }

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    a = await seed("a");
    b = await seed("b");
    await subscribe(a.userId, a.clientId, "https://push.example/a");
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(() => {
    sent.length = 0;
    failWith = null;
  });

  it("verstuurt niets tijdens stille uren", async () => {
    const { flushPendingPush } = await import("@/server/push");
    await pending(a.userId, a.clientId, "video_review", "Video 1");
    const res = await flushPendingPush({ now: LATE });
    expect(res.quiet).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("bundelt, telt handmatig niet mee en houdt de daglimiet aan", async () => {
    const { flushPendingPush } = await import("@/server/push");
    await pending(a.userId, a.clientId, "video_review", "Video 2");
    await pending(a.userId, a.clientId, "manual", "Belangrijke update");

    const first = await flushPendingPush({ now: NOON });
    // Eén gebundelde push voor de twee video's + de handmatige melding.
    expect(sent).toHaveLength(2);
    expect(first.pushes).toBe(2);
    expect(sent.map((x) => JSON.parse(x.body).title)).toContain("2 video's staan klaar voor je feedback");

    // Nog drie automatische soorten: daglimiet is 2, er ging er al 1 uit.
    sent.length = 0;
    await pending(a.userId, a.clientId, "script_review", "Script");
    await pending(a.userId, a.clientId, "content_plan", "Planning");
    await pending(a.userId, a.clientId, "results", "Resultaten");
    const second = await flushPendingPush({ now: NOON });
    expect(sent).toHaveLength(1);
    expect(second.skipped).toBe(2);
  });

  it("logt de aflevering en ruimt een verlopen abonnement op (410)", async () => {
    const { flushPendingPush } = await import("@/server/push");
    const { eq } = await import("drizzle-orm");
    // Volgende dag, zodat de daglimiet niet meetelt.
    const nextDay = new Date("2026-11-05T11:00:00Z");
    failWith = 410;
    await pending(a.userId, a.clientId, "video_review", "Video 3", nextDay);
    await flushPendingPush({ now: nextDay });

    const [sub] = await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.userId, a.userId));
    expect(sub!.revokedAt).not.toBeNull();
    const logs = await db.select().from(s.pushDeliveries).where(eq(s.pushDeliveries.statusCode, 410));
    expect(logs.length).toBe(1);
    expect(logs[0]!.status).toBe("expired");
  });

  it("toont in het meldingencentrum alleen de eigen meldingen", async () => {
    const { getPortalNotifications, getUnreadNotificationCount } = await import("@/server/client-app");
    await db.insert(s.notifications).values({ userId: b.userId, clientId: b.clientId, type: "manual", title: "GEHEIM-B" });
    const listA = await getPortalNotifications(viewerFor(a.userId, a.clientId));
    expect(JSON.stringify(listA)).not.toContain("GEHEIM-B");
    expect(listA.every((n) => n.title !== "GEHEIM-B")).toBe(true);
    // Zelfs met het user-id van A maar een scope op B: geen rijen.
    const crossed = await getPortalNotifications(viewerFor(a.userId, b.clientId));
    expect(crossed).toHaveLength(0);
    expect(await getUnreadNotificationCount(viewerFor(b.userId, b.clientId))).toBe(1);
  });

  it("vraagt een inlogcode op een nieuw apparaat en onthoudt het apparaat daarna", async () => {
    const { eq } = await import("drizzle-orm");
    const code = await import("@/server/auth/login-code");
    const user = { id: a.userId, email: "a@klant.nl", primaryRole: "client", clientId: a.clientId };

    expect(await code.loginCodeRequired(user)).toBe(false);
    await db.update(s.clients).set({ portalLoginCodeRequired: true }).where(eq(s.clients.id, a.clientId));
    expect(await code.loginCodeRequired(user)).toBe(true);

    cookieJar.clear();
    mails.length = 0;
    const started = await code.startLoginChallenge(user, { ip: null, userAgent: "vitest" });
    expect(started.ok).toBe(true);
    const mailed = /(\d{6})/.exec(mails[0]!.subject)![1]!;

    const wrong = await code.verifyLoginChallenge(mailed === "000000" ? "111111" : "000000");
    expect(wrong.ok).toBe(false);

    const right = await code.verifyLoginChallenge(mailed);
    expect(right.ok).toBe(true);
    // Code is eenmalig.
    expect((await code.verifyLoginChallenge(mailed)).ok).toBe(false);

    await code.trustThisDevice(a.userId, "vitest");
    expect(await code.loginCodeRequired(user)).toBe(false);

    // Een ander account op hetzelfde apparaat krijgt wél een code.
    await db.update(s.clients).set({ portalLoginCodeRequired: true }).where(eq(s.clients.id, b.clientId));
    expect(await code.loginCodeRequired({ id: b.userId, primaryRole: "client", clientId: b.clientId })).toBe(true);
  });

  it("blokkeert de code na vijf foute pogingen", async () => {
    const code = await import("@/server/auth/login-code");
    cookieJar.clear();
    mails.length = 0;
    await code.startLoginChallenge({ id: a.userId, email: "a@klant.nl" }, { ip: null, userAgent: "vitest" });
    const real = /(\d{6})/.exec(mails[0]!.subject)![1]!;
    const bad = real === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) await code.verifyLoginChallenge(bad);
    const after = await code.verifyLoginChallenge(real);
    expect(after.ok).toBe(false);
  });

  it("geeft klanten een langere sessie dan het team", async () => {
    const { sessionPolicy } = await import("@/server/auth/session");
    expect(sessionPolicy("client").ttlMs).toBeGreaterThan(sessionPolicy("owner").ttlMs);
    expect(sessionPolicy("client").absoluteMaxMs).toBe(90 * 86_400_000);
    expect(sessionPolicy("project_coordinator").absoluteMaxMs).toBe(30 * 86_400_000);
  });
});
