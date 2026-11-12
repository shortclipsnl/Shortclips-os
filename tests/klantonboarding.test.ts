import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { buildWelcomeMessage, canDisableStep, computeSteps, isKickoffTitle, isSimilarCompany, isWhatsappGroupLink, nextFriday, planFollowups, withRetry, type OnboardingFacts } from "@/lib/onboarding-plan";

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

  it("telt de voortgang en rondt pas af als alle verplichte stappen klaar zijn", () => {
    const base: OnboardingFacts = {
      contract: "open", missingClientData: ["telefoonnummer"], hasCoordinator: true, hasPortalLogin: false,
      driveStatus: "klaar", frameLinked: false, tasksCreated: true, hasWelcomeMessage: true, hasWelcomeFile: true,
      whatsappDone: false, hasPhone: false, welcomeSent: false, portalUsed: false,
      kickoff: { at: null, source: null }, briefingMissing: ["doelstellingen", "doelgroep"], briefingTouched: false, shoots: 0, disabled: [],
    };
    const a = computeSteps(base);
    expect(a.total).toBe(15);
    expect(a.done).toBe(5);
    expect(a.complete).toBe(false);
    expect(a.steps.find((s) => s.key === "whatsapp")!.status).toBe("wacht");
    expect(a.steps.find((s) => s.key === "contract")!.status).toBe("wacht");
    expect(a.phases.map((p) => p.key)).toEqual([1, 2, 3, 4]);
    expect(computeSteps({ ...base, driveStatus: "mislukt", driveError: "x" }).needsAction).toBe(true);
    // Alles verplicht klaar; het optionele "klant heeft ingelogd" blokkeert niet.
    const ready = {
      ...base, contract: "ondertekend" as const, missingClientData: [], hasPortalLogin: true, frameLinked: true, whatsappDone: true, hasPhone: true,
      welcomeSent: true, kickoff: { at: "di 9 dec 10:00", source: "agenda" as const }, briefingMissing: [], briefingTouched: true, shoots: 3,
    };
    const c = computeSteps(ready);
    expect(c.complete).toBe(true);
    expect(c.steps.find((s) => s.key === "portal_used")!.status).toBe("wacht");
    // Twee opnamedagen is nog niet genoeg.
    expect(computeSteps({ ...ready, shoots: 2 }).complete).toBe(false);
    // Een uitgezette stap telt niet mee.
    const off = computeSteps({ ...ready, shoots: 0, disabled: ["first_shoot"] });
    expect(off.complete).toBe(true);
    expect(off.total).toBe(14);
  });

  it("herkent kickoffs, WhatsApp-links en wie wat mag uitzetten", () => {
    expect(isKickoffTitle("Kickoff | Aquasel")).toBe(true);
    expect(isKickoffTitle("Kick-off Aquasel")).toBe(true);
    expect(isKickoffTitle("Kick off met Aquasel")).toBe(true);
    expect(isKickoffTitle("Opname Aquasel 8 shorts")).toBe(false);
    expect(isWhatsappGroupLink("https://chat.whatsapp.com/AbCdEf123456")).toBe(true);
    expect(isWhatsappGroupLink("https://wa.me/31612345678")).toBe(false);
    expect(canDisableStep("portal_used", false)).toBe(true);
    expect(canDisableStep("kickoff", false)).toBe(false);
    expect(canDisableStep("kickoff", true)).toBe(true);
    expect(canDisableStep("pm_linked", true)).toBe(false);
  });

  it("plant de vervolgmomenten op vaste regels", () => {
    expect(nextFriday("2026-11-09")).toBe("2026-11-13");
    expect(nextFriday("2026-11-13")).toBe("2026-11-13");
    const p = planFollowups({ clientName: "X", convertedOn: "2026-11-09", startOn: "2026-12-01", endsOn: "2027-02-28", noticeDays: 30 });
    const by = Object.fromEntries(p.map((f) => [f.key, f]));
    expect(by.factuur!.dueOn).toBe("2026-11-13");
    expect(by.factuur!.owner).toBe("facturatie");
    expect(by.evaluatie_1m!.dueOn).toBe("2027-01-01");
    expect(by.tevredenheid!.dueOn).toBe("2027-01-12");
    expect(by.verlenging!.dueOn).toBe("2027-01-22");
    expect(by.verlenging!.showFrom).toBe("2027-01-08");
    // Zonder einddatum geen verlengingsmoment.
    expect(planFollowups({ clientName: "X", convertedOn: "2026-11-09", startOn: "2026-12-01", endsOn: null, noticeDays: 30 }).map((f) => f.key)).not.toContain("verlenging");
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
    expect(first.tasks).toBe(7);
    const open = await db.select().from(s.tasks).where(and(eq(s.tasks.clientId, c!.id), isNull(s.tasks.deletedAt)));
    const onbTasks = open.filter((t) => !t.dedupeKey!.includes("vervolg_"));
    expect(onbTasks).toHaveLength(7);
    expect(onbTasks.every((t) => t.assigneeId === milouId && t.category === "klantcontact")).toBe(true);
    // De eerste factuur staat meteen klaar bij de facturatie-eigenaar (Milou).
    const factuur = open.find((t) => t.dedupeKey!.endsWith("vervolg_factuur"));
    expect(factuur?.assigneeId).toBe(milouId);
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
    expect(await db.select().from(s.tasks).where(eq(s.tasks.clientId, c!.id))).toHaveLength(8);
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

  it("voortgang: elke stap gaat vanzelf op klaar en sluit de taak, alles verplicht klaar = afgerond", async () => {
    const [c] = await db.select().from(s.clients).where(eq(s.clients.name, "Testbedrijf Noord"));
    const id = c!.id;
    const status = (v: Awaited<ReturnType<typeof onb.getOnboardingView>>, key: string) => v!.steps.find((x) => x.key === key)!.status;
    const taskStatus = async (key: string) => (await db.select({ st: s.tasks.status }).from(s.tasks).where(eq(s.tasks.dedupeKey, `onboarding:${id}:${key}`)))[0]?.st;

    let v = await onb.getOnboardingView(id);
    expect(v!.phases).toHaveLength(4);
    expect(status(v, "whatsapp")).toBe("wacht");
    expect(status(v, "contract")).toBe("open");
    expect(v!.whatsapp.groupName).toBe("Shortclips x Testbedrijf Noord");

    // Telefoonnummer aanvullen en WhatsApp-groepslink opslaan.
    await db.update(s.clientContacts).set({ phone: "0612345678" }).where(eq(s.clientContacts.clientId, id));
    expect((await onb.saveWhatsappLink(id, "https://wa.me/123", "milou@shortclips.nl")).ok).toBe(false);
    expect((await onb.saveWhatsappLink(id, "https://chat.whatsapp.com/AbCdEf123456", "milou@shortclips.nl")).ok).toBe(true);
    expect(await taskStatus("whatsapp")).toBe("done");

    // Welkomstbericht verstuurd, portaallogin, Frame.io-project, getekende offerte.
    await onb.markWelcomeSent(id, "milou@shortclips.nl");
    expect(await taskStatus("welkomstbericht")).toBe("done");
    await db.insert(s.users).values({ email: "pieter@test.nl", fullName: "Pieter de Vries", primaryRole: "client", clientId: id, status: "active" });
    await db.insert(s.clientIntegrations).values({ clientId: id, provider: "frameio", externalId: "proj-1", externalName: "Testbedrijf Noord" });
    await db.insert(s.quotes).values({ number: "2026-099", title: "Offerte Testbedrijf Noord", status: "ondertekend", leadId, acceptedAt: new Date() });

    // Kickoff in de agenda en briefing in het klantgeheugen.
    await db.insert(s.calendarEvents).values({ calendarId: "team", externalId: "ev-1", title: "Kickoff | Testbedrijf Noord", startsAt: new Date("2026-12-02T09:00:00Z"), clientId: id });
    await onb.saveBriefing(id, { goal: "Meer aanvragen in Friesland", audience: "Huiseigenaren 35-65", tone: "" }, { id: milouId, email: "milou@shortclips.nl" });
    const kennis = await db.select().from(s.clientKnowledge).where(and(eq(s.clientKnowledge.clientId, id), isNull(s.clientKnowledge.deletedAt)));
    expect(kennis.map((k) => k.category).sort()).toEqual(["audience", "goal"]);
    // Opnieuw opslaan vervangt, maakt niets dubbel.
    await onb.saveBriefing(id, { goal: "Meer aanvragen in heel Noord-Nederland", audience: "Huiseigenaren 35-65" }, { id: milouId, email: "milou@shortclips.nl" });
    expect(await db.select().from(s.clientKnowledge).where(and(eq(s.clientKnowledge.clientId, id), isNull(s.clientKnowledge.deletedAt)))).toHaveLength(2);

    v = await onb.getOnboardingView(id);
    expect(v!.completedAt).toBeNull();
    expect(v!.requiredOpen.map((r) => r.key)).toEqual(["first_shoot"]);
    expect(await taskStatus("kickoff")).toBe("done");
    expect(await taskStatus("briefing")).toBe("done");
    expect(await taskStatus("frame")).toBe("done");

    // Drie opnamedagen: onboarding rondt af.
    for (const d of ["2026-12-03", "2027-01-07", "2027-02-04"]) await db.insert(s.productionDays).values({ clientId: id, title: "Opname", scheduledOn: d });
    const sync = await onb.syncOpenOnboardings();
    expect(sync.completed).toBe(1);
    v = await onb.getOnboardingView(id);
    expect(v!.completedAt).not.toBeNull();
    expect(await taskStatus("opnamedag")).toBe("done");
    const done = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, milouId), eq(s.notifications.type, "onboarding_completed")));
    expect(done).toHaveLength(1);
  });

  it("signaleert vertraging één keer en alleen bij wie het aangaat", async () => {
    const [l] = await db.insert(s.salesLeads).values({ company: "Traag Bedrijf", contactName: "Anna Traag", email: "anna@traag.nl", phone: "0611111111", status: "onderhandeling" }).returning({ id: s.salesLeads.id });
    const r = await onb.convertLead({ id: jarnoId, email: "jarno@shortclips.nl" }, { ...input(), leadId: l!.id, company: "Traag Bedrijf", phone: "0611111111" });
    expect(r.ok).toBe(true);
    const clientId = r.ok ? r.clientId : "";
    await onb.runOnboardingAutomation(clientId);
    // Drie weken geleden gestart: WhatsApp, kickoff en opnamedagen zijn te laat.
    await db.update(s.clientOnboardings).set({ createdAt: new Date(Date.now() - 21 * 86400_000) }).where(eq(s.clientOnboardings.clientId, clientId));
    const first = await onb.syncOpenOnboardings();
    expect(first.signals).toBe(3);
    const late = await db.select().from(s.notifications).where(and(eq(s.notifications.clientId, clientId), eq(s.notifications.type, "onboarding_late")));
    expect(late.filter((n) => n.userId === milouId)).toHaveLength(3);
    // Alleen de opnamedagen gaan ook naar Jarno.
    expect(late.filter((n) => n.userId === jarnoId)).toHaveLength(1);
    const second = await onb.syncOpenOnboardings();
    expect(second.signals).toBe(0);
    // Een verplichte stap uitzetten mag alleen de eigenaar.
    expect((await onb.setStepDisabled(clientId, "kickoff", true, { email: "milou@shortclips.nl", isOwner: false })).ok).toBe(false);
    expect((await onb.setStepDisabled(clientId, "portal_used", true, { email: "milou@shortclips.nl", isOwner: false })).ok).toBe(true);
    const v = await onb.getOnboardingView(clientId);
    expect(v!.steps.find((x) => x.key === "portal_used")!.status).toBe("uit");
  });

  it("vervolgtaken komen pas in beeld als het zover is en schuiven mee met het contract", async () => {
    const [c] = await db.select().from(s.clients).where(eq(s.clients.name, "Testbedrijf Noord"));
    const keys = async () => (await db.select({ k: s.tasks.dedupeKey }).from(s.tasks).where(eq(s.tasks.clientId, c!.id))).map((r) => r.k!).filter((k) => k.includes("vervolg_"));
    expect(await keys()).toEqual([`onboarding:${c!.id}:vervolg_factuur`]);
    // Start in het verleden: evaluatie en tevredenheid moeten nu in beeld zijn.
    await db.update(s.clients).set({ startedOn: "2026-01-05" }).where(eq(s.clients.id, c!.id));
    await db.update(s.contracts).set({ endsOn: "2026-04-04" }).where(eq(s.contracts.clientId, c!.id));
    await onb.syncAllFollowups();
    expect((await keys()).sort()).toEqual([
      `onboarding:${c!.id}:vervolg_evaluatie_1m`,
      `onboarding:${c!.id}:vervolg_factuur`,
      `onboarding:${c!.id}:vervolg_tevredenheid`,
      `onboarding:${c!.id}:vervolg_verlenging`,
    ]);
    // Contract verlengd: open verlengingstaak schuift mee, er komt geen tweede.
    await db.update(s.contracts).set({ endsOn: "2027-06-30" }).where(eq(s.contracts.clientId, c!.id));
    await onb.syncAllFollowups();
    const [v] = await db.select().from(s.tasks).where(eq(s.tasks.dedupeKey, `onboarding:${c!.id}:vervolg_verlenging`));
    expect(v!.dueOn).toBe("2027-05-24");
    expect((await keys()).length).toBe(4);
    const view = await onb.getOnboardingView(c!.id);
    expect(view!.followups.map((f) => f.state)).toEqual(["open", "open", "open", "open"]);
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
