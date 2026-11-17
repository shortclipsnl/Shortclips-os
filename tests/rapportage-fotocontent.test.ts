import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { weergavenPerVideo } from "@/lib/cijfers";
import { taskSignal } from "@/lib/task-signals";
import { stapKey } from "@/lib/maandcontrole";

/**
 * Feedback Milou (17 nov 2026):
 *  - fotocontent (Instagram-feedposts, carrousels, Facebook-albums) telt niet
 *    mee in de statistieken van de maandrapportages, intern en extern;
 *  - de knop "Bekijk rapportage" op de takenpagina opent de rapportage zelf.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
type Schema = typeof import("@/db/schema");
let db: Db;
let s: Schema;
let clientId = "";

const POSTS = [
  // Video's: reel met duur, reel zonder duur (alleen de link), TikTok-video.
  { platform: "instagram", url: "https://www.instagram.com/reel/AAA/", duur: 27, views: 19000, caption: "Reel met prijs" },
  { platform: "instagram", url: "https://www.instagram.com/reel/BBB/", duur: null, views: 7000, caption: "Wijkvideo" },
  { platform: "tiktok", url: "https://www.tiktok.com/@klant/video/123", duur: 26, views: 4000, caption: "TikTok" },
  // Fotocontent: afbeelding, carrousel en Facebook-album. Hoort niet in de videocijfers.
  { platform: "instagram", url: "https://www.instagram.com/p/CCC/", duur: null, views: 6300, caption: "Fotopost" },
  { platform: "instagram", url: "https://www.instagram.com/p/DDD/", duur: null, views: 5700, caption: "Carrousel" },
  { platform: "facebook", url: "https://facebook.com/1/posts/2", duur: null, views: 900, caption: "Album" },
] as const;

beforeAll(async () => {
  db = await freshDatabase();
  s = await import("@/db/schema");
  const [c] = await db.insert(s.clients).values({ slug: "makelaar", name: "Makelaar BV", status: "active" }).returning({ id: s.clients.id });
  clientId = c!.id;
  let dag = 5;
  for (const p of POSTS) {
    const [pub] = await db.insert(s.publications).values({
      clientId, platform: p.platform, status: "published", publishedAt: new Date(`2026-10-${String(dag++).padStart(2, "0")}T12:00:00Z`),
      caption: p.caption, externalUrl: p.url, externalPostId: p.url, durationSeconds: p.duur,
    }).returning({ id: s.publications.id });
    await db.insert(s.socialMetrics).values({ publicationId: pub!.id, clientId, platform: p.platform, measuredOn: "2026-11-01", views: p.views, likes: 10, comments: 1, shares: 2, saves: 1 });
  }
  await db.insert(s.dailyMetrics).values({ clientId, platform: "instagram", measuredOn: "2026-10-15", views: 50000, reach: 20000, engagements: 300, followerDelta: 5, likes: 1, comments: 1, shares: 1, saves: 1, source: "metricool" });
}, 180000);

afterAll(async () => { await closeDatabase(); });

describe("fotocontent telt niet mee in de rapportcijfers", () => {
  it("telt alleen video's en hun eigen weergaven", async () => {
    const { monthSeries } = await import("@/server/reports/metrics");
    const okt = (await monthSeries(clientId, "2026-10", 1)).at(-1)!;
    expect(okt.videos).toBe(3);
    expect(okt.videoViews).toBe(30000);
    // Echte weergaven per video: 30.000 / 3, niet alle accountweergaven gedeeld door het aantal posts.
    expect(weergavenPerVideo(okt)).toBe(10000);
  });

  it("toont geen fotoposts in de videolijst", async () => {
    const { monthVideos } = await import("@/server/reports/metrics");
    const titels = (await monthVideos(clientId, "2026-10")).map((v) => v.titel);
    expect(titels).toEqual(["Reel met prijs", "Wijkvideo", "TikTok"]);
  });

  it("telt per platform alleen video's", async () => {
    const { platformSplit } = await import("@/server/reports/metrics");
    const split = await platformSplit(clientId, "2026-10");
    expect(split.find((p) => p.platform === "instagram")?.videos).toBe(2);
    expect(split.find((p) => p.platform === "tiktok")?.videos).toBe(1);
    expect(split.find((p) => p.platform === "facebook")).toBeUndefined();
  });

  it("houdt de oude berekening aan voor rapportages zonder videocijfers", () => {
    expect(weergavenPerVideo({ views: 1000, videos: 4, meetdagen: 30 })).toBe(250);
    expect(weergavenPerVideo({ views: 1000, videos: 4, videoViews: 0, meetdagen: 30 })).toBeNull();
    expect(weergavenPerVideo({ views: 1000, videos: 0, videoViews: 500 })).toBeNull();
  });
});

describe("takenpagina: Bekijk rapportage", () => {
  it("opent de rapportage zelf en houdt de controlepagina als tweede knop", () => {
    const sig = taskSignal({
      title: "Maandrapportage controleren", description: "Wacht op controle", dedupeKey: stapKey("c1", "2026-10", "controleren"),
      entityType: "client_report", entityId: "2e0fa9d4-fce5-4434-b217-f0a58ef0ff6b", clientName: "Makelaar BV",
    });
    expect(sig?.kind).toBe("maandrapport");
    if (sig?.kind !== "maandrapport") return;
    expect(sig.viewHref).toBe("/api/reports/monthly/2e0fa9d4-fce5-4434-b217-f0a58ef0ff6b/pdf?versie=klant");
    expect(sig.actionHref).toBe("/analytics/maandrapportages/2e0fa9d4-fce5-4434-b217-f0a58ef0ff6b");
  });
});
