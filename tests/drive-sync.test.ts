import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_REFRESH_TOKEN = "test-refresh";
});

const notified: string[] = [];
vi.mock("@/server/notification-digest", () => ({
  notifyTechnical: async (line: string) => {
    notified.push(line);
    return 1;
  },
}));
vi.mock("@/server/audit", () => ({ logError: async () => undefined, auditLog: async () => undefined }));

import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, driveMappings, files, integrationConnections, syncJobs } from "@/db/schema";
import { drive, type DriveFile } from "@/server/integrations/drive";
import { IntegrationError } from "@/server/integrations/types";
import {
  ACCOUNT_ENTITY,
  getAccountCursor,
  processDriveChanges,
  reconcileDriveFolders,
} from "@/server/jobs/drive-sync";
import { getDriveStatus, runDriveHealthCheck } from "@/server/integrations/drive-status";
import { setGoogleAuthState } from "@/server/integrations/google-connection";

/**
 * Bewijst de Drive-synchronisatie tegen een echte Postgres (PGlite), met een
 * nagebootste Drive. Dekt de testsituaties uit de opdracht.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let alfa: string;
let beta: string;

const FOLDER = "application/vnd.google-apps.folder";
type Change = { fileId: string; removed: boolean; file?: DriveFile };
type Page = { changes: Change[]; nextPageToken?: string; newStartPageToken?: string };

/** Nagebootste changes-feed: pageToken → pagina. */
let feed: Record<string, Page> = {};
/** Nagebootste mapinhoud voor de volledige controle. */
let tree: Record<string, DriveFile[]> = {};
/** Nagebootste metadata voor files.get (bovenliggende mappen navragen). */
let driveMeta: Record<string, DriveFile> = {};

function f(id: string, name: string, parent: string, extra: Partial<DriveFile> = {}): DriveFile {
  return { id, name, mimeType: "application/pdf", parents: [parent], modifiedTime: "2026-11-08T10:00:00Z", ...extra };
}
function folder(id: string, name: string, parent: string): DriveFile {
  return f(id, name, parent, { mimeType: FOLDER });
}
const change = (file: DriveFile): Change => ({ fileId: file.id, removed: false, file });

async function live(externalId: string) {
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.externalId, externalId), isNull(files.deletedAt)));
  return row ?? null;
}
async function setCursor(token: string) {
  await db.update(driveMappings).set({ pageToken: token }).where(eq(driveMappings.entityType, ACCOUNT_ENTITY));
}
/** Alle wijzigingen van één pagina in de feed zetten en verwerken. */
async function push(token: string, changes: Change[]) {
  feed[token] = { changes, newStartPageToken: `${Number(token) + 1}` };
  feed[`${Number(token) + 1}`] = { changes: [], newStartPageToken: `${Number(token) + 1}` };
  await setCursor(token);
  return processDriveChanges({ budgetMs: 60_000 });
}

