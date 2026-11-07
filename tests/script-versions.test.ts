import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, files, productionDays, scriptReviews, scriptReviewVersions, shootScriptSources } from "@/db/schema";
import { checkForNewerVersion, isSameScript, newestSource } from "@/lib/script-versions";

/**
 * Altijd de nieuwste scriptversie: herkennen van een nieuwere versie van
 * hetzelfde script, automatisch overstappen (en niet bij een andere variant),
 * en voor de captions de nieuwste bron kiezen (Drive of klantportaal).
 */

// Drive en de captiongenerator nabootsen: geen netwerk, geen AI.
vi.mock("@/server/integrations/drive", () => ({
  drive: { isConfigured: true, downloadBytes: async (id: string) => new TextEncoder().encode(`pdf-${id}`) },
}));
const ensureCalls: string[] = [];
vi.mock("@/server/captions/run", () => ({
  ensureCaptionsForShoot: async (id: string) => { ensureCalls.push(id); return { ok: false, reason: "unchanged" }; },
}));

describe("zelfde script, andere versie", () => {
  it("herkent versies", () => {
    expect(isSameScript("Organisch Scripts - 365 Werk.pdf", "Organisch Scripts - 365 Werk Sessie 7.pdf")).toBe(true);
    expect(isSameScript("Short video script 1.0 - AI2 - Shortclips.pdf", "Short video script 2.0 - AI2 - Shortclips.pdf")).toBe(true);
    expect(isSameScript("Scripts KKFH.pdf", "Scripts KKFH V2.pdf")).toBe(true);
    expect(isSameScript("Scripts KKFH.pdf", "Scripts KKFH (1).pdf")).toBe(true);
    expect(isSameScript("Scripts KKFH - concept.pdf", "Scripts KKFH - Final.pdf")).toBe(true);
  });
  it("ziet een variant als ander document", () => {
    expect(isSameScript("Short video script - 365werk - Shortclips.pdf", "Short video script - RUTGER - 365werk - Shortclips.pdf")).toBe(false);
    expect(isSameScript("short video scripts - 365WERK - Shortclips.pdf", "short video scripts - videograaf - 365WERK - Shortclips.pdf")).toBe(false);
    expect(isSameScript("Short video script - Organisch - Shades.pdf", "Short video script - Advertentie - Shades.pdf")).toBe(false);
  });
});

describe("nieuwere versie zoeken", () => {
  const linked = { externalId: "a", name: "Scripts KKFH.pdf", modifiedAt: "2026-11-01T10:00:00Z" };
  it("stapt over naar een nieuwere versie van hetzelfde script", () => {
    const r = checkForNewerVersion({ linked, linkedAt: "2026-11-02T10:00:00Z", siblings: [
      linked,
      { externalId: "b", name: "Scripts KKFH V2.pdf", modifiedAt: "2026-11-05T10:00:00Z" },
      { externalId: "c", name: "Voice over Tinus.pdf", modifiedAt: "2026-11-06T10:00:00Z" },
    ] });
    expect(r.upgradeTo?.externalId).toBe("b");
    expect(r.otherNewer.map((f) => f.externalId)).toEqual(["c"]);
  });
  it("laat een bewuste keuze voor een oudere versie staan", () => {
    const r = checkForNewerVersion({ linked, linkedAt: "2026-11-06T10:00:00Z", siblings: [
      { externalId: "b", name: "Scripts KKFH V2.pdf", modifiedAt: "2026-11-05T10:00:00Z" },
    ] });
    expect(r.upgradeTo).toBeNull();
  });
});

describe("nieuwste bron voor captions", () => {
  it("kiest de nieuwste van portaal en Drive", () => {
    expect(newestSource({ createdAt: "2026-11-01T00:00:00Z" }, "2026-11-03T00:00:00Z")).toBe("drive");
    expect(newestSource({ createdAt: "2026-11-04T00:00:00Z" }, "2026-11-03T00:00:00Z")).toBe("review");
    expect(newestSource(null, "2026-11-03T00:00:00Z")).toBe("drive");
    expect(newestSource({ createdAt: "2026-11-04T00:00:00Z" }, null)).toBe("review");
    expect(newestSource(null, null)).toBeNull();
  });
});

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let clientId: string;

function inDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  db = await freshDatabase();
  const [c] = await db.insert(clients).values({ slug: "kkfh", name: "KKFH" }).returning({ id: clients.id });
  clientId = c!.id;
});
afterAll(async () => {
  await closeDatabase();
});

