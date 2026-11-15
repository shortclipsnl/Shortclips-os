import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, contentAdvice } from "@/db/schema";
import { analyzeMemory, type MemoryInput } from "@/server/content-memory/analyze";
import { buildAdvice } from "@/server/content-memory/advice";
import type { ClientMemory } from "@/server/content-memory";

/**
 * Contentadvies, opslag en leerlus: adviezen worden één keer vastgelegd, de
 * voortgang schuift vanzelf door zodra er video's online staan waarin het
 * advies is toegepast, en een afgesloten advies komt niet direct terug.
 */

const day = (n: number) => new Date(Date.UTC(2026, 5, 1) + n * 86_400_000);
const vid = (i: number, o: Partial<MemoryInput> = {}): MemoryInput => ({
  id: `v${i}`, platform: "instagram", publishedAt: day(i * 3), caption: `Video nummer ${i} over een mooie woning in Sneek met tuin.\nBel ons gerust voor een bezichtiging.`,
  durationSeconds: 55, views: 1000 + (i % 3) * 100, likes: 30, comments: 3, shares: 1, saves: 2, avgWatchSeconds: 12, followerDelta: 0,
  externalUrl: null, thumbnail: null, spokenHook: null, planTitle: null, planId: null, format: "Wijkportret", ...o,
});
const price = (i: number, d: number): MemoryInput => vid(i, { publishedAt: day(d), caption: `Wat kost deze woning in Sneek voor €${300 + i}.000?\nLaat het weten in de reacties.`, views: 3400 + i * 10, comments: 40, format: "Woningtour met prijsvraag" });

const base = Array.from({ length: 16 }, (_, i) => vid(i)); // dag 0 t/m 45
const early = [price(100, 20), price(101, 24), price(102, 28), price(103, 32)];
const later = [price(200, 62), price(201, 64), price(202, 66)];

let db: Awaited<ReturnType<typeof freshDatabase>>;
let clientId: string;

const cmOf = (inputs: MemoryInput[], now: Date): ClientMemory =>
  ({ clientId, clientName: "Testklant", clientSlug: "test", memory: analyzeMemory(inputs, now), ai: { formats: [], labels: {}, structures: {}, ideas: [], updatedAt: null, model: null }, strategy: null }) as unknown as ClientMemory;

beforeAll(async () => {
  db = await freshDatabase();
  const [c] = await db.insert(clients).values({ name: "Testklant", slug: "testklant-advies" } as typeof clients.$inferInsert).returning({ id: clients.id });
  clientId = c!.id;
});
afterAll(async () => {
  await closeDatabase();
});

describe("contentadvies in de database", () => {
  it("legt adviezen één keer vast en schuift de voortgang vanzelf door", async () => {
    const { syncClientAdvice, adviceContext, loadClientAdvice } = await import("@/server/content-memory/advice-store");
    const t1 = day(60);
    const cm1 = cmOf([...base, ...early], t1);
    const ctx1 = adviceContext(cm1);
    const a1 = buildAdvice(cm1.memory, ctx1);
    expect(a1.sections.meer.some((i) => i.key === "meer:hook:Prijs")).toBe(true);

    const r1 = await syncClientAdvice(cm1, a1, ctx1, t1);
    expect(r1.created).toBeGreaterThan(0);
    const again = await syncClientAdvice(cm1, a1, ctx1, t1);
    expect(again.created).toBe(0);

    const row = async () => (await db.select().from(contentAdvice).where(eq(contentAdvice.clientId, clientId))).find((r) => r.key === "meer:hook:Prijs")!;
    expect((await row()).status).toBe("nog_toepassen");

    // Drie nieuwe prijsvideo's na het advies, minstens zeven dagen oud.
    const t2 = day(80);
    const cm2 = cmOf([...base, ...early, ...later], t2);
    const ctx2 = adviceContext(cm2);
    const r2 = await syncClientAdvice(cm2, buildAdvice(cm2.memory, ctx2), ctx2, t2);
    expect(r2.closed).toBeGreaterThan(0);
    const done = await row();
    expect(done.status).toBe("effectief");
    expect((done.outcome as { matched: number }).matched).toBe(3);
    expect(done.closedAt).not.toBeNull();

    // Afgesloten: komt niet opnieuw tussen het advies, wel bij de geleerde lessen.
    const r3 = await syncClientAdvice(cm2, buildAdvice(cm2.memory, ctx2), ctx2, t2);
    expect(r3.created).toBe(0);
    const view = await loadClientAdvice(cm2, { sync: false, now: t2 });
    expect(view.advice.sections.meer.some((i) => i.key === "meer:hook:Prijs")).toBe(false);
    expect(view.learned.some((r) => r.key === "meer:hook:Prijs" && r.status === "effectief")).toBe(true);
  });

  it("laat een niet opgepakt advies vervallen als de cijfers het niet meer dragen", async () => {
    const { syncClientAdvice, adviceContext } = await import("@/server/content-memory/advice-store");
    const [r] = await db.insert(contentAdvice).values({ clientId, key: "meer:hook:Vraag", section: "meer", title: "Openen met een vraag", item: { key: "meer:hook:Vraag", target: { dimension: "hook", label: "Vraag" } }, measureFrom: day(90) }).returning({ id: contentAdvice.id });
    const [p] = await db.insert(contentAdvice).values({ clientId, key: "meer:cta:Volgen", section: "meer", title: "Vragen om te volgen", status: "ingepland", item: { key: "meer:cta:Volgen", target: { dimension: "cta", label: "Volgen" } }, measureFrom: day(90) }).returning({ id: contentAdvice.id });
    const cm = cmOf(base, day(95));
    const ctx = adviceContext(cm);
    await syncClientAdvice(cm, buildAdvice(cm.memory, ctx), ctx, day(95));
    const [gone] = await db.select().from(contentAdvice).where(eq(contentAdvice.id, r!.id));
    expect(gone!.status).toBe("vervallen");
    expect(gone!.closedReason).toBe("automatisch");
    // Wat het team al heeft ingepland blijft staan: de meting loopt door.
    const [kept] = await db.select().from(contentAdvice).where(eq(contentAdvice.id, p!.id));
    expect(kept!.status).toBe("ingepland");
  });
});
