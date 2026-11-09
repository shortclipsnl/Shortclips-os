import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientContacts,
  clientIntegrations,
  clientOnboardings,
  clients,
  contracts,
  driveMappings,
  productionDays,
  salesLeads,
  tasks,
  users,
  type OnboardingDetails,
  type OnboardingLogEntry,
  type OnboardingStepState,
} from "@/db/schema";
import { drive, DriveService } from "@/server/integrations/drive";
import { notify } from "@/server/notifications";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import {
  buildWelcomeMessage,
  computeSteps,
  DRIVE_SUBFOLDERS,
  driveFolderName,
  isSimilarCompany,
  normalizeCompany,
  ONBOARDING_TASKS,
  onboardingTaskDedupe,
  PAKKETTEN,
  WELCOME_FILES,
  withRetry,
  type OnboardingFacts,
} from "@/lib/onboarding-plan";

/**
 * Klantonboarding: van gewonnen lead naar ingerichte klant.
 *
 * 1. `convertLead` maakt in één transactie de klant, contactpersoon, contract en
 *    de onboarding-rij aan en koppelt de lead. De lead wordt daarbij vergrendeld
 *    (`for update`), zodat twee snelle klikken nooit twee klanten opleveren.
 * 2. `runOnboardingAutomation` doet daarna de externe stappen: Drive-map, één
 *    melding aan de projectmanager en de onboardingtaken. Elke stap is
 *    idempotent, dus opnieuw draaien maakt nooit iets dubbel.
 * 3. `syncOpenOnboardings` (elk uur, na de agenda-sync) werkt de voortgang bij:
 *    opname in de agenda = opnamedag-taak klaar, alles klaar = onboarding afgerond.
 *
 * Er gaat NOOIT iets automatisch naar de klant: welkomstbericht en portaal-
 * uitnodiging blijven een bewuste klik van de projectmanager.
 */

const OWNER_EMAIL = "jarno@shortclips.nl";
const PM_EMAILS = ["milou@shortclips.nl", "jiska@shortclips.nl", "jarno@shortclips.nl"] as const;

function todayAmsterdam(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "klant"
  );
}

/* ------------------------------------------------------------------ *
 * Controlevenster: gegevens ophalen
 * ------------------------------------------------------------------ */

export type PmOption = { id: string; name: string; email: string };

export async function listProjectManagers(): Promise<PmOption[]> {
  const rows = await db
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(and(inArray(sql`lower(${users.email})`, [...PM_EMAILS]), isNull(users.deletedAt)));
  return rows.sort((a, b) => PM_EMAILS.indexOf(a.email.toLowerCase() as never) - PM_EMAILS.indexOf(b.email.toLowerCase() as never));
}

export type ConvertForm = {
  lead: {
    id: string;
    company: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    expectedMonthly: string | null;
    startOn: string | null;
    note: string | null;
    status: string;
  };
  alreadyClient: { slug: string; name: string } | null;
  similarClients: { id: string; slug: string; name: string; status: string }[];
  pms: PmOption[];
  defaultPmId: string | null;
};

