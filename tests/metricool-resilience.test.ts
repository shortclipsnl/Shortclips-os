import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { IntegrationError } from "@/server/integrations/types";
import { isNotAvailable } from "@/server/integrations/metricool";

/**
 * Cijfers mogen niet op nul springen als Metricool tijdelijk niet reageert:
 * een platform waarvan de ophaalronde faalt houdt zijn laatst opgehaalde
 * cijfers, alleen volledig opgehaalde platforms worden vervangen.
 */
describe("Metricool: geen nul-cijfers bij een tijdelijke storing", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let clientId = "";
  const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    const [c] = await db.insert(s.clients).values({ slug: "klant-m", name: "Klant M" }).returning({ id: s.clients.id });
    clientId = c!.id;
    await db.insert(s.clientIntegrations).values({ clientId, provider: "metricool", externalId: "77", externalName: "klant m", config: { userId: 9 } });
    await db.insert(s.dailyMetrics).values([
      { clientId, platform: "instagram", measuredOn: day, views: 100, source: "metricool" },
      { clientId, platform: "tiktok", measuredOn: day, views: 5000, source: "metricool" },
    ]);
  });
  afterAll(async () => closeDatabase());

  it("vervangt Instagram, laat TikTok staan bij een 503", async () => {
    const { pullMetricoolMetrics } = await import("@/server/jobs/metricool-sync");
    const source = {
      async listBrands() {
        return [{ id: 77, label: "klant m", userId: 9, networks: [] }];
      },
      async timeline(_b: number, _u: number, network: string, _s: string, metric: string) {
        if (network === "Tiktok") throw new IntegrationError("metricool", "HTTP 503", 503, true);
        if (network === "Instagram" && metric === "views") return [{ date: day, value: 250 }];
        return [];
      },
    };
    const res = await pullMetricoolMetrics(undefined, source as never, 10);
    expect(res.ok).toBe(true);

    const rows = await db.select().from(s.dailyMetrics).where(and(eq(s.dailyMetrics.clientId, clientId), eq(s.dailyMetrics.measuredOn, day)));
    const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r.views]));
    expect(byPlatform.instagram).toBe(250);
    expect(byPlatform.tiktok).toBe(5000);

    const [job] = await db.select().from(s.syncJobs).where(eq(s.syncJobs.jobType, "metricool.pull_metrics"));
    expect(job?.status).toBe("partial");
  });

  it("onderscheidt 'niet gekoppeld' van een storing", () => {
    expect(isNotAvailable(new IntegrationError("metricool", "HTTP 403", 403, false))).toBe(true);
    expect(isNotAvailable(new IntegrationError("metricool", "HTTP 503", 503, true))).toBe(false);
    expect(isNotAvailable(new IntegrationError("metricool", "Time-out", undefined, true))).toBe(false);
  });
});
