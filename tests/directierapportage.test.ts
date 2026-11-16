import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { parsePortalPeriod, periodResultOpts } from "@/lib/portal-periods";

/**
 * Directieversie van het maandoverzicht: zelfde cijfers als de
 * resultatenpagina, aangevuld met afname en uitgevoerd werk. Getest wordt dat
 * de klant haar alleen krijgt na afloop, controle en publicatie, dat er geen
 * prijzen of gegevens van een andere klant in komen, en dat wat niet gemeten is
 * ook zo wordt genoemd.
 */

type Schema = typeof import("@/db/schema");
type Viewer = import("@/server/auth/context").Viewer;

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function seed(db: Awaited<ReturnType<typeof freshDatabase>>, s: Schema, tag: string, perDay: number, focus: string | null) {
  const [client] = await db
    .insert(s.clients)
    .values({ slug: `klant-${tag.toLowerCase()}`, name: `Klant ${tag}`, status: "active", contentFocus: focus, monthlyRevenue: "2950.00", monthlyVideoQuota: 8 })
    .returning({ id: s.clients.id });
  const clientId = client!.id;
  await db.insert(s.clientPackages).values({ clientId, name: "Organisch 8", videosPerMonth: 8, shootDaysPerMonth: 1, monthlyPrice: "2950.00", isActive: true });
  const rows = days("2025-04-01", "2025-09-30").map((d) => ({ clientId, platform: "instagram" as const, measuredOn: d, views: perDay, reach: perDay / 2, engagements: 4, followerDelta: 2 }));
  for (let i = 0; i < rows.length; i += 60) await db.insert(s.dailyMetrics).values(rows.slice(i, i + 60));
  await db.insert(s.publications).values([
    { clientId, platform: "instagram", status: "published", publishedAt: new Date("2025-07-10T10:00:00Z"), externalPostId: `${tag}-1`, caption: `${tag}-video juli` },
    { clientId, platform: "instagram", status: "published", publishedAt: new Date("2025-08-10T10:00:00Z"), externalPostId: `${tag}-2`, caption: `${tag}-video augustus` },
  ]);
  return clientId;
}

const portalViewer = (clientId: string) =>
  ({ id: "00000000-0000-0000-0000-0000000000aa", email: "c@klant.nl", fullName: "Klant", primaryRole: "client", clientId, avatarUrl: null, status: "active", permissions: new Set(["portal:access"]), clientScope: [clientId], isPortalUser: true, isEditorOnly: false }) as unknown as Viewer;