export async function getConvertForm(leadId: string): Promise<ConvertForm | null> {
  const [lead] = await db.select().from(salesLeads).where(eq(salesLeads.id, leadId)).limit(1);
  if (!lead) return null;

  let alreadyClient: ConvertForm["alreadyClient"] = null;
  if (lead.convertedClientId) {
    const [c] = await db.select({ slug: clients.slug, name: clients.name }).from(clients).where(eq(clients.id, lead.convertedClientId)).limit(1);
    if (c) alreadyClient = c;
  }

  const all = await db
    .select({ id: clients.id, slug: clients.slug, name: clients.name, status: clients.status })
    .from(clients)
    .where(isNull(clients.deletedAt));
  const similarClients = all.filter((c) => isSimilarCompany(c.name, lead.company)).slice(0, 5);

  const pms = await listProjectManagers();
  const milou = pms.find((p) => p.email.toLowerCase() === "milou@shortclips.nl");

  return {
    lead: {
      id: lead.id,
      company: lead.company,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      website: lead.website,
      expectedMonthly: Number(lead.expectedMonthly) > 0 ? String(lead.expectedMonthly) : null,
      startOn: lead.startOn,
      note: lead.note,
      status: lead.status,
    },
    alreadyClient,
    similarClients,
    pms,
    defaultPmId: milou?.id ?? pms[0]?.id ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Omzetten
 * ------------------------------------------------------------------ */

export type ConvertInput = {
  leadId: string;
  company: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  pakket: OnboardingDetails["pakket"];
  shortsPerMonth: number;
  contentFocus: OnboardingDetails["contentFocus"];
  monthlyRevenue: string | null;
  startOn: string | null;
  contractMonths: number | null;
  coordinatorId: string;
  publisher: OnboardingDetails["publisher"];
  notes: string | null;
  /** Bewust doorgaan ondanks een klant met een gelijkende naam. */
  confirmSimilar: boolean;
  /** Koppel aan deze bestaande klant in plaats van een nieuwe aan te maken. */
  linkToClientId?: string | null;
};

export type ConvertResult =
  | { ok: true; slug: string; clientId: string; existing: boolean }
  | { ok: false; message: string; similar?: { slug: string; name: string }[] };

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export async function convertLead(viewer: { id: string; email: string }, input: ConvertInput): Promise<ConvertResult> {
  const company = input.company.replace(/\s+/g, " ").trim();
  if (!company) return { ok: false, message: "Vul de bedrijfsnaam in." };
  if (!input.coordinatorId) return { ok: false, message: "Kies een projectmanager." };
  const pms = await listProjectManagers();
  const pm = pms.find((p) => p.id === input.coordinatorId);
  if (!pm) return { ok: false, message: "Deze projectmanager is niet gevonden." };
  if (input.monthlyRevenue && !/^\d+(?:[.,]\d{1,2})?$/.test(input.monthlyRevenue.trim())) {
    return { ok: false, message: "Vul het maandbedrag in als getal, bijvoorbeeld 2450." };
  }
  if (input.startOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.startOn)) {
    return { ok: false, message: "De startdatum is ongeldig." };
  }
  const monthly = input.monthlyRevenue ? input.monthlyRevenue.trim().replace(",", ".") : null;
  const startOn = input.startOn || todayAmsterdam();

  // Gelijkende klant? Alleen doorgaan als dat bewust is gekozen.
  if (!input.linkToClientId && !input.confirmSimilar) {
    const all = await db.select({ name: clients.name, slug: clients.slug }).from(clients).where(isNull(clients.deletedAt));
    const similar = all.filter((c) => isSimilarCompany(c.name, company));
    if (similar.length) {
      return { ok: false, message: "Er bestaat al een klant met een gelijkende naam.", similar };
    }
  }

  const details: OnboardingDetails = {
    pakket: input.pakket,
    shortsPerMonth: input.shortsPerMonth,
    contentFocus: input.contentFocus,
    contractMonths: input.contractMonths,
    publisher: input.publisher,
    notes: input.notes?.trim() || null,
  };
  const welcomeFile = WELCOME_FILES[input.contentFocus];
  const welcomeMessage = buildWelcomeMessage({ contactName: input.contactName, pmName: pm.name });
  const startLog: OnboardingLogEntry = { at: nowIso(), step: "client_created", event: "gestart", detail: `Omgezet door ${viewer.email}`, actor: viewer.email };

  const result = await db.transaction(async (tx) => {
    // Lead vergrendelen: een tweede (gelijktijdige) klik wacht hier en ziet
    // daarna dat de lead al is omgezet.
    const [lead] = await tx.select().from(salesLeads).where(eq(salesLeads.id, input.leadId)).for("update");
    if (!lead) return { ok: false as const, message: "Lead niet gevonden." };
    if (lead.convertedClientId) {
      const [c] = await tx.select({ id: clients.id, slug: clients.slug }).from(clients).where(eq(clients.id, lead.convertedClientId)).limit(1);
      if (c) return { ok: true as const, slug: c.slug, clientId: c.id, existing: true };
    }

    let clientId: string;
    let slug: string;
    if (input.linkToClientId) {
      const [c] = await tx.select({ id: clients.id, slug: clients.slug }).from(clients).where(and(eq(clients.id, input.linkToClientId), isNull(clients.deletedAt))).limit(1);
      if (!c) return { ok: false as const, message: "De gekozen bestaande klant is niet gevonden." };
      clientId = c.id;
      slug = c.slug;
    } else {
      const basis = slugify(company);
      slug = basis;
      for (let n = 2; ; n++) {
        const [hit] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
        if (!hit) break;
        slug = `${basis}-${n}`;
      }
      const managed = ["name", "status", "coordinatorId", "startedOn"];
      if (monthly) managed.push("monthlyRevenue");
      const [created] = await tx
        .insert(clients)
        .values({
          slug,
          name: company,
          website: lead.website,
          status: "active",
          coordinatorId: pm.id,
          monthlyVideoQuota: input.shortsPerMonth,
          contentFocus: input.contentFocus,
          weHandlePosting: input.publisher === "shortclips",
          monthlyRevenue: monthly ?? "0",
          startedOn: startOn,
          contractMonths: input.contractMonths,
          notes: [lead.note, lead.source ? `Bron: ${lead.source}` : null, details.notes].filter(Boolean).join("\n") || null,
          managedFields: managed,
        })
        .returning({ id: clients.id });
      clientId = created!.id;

      await tx.insert(clientContacts).values({
        clientId,
        fullName: input.contactName?.trim() || "Contactpersoon nog aanvullen",
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        isPrimary: true,
      });
      await tx.insert(contracts).values({
        clientId,
        startsOn: startOn,
        endsOn: input.contractMonths ? addMonths(startOn, input.contractMonths) : null,
        monthlyValue: monthly ?? "0",
        reference: "Nog aanvullen",
        notes: `Aangemaakt bij omzetten van de lead.${input.contractMonths ? ` Looptijd ${input.contractMonths} maanden.` : ""}`,
      });
    }

    const [existingOnb] = await tx.select({ id: clientOnboardings.id }).from(clientOnboardings).where(eq(clientOnboardings.clientId, clientId)).limit(1);
    if (!existingOnb) {
      await tx.insert(clientOnboardings).values({
        clientId,
        leadId: lead.id,
        startedById: viewer.id,
        details,
        steps: {},
        log: [startLog],
        welcomeMessage,
        welcomeFileId: welcomeFile.id,
      });
    }

    await tx
      .update(salesLeads)
      .set({ status: "gewonnen", convertedClientId: clientId, updatedAt: new Date() })
      .where(eq(salesLeads.id, lead.id));

    return { ok: true as const, slug, clientId, existing: Boolean(input.linkToClientId) };
  });

  return result;
}

/* ------------------------------------------------------------------ *
 * Automatische stappen
 * ------------------------------------------------------------------ */

async function getOnb(clientId: string) {
  const [row] = await db.select().from(clientOnboardings).where(eq(clientOnboardings.clientId, clientId)).limit(1);
  return row ?? null;
}

async function saveStep(clientId: string, key: string, state: OnboardingStepState, log?: Omit<OnboardingLogEntry, "at">) {
  const row = await getOnb(clientId);
  if (!row) return;
  const steps = { ...(row.steps ?? {}), [key]: state };
  const entries = log ? [...(row.log ?? []), { at: nowIso(), ...log }].slice(-60) : row.log;
  await db.update(clientOnboardings).set({ steps, log: entries, updatedAt: new Date() }).where(eq(clientOnboardings.id, row.id));
}

/** Bestaande Drive-koppeling van de klant (dezelfde tabel als de Drive-sync). */
async function clientDriveMapping(clientId: string) {
  const [m] = await db
    .select({ folderId: driveMappings.folderId, folderName: driveMappings.folderName })
    .from(driveMappings)
    .where(and(eq(driveMappings.entityType, "client"), eq(driveMappings.entityId, clientId)))
    .limit(1);
  return m ?? null;
}

export type DriveStepResult = { ok: boolean; folderId?: string; created?: boolean; message?: string };

/**
 * Drive-map plus de 7 standaardmappen. Volgorde: bestaande koppeling → map met
 * dezelfde naam onder ACTIEVE KLANTEN (ook "LUXEWAGEN " met spatie) → nieuw.
 * De map-id wordt meteen opgeslagen, zodat een herhaling nooit een tweede map maakt.
 */
export async function runDriveStep(clientId: string): Promise<DriveStepResult> {
  const row = await getOnb(clientId);
  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) return { ok: false, message: "Klant niet gevonden." };
  const prevAttempts = row?.steps?.drive?.attempts ?? 0;

  const mapped = await clientDriveMapping(clientId);
  if (mapped) {
    await saveStep(clientId, "drive", { status: "klaar", attempts: prevAttempts, error: null, at: nowIso() });
    return { ok: true, folderId: mapped.folderId, created: false };
  }

  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!root || !drive.isConfigured) {
    const msg = "De Google Drive-koppeling is niet ingesteld (hoofdmap ACTIEVE KLANTEN ontbreekt).";
    await saveStep(clientId, "drive", { status: "mislukt", attempts: prevAttempts + 1, error: msg, at: nowIso() }, { step: "drive", event: "mislukt", detail: msg, actor: "systeem" });
    return { ok: false, message: msg };
  }

  await saveStep(clientId, "drive", { status: "bezig", attempts: prevAttempts, error: null, at: nowIso() });
  const wanted = driveFolderName(client.name);
  try {
    const { value, attempts } = await withRetry(async () => {
      const children = (await drive.listFolder(root)).filter((f) => DriveService.isFolder(f) && !f.trashed);
      const hit = children.find((f) => normalizeCompany(f.name) === normalizeCompany(wanted));
      let folderId = hit?.id;
      let created = false;
      if (!folderId) {
        folderId = await drive.ensureFolderUnder(wanted, root);
        created = true;
      }
      // Map-id direct vastleggen (vóór de submappen), zodat een herhaling dezelfde map pakt.
      await db
        .insert(driveMappings)
        .values({ entityType: "client", entityId: clientId, folderId, folderName: hit?.name ?? wanted, subfolderMap: {} })
        .onConflictDoNothing();
      const sub: Record<string, string> = {};
      for (const name of DRIVE_SUBFOLDERS) sub[name] = await drive.ensureFolderUnder(name, folderId);
      await db
        .update(driveMappings)
        .set({ subfolderMap: sub, updatedAt: new Date() })
        .where(and(eq(driveMappings.entityType, "client"), eq(driveMappings.folderId, folderId)));
      return { folderId, created, folderName: hit?.name ?? wanted };
    });

    await db
      .insert(clientIntegrations)
      .values({
        clientId,
        provider: "google_drive",
        externalId: value.folderId,
        externalName: value.folderName.trim(),
        externalUrl: `https://drive.google.com/drive/folders/${value.folderId}`,
      })
      .onConflictDoNothing();

    await saveStep(
      clientId,
      "drive",
      { status: "klaar", attempts: prevAttempts + attempts, error: null, at: nowIso() },
      { step: "drive", event: "klaar", detail: value.created ? `Map ${value.folderName} met ${DRIVE_SUBFOLDERS.length} standaardmappen aangemaakt` : `Bestaande map ${value.folderName.trim()} gekoppeld`, actor: "systeem" },
    );
    return { ok: true, folderId: value.folderId, created: value.created };
  } catch (e) {
    const err = e as { message?: string; status?: number; attempts?: number; userMessage?: string };
    const attempts = prevAttempts + (err.attempts ?? 1);
    const msg = err.userMessage ?? "Drive-map aanmaken mislukt.";
    await saveStep(
      clientId,
      "drive",
      { status: "mislukt", attempts, error: msg, at: nowIso() },
      { step: "drive", event: "mislukt", detail: `${msg}${err.status ? ` (HTTP ${err.status})` : ""}`, actor: "systeem" },
    );
    console.error("[onboarding.drive]", clientId, err.message);
    return { ok: false, message: msg };
  }
}