describe("met de database", () => {
  it("koppelt automatisch de nieuwere versie en laat de captions controleren", async () => {
    const { syncScriptVersions } = await import("@/server/script-versions");
    const [day] = await db.insert(productionDays).values({ clientId, scheduledOn: inDays(20), title: "Opname" }).returning({ id: productionDays.id });
    await db.insert(files).values([
      { clientId, externalId: "folder", name: "SESSIE 9 - 3 NOVEMBER", isFolder: true, path: "/2. SHORT VIDEO SCRIPTS/SESSIE 9 - 3 NOVEMBER" },
      { clientId, externalId: "v1", parentExternalId: "folder", name: "Scripts KKFH.pdf", mimeType: "application/pdf", path: "/2. SHORT VIDEO SCRIPTS/SESSIE 9 - 3 NOVEMBER/Scripts KKFH.pdf", modifiedAt: new Date("2026-11-01T10:00:00Z") },
      { clientId, externalId: "v2", parentExternalId: "folder", name: "Scripts KKFH V2.pdf", mimeType: "application/pdf", path: "/2. SHORT VIDEO SCRIPTS/SESSIE 9 - 3 NOVEMBER/Scripts KKFH V2.pdf", modifiedAt: new Date("2026-11-04T10:00:00Z") },
      { clientId, externalId: "pptx", parentExternalId: "folder", name: "Scripts KKFH V3.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", modifiedAt: new Date("2026-11-05T10:00:00Z") },
    ]);
    await db.insert(shootScriptSources).values({ productionDayId: day!.id, clientId, status: "gekoppeld", confidence: "hoog", fileExternalId: "v1", fileName: "Scripts KKFH.pdf", confirmedAt: new Date("2026-11-02T10:00:00Z") });

    const r = await syncScriptVersions([day!.id]);
    expect(r.upgraded).toBe(1);
    const [src] = await db.select().from(shootScriptSources).where(eq(shootScriptSources.productionDayId, day!.id));
    expect(src!.fileExternalId).toBe("v2"); // niet de PPTX
    expect(src!.contentHash).toBeNull();
    expect(ensureCalls).toContain(day!.id);

    // Tweede run: niets meer te doen.
    expect((await syncScriptVersions([day!.id])).upgraded).toBe(0);
  });

  it("gebruikt voor de captions de nieuwste bron (Drive na een oudere portaal-PDF)", async () => {
    const { shootReviewPdf } = await import("@/server/captions/generate");
    const [day] = await db.insert(productionDays).values({ clientId, scheduledOn: inDays(25), title: "Opname 2" }).returning({ id: productionDays.id });
    const [rev] = await db.insert(scriptReviews).values({ clientId, productionDayId: day!.id, title: "Scripts" } as typeof scriptReviews.$inferInsert).returning({ id: scriptReviews.id });
    await db.insert(scriptReviewVersions).values({ reviewId: rev!.id, versionNumber: 1, fileName: "portaal.pdf", contentType: "application/pdf", sizeBytes: 10, dataBase64: Buffer.from("portaal").toString("base64"), createdAt: new Date("2026-11-01T10:00:00Z") } as typeof scriptReviewVersions.$inferInsert);

    // Alleen portaal-PDF → die.
    expect((await shootReviewPdf(day!.id))!.origin).toBe("review");

    // Later een nieuwe Drive-versie gekoppeld → Drive wint.
    await db.insert(shootScriptSources).values({ productionDayId: day!.id, clientId, status: "gekoppeld", confidence: "hoog", fileExternalId: "v2", fileName: "Scripts KKFH V2.pdf", confirmedAt: new Date("2026-11-06T10:00:00Z") });
    const pdf = await shootReviewPdf(day!.id);
    expect(pdf!.origin).toBe("drive");
    expect(pdf!.fileName).toBe("Scripts KKFH V2.pdf");

    // Daarna een nieuwere portaalversie → portaal wint weer.
    await db.insert(scriptReviewVersions).values({ reviewId: rev!.id, versionNumber: 2, fileName: "portaal-v2.pdf", contentType: "application/pdf", sizeBytes: 10, dataBase64: Buffer.from("portaal2").toString("base64"), createdAt: new Date(Date.now() + 60_000) } as typeof scriptReviewVersions.$inferInsert);
    expect((await shootReviewPdf(day!.id))!.fileName).toBe("portaal-v2.pdf");
  });
});
