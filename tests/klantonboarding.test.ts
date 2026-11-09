import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { buildWelcomeMessage, computeSteps, isSimilarCompany, withRetry, type OnboardingFacts } from "@/lib/onboarding-plan";

/* ------------------------------------------------------------------ *
 * Drive nabootsen: geen echte mappen tijdens de test. Te sturen per test.
 * ------------------------------------------------------------------ */
const driveState = {
  folders: [] as { id: string; name: string; parent: string }[],
  failCreates: 0,
  failStatus: 503,
  creates: 0,
};
vi.mock("@/server/integrations/drive", () => {
  class DriveService {
    static isFolder(f: { mimeType: string }) {
      return f.mimeType === "application/vnd.google-apps.folder";
    }
  }
  const drive = {
    isConfigured: true,
    async listFolder(parent: string) {
      return driveState.folders.filter((f) => f.parent === parent).map((f) => ({ id: f.id, name: f.name, mimeType: "application/vnd.google-apps.folder" }));
    },
    async ensureFolderUnder(name: string, parent: string) {
      const hit = driveState.folders.find((f) => f.parent === parent && f.name === name);
      if (hit) return hit.id;
      if (driveState.failCreates > 0) {
        driveState.failCreates--;
        const e = new Error("Drive tijdelijk niet bereikbaar") as Error & { status: number; retryable: boolean; userMessage: string };
        e.status = driveState.failStatus;
        e.retryable = driveState.failStatus >= 500;
        e.userMessage = "Google Drive is tijdelijk niet bereikbaar.";
        throw e;
      }
      driveState.creates++;
      const id = `f${driveState.folders.length + 1}`;
      driveState.folders.push({ id, name, parent });
      return id;
    },
  };
  return { drive, DriveService };
});

describe("onboarding: vaste regels", () => {
  it("herkent gelijkende klantnamen", () => {
    expect(isSimilarCompany("Donkergroen", "Donker Groep")).toBe(true);
    expect(isSimilarCompany("Sutherland", "Sutterland")).toBe(true);
    expect(isSimilarCompany("Koops", "Koops Chalets")).toBe(true);
    expect(isSimilarCompany("Hegro BV", "Hegro")).toBe(true);
    expect(isSimilarCompany("Probo", "Kubo")).toBe(false);
    expect(isSimilarCompany("NAHV", "Skodora")).toBe(false);
  });

  it("maakt een welkomstbericht met voornamen en zonder streepjes", () => {
    const m = buildWelcomeMessage({ contactName: "Pieter de Vries", pmName: "Milou Sjoerdsma" });
    expect(m.startsWith("Hi Pieter,")).toBe(true);
    expect(m).toContain("Milou wordt jullie vaste contactpersoon");
    expect(m).not.toMatch(/[–—]/);
  });

  it("telt de voortgang en rondt pas af als alles klaar is", () => {
    const base: OnboardingFacts = {
      driveStatus: "klaar", hasCoordinator: true, hasWelcomeFile: true, hasWelcomeMessage: true,
      hasPortalLogin: false, whatsappDone: false, hasPhone: false, hasShoot: false, shootTaskDone: false,
    };
    const a = computeSteps(base);
    expect(a.done).toBe(5);
    expect(a.total).toBe(9);
    expect(a.complete).toBe(false);
    expect(a.steps.find((s) => s.key === "whatsapp")!.status).toBe("wacht");
    const b = computeSteps({ ...base, driveStatus: "mislukt", driveError: "x" });
    expect(b.needsAction).toBe(true);
    const c = computeSteps({ ...base, hasPortalLogin: true, whatsappDone: true, hasShoot: true });
    expect(c.complete).toBe(true);
    expect(c.done).toBe(9);
  });

  it("probeert alleen tijdelijke fouten opnieuw", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      n++;
      if (n < 3) throw Object.assign(new Error("x"), { status: 503 });
      return "ok";
    }, 3, async () => undefined);
    expect(r).toEqual({ value: "ok", attempts: 3 });
    let m = 0;
    await expect(withRetry(async () => {
      m++;
      throw Object.assign(new Error("nee"), { status: 403 });
    }, 3, async () => undefined)).rejects.toThrow("nee");
    expect(m).toBe(1);
  });
});