/** Taken en de ene melding voor de projectmanager. Idempotent via dedupe-sleutels. */
export async function runTaskStep(clientId: string): Promise<{ created: number }> {
  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const row = await getOnb(clientId);
  if (!client || !row) return { created: 0 };
  if (!client.coordinatorId) return { created: 0 };

  const [contact] = await db
    .select({ name: clientContacts.fullName, phone: clientContacts.phone, email: clientContacts.email })
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
    .orderBy(desc(clientContacts.isPrimary))
    .limit(1);
  const [pm] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, client.coordinatorId)).limit(1);

  const holidays = nlHolidaySet();
  const start = row.createdAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const welcome = row.welcomeFileId ? `https://drive.google.com/file/d/${row.welcomeFileId}/view` : null;
  const href = `/clients/${client.slug}?tab=onboarding`;
  const contactLine = contact?.name && !/aanvullen/i.test(contact.name) ? contact.name : "contactpersoon";

  const descriptions: Record<string, string> = {
    whatsapp: [
      `Groepsnaam: Shortclips x ${client.name}`,
      `Contactpersoon: ${contactLine}${contact?.phone ? `, ${contact.phone}` : " (telefoonnummer ontbreekt nog, vul aan bij Contactpersoon)"}`,
      `In de groep: ${pm?.name ?? "projectmanager"} en ${contactLine}`,
      "Eerste bericht: het welkomstconcept op het tabblad Onboarding van de klant.",
      welcome ? `Welkomstbestand: ${welcome}` : null,
      "Maak de groep handmatig aan in WhatsApp Business.",
    ].filter(Boolean).join("\n"),
    welkomstbericht: "Het concept staat op het tabblad Onboarding van de klant. Controleer, pas aan waar nodig en verstuur het zelf.",
    welkomstbestand: welcome ? `Deel het welkomstbestand: ${welcome}` : "Deel het welkomstbestand met de klant.",
    portaal: `Controleer het e-mailadres${contact?.email ? ` (${contact.email})` : ""} en maak de login aan via Beheer van deze klant.`,
    opnamedag: "Plan de kennismaking of eerste opnamedag. Staat de opname in Google Agenda, dan gaat deze taak vanzelf op klaar.",
  };

  let created = 0;
  for (const t of ONBOARDING_TASKS) {
    const dedupeKey = onboardingTaskDedupe(clientId, t.key);
    // Bestaat de taak al (open of afgerond)? Dan niets doen.
    const [exists] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dedupeKey, dedupeKey), isNull(tasks.deletedAt))).limit(1);
    if (exists) continue;
    const res = await db
      .insert(tasks)
      .values({
        clientId,
        title: t.title(client.name),
        description: descriptions[t.key] ?? null,
        status: "todo",
        priority: t.daysAfter === 0 ? "high" : "normal",
        category: "klantcontact",
        assigneeId: client.coordinatorId,
        dueOn: addWorkingDays(start, t.daysAfter, holidays),
        entityType: "client_onboarding",
        entityId: row.id,
        source: "automation",
        dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    created += res.length;
  }

  const sent = await notify({
    userIds: [client.coordinatorId],
    clientId,
    type: "onboarding_assigned",
    level: "info",
    title: `Nieuwe klant toegewezen: ${client.name}`,
    body: "De klant is aangemaakt. Je onboardingtaken staan klaar op Vandaag.",
    href,
    entityType: "client",
    entityId: clientId,
    dedupeKey: `onboarding_assigned:${clientId}`,
    allowInactiveClient: true,
  });

  await saveStep(
    clientId,
    "tasks",
    { status: "klaar", attempts: (row.steps?.tasks?.attempts ?? 0) + 1, error: null, at: nowIso() },
    created || sent ? { step: "pm_linked", event: "klaar", detail: `${created} taken en ${sent ? "1 melding" : "geen nieuwe melding"} voor ${pm?.name ?? "projectmanager"}`, actor: "systeem" } : undefined,
  );
  return { created };
}