describe("directieversie van het maandoverzicht", () => {
  let portal: typeof import("@/server/portal");
  let reviewMod: typeof import("@/server/period-review");
  let dir: typeof import("@/server/reports/directie");
  let pdf: typeof import("@/server/reports/pdf-directie-html");
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: Schema;
  let a: string;
  let b: string;
  let c: string;

  const load = async (clientId: string, periode: string) => {
    const viewer = portalViewer(clientId);
    const r = await portal.getPortalResults(viewer, periodResultOpts(parsePortalPeriod({ periode })));
    const review = (await reviewMod.getPeriodReview(viewer, r))!;
    return { r, review, data: await dir.loadDirectieData(clientId, r, review) };
  };

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    portal = await import("@/server/portal");
    reviewMod = await import("@/server/period-review");
    dir = await import("@/server/reports/directie");
    pdf = await import("@/server/reports/pdf-directie-html");
    a = await seed(db, s, "A", 200, "organisch");
    b = await seed(db, s, "B", 9000, "beide");
    c = await seed(db, s, "C", 50, null);
  });
  afterAll(async () => {
    await closeDatabase();
  });

  it("stelt de maand samen uit afname, uitgevoerd werk en de gemeten cijfers", async () => {
    const { data } = await load(a, "2025-08");
    expect(data).not.toBeNull();
    expect(data!).toMatchObject({ clientName: "Klant A", label: "Augustus 2025" });
    expect(data!.afname).toMatchObject({ focus: "organisch", videosPerMaand: 8, opnamedagenPerMaand: 1 });
    expect(data!.uitgevoerd.maanden.map((m) => [m.key, m.gepubliceerd])).toEqual([["2025-08", 1]]);
    expect(data!.uitgevoerd.afgesproken).toBe(8);
    expect(data!.conclusie).toHaveLength(5);
    expect(data!.conclusie[1]!.tekst).toContain("6.200");
    expect(data!.conclusie[1]!.tekst).toContain("Aanvragen en omzet zijn niet gemeten");
  });

  it("de PDF noemt wat niet gemeten is en bevat geen prijs of gegevens van een andere klant", async () => {
    const { data } = await load(a, "2025-08");
    const html = pdf.renderDirectieHtml(data!, "directie");
    expect(pdf.directieTitle("directie")).toBe("Maandrapportage directie");
    expect(html.match(/<section class="page/g)).toHaveLength(5);
    expect(html).toContain("Wat doet Shortclips voor Klant A?");
    expect(html).toContain("Organische short video content, 8 video's per maand, 1 opnamedag per maand");
    expect(html).toContain("Niet gemeten");
    expect(html).toContain("Bereik is geen omzet");
    expect(html).toContain("Conclusie voor de directie");
    for (const verboden of ["2950", "2.950", "Organisch 8", "Klant B", "B-video", b, "—", "Interne voorvertoning"]) expect(html).not.toContain(verboden);
  });

  it("het directieoverzicht is precies één pagina", async () => {
    const { data } = await load(a, "2025-08");
    const kort = pdf.renderDirectieHtml(data!, "overzicht");
    expect(pdf.directieTitle("overzicht")).toBe("Directieoverzicht");
    expect(kort.match(/<section class="page/g)).toHaveLength(1);
    expect(kort).toContain("Directieoverzicht");
    expect(kort).toContain("Belangrijkste conclusie");
    expect(kort).not.toContain("2950");
  });

  it("de interne voorvertoning is als zodanig gemarkeerd", async () => {
    const { data } = await load(a, "2025-08");
    expect(pdf.renderDirectieHtml(data!, "directie", { concept: true })).toContain("Interne voorvertoning");
  });

  it("is er alleen per maand: een kwartaal verwijst naar de kwartaalrapportage, een vrije periode heeft er geen", async () => {
    const q = await load(a, "2025-Q3");
    expect(q.data).toBeNull();
    const reden = dir.directieBeschikbaar(q.review, { focus: "organisch" }, true, true);
    expect(reden.ok).toBe(false);
    expect(reden.reden).toContain("kwartaalrapportage");
    const viewer = portalViewer(a);
    const r = await portal.getPortalResults(viewer, periodResultOpts(parsePortalPeriod({ periode: "custom", van: "2025-07-05", tot: "2025-07-20" })));
    const review = (await reviewMod.getPeriodReview(viewer, r))!;
    expect(await dir.loadDirectieData(a, r, review)).toBeNull();
    expect(dir.directieVariant("samenvatting")).toBeNull();
    expect(dir.directieVariant("overzicht")).toBe("overzicht");
  });

  it("de klant krijgt de directieversie pas na afloop, controle en publicatie", async () => {
    const afname = { focus: "organisch" as const };
    const voor = await load(a, "2025-08");
    // Niet vrijgegeven voor klanten: nooit beschikbaar, wat er verder ook klopt.
    expect(dir.directieBeschikbaar(voor.review, afname, true, false).ok).toBe(false);
    // Vrijgegeven, maar de maandrapportage is nog niet gepubliceerd.
    const zonder = dir.directieBeschikbaar(voor.review, afname, true, true);
    expect(zonder.ok).toBe(false);
    expect(zonder.reden).toContain("nog niet goedgekeurd en gepubliceerd");

    await db.insert(s.clientReports).values({ clientId: a, periodType: "month", period: "2025-08", title: "Maandrapport 2025-08", status: "gepubliceerd", isPublished: true });
    await db.insert(s.clientReports).values({ clientId: a, periodType: "month", period: "2025-09", title: "Maandrapport 2025-09", status: "klaar_voor_controle" });
    // Een gepubliceerde maand is beschikbaar; een maand die op controle wacht niet.
    const aug = await load(a, "2025-08");
    expect(dir.directieBeschikbaar(aug.review, afname, true, true)).toEqual({ ok: true, reden: null });
    const sep = await load(a, "2025-09");
    expect(dir.directieBeschikbaar(sep.review, afname, true, true).ok).toBe(false);
    // Zonder vastgelegde afname gaat er niets naar de klant.
    expect(dir.directieBeschikbaar(aug.review, { focus: null }, true, true).ok).toBe(false);
    // Een lopende maand evenmin.
    expect(dir.directieBeschikbaar({ ...aug.review, complete: false }, afname, true, true).ok).toBe(false);
    // De gepubliceerde rapportage van klant A maakt niets vrij voor klant B.
    const anders = await load(b, "2025-08");
    expect(dir.directieBeschikbaar(anders.review, { focus: "beide" }, true, true).ok).toBe(false);
  });

  it("zonder vastgelegde afname meldt het rapport dat eerlijk", async () => {
    const { data } = await load(c, "2025-08");
    expect(data!.afname.focus).toBeNull();
    expect(pdf.renderDirectieHtml(data!, "directie", { concept: true })).toContain("De afname is nog niet vastgelegd in het portaal.");
  });

  it("neemt alleen gemeten of door het team goedgekeurde actiepunten mee, maximaal vijf", () => {
    const acties = dir.directieActies([
      { kind: "testen", title: "Nieuw idee", text: "", source: "voorstel" },
      { kind: "verbeteren", title: "Kortere video's", text: "", source: "team" },
      { kind: "behouden", title: "Vraag als opening", text: "", source: "resultaten" },
      ...[1, 2, 3, 4, 5].map((i) => ({ kind: "verbeteren" as const, title: `Punt ${i}`, text: "", source: "team" as const })),
    ]);
    expect(acties).toHaveLength(5);
    expect(acties[0]).toMatchObject({ kind: "behouden", title: "Vraag als opening" });
    expect(acties.map((x) => x.title)).not.toContain("Nieuw idee");
  });

  it("werkzaamheden volgen de afname: publicatie alleen als Shortclips plaatst", () => {
    expect(dir.werkzaamheden({ focus: "organisch", plaatsing: false })[0]!.items.join(" ")).not.toContain("Publicatie");
    expect(dir.werkzaamheden({ focus: "organisch", plaatsing: true })[0]!.items.join(" ")).toContain("Publicatie");
    expect(dir.werkzaamheden({ focus: "beide", plaatsing: true }).map((w) => w.titel)).toEqual(["Organische short video content", "Videoadvertenties"]);
    expect(dir.werkzaamheden({ focus: null, plaatsing: true })).toEqual([]);
  });
});
