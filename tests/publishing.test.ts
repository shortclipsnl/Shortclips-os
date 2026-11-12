import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clientIntegrations, clients, contentCalendar, frameAssets, publications, users } from "@/db/schema";
import { getPublishingView, planViaMetricool, reconcilePublishing, revokePlanning, setPublishMode, amsterdamIso } from "@/server/publishing";
import type { MetricoolScheduler, ScheduledPost } from "@/server/integrations/metricool-scheduler";
import type { MetricoolPostBody } from "@/lib/metricool-payload";

/**
 * Publiceren via Metricool, van begin tot eind tegen de echte database, met een
 * nagebootste Metricool die bijhoudt wat er "online" zou gaan.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;

class FakeMetricool {
  isLive = true;
  posts = new Map<string, ScheduledPost>();
  created = 0;
  removed = 0;
  failNextCreate: "error" | "timeout-after-create" | null = null;
  private n = 0;
  async list(): Promise<ScheduledPost[]> { return [...this.posts.values()]; }
  async get(_b: string, _u: string, id: string) { return [...this.posts.values()].find((p) => p.id === id) ?? null; }
  async create(_b: string, _u: string, body: MetricoolPostBody) {
    if (!this.isLive) return { dryRun: true as const, method: "POST", url: "x", body };
    if (this.failNextCreate === "error") { this.failNextCreate = null; throw new Error("Metricool 500"); }
    const post: ScheduledPost = { id: String(++this.n), uuid: `uuid-${this.n}`, text: body.text, at: body.publicationDate.dateTime, networks: body.providers.map((p) => p.network), draft: body.draft };
    this.posts.set(post.uuid, post);
    this.created++;
    if (this.failNextCreate === "timeout-after-create") { this.failNextCreate = null; throw new Error("time-out"); }
    return { dryRun: false as const, post };
  }
  async update(_b: string, _u: string, id: string, uuid: string, body: MetricoolPostBody) {
    const post: ScheduledPost = { id: id + "u", uuid, text: body.text, at: body.publicationDate.dateTime, networks: body.providers.map((p) => p.network), draft: body.draft };
    this.posts.set(uuid, post);
    return { dryRun: false as const, post };
  }
  async hold() { throw new Error("niet gebruikt"); }
  async remove(_b: string, _u: string, _id: string, uuid: string) {
    if (!uuid) throw new Error("geen UUID");
    this.posts.delete(uuid);
    this.removed++;
    return { dryRun: false as const, post: null };
  }
}

const NOW = new Date("2026-11-12T10:00:00+01:00");
let mc: FakeMetricool;
const sched = () => mc as unknown as MetricoolScheduler;
const media = async () => "https://frame.example/video.mp4";
let clientId: string;
let milou: string;
let itemId: string;

async function makeItem(o: { title?: string; time?: string | null; date?: string; caption?: string } = {}) {
  const [a] = await db.insert(frameAssets).values({ clientId, frameProjectId: "p", frameFileId: `f-${Math.random()}`, mediaFileId: "m1", name: "1 - BMW M3 TOURING", sessionName: "Opname 4 nov" }).returning({ id: frameAssets.id });
  const [it] = await db
    .insert(contentCalendar)
    .values({ clientId, title: o.title ?? "BMW M3 Touring", scheduledOn: o.date ?? "2026-11-18", scheduledAt: o.time === undefined ? "16:30" : o.time, caption: o.caption ?? `Een M3 Touring met 312 km. ${Math.random().toString(36).slice(2, 8)}`, frameAssetId: a!.id })
    .returning({ id: contentCalendar.id });
  return it!.id;
}

beforeAll(async () => {
  db = await freshDatabase();
  const [c] = await db.insert(clients).values({ slug: "auto-christiaan", name: "Auto Christiaan", status: "active" }).returning({ id: clients.id });
  clientId = c!.id;
  const [u] = await db.insert(users).values({ email: "milou@shortclips.nl", fullName: "Milou Test", status: "active", primaryRole: "operational_manager" }).returning({ id: users.id });
  milou = u!.id;
  await db.insert(clientIntegrations).values({ clientId, provider: "metricool", externalId: "5169272", config: { userId: 3393435, networks: ["instagram", "tiktok", "facebook"] } });
});
afterAll(async () => { await closeDatabase(); });
beforeEach(async () => {
  mc = new FakeMetricool();
  itemId = await makeItem();
});

const rows = (id: string) => db.select().from(publications).where(and(eq(publications.calendarItemId, id), isNull(publications.deletedAt)));

describe("standaard handmatig", () => {
  it("een nieuw bericht staat op handmatig en inplannen kan niet", async () => {
    const v = await getPublishingView(itemId, NOW);
    expect(v!.mode).toBe("handmatig");
    expect(v!.canPlan).toBe(false);
    const r = await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(r.ok).toBe(false);
    expect(mc.created).toBe(0);
  });
});

describe("op Metricool zetten publiceert niets", () => {
  it("alleen de keuze maken stuurt niets; YouTube (niet gekoppeld) blijft zelf posten", async () => {
    await setPublishMode(itemId, "metricool", sched());
    expect(mc.created).toBe(0);
    const v = await getPublishingView(itemId, NOW);
    expect(v!.mode).toBe("metricool");
    expect(v!.channels.find((c) => c.platform === "youtube")!.status).toBe("handmatig");
    expect(v!.channels.filter((c) => c.status === "niet_verstuurd").map((c) => c.platform).sort()).toEqual(["facebook", "instagram", "tiktok"]);
    expect(v!.canPlan).toBe(true);
  });
});

describe("inplannen", () => {
  it("maakt precies één post per gekoppeld kanaal, op het juiste kanaal en tijdstip", async () => {
    await setPublishMode(itemId, "metricool", sched());
    const r = await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(r.ok).toBe(true);
    expect(mc.created).toBe(3);
    const posts = [...mc.posts.values()];
    expect(posts.map((p) => p.networks).flat().sort()).toEqual(["facebook", "instagram", "tiktok"]);
    expect(posts.every((p) => p.networks.length === 1 && p.at === "2026-11-18T16:30:00")).toBe(true);
    expect((await rows(itemId)).filter((x) => x.syncStatus === "ingepland")).toHaveLength(3);
  });
  it("nogmaals inplannen of dubbelklikken maakt geen tweede post", async () => {
    await setPublishMode(itemId, "metricool", sched());
    await Promise.all([
      planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media }),
      planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media }),
    ]);
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(mc.posts.size).toBe(3);
  });
  it("time-out nadat Metricool de post al maakte: post wordt teruggevonden, niet dubbel", async () => {
    await setPublishMode(itemId, "metricool", sched());
    mc.failNextCreate = "timeout-after-create";
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(mc.posts.size).toBe(3);
    expect((await rows(itemId)).filter((x) => x.syncStatus === "ingepland")).toHaveLength(3);
  });
  it("fout bij Metricool: kanaal op Niet gelukt met reden, de rest gaat door", async () => {
    await setPublishMode(itemId, "metricool", sched());
    mc.failNextCreate = "error";
    const r = await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(r.message).toMatch(/Niet gelukt/);
    const rs = await rows(itemId);
    expect(rs.filter((x) => x.syncStatus === "mislukt")).toHaveLength(1);
    expect(rs.find((x) => x.syncStatus === "mislukt")!.lastError).toMatch(/Metricool 500/);
  });
  it("geen tijdstip of te kort dag: niets", async () => {
    const id = await makeItem({ time: null });
    await setPublishMode(id, "metricool", sched());
    expect((await getPublishingView(id, NOW))!.canPlan).toBe(false);
    const late = await makeItem({ date: "2026-11-12", time: "10:05" });
    await setPublishMode(late, "metricool", sched());
    await planViaMetricool(late, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(mc.created).toBe(0);
  });
  it("proefmodus: alles gecontroleerd, niets verstuurd", async () => {
    mc.isLive = false;
    await setPublishMode(itemId, "metricool", sched());
    const r = await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(r.message).toMatch(/Proefmodus/);
    expect(mc.posts.size).toBe(0);
    expect((await rows(itemId)).filter((x) => x.syncStatus === "proef")).toHaveLength(3);
  });
});

describe("latere wijzigingen gaan nooit ongemerkt online", () => {
  async function planned() {
    await setPublishMode(itemId, "metricool", sched());
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(mc.posts.size).toBe(3);
  }
  it("caption gewijzigd: posts uit Metricool, status in de wacht", async () => {
    await planned();
    await db.update(contentCalendar).set({ caption: "Nieuwe tekst" }).where(eq(contentCalendar.id, itemId));
    const r = await reconcilePublishing({ scheduler: sched(), now: NOW });
    expect(r.held).toBeGreaterThan(0);
    expect(mc.posts.size).toBe(0);
    const v = await getPublishingView(itemId, NOW);
    expect(v!.channels.filter((c) => c.status === "in_de_wacht")).toHaveLength(3);
    expect(v!.canPlan).toBe(true);
  });
  it("tijd verschoven of bericht verwijderd: posts uit Metricool", async () => {
    await planned();
    await db.update(contentCalendar).set({ scheduledAt: "18:00" }).where(eq(contentCalendar.id, itemId));
    await reconcilePublishing({ scheduler: sched(), now: NOW });
    expect(mc.posts.size).toBe(0);
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(mc.posts.size).toBe(3);
    await db.update(contentCalendar).set({ deletedAt: new Date() }).where(eq(contentCalendar.id, itemId));
    await reconcilePublishing({ scheduler: sched(), now: NOW });
    expect(mc.posts.size).toBe(0);
  });
  it("niets gewijzigd: controle laat alles staan", async () => {
    await planned();
    const r = await reconcilePublishing({ scheduler: sched(), now: NOW });
    expect(r.held).toBe(0);
    expect(mc.posts.size).toBe(3);
  });
});

describe("intrekken en terug naar handmatig", () => {
  it("intrekken haalt de posts uit Metricool", async () => {
    await setPublishMode(itemId, "metricool", sched());
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    await revokePlanning(itemId, sched());
    expect(mc.posts.size).toBe(0);
  });
  it("terug naar handmatig terwijl ingepland: posts uit Metricool, geen dubbele plaatsing", async () => {
    await setPublishMode(itemId, "metricool", sched());
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    await setPublishMode(itemId, "handmatig", sched());
    expect(mc.posts.size).toBe(0);
    expect((await getPublishingView(itemId, NOW))!.mode).toBe("handmatig");
  });
});

describe("publicatie bevestigen via de statistieken", () => {
  it("na publicatie wordt de post teruggevonden en gekoppeld aan het bericht", async () => {
    await setPublishMode(itemId, "metricool", sched());
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    const at = new Date(amsterdamIso("2026-11-18", "16:30"));
    const [it0] = await db.select({ caption: contentCalendar.caption }).from(contentCalendar).where(eq(contentCalendar.id, itemId));
    // Een andere video van dezelfde klant rond hetzelfde tijdstip mag niet gekoppeld worden.
    await db.insert(publications).values({ clientId, platform: "instagram", status: "published", publishedAt: new Date(at.getTime() + 120_000), externalPostId: "ext-ander", caption: "Heel andere video" });
    for (const p of ["instagram", "tiktok", "facebook"] as const) {
      await db.insert(publications).values({ clientId, platform: p, status: "published", publishedAt: new Date(at.getTime() + 60_000), externalPostId: `ext-${p}`, caption: it0!.caption });
    }
    await reconcilePublishing({ scheduler: sched(), now: new Date(at.getTime() + 3600_000) });
    const own = await rows(itemId);
    expect(own.filter((r) => r.publishMode === "metricool" && r.syncStatus === "gepubliceerd")).toHaveLength(3);
    expect(own.filter((r) => r.externalPostId).map((r) => r.externalPostId).sort()).toEqual(["ext-facebook", "ext-instagram", "ext-tiktok"]);
    const [it] = await db.select({ status: contentCalendar.status }).from(contentCalendar).where(eq(contentCalendar.id, itemId));
    expect(it!.status).toBe("published");
  });
});

describe("Amsterdamse tijd", () => {
  it("winter- en zomertijd kloppen", () => {
    expect(amsterdamIso("2026-11-18", "16:30")).toBe("2026-11-18T15:30:00.000Z");
    expect(amsterdamIso("2026-07-01", "16:30")).toBe("2026-07-01T14:30:00.000Z");
  });
});

describe("database-fout na aanmaken in Metricool", () => {
  it("de volgende poging vindt de al aangemaakte post terug in plaats van een tweede te maken", async () => {
    await setPublishMode(itemId, "metricool", sched());
    // Eerste poging met een ongeldige gebruiker: Metricool maakt de posts, het opslaan van de vrijgave faalt.
    await planViaMetricool(itemId, "00000000-0000-0000-0000-000000000000", { scheduler: sched(), now: NOW, mediaUrl: media });
    await planViaMetricool(itemId, milou, { scheduler: sched(), now: NOW, mediaUrl: media });
    expect(mc.posts.size).toBe(3);
    expect((await rows(itemId)).filter((x) => x.syncStatus === "ingepland")).toHaveLength(3);
  });
});