beforeAll(async () => {
  db = await freshDatabase();
  vi.spyOn(drive, "changes").mockImplementation(async (token: string) => {
    const page = feed[token];
    if (!page) throw new Error(`onbekend token ${token}`);
    return page;
  });
  vi.spyOn(drive, "startPageToken").mockResolvedValue("900");
  vi.spyOn(drive, "listFolder").mockImplementation(async (id: string) => tree[id] ?? []);
  vi.spyOn(drive, "getFile").mockImplementation(async (id: string) => {
    const meta = driveMeta[id];
    if (!meta) throw Object.assign(new Error("not found"), { status: 404 });
    return meta;
  });
  vi.spyOn(drive, "about").mockResolvedValue({ emailAddress: "teamshortclips@gmail.com", displayName: "Team" });

  const [a] = await db.insert(clients).values({ slug: "alfa", name: "Alfa" }).returning({ id: clients.id });
  const [b] = await db.insert(clients).values({ slug: "beta", name: "Beta" }).returning({ id: clients.id });
  alfa = a!.id;
  beta = b!.id;
  // Oude situatie: per klantmap een eigen cursor (Beta liep achter sinds token 100).
  await db.insert(driveMappings).values([
    { entityType: "client", entityId: alfa, folderId: "root-alfa", pageToken: "250" },
    { entityType: "client", entityId: beta, folderId: "root-beta", pageToken: "100" },
  ]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

beforeEach(() => {
  feed = {};
});

describe("Drive-synchronisatie", () => {
  it("12. haalt de achterstand in: de nieuwe cursor start bij de oudste klantcursor", async () => {
    feed["100"] = { changes: [], newStartPageToken: "101" };
    const r = await processDriveChanges();
    expect(r.ok).toBe(true);
    const cursor = await getAccountCursor();
    expect(cursor?.pageToken).toBe("101");
  });

  it("nieuw bestand krijgt de juiste klant, pad en categorie (vindbaar voor Scripting)", async () => {
    const scripts = folder("fold-scripts-a", "Scripts", "root-alfa");
    const sessie = folder("fold-sessie-a", "Sessie november", "fold-scripts-a");
    const pdf = f("pdf-1", "Scripts Alfa 04-11.pdf", "fold-sessie-a");
    // Bewust in "verkeerde" volgorde: kind vóór ouder.
    const r = await push("200", [change(pdf), change(sessie), change(scripts)]);
    expect(r.ok).toBe(true);
    const row = await live("pdf-1");
    expect(row?.clientId).toBe(alfa);
    expect(row?.path).toBe("/Scripts/Sessie november/Scripts Alfa 04-11.pdf");
    expect(row?.category).toBe("Scripts");
  });

  it("bestand buiten de klantmappen wordt niet aan een klant gehangen", async () => {
    await push("210", [change(f("prive-1", "Belasting.pdf", "map-van-iemand-anders"))]);
    expect(await live("prive-1")).toBeNull();
  });

  it("7. gewijzigd bestand wordt bijgewerkt; dezelfde wijziging twee keer = geen dubbel bestand", async () => {
    const pdf = f("pdf-1", "Scripts Alfa 04-11 v2.pdf", "fold-sessie-a", { modifiedTime: "2026-11-08T12:00:00Z" });
    await push("220", [change(pdf)]);
    await push("230", [change(pdf)]); // herhaalde taak
    const rows = await db.select().from(files).where(eq(files.externalId, "pdf-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Scripts Alfa 04-11 v2.pdf");
    expect(rows[0]!.modifiedAt?.toISOString()).toBe("2026-11-08T12:00:00.000Z");
  });

  it("8. verplaatst bestand en verplaatste map: klant en paden van alles eronder kloppen", async () => {
    const before = await live("pdf-1");
    // Hele sessiemap van Alfa naar Beta verplaatst en hernoemd.
    await push("240", [
      change(folder("fold-scripts-b", "Scripts", "root-beta")),
      change(folder("fold-sessie-a", "Sessie december", "fold-scripts-b")),
    ]);
    const after = await live("pdf-1");
    expect(after?.id).toBe(before?.id); // bestaande koppeling blijft behouden
    expect(after?.clientId).toBe(beta);
    expect(after?.path).toBe("/Scripts/Sessie december/Scripts Alfa 04-11 v2.pdf");
  });

  it("9. verwijderd bestand en verwijderde map (ook alles eronder) worden gemarkeerd, niet gewist", async () => {
    await push("250", [change(f("pdf-2", "Losse notitie.pdf", "fold-sessie-a"))]);
    expect(await live("pdf-2")).not.toBeNull();
    await push("260", [{ fileId: "fold-sessie-a", removed: false, file: { ...folder("fold-sessie-a", "Sessie december", "fold-scripts-b"), trashed: true } }]);
    expect(await live("pdf-1")).toBeNull();
    expect(await live("pdf-2")).toBeNull();
    const kept = await db.select().from(files).where(eq(files.externalId, "pdf-1"));
    expect(kept).toHaveLength(1); // nog aanwezig, alleen gemarkeerd
  });

  it("6. toegang tot een bestand kwijt (removed in de feed) → gemarkeerd als verwijderd", async () => {
    await push("270", [change(f("pdf-3", "Contract.pdf", "fold-scripts-a"))]);
    expect(await live("pdf-3")).not.toBeNull();
    await push("280", [{ fileId: "pdf-3", removed: true }]);
    expect(await live("pdf-3")).toBeNull();
  });

  it("diepe submap die nog niet in de database staat: navragen bij Drive, bestand blijft bij de klant", async () => {
    // Bestaand bestand in een diepe map die de oude import oversloeg.
    await db.insert(files).values({ clientId: alfa, name: "Diep.pdf", source: "google_drive", externalId: "diep-1", isFolder: false });
    driveMeta = {
      "d1": folder("d1", "Opnames", "root-alfa"),
      "d2": folder("d2", "2026", "d1"),
      "d3": folder("d3", "November", "d2"),
    };
    await push("285", [change(f("diep-1", "Diep.pdf", "d3"))]);
    const row = await live("diep-1");
    expect(row).not.toBeNull(); // níet onterecht als verwijderd gemarkeerd
    expect(row?.path).toBe("/Opnames/2026/November/Diep.pdf");
    expect(row?.category).toBe("Opnames");
    expect((await live("d3"))?.path).toBe("/Opnames/2026/November");
  });

  it("bestand echt uit de klantmap verplaatst (naar een privémap): gemarkeerd als verwijderd", async () => {
    driveMeta = { ...driveMeta, "prive-map": folder("prive-map", "Privé", "my-drive-root"), "my-drive-root": { id: "my-drive-root", name: "Mijn Drive", mimeType: FOLDER } };
    await push("290", [change(f("diep-1", "Diep.pdf", "prive-map"))]);
    expect(await live("diep-1")).toBeNull();
  });

  it("10. twee gelijktijdige runs: de tweede wacht niet en verwerkt niets dubbel", async () => {
    feed["300"] = { changes: [change(f("pdf-4", "Gelijktijdig.pdf", "fold-scripts-a"))], newStartPageToken: "301" };
    feed["301"] = { changes: [], newStartPageToken: "301" };
    await setCursor("300");
    const [a, b] = await Promise.all([processDriveChanges(), processDriveChanges()]);
    expect([a.skipped, b.skipped].filter((s) => s === "already_running")).toHaveLength(1);
    const rows = await db.select().from(files).where(eq(files.externalId, "pdf-4"));
    expect(rows).toHaveLength(1);
  });

  it("11/12. onderbroken run (tijdbudget op) gaat later verder zonder iets te missen", async () => {
    feed["400"] = { changes: [change(f("p-a", "A.pdf", "fold-scripts-a"))], nextPageToken: "401" };
    feed["401"] = { changes: [change(f("p-b", "B.pdf", "fold-scripts-a"))], nextPageToken: "402" };
    feed["402"] = { changes: [change(f("p-c", "C.pdf", "fold-scripts-a"))], newStartPageToken: "403" };
    feed["403"] = { changes: [], newStartPageToken: "403" };
    await setCursor("400");
    const first = await processDriveChanges({ budgetMs: 0 }); // stopt na één pagina
    expect(first.caughtUp).toBe(false);
    expect((await getAccountCursor())?.pageToken).toBe("401");
    expect(await live("p-b")).toBeNull();
    // "Herstart": een nieuwe run pakt het op waar de vorige stopte.
    const second = await processDriveChanges();
    expect(second.caughtUp).toBe(true);
    for (const id of ["p-a", "p-b", "p-c"]) expect(await live(id)).not.toBeNull();
    expect((await getAccountCursor())?.pageToken).toBe("403");
  });

  it("3. Drive onbereikbaar: cursor blijft staan, laatst bekende gegevens blijven zichtbaar, status 'aandacht'", async () => {
    await setCursor("500");
    const spy = vi.mocked(drive.changes);
    spy.mockRejectedValueOnce(new IntegrationError("google_drive", "HTTP 503", 503, true));
    spy.mockRejectedValueOnce(new IntegrationError("google_drive", "HTTP 503", 503, true));
    spy.mockRejectedValueOnce(new IntegrationError("google_drive", "HTTP 503", 503, true));
    for (let i = 0; i < 3; i++) expect((await processDriveChanges()).ok).toBe(false);
    expect((await getAccountCursor())?.pageToken).toBe("500");
    expect(await live("p-a")).not.toBeNull();
    const status = await getDriveStatus();
    expect(status.connection).toBe("aandacht");
    expect(status.consecutiveFailures).toBe(3);
    expect(notified).toHaveLength(0); // niveau 2: geen melding

    // Herstel: Drive weer bereikbaar.
    feed["500"] = { changes: [], newStartPageToken: "500" };
    expect((await processDriveChanges()).ok).toBe(true);
    expect((await getDriveStatus()).connection).toBe("actief");
  });

  it("niveau 3: ingetrokken toestemming → precies één melding, ook bij herhaalde controles", async () => {
    await setGoogleAuthState("reauth_required", "test");
    await runDriveHealthCheck();
    await runDriveHealthCheck();
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("Opnieuw verbinden");
    const status = await getDriveStatus();
    expect(status.connection).toBe("verbroken");
    expect(status.canReconnect).toBe(true);

    // Hersteld → status actief en een volgende verbreking mag weer gemeld worden.
    await setGoogleAuthState("ok");
    await runDriveHealthCheck();
    const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.provider, "google_drive"));
    expect((conn!.config as { alertedState?: string | null }).alertedState ?? null).toBeNull();
  });

  it("afgebroken runs (servertime-out) worden netjes afgesloten", async () => {
    await db.insert(syncJobs).values({
      provider: "google_drive",
      jobType: "drive.sync_changes",
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60_000),
    });
    const r = await runDriveHealthCheck();
    expect(r.abortedJobs).toBe(1);
  });
});

describe("Vangnet: volledige controle van een klantmap", () => {
  it("herstelt ontbrekend pad/categorie, voegt gemiste bestanden toe en markeert verdwenen bestanden", async () => {
    // Een oude rij zonder pad/categorie (zoals de 451 rijen in productie).
    await db.insert(files).values({ clientId: alfa, name: "Oud.pdf", source: "google_drive", externalId: "oud-1", isFolder: false });
    // Een rij die in Drive niet meer bestaat.
    await db.insert(files).values({ clientId: alfa, name: "Weg.pdf", source: "google_drive", externalId: "weg-1", path: "/Weg.pdf", isFolder: false });
    const before = await live("oud-1");

    tree = {
      "root-alfa": [folder("fold-scripts-a", "Scripts", "root-alfa"), f("gemist-1", "Gemist.pdf", "root-alfa")],
      "fold-scripts-a": [f("oud-1", "Oud.pdf", "fold-scripts-a"), f("p-a", "A.pdf", "fold-scripts-a"), f("p-b", "B.pdf", "fold-scripts-a"), f("p-c", "C.pdf", "fold-scripts-a"), f("pdf-4", "Gelijktijdig.pdf", "fold-scripts-a")],
    };
    const r = await reconcileDriveFolders({ clientId: alfa });
    expect(r.ok).toBe(true);

    const oud = await live("oud-1");
    expect(oud?.id).toBe(before?.id);
    expect(oud?.path).toBe("/Scripts/Oud.pdf");
    expect(oud?.category).toBe("Scripts");
    expect(await live("gemist-1")).not.toBeNull();
    expect(await live("weg-1")).toBeNull();
    const [m] = await db.select().from(driveMappings).where(eq(driveMappings.entityId, alfa));
    expect(m?.lastFullSyncAt).not.toBeNull();
  });

  it("verwijdert niets als de map niet volledig gelezen kon worden", async () => {
    tree = { "root-alfa": Array.from({ length: 2000 }, (_, i) => f(`veel-${i}`, `F${i}.pdf`, "root-alfa")) };
    await reconcileDriveFolders({ clientId: alfa });
    expect(await live("p-a")).not.toBeNull(); // niet onterecht weggehaald
  });
});