describe("onboarding: lead omzetten tegen een echte database", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let onb: typeof import("@/server/onboarding");
  let milouId = "";
  let jarnoId = "";
  let leadId = "";
  const ROOT = "root-actieve-klanten";

  beforeAll(async () => {
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = ROOT;
    db = await freshDatabase();
    s = await import("@/db/schema");
    onb = await import("@/server/onboarding");
    const [m] = await db.insert(s.users).values({ email: "milou@shortclips.nl", fullName: "Milou Sjoerdsma", primaryRole: "project_coordinator", status: "active" }).returning({ id: s.users.id });
    const [j] = await db.insert(s.users).values({ email: "jarno@shortclips.nl", fullName: "Jarno Klijnsma", primaryRole: "owner", status: "active" }).returning({ id: s.users.id });
    milouId = m!.id;
    jarnoId = j!.id;
    await db.insert(s.clients).values({ slug: "donker-groep", name: "Donker Groep", coordinatorId: milouId });
    const [l] = await db.insert(s.salesLeads).values({ company: "Testbedrijf Noord", contactName: "Pieter de Vries", email: "pieter@test.nl", status: "onderhandeling" }).returning({ id: s.salesLeads.id });
    leadId = l!.id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const input = () => ({
    leadId,
    company: "Testbedrijf Noord",
    contactName: "Pieter de Vries",
    email: "pieter@test.nl",
    phone: null,
    pakket: "org8" as const,
    shortsPerMonth: 8,
    contentFocus: "organisch" as const,
    monthlyRevenue: "2450",
    startOn: "2026-12-01",
    contractMonths: 3,
    coordinatorId: milouId,
    publisher: "shortclips" as const,
    notes: "Eerste opname op locatie.",
    confirmSimilar: false,
  });

  it("vult het controlevenster vooraf in", async () => {
    const f = await onb.getConvertForm(leadId);
    expect(f?.lead.company).toBe("Testbedrijf Noord");
    expect(f?.pms.map((p) => p.email)).toEqual(["milou@shortclips.nl", "jarno@shortclips.nl"]);
    expect(f?.defaultPmId).toBe(milouId);
    expect(f?.similarClients).toEqual([]);
  });

  it("twee snelle klikken geven één klant", async () => {
    const viewer = { id: jarnoId, email: "jarno@shortclips.nl" };
    const [a, b] = await Promise.all([onb.convertLead(viewer, input()), onb.convertLead(viewer, input())]);
    expect(a.ok && b.ok).toBe(true);
    const rows = await db.select().from(s.clients).where(and(eq(s.clients.name, "Testbedrijf Noord"), isNull(s.clients.deletedAt)));
    expect(rows).toHaveLength(1);
    const c = rows[0]!;
    expect(c.coordinatorId).toBe(milouId);
    expect(c.monthlyVideoQuota).toBe(8);
    expect(c.contentFocus).toBe("organisch");
    expect(c.contractMonths).toBe(3);
    const [lead] = await db.select().from(s.salesLeads).where(eq(s.salesLeads.id, leadId));
    expect(lead!.status).toBe("gewonnen");
    expect(lead!.convertedClientId).toBe(c.id);
    const [contract] = await db.select().from(s.contracts).where(eq(s.contracts.clientId, c.id));
    expect(contract!.endsOn).toBe("2027-02-28");
    expect(contract!.monthlyValue).toBe("2450.00");
    const onbs = await db.select().from(s.clientOnboardings).where(eq(s.clientOnboardings.clientId, c.id));
    expect(onbs).toHaveLength(1);
  });

  it("Drive faalt tijdelijk: stap mislukt, rest gaat door, opnieuw maakt niets dubbel", async () => {
    const [c] = await db.select().from(s.clients).where(eq(s.clients.name, "Testbedrijf Noord"));
    driveState.failCreates = 10; // alle pogingen in deze ronde mislukken
    const first = await onb.runOnboardingAutomation(c!.id);
    expect(first.drive.ok).toBe(false);
    expect(first.tasks).toBe(5);
    const open = await db.select().from(s.tasks).where(and(eq(s.tasks.clientId, c!.id), isNull(s.tasks.deletedAt)));
    expect(open).toHaveLength(5);
    expect(open.every((t) => t.assigneeId === milouId && t.category === "klantcontact")).toBe(true);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.userId, milouId));
    expect(notes.map((n) => n.type).sort()).toEqual(["onboarding_assigned", "onboarding_failed"]);
    // Jarno krijgt bij een eerste fout niets.
    expect(await db.select().from(s.notifications).where(eq(s.notifications.userId, jarnoId))).toHaveLength(0);

    driveState.failCreates = 0;
    const second = await onb.runOnboardingAutomation(c!.id);
    expect(second.drive.ok).toBe(true);
    expect(second.tasks).toBe(0);
    const third = await onb.runOnboardingAutomation(c!.id);
    expect(third.drive.ok).toBe(true);
    const top = driveState.folders.filter((f) => f.parent === ROOT);
    expect(top.map((f) => f.name)).toEqual(["TESTBEDRIJF NOORD"]);
    expect(driveState.folders.filter((f) => f.parent === top[0]!.id)).toHaveLength(7);
    expect(await db.select().from(s.tasks).where(eq(s.tasks.clientId, c!.id))).toHaveLength(5);
    expect(await db.select().from(s.notifications).where(and(eq(s.notifications.userId, milouId), eq(s.notifications.type, "onboarding_assigned")))).toHaveLength(1);
  });

  it("een bestaande map met andere schrijfwijze wordt gekoppeld, niet opnieuw gemaakt", async () => {
    driveState.folders.push({ id: "bestaand", name: "LUXEWAGEN ", parent: ROOT });
    const [cl] = await db.insert(s.clients).values({ slug: "luxewagen", name: "Luxewagen", coordinatorId: milouId }).returning({ id: s.clients.id });
    await db.insert(s.clientOnboardings).values({ clientId: cl!.id, details: { pakket: "org6", shortsPerMonth: 6, contentFocus: "organisch", contractMonths: 3, publisher: "shortclips", notes: null } });
    const before = driveState.folders.filter((f) => f.parent === ROOT).length;
    const r = await onb.runDriveStep(cl!.id);
    expect(r).toMatchObject({ ok: true, folderId: "bestaand", created: false });
    expect(driveState.folders.filter((f) => f.parent === ROOT).length).toBe(before);
  });

  it("voortgang: opname in de agenda rondt de opnamedag af, alles klaar = afgerond", async () => {
    const [c] = await db.select().from(s.clients).where(eq(s.clients.name, "Testbedrijf Noord"));
    let v = await onb.getOnboardingView(c!.id);
    expect(v!.done).toBe(5);
    expect(v!.steps.find((x) => x.key === "whatsapp")!.status).toBe("wacht");

    await db.insert(s.productionDays).values({ clientId: c!.id, title: "Opname", scheduledOn: "2026-12-03" });
    await db.update(s.tasks).set({ status: "done", completedAt: new Date() }).where(eq(s.tasks.dedupeKey, `onboarding:${c!.id}:whatsapp`));
    await db.insert(s.users).values({ email: "pieter@test.nl", fullName: "Pieter de Vries", primaryRole: "client", clientId: c!.id, status: "active" });

    const sync = await onb.syncOpenOnboardings();
    expect(sync.completed).toBe(1);
    v = await onb.getOnboardingView(c!.id);
    expect(v!.done).toBe(9);
    expect(v!.completedAt).not.toBeNull();
    const [shootTask] = await db.select().from(s.tasks).where(eq(s.tasks.dedupeKey, `onboarding:${c!.id}:opnamedag`));
    expect(shootTask!.status).toBe("done");
  });

  it("gelijkende naam: eerst een keuze, koppelen maakt geen nieuwe klant", async () => {
    const [l] = await db.insert(s.salesLeads).values({ company: "Donkergroen", status: "onderhandeling" }).returning({ id: s.salesLeads.id });
    const viewer = { id: jarnoId, email: "jarno@shortclips.nl" };
    const base = { ...input(), leadId: l!.id, company: "Donkergroen" };
    const r1 = await onb.convertLead(viewer, base);
    expect(r1.ok).toBe(false);
    expect(r1.ok ? [] : r1.similar?.map((x) => x.name)).toEqual(["Donker Groep"]);
    const [donker] = await db.select().from(s.clients).where(eq(s.clients.slug, "donker-groep"));
    const r2 = await onb.convertLead(viewer, { ...base, linkToClientId: donker!.id });
    expect(r2).toMatchObject({ ok: true, slug: "donker-groep" });
    expect(await db.select().from(s.clients).where(eq(s.clients.name, "Donkergroen"))).toHaveLength(0);
  });
});
