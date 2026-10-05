import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * De harde privacy-garantie, end-to-end getest op de ÉCHTE portaal-route.
 *
 * `tests/isolation.test.ts` bewijst dat de scoping-primitieven kloppen. Deze
 * test gaat een stap verder: hij draait de volledige `getPortalData` en
 * `getPortalVideo` — precies de functies die het klantportaal voeden — met een
 * ingelogde klant A, terwijl klant B exact dezelfde soorten data heeft. Eis:
 *
 *   1. In de hele payload van klant A komt NIETS van klant B voor.
 *   2. Een klant kan geen video van een andere klant openen door een id te
 *      raden/plakken (id-manipulatie → niet gevonden, geen lek).
 *   3. Interne opmerkingen en interne gebeurtenissen bereiken het portaal niet.
 */

type Schema = typeof import("@/db/schema");
type Ctx = typeof import("@/server/auth/context");

const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = "2099-01-01";

/** Vult één klant met elke datasoort die het portaal toont. `tag` = A of B. */
async function seedClient(
  db: Awaited<ReturnType<typeof freshDatabase>>,
  s: Schema,
  tag: string,
): Promise<{ clientId: string; reviewVideoId: string }> {
  const [client] = await db
    .insert(s.clients)
    .values({ slug: `klant-${tag.toLowerCase()}`, name: `Klant ${tag}`, status: "active" })
    .returning({ id: s.clients.id });
  const clientId = client!.id;

  // Video die op goedkeuring van de klant wacht (+ later reviewdraden).
  const [reviewVideo] = await db
    .insert(s.deliverables)
    .values({ clientId, title: `${tag}-wacht-op-akkoord`, status: "client_review" })
    .returning({ id: s.deliverables.id });
  const reviewVideoId = reviewVideo!.id;

  await db.insert(s.deliverables).values([
    { clientId, title: `${tag}-in-montage`, status: "editing" },
    { clientId, title: `${tag}-gepubliceerd`, status: "published", publishedAt: new Date() },
  ]);

  await db.insert(s.scripts).values({
    clientId,
    title: `${tag}-script`,
    status: "client_review",
    hook: `${tag}-hook`,
    body: `${tag}-body`,
    cta: `${tag}-cta`,
  });

  await db.insert(s.productionDays).values({
    clientId,
    title: `${tag}-opnamedag`,
    scheduledOn: FUTURE,
    locationName: `${tag}-locatie`,
  });

  await db.insert(s.contentCalendar).values({
    clientId,
    title: `${tag}-publicatie`,
    scheduledOn: FUTURE,
    status: "scheduled",
    platforms: ["instagram"],
  });

  await db.insert(s.clientReports).values({
    clientId,
    period: "2026-09",
    title: `${tag}-maandrapport`,
    isPublished: true,
    publishedAt: new Date(),
  });

  await db.insert(s.files).values({
    clientId,
    name: `${tag}-rapportage.pdf`,
    category: "Rapportages",
    externalUrl: `https://drive.example/${tag}`,
    isFolder: false,
    modifiedAt: new Date(),
  });

  await db.insert(s.activityEvents).values([
    { clientId, type: "video.approved", title: `${tag}-zichtbare-gebeurtenis`, isClientVisible: true },
    { clientId, type: "margin.updated", title: `${tag}-INTERNE-marge`, isClientVisible: false },
  ]);

  // Verschillende getallen per klant: zo valt op als cijfers worden opgeteld.
  await db.insert(s.dailyMetrics).values({
    clientId,
    measuredOn: TODAY,
    views: tag === "A" ? 100 : 777,
    reach: tag === "A" ? 50 : 888,
    engagements: tag === "A" ? 10 : 999,
    followerDelta: tag === "A" ? 5 : 666,
  });

  // Reviewdraden op de wacht-op-akkoord-video: één klant, één intern.
  await db.insert(s.reviewThreads).values([
    { deliverableId: reviewVideoId, visibility: "client" },
    { deliverableId: reviewVideoId, visibility: "internal" },
  ]);

  return { clientId, reviewVideoId };
}

function portalViewer(ctx: Ctx, clientId: string): import("@/server/auth/context").Viewer {
  return {
    id: "00000000-0000-0000-0000-0000000000aa",
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
  } as import("@/server/auth/context").Viewer;
}

describe("portaal-isolatie (end-to-end op de echte route)", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: Schema;
  let ctx: Ctx;
  let portal: typeof import("@/server/portal");
  let a: { clientId: string; reviewVideoId: string };
  let b: { clientId: string; reviewVideoId: string };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    ctx = await import("@/server/auth/context");
    portal = await import("@/server/portal");

    a = await seedClient(db, s, "A");
    b = await seedClient(db, s, "B");
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("toont klant A uitsluitend de eigen gegevens — geen spoor van klant B", async () => {
    const data = await portal.getPortalData(portalViewer(ctx, a.clientId));

    expect(data.client.id).toBe(a.clientId);
    expect(data.client.name).toBe("Klant A");

    // Nergens in de volledige payload mag iets van klant B opduiken.
    const blob = JSON.stringify(data);
    expect(blob).not.toContain("Klant B");
    expect(blob).not.toContain("B-");
    expect(blob).not.toContain(b.clientId);
    expect(blob).not.toContain(b.reviewVideoId);

    // En elke lijst bevat echt alleen data van A.
    expect(data.awaitingApproval.map((v) => v.title)).toEqual(["A-wacht-op-akkoord"]);
    expect(data.scriptsToReview.map((v) => v.title)).toEqual(["A-script"]);
    expect(data.inProgress.map((v) => v.title)).toEqual(["A-in-montage"]);
    expect(data.published.map((v) => v.title)).toEqual(["A-gepubliceerd"]);
    expect(data.calendar.map((v) => v.title)).toEqual(["A-publicatie"]);
    expect(data.reports.map((v) => v.title)).toEqual(["A-maandrapport"]);
    expect(data.documents.map((v) => v.name)).toEqual(["A-rapportage.pdf"]);
    expect(data.upcomingShoot?.title).toBe("A-opnamedag");
  });

  it("telt cijfers van een andere klant niet mee", async () => {
    const data = await portal.getPortalData(portalViewer(ctx, a.clientId));
    // Exact de getallen van A — niet opgeteld met B (777/888/999/666).
    expect(data.metrics).toEqual({ views: 100, reach: 50, engagements: 10, followerGrowth: 5 });
  });

  it("laat interne gebeurtenissen en interne opmerkingen niet in het portaal lekken", async () => {
    const data = await portal.getPortalData(portalViewer(ctx, a.clientId));
    const titles = data.timeline.map((e) => e.title);
    expect(titles).toContain("A-zichtbare-gebeurtenis");
    expect(titles).not.toContain("A-INTERNE-marge");

    const video = await portal.getPortalVideo(portalViewer(ctx, a.clientId), a.reviewVideoId);
    // Alleen de klant-draad, nooit de interne draad.
    expect(video.threads).toHaveLength(1);
  });

  it("blokkeert het openen van de video van een andere klant via een geplakt id", async () => {
    // Klant A probeert de video-id van klant B te openen → niet gevonden, geen lek.
    await expect(
      portal.getPortalVideo(portalViewer(ctx, a.clientId), b.reviewVideoId),
    ).rejects.toThrow();
  });

  it("geeft een klant zonder gekoppelde klant niets", async () => {
    const orphan = portalViewer(ctx, a.clientId);
    orphan.clientId = null;
    await expect(portal.getPortalData(orphan)).rejects.toThrow();
  });
});
