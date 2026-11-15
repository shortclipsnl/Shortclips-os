import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { parsePortalPeriod, periodResultOpts } from "@/lib/portal-periods";

/**
 * Maand- en kwartaalresultaten op de echte portaalfuncties: de cijfers van een
 * kwartaal, de vergelijking met het kwartaal ervoor, het overzicht (samenvatting,
 * bedrijfsimpact) en de PDF. Klant B heeft bewust andere cijfers: die mogen
 * nergens bij klant A opduiken.
 */

type Schema = typeof import("@/db/schema");
type Viewer = import("@/server/auth/context").Viewer;

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function seed(db: Awaited<ReturnType<typeof freshDatabase>>, s: Schema, tag: string, perDay: { q2: number; q3: number }) {
  const [client] = await db.insert(s.clients).values({ slug: `klant-${tag.toLowerCase()}`, name: `Klant ${tag}`, status: "active" }).returning({ id: s.clients.id });
  const clientId = client!.id;
  const rows = [
    ...days("2025-04-01", "2025-06-30").map((d) => ({ clientId, platform: "instagram" as const, measuredOn: d, views: perDay.q2, reach: perDay.q2 / 2, engagements: 2, followerDelta: 1 })),
    ...days("2025-07-01", "2025-09-30").map((d) => ({ clientId, platform: "instagram" as const, measuredOn: d, views: perDay.q3, reach: perDay.q3 / 2, engagements: 4, followerDelta: 2 })),
  ];
  for (let i = 0; i < rows.length; i += 60) await db.insert(s.dailyMetrics).values(rows.slice(i, i + 60));
  await db.insert(s.publications).values([
    { clientId, platform: "instagram", status: "published", publishedAt: new Date("2025-08-10T10:00:00Z"), externalPostId: `${tag}-1`, caption: `${tag}-video augustus` },
    { clientId, platform: "instagram", status: "published", publishedAt: new Date("2025-05-10T10:00:00Z"), externalPostId: `${tag}-0`, caption: `${tag}-video mei` },
  ]);
  return clientId;
}

const portalViewer = (clientId: string) =>
  ({ id: "00000000-0000-0000-0000-0000000000aa", email: "c@klant.nl", fullName: "Klant", primaryRole: "client", clientId, avatarUrl: null, status: "active", permissions: new Set(["portal:access"]), clientScope: [clientId], isPortalUser: true, isEditorOnly: false }) as unknown as Viewer;
const teamViewer = () =>
  ({ id: "00000000-0000-0000-0000-0000000000bb", email: "t@shortclips.nl", fullName: "Team", primaryRole: "owner", clientId: null, avatarUrl: null, status: "active", permissions: new Set(["analytics:read"]), clientScope: null, isPortalUser: false, isEditorOnly: false }) as unknown as Viewer;