async function notifyFailure(clientId: string, stepLabel: string, detail: string, escalate: boolean) {
  const [client] = await db.select({ name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) return;
  const href = `/clients/${client.slug}?tab=onboarding`;
  if (client.coordinatorId) {
    await notify({
      userIds: [client.coordinatorId],
      clientId,
      type: "onboarding_failed",
      level: "warning",
      title: `Onboarding ${client.name}: ${stepLabel} mislukt`,
      body: `${detail} Klik op Opnieuw proberen op het tabblad Onboarding.`,
      href,
      dedupeKey: `onboarding_failed:${clientId}:${stepLabel}`,
      allowInactiveClient: true,
    });
  }
  if (escalate) {
    const [owner] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${OWNER_EMAIL}`, isNull(users.deletedAt))).limit(1);
    if (owner && owner.id !== client.coordinatorId) {
      await notify({
        userIds: [owner.id],
        clientId,
        type: "onboarding_escalation",
        level: "critical",
        title: `Onboarding ${client.name}: ${stepLabel} blijft mislukken`,
        body: detail,
        href,
        dedupeKey: `onboarding_escalation:${clientId}:${stepLabel}`,
        allowInactiveClient: true,
      });
    }
  }
}

/** Alle automatische stappen. Gaat door als één stap mislukt. */
export async function runOnboardingAutomation(clientId: string): Promise<{ drive: DriveStepResult; tasks: number }> {
  const driveRes = await runDriveStep(clientId).catch((e) => ({ ok: false, message: String(e) }) as DriveStepResult);
  const taskRes = await runTaskStep(clientId).catch((e) => {
    console.error("[onboarding.tasks]", clientId, e);
    return { created: 0 };
  });
  if (!driveRes.ok) {
    const row = await getOnb(clientId);
    const attempts = row?.steps?.drive?.attempts ?? 0;
    await notifyFailure(clientId, "Google Drive-map", driveRes.message ?? "Aanmaken mislukt.", attempts >= 6).catch(() => undefined);
  }
  await refreshOnboarding(clientId).catch(() => undefined);
  return { drive: driveRes, tasks: taskRes.created };
}

/* ------------------------------------------------------------------ *
 * Voortgang
 * ------------------------------------------------------------------ */

async function taskDone(clientId: string, key: string): Promise<boolean> {
  const [t] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.dedupeKey, onboardingTaskDedupe(clientId, key)), isNull(tasks.deletedAt)))
    .limit(1);
  return t?.status === "done";
}

async function collectFacts(clientId: string) {
  const row = await getOnb(clientId);
  if (!row) return null;
  const [client] = await db.select({ coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  const [contact] = await db
    .select({ phone: clientContacts.phone })
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
    .orderBy(desc(clientContacts.isPrimary))
    .limit(1);
  const [login] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.clientId, clientId), eq(users.primaryRole, "client"), isNull(users.deletedAt)))
    .limit(1);
  const [shoot] = await db
    .select({ id: productionDays.id })
    .from(productionDays)
    .where(and(eq(productionDays.clientId, clientId), ne(productionDays.status, "cancelled")))
    .limit(1);
  const mapped = await clientDriveMapping(clientId);
  const ds = row.steps?.drive;
  const facts: OnboardingFacts = {
    driveStatus: mapped ? "klaar" : ds?.status === "mislukt" ? "mislukt" : ds?.status === "bezig" ? "bezig" : "open",
    driveError: ds?.error ?? null,
    hasCoordinator: Boolean(client?.coordinatorId),
    hasWelcomeFile: Boolean(row.welcomeFileId),
    hasWelcomeMessage: Boolean(row.welcomeMessage?.trim()),
    hasPortalLogin: Boolean(login),
    whatsappDone: await taskDone(clientId, "whatsapp"),
    hasPhone: Boolean(contact?.phone?.trim()),
    hasShoot: Boolean(shoot),
    shootTaskDone: await taskDone(clientId, "opnamedag"),
  };
  return { row, facts };
}

/**
 * Voortgang bijwerken: opname in de agenda → opnamedag-taak afronden; portaal-
 * login aangemaakt → portaaltaak afronden; alles klaar → onboarding afgerond.
 */
export async function refreshOnboarding(clientId: string) {
  const got = await collectFacts(clientId);
  if (!got) return null;
  const { row, facts } = got;

  const autoClose: { key: string; when: boolean; reason: string }[] = [
    { key: "opnamedag", when: facts.hasShoot, reason: "Opname staat in de agenda" },
    { key: "portaal", when: facts.hasPortalLogin, reason: "Portaallogin is aangemaakt" },
  ];
  const log = [...(row.log ?? [])];
  let changed = false;
  for (const a of autoClose) {
    if (!a.when) continue;
    const closed = await db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.dedupeKey, onboardingTaskDedupe(clientId, a.key)), ne(tasks.status, "done"), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    if (closed.length) {
      log.push({ at: nowIso(), step: a.key, event: "klaar", detail: a.reason, actor: "systeem" });
      changed = true;
    }
  }
  if (facts.hasShoot) facts.shootTaskDone = true;

  const view = computeSteps(facts);
  if (view.complete && !row.completedAt) {
    log.push({ at: nowIso(), step: "done", event: "klaar", detail: "Onboarding afgerond", actor: "systeem" });
    await db.update(clientOnboardings).set({ completedAt: new Date(), log: log.slice(-60), updatedAt: new Date() }).where(eq(clientOnboardings.id, row.id));
  } else if (changed) {
    await db.update(clientOnboardings).set({ log: log.slice(-60), updatedAt: new Date() }).where(eq(clientOnboardings.id, row.id));
  }
  return view;
}

export type OnboardingView = {
  clientId: string;
  startedAt: string;
  completedAt: string | null;
  startedBy: string | null;
  details: OnboardingDetails;
  welcomeMessage: string | null;
  welcomeFile: { id: string; name: string; url: string } | null;
  driveUrl: string | null;
  steps: ReturnType<typeof computeSteps>["steps"];
  done: number;
  total: number;
  needsAction: boolean;
  log: OnboardingLogEntry[];
};

export async function getOnboardingView(clientId: string): Promise<OnboardingView | null> {
  await refreshOnboarding(clientId).catch(() => undefined);
  const got = await collectFacts(clientId);
  if (!got) return null;
  const { row, facts } = got;
  const v = computeSteps(facts);
  const mapped = await clientDriveMapping(clientId);
  const [by] = row.startedById ? await db.select({ name: users.fullName }).from(users).where(eq(users.id, row.startedById)).limit(1) : [];
  const wf = Object.values(WELCOME_FILES).find((w) => w.id === row.welcomeFileId);
  return {
    clientId,
    startedAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    startedBy: by?.name ?? null,
    details: row.details,
    welcomeMessage: row.welcomeMessage,
    welcomeFile: row.welcomeFileId ? { id: row.welcomeFileId, name: wf?.name ?? "Welkomstbestand", url: `https://drive.google.com/file/d/${row.welcomeFileId}/view` } : null,
    driveUrl: mapped ? `https://drive.google.com/drive/folders/${mapped.folderId}` : null,
    steps: v.steps,
    done: v.done,
    total: v.total,
    needsAction: v.needsAction,
    log: [...(row.log ?? [])].reverse().slice(0, 12),
  };
}

export async function hasOnboarding(clientId: string): Promise<{ exists: boolean; completed: boolean }> {
  const row = await getOnb(clientId);
  return { exists: Boolean(row), completed: Boolean(row?.completedAt) };
}

export async function saveWelcomeMessage(clientId: string, text: string) {
  await db.update(clientOnboardings).set({ welcomeMessage: text.slice(0, 4000), updatedAt: new Date() }).where(eq(clientOnboardings.clientId, clientId));
}

/** Overzicht voor de klantenpagina: lopende onboardings plus die van de laatste 14 dagen. */
export type OnboardingListRow = {
  clientId: string;
  slug: string;
  name: string;
  pm: string | null;
  startOn: string | null;
  done: number;
  total: number;
  status: "Afgerond" | "Actie nodig" | "Bezig";
  next: string | null;
};

export async function listOnboardings(): Promise<OnboardingListRow[]> {
  const since = new Date(Date.now() - 14 * 86400_000);
  const rows = await db
    .select({
      clientId: clientOnboardings.clientId,
      completedAt: clientOnboardings.completedAt,
      slug: clients.slug,
      name: clients.name,
      startOn: clients.startedOn,
      pm: users.fullName,
    })
    .from(clientOnboardings)
    .innerJoin(clients, eq(clients.id, clientOnboardings.clientId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(isNull(clients.deletedAt), sql`(${clientOnboardings.completedAt} is null or ${clientOnboardings.completedAt} > ${since})`))
    .orderBy(desc(clientOnboardings.createdAt))
    .limit(30);

  const out: OnboardingListRow[] = [];
  for (const r of rows) {
    const got = await collectFacts(r.clientId);
    if (!got) continue;
    const v = computeSteps(got.facts);
    const today = todayAmsterdam();
    const [late] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.clientId, r.clientId), eq(tasks.entityType, "client_onboarding"), ne(tasks.status, "done"), isNull(tasks.deletedAt), sql`${tasks.dueOn} < ${today}`))
      .limit(1);
    const firstOpen = v.steps.find((s) => s.status !== "klaar");
    out.push({
      clientId: r.clientId,
      slug: r.slug,
      name: r.name,
      pm: r.pm,
      startOn: r.startOn,
      done: v.done,
      total: v.total,
      status: r.completedAt || v.complete ? "Afgerond" : v.needsAction || late ? "Actie nodig" : "Bezig",
      next: firstOpen ? `${firstOpen.label}${firstOpen.detail ? `: ${firstOpen.detail}` : ""}` : null,
    });
  }
  return out;
}

/** Elk uur (na de agenda-sync): voortgang van alle lopende onboardings bijwerken. */
export async function syncOpenOnboardings(): Promise<{ ok: boolean; checked: number; completed: number }> {
  const open = await db.select({ clientId: clientOnboardings.clientId }).from(clientOnboardings).where(isNull(clientOnboardings.completedAt));
  let completed = 0;
  for (const o of open) {
    try {
      // Een eerder mislukte Drive-stap één keer per uur opnieuw proberen (veilig: idempotent).
      const row = await getOnb(o.clientId);
      if (row?.steps?.drive?.status === "mislukt" && (row.steps.drive.attempts ?? 0) < 12) await runDriveStep(o.clientId);
      const v = await refreshOnboarding(o.clientId);
      if (v?.complete) completed++;
    } catch (e) {
      console.error("[onboarding.sync]", o.clientId, e);
    }
  }
  return { ok: true, checked: open.length, completed };
}

export const PAKKET_LABEL: Record<string, string> = Object.fromEntries(PAKKETTEN.map((p) => [p.value, p.label]));
