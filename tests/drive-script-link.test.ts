import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, files, productionDays, shootScriptSources } from "@/db/schema";
import { matchDriveScriptsForShoots } from "@/server/captions/drive-script-match";
import { shootHasReviewPdf } from "@/server/captions/generate";

/**
 * Bewijst de hele koppelketen tegen een echte test-database (PGlite), zonder
 * Google Drive: een gesynct script-PDF in `files` wordt op klant + datum aan de
 * juiste opname gekoppeld in `shoot_script_sources`, en telt daarna mee als
 * "heeft een script-PDF" voor de Caption Maker. Ook de veilige twijfel-afhandeling
 * (twee even sterke matches → suggestie, geen automatische koppeling) wordt getest.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;

async function makeClient(slug: string, name: string): Promise<string> {
  const [c] = await db.insert(clients).values({ slug, name }).returning({ id: clients.id });
  return c!.id;
}
async function makeShoot(clientId: string, scheduledOn: string, title: string): Promise<string> {
  const [d] = await db.insert(productionDays).values({ clientId, scheduledOn, title }).returning({ id: productionDays.id });
  return d!.id;
}
async function makeScriptFile(clientId: string, externalId: string, name: string, path?: string) {
  await db.insert(files).values({
    clientId, externalId, name, path: path ?? `Scripts/${name}`,
    category: "Scripts", isFolder: false, mimeType: "application/pdf",
  });
}

beforeAll(async () => {
  db = await freshDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

describe("Drive-script koppeling", () => {
  it("koppelt een script-PDF op klant + datum automatisch aan de juiste opname", async () => {
    const clientId = await makeClient("alfa", "Alfa");
    const dayId = await makeShoot(clientId, "2026-11-04", "Opnamedag Alfa — nov");
    // De juiste PDF (datum 04-11) + een misleider met een andere datum.
    await makeScriptFile(clientId, "drive-juist", "Scripts Alfa 04-11.pdf");
    await makeScriptFile(clientId, "drive-oud", "Scripts Alfa 20-10.pdf");

    const [outcome] = await matchDriveScriptsForShoots([
      { productionDayId: dayId, clientId, scheduledOn: "2026-11-04", title: "Opnamedag Alfa — nov", clientName: "Alfa" },
    ]);
    expect(outcome?.linked).toBe(1);

    const [src] = await db
      .select({ status: shootScriptSources.status, fileExternalId: shootScriptSources.fileExternalId })
      .from(shootScriptSources)
      .where(eq(shootScriptSources.productionDayId, dayId));
    expect(src?.status).toBe("gekoppeld");
    expect(src?.fileExternalId).toBe("drive-juist");

    // Telt mee als "heeft script-PDF" voor de Caption Maker.
    const has = await shootHasReviewPdf([dayId]);
    expect(has.has(dayId)).toBe(true);
  });

  it("koppelt niets automatisch bij twee even sterke matches, maar maakt een suggestie", async () => {
    const clientId = await makeClient("beta", "Beta");
    const dayId = await makeShoot(clientId, "2026-11-05", "Opnamedag Beta — nov");
    await makeScriptFile(clientId, "beta-1", "Scripts Beta 05-11 deel 1.pdf");
    await makeScriptFile(clientId, "beta-2", "Scripts Beta 05-11 deel 2.pdf");

    const [outcome] = await matchDriveScriptsForShoots([
      { productionDayId: dayId, clientId, scheduledOn: "2026-11-05", title: "Opnamedag Beta — nov", clientName: "Beta" },
    ]);
    expect(outcome?.linked).toBe(0);
    expect(outcome?.suggested).toBe(1);

    const [src] = await db
      .select({ status: shootScriptSources.status })
      .from(shootScriptSources)
      .where(eq(shootScriptSources.productionDayId, dayId));
    expect(src?.status).toBe("suggestie");

    // Een suggestie is (nog) geen bron → telt niet als "heeft script-PDF".
    const has = await shootHasReviewPdf([dayId]);
    expect(has.has(dayId)).toBe(false);
  });

  it("overschrijft een afgewezen koppeling niet opnieuw", async () => {
    const clientId = await makeClient("gamma", "Gamma");
    const dayId = await makeShoot(clientId, "2026-11-06", "Opnamedag Gamma — nov");
    await makeScriptFile(clientId, "gamma-1", "Scripts Gamma 06-11.pdf");

    // Team heeft de match eerder afgewezen.
    await db.insert(shootScriptSources).values({
      productionDayId: dayId, clientId, status: "afgewezen", confidence: "hoog",
      fileExternalId: "gamma-1", fileName: "Scripts Gamma 06-11.pdf",
    });

    await matchDriveScriptsForShoots([
      { productionDayId: dayId, clientId, scheduledOn: "2026-11-06", title: "Opnamedag Gamma — nov", clientName: "Gamma" },
    ]);
    const [src] = await db
      .select({ status: shootScriptSources.status })
      .from(shootScriptSources)
      .where(and(eq(shootScriptSources.productionDayId, dayId)));
    expect(src?.status).toBe("afgewezen");
  });
});