describe("kwartaaloverzicht en maandresultaten", () => {
  let portal: typeof import("@/server/portal");
  let reviewMod: typeof import("@/server/period-review");
  let a: string;
  let b: string;

  beforeAll(async () => {
    const db = await freshDatabase();
    const s = await import("@/db/schema");
    portal = await import("@/server/portal");
    reviewMod = await import("@/server/period-review");
    a = await seed(db, s, "A", { q2: 100, q3: 200 });
    b = await seed(db, s, "B", { q2: 7000, q3: 9000 });
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it("telt een kwartaal op en vergelijkt met het hele kwartaal ervoor", async () => {
    const period = parsePortalPeriod({ periode: "2025-Q3" });
    const r = await portal.getPortalResults(portalViewer(a), periodResultOpts(period));
    expect(r).toMatchObject({ periodKey: "2025-Q3", periodStart: "2025-07-01", periodEnd: "2025-09-30", prevStart: "2025-04-01", prevEnd: "2025-06-30", firstDataOn: "2025-04-01" });
    expect(r.metrics.views).toBe(92 * 200);
    expect(r.prev.views).toBe(91 * 100);
    expect(r.deltas.views).toBe(Math.round(((92 * 200 - 91 * 100) / (91 * 100)) * 100));
    expect(r.metrics.followerGrowth).toBe(92 * 2);
    expect(r.metrics.publishedVideos).toBe(1);
    expect(r.prev.publishedVideos).toBe(1);
  });

  it("een maand vergelijkt met de kalendermaand ervoor, niet met een even lange periode", async () => {
    const r = await portal.getPortalResults(portalViewer(a), periodResultOpts(parsePortalPeriod({ periode: "2025-07" })));
    expect(r.metrics.views).toBe(31 * 200);
    expect(r).toMatchObject({ prevStart: "2025-06-01", prevEnd: "2025-06-30" });
    expect(r.prev.views).toBe(30 * 100);
  });

  it("toont geen groeipercentage als de vorige periode geen cijfers heeft", async () => {
    const r = await portal.getPortalResults(portalViewer(a), periodResultOpts(parsePortalPeriod({ periode: "2025-Q2" })));
    expect(r.metrics.views).toBe(91 * 100);
    expect(r.prev.views).toBe(0);
    expect(r.deltas.views).toBeNull();
  });

  it("een periode zonder cijfers geeft een lege staat, geen verzonnen nullen in de samenvatting", async () => {
    const r = await portal.getPortalResults(portalViewer(a), periodResultOpts(parsePortalPeriod({ periode: "2025-Q1" })));
    expect(r.hasData).toBe(false);
    const review = await reviewMod.getPeriodReview(portalViewer(a), r);
    expect(review?.summary).toBeNull();
  });

  it("bouwt het kwartaaloverzicht uit de eigen cijfers en houdt gemeten en niet gemeten uit elkaar", async () => {
    const viewer = portalViewer(a);
    const r = await portal.getPortalResults(viewer, periodResultOpts(parsePortalPeriod({ periode: "2025-Q3" })));
    const review = (await reviewMod.getPeriodReview(viewer, r))!;
    expect(review).toMatchObject({ mode: "kwartaal", label: "Q3 2025", prevLabel: "Q2 2025", complete: true, intern: null });
    expect(review.months.map((m) => [m.key, m.views])).toEqual([["2025-07", 6200], ["2025-08", 6200], ["2025-09", 6000]]);
    expect(review.summary!.bereikt).toContain("18.400");
    expect(review.summary!.bereikt).toContain("Q2 2025");
    expect(review.impact.gemeten.map((g) => g.label)).toEqual(expect.arrayContaining(["Bereik", "Weergaven", "Nieuwe volgers"]));
    expect(review.impact.nietGemeten.map((g) => g.label)).toEqual(["Websitebezoeken", "Aanvragen", "Conversies"]);
    // Een kwartaal van lang geleden krijgt geen "advies voor volgend kwartaal".
    expect(review.advice).toEqual([]);
    // Nergens iets van klant B.
    const blob = JSON.stringify({ r, review });
    expect(blob).not.toContain("Klant B");
    expect(blob).not.toContain("B-video");
    expect(blob).not.toContain(b);
  });

  it("de interne versie voegt de teamanalyse toe en is afgeschermd op klanttoegang", async () => {
    const team = teamViewer();
    const r = await portal.getPortalResultsForClient(team, a, periodResultOpts(parsePortalPeriod({ periode: "2025-Q3" })));
    const review = await reviewMod.getPeriodReviewForClient(team, a, r, "intern");
    expect(review.intern).not.toBeNull();
    expect(review.memoryHref).toBe("/contentgeheugen?klant=klant-a");
    // Een portaalgebruiker van klant A kan het overzicht van klant B niet opvragen.
    await expect(reviewMod.getPeriodReviewForClient(portalViewer(a), b, r, "klant")).rejects.toBeTruthy();
  });

  it("de PDF bevat de managementsamenvatting en de eerlijke kanttekening", async () => {
    const { renderPeriodReportHtml, periodReportTitle } = await import("@/server/reports/pdf-period-html");
    const viewer = portalViewer(a);
    const r = await portal.getPortalResults(viewer, periodResultOpts(parsePortalPeriod({ periode: "2025-Q3" })));
    const review = (await reviewMod.getPeriodReview(viewer, r))!;
    const html = renderPeriodReportHtml({ clientName: "Klant A", r, review });
    expect(periodReportTitle(review)).toBe("Kwartaalrapportage");
    expect(html).toContain("Managementsamenvatting");
    expect(html).toContain("Q3 2025");
    expect(html).toContain("Niet gemeten");
    expect(html).toContain("Websitebezoeken");
    expect(html).not.toContain("Klant B");
    expect(html).not.toContain("—");
  });
});
