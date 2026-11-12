import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calendarEvents,
  clientContacts,
  clientIntegrations,
  clientKnowledge,
  clientOnboardings,
  clients,
  contracts,
  driveMappings,
  productionDays,
  quotes,
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
import { isInactiveClientStatus } from "@/lib/client-status";
import {
  BRIEFING_FIELDS,
  BRIEFING_SOURCE,
  buildWelcomeMessage,
  canDisableStep,
  computeSteps,
  FIRST_SHOOTS_REQUIRED,
  isKickoffTitle,
  isWhatsappGroupLink,
  LATE_SIGNALS,
  whatsappGroupName,
  DRIVE_SUBFOLDERS,
  driveFolderName,
  isSimilarCompany,
  normalizeCompany,
  ONBOARDING_TASKS,
  onboardingTaskDedupe,
  PAKKETTEN,
  WELCOME_FILES,
  planFollowups,
  withRetry,
  type FollowupPlan,
  type PhaseView,
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
  /** Interne teamleden om te betrekken (videograaf, andere projectmanager). */
  team: PmOption[];
  /** Gekoppelde offerte uit PandaDoc (laatste), zonder bedrag. */
  quote: { status: string; title: string; signedAt: string | null } | null;
  /** Alleen de eigenaar ziet bedragen (wordt in de action gezet). */
  canSeeAmounts?: boolean;
};

/** Interne teamleden die bij een klant betrokken kunnen worden. */
export async function listTeamOptions(): Promise<PmOption[]> {
  const rows = await db
    .select({ id: users.id, name: users.fullName, email: users.email, role: users.primaryRole })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.status, "active"), inArray(users.primaryRole, ["owner", "admin", "project_coordinator", "content_creator", "videographer", "operational_manager"])));
  return rows
    .filter((r) => /@shortclips\.nl$/i.test(r.email))
    .map(({ id, name, email }) => ({ id, name, email }))
    .sort((a, b) => a.name.localeCompare(b.name, "nl"));
}

const SIGNED = ["ondertekend", "geaccepteerd"];
const LIVE_QUOTE = ["concept", "verzonden", "bekeken"];

/** Beste offertestatus voor een lead: getekend wint, anders de laatste lopende. */
async function quoteForLead(leadId: string | null) {
  if (!leadId) return null;
  const rows = await db
    .select({ status: quotes.status, title: quotes.title, acceptedAt: quotes.acceptedAt, updatedAt: quotes.updatedAt })
    .from(quotes)
    .where(eq(quotes.leadId, leadId))
    .orderBy(desc(quotes.updatedAt));
  const signed = rows.find((r) => SIGNED.includes(r.status));
  const pick = signed ?? rows.find((r) => LIVE_QUOTE.includes(r.status)) ?? rows[0];
  if (!pick) return null;
  return { status: pick.status as string, title: pick.title, signedAt: signed?.acceptedAt ? signed.acceptedAt.toISOString() : null };
}

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

  const team = await listTeamOptions();
  const quote = await quoteForLead(lead.id);

  return {
    team,
    quote,
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
  /** Betrokken teamleden (user-id's) naast de projectmanager. */
  team?: string[];
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
    team: (input.team ?? []).filter((id) => id !== input.coordinatorId).slice(0, 12),
  };
  const welcomeFile = WELCOME_FILES[input.contentFocus];
  const welcomeMessage = buildWelcomeMessage({ contactName: input.contactName, pmName: pm.name, publisher: input.publisher });
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

  const team = row.details?.team?.length
    ? await db.select({ name: users.fullName }).from(users).where(inArray(users.id, row.details.team))
    : [];
  const groupMembers = [pm?.name ?? "projectmanager", ...team.map((t) => t.name), contactLine].join(", ");

  const descriptions: Record<string, string> = {
    whatsapp: [
      `Groepsnaam: ${whatsappGroupName(client.name)}`,
      `Contactpersoon: ${contactLine}${contact?.phone ? `, ${contact.phone}` : " (telefoonnummer ontbreekt nog, vul aan bij Contactpersoon)"}`,
      `In de groep: ${groupMembers}`,
      "Maak de groep aan in WhatsApp Business en plak daarna de groepslink op het tabblad Onboarding. Dan gaat deze taak vanzelf op klaar.",
    ].join("\n"),
    frame: `Maak in Frame.io een project aan met precies de naam "${client.name}". De Hub koppelt het binnen twee uur vanzelf, of klik op "Nu zoeken" op het tabblad Onboarding.`,
    welkomstbericht: [
      "Het concept staat op het tabblad Onboarding van de klant. Controleer, pas aan waar nodig en verstuur het zelf in de WhatsApp groep.",
      welcome ? `Stuur het welkomstbestand mee: ${welcome}` : "Stuur het welkomstbestand mee.",
      "Klik daarna op \"Verstuurd\" op het tabblad Onboarding.",
    ].join("\n"),
    portaal: `Controleer het e-mailadres${contact?.email ? ` (${contact.email})` : ""} en maak de login aan via Beheer van deze klant.`,
    kickoff: `Plan de kickoff (ca. 45 minuten) in de agenda Team Shortclips met "Kickoff" en de klantnaam in de titel, bijvoorbeeld "Kickoff | ${client.name}". De Hub herkent het event en zet de stap vanzelf op klaar.`,
    briefing: "Vul tijdens of direct na de kickoff de klantbriefing in op het tabblad Onboarding. Die komt in het klantgeheugen, zodat de Scriptgenerator en Content Research hem gebruiken.",
    opnamedag: `Leg in de kickoff de eerste ${FIRST_SHOOTS_REQUIRED} opnamedagen vast. Staan ze in Google Agenda, dan gaat deze taak vanzelf op klaar.`,
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
  await syncFollowups(clientId).catch((e) => console.error("[onboarding.followups]", clientId, e));
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

function fmtKickoff(d: Date): string {
  return d.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** Kickoff in de agenda (event met "kickoff" in de titel, gekoppeld aan de klant). */
async function kickoffEvent(clientId: string): Promise<Date | null> {
  const rows = await db
    .select({ title: calendarEvents.title, startsAt: calendarEvents.startsAt })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.clientId, clientId), or(isNull(calendarEvents.status), ne(calendarEvents.status, "cancelled"))))
    .orderBy(asc(calendarEvents.startsAt));
  const hit = rows.find((r) => isKickoffTitle(r.title));
  return hit?.startsAt ?? null;
}

/** Briefing uit het klantgeheugen: alleen regels die via de onboarding zijn ingevuld. */
export async function getBriefing(clientId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ category: clientKnowledge.category, body: clientKnowledge.body })
    .from(clientKnowledge)
    .where(and(eq(clientKnowledge.clientId, clientId), eq(clientKnowledge.source, BRIEFING_SOURCE), isNull(clientKnowledge.deletedAt)));
  const out: Record<string, string> = {};
  for (const f of BRIEFING_FIELDS) {
    const hit = rows.find((r) => r.category === f.category);
    if (hit?.body.trim()) out[f.key] = hit.body;
  }
  return out;
}

async function collectFacts(clientId: string) {
  const row = await getOnb(clientId);
  if (!row) return null;
  const [client] = await db.select({ coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  const [contact] = await db
    .select({ name: clientContacts.fullName, email: clientContacts.email, phone: clientContacts.phone })
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
    .orderBy(desc(clientContacts.isPrimary))
    .limit(1);
  const logins = await db
    .select({ id: users.id, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(and(eq(users.clientId, clientId), eq(users.primaryRole, "client"), isNull(users.deletedAt)));
  const shootRows = await db
    .select({ on: productionDays.scheduledOn })
    .from(productionDays)
    .where(and(eq(productionDays.clientId, clientId), ne(productionDays.status, "cancelled")));
  const [frame] = await db
    .select({ id: clientIntegrations.id, externalId: clientIntegrations.externalId, name: clientIntegrations.externalName })
    .from(clientIntegrations)
    .where(and(eq(clientIntegrations.clientId, clientId), eq(clientIntegrations.provider, "frameio")))
    .limit(1);
  const mapped = await clientDriveMapping(clientId);
  const quote = await quoteForLead(row.leadId);
  const kick = await kickoffEvent(clientId);
  const briefing = await getBriefing(clientId);
  const d = row.details ?? ({} as OnboardingDetails);

  const missing: string[] = [];
  if (!contact?.name?.trim() || /aanvullen/i.test(contact.name)) missing.push("naam contactpersoon");
  if (!contact?.email?.trim()) missing.push("e-mailadres");
  if (!contact?.phone?.trim()) missing.push("telefoonnummer");

  const ds = row.steps?.drive;
  const whatsappTask = await taskDone(clientId, "whatsapp");
  const facts: OnboardingFacts = {
    contract: quote && SIGNED.includes(quote.status) ? "ondertekend" : quote && LIVE_QUOTE.includes(quote.status) ? "open" : "geen",
    contractManual: Boolean(d.confirmed?.contract),
    missingClientData: missing,
    hasCoordinator: Boolean(client?.coordinatorId),
    hasPortalLogin: logins.length > 0,
    driveStatus: mapped ? "klaar" : ds?.status === "mislukt" ? "mislukt" : ds?.status === "bezig" ? "bezig" : "open",
    driveError: ds?.error ?? null,
    frameLinked: Boolean(frame),
    frameManual: Boolean(d.confirmed?.frame),
    tasksCreated: row.steps?.tasks?.status === "klaar",
    hasWelcomeMessage: Boolean(row.welcomeMessage?.trim()),
    hasWelcomeFile: Boolean(row.welcomeFileId),
    whatsappDone: Boolean(d.whatsappLink) || whatsappTask,
    hasPhone: Boolean(contact?.phone?.trim()),
    welcomeSent: await taskDone(clientId, "welkomstbericht"),
    portalUsed: logins.some((l) => l.lastLoginAt),
    kickoff: kick
      ? { at: fmtKickoff(kick), source: "agenda" }
      : d.kickoffManual?.at
        ? { at: fmtKickoff(new Date(d.kickoffManual.at)), source: "handmatig" }
        : { at: null, source: null },
    briefingMissing: BRIEFING_FIELDS.filter((f) => f.required && !briefing[f.key]).map((f) => f.title.toLowerCase()),
    briefingTouched: Object.keys(briefing).length > 0,
    shoots: new Set(shootRows.map((r) => String(r.on))).size,
    disabled: d.disabledSteps ?? [],
  };
  return { row, facts, extra: { frame: frame ?? null, contact: contact ?? null, briefing, quote, kickoffAt: kick } };
}

/**
 * Voortgang bijwerken: wat in de Hub of de agenda al gebeurd is, rondt de
 * bijbehorende taak af (één bron, niet dubbel afvinken). Alle verplichte
 * stappen klaar → onboarding afgerond.
 */
export async function refreshOnboarding(clientId: string) {
  const got = await collectFacts(clientId);
  if (!got) return null;
  const { row, facts } = got;
  const briefingDone = facts.briefingMissing.length === 0;

  const autoClose: { key: string; when: boolean; reason: string }[] = [
    { key: "whatsapp", when: facts.whatsappDone, reason: "WhatsApp groep bevestigd" },
    { key: "frame", when: facts.frameLinked || Boolean(facts.frameManual), reason: "Frame.io project gekoppeld" },
    { key: "welkomstbestand", when: facts.welcomeSent, reason: "Welkomstbericht en -bestand verstuurd" },
    { key: "portaal", when: facts.hasPortalLogin, reason: "Portaallogin is aangemaakt" },
    { key: "kickoff", when: Boolean(facts.kickoff.at), reason: facts.kickoff.source === "agenda" ? "Kickoff staat in de agenda" : "Kickoff handmatig vastgelegd" },
    { key: "briefing", when: briefingDone, reason: "Briefing staat in het klantgeheugen" },
    { key: "opnamedag", when: facts.shoots >= FIRST_SHOOTS_REQUIRED, reason: `${FIRST_SHOOTS_REQUIRED} opnamedagen staan in de agenda` },
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

  const view = computeSteps(facts);
  if (view.complete && !row.completedAt) {
    log.push({ at: nowIso(), step: "done", event: "klaar", detail: "Onboarding afgerond: alle verplichte stappen zijn klaar", actor: "systeem" });
    await db.update(clientOnboardings).set({ completedAt: new Date(), log: log.slice(-60), updatedAt: new Date() }).where(eq(clientOnboardings.id, row.id));
    await notifyCompleted(clientId).catch(() => undefined);
  } else if (changed) {
    await db.update(clientOnboardings).set({ log: log.slice(-60), updatedAt: new Date() }).where(eq(clientOnboardings.id, row.id));
  }
  return view;
}

async function notifyCompleted(clientId: string) {
  const [client] = await db.select({ name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client?.coordinatorId) return;
  await notify({
    userIds: [client.coordinatorId],
    clientId,
    type: "onboarding_completed",
    level: "info",
    title: `Onboarding ${client.name} afgerond`,
    body: "Alle verplichte stappen zijn klaar. De klant is klaar voor de samenwerking.",
    href: `/clients/${client.slug}?tab=onboarding`,
    dedupeKey: `onboarding_completed:${clientId}`,
    allowInactiveClient: true,
  });
}

export type OnboardingView = {
  clientId: string;
  clientName: string;
  startedAt: string;
  completedAt: string | null;
  startedBy: string | null;
  pmName: string | null;
  teamNames: string[];
  details: OnboardingDetails;
  welcomeMessage: string | null;
  welcomeFile: { id: string; name: string; url: string } | null;
  driveUrl: string | null;
  frame: { name: string | null } | null;
  whatsapp: { groupName: string; link: string | null; members: string[]; phone: string | null };
  kickoff: { at: string | null; source: "agenda" | "handmatig" | null };
  briefing: Record<string, string>;
  shoots: number;
  steps: ReturnType<typeof computeSteps>["steps"];
  phases: PhaseView[];
  requiredOpen: { key: string; label: string }[];
  done: number;
  total: number;
  needsAction: boolean;
  disableable: string[];
  log: OnboardingLogEntry[];
  followups: FollowupView[];
};

export async function getOnboardingView(clientId: string, viewer?: { isOwner: boolean }): Promise<OnboardingView | null> {
  await refreshOnboarding(clientId).catch(() => undefined);
  const got = await collectFacts(clientId);
  if (!got) return null;
  const { row, facts, extra } = got;
  const v = computeSteps(facts);
  const mapped = await clientDriveMapping(clientId);
  const [client] = await db.select({ name: clients.name, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  const [pm] = client?.coordinatorId ? await db.select({ name: users.fullName }).from(users).where(eq(users.id, client.coordinatorId)).limit(1) : [];
  const team = row.details?.team?.length ? await db.select({ name: users.fullName }).from(users).where(inArray(users.id, row.details.team)) : [];
  const [by] = row.startedById ? await db.select({ name: users.fullName }).from(users).where(eq(users.id, row.startedById)).limit(1) : [];
  const wf = Object.values(WELCOME_FILES).find((w) => w.id === row.welcomeFileId);
  const contactName = extra.contact?.name && !/aanvullen/i.test(extra.contact.name) ? extra.contact.name : null;
  const isOwner = viewer?.isOwner ?? false;
  return {
    clientId,
    clientName: client?.name ?? "",
    startedAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    startedBy: by?.name ?? null,
    pmName: pm?.name ?? null,
    teamNames: team.map((t) => t.name),
    details: row.details,
    welcomeMessage: row.welcomeMessage,
    welcomeFile: row.welcomeFileId ? { id: row.welcomeFileId, name: wf?.name ?? "Welkomstbestand", url: `https://drive.google.com/file/d/${row.welcomeFileId}/view` } : null,
    driveUrl: mapped ? `https://drive.google.com/drive/folders/${mapped.folderId}` : null,
    frame: extra.frame ? { name: extra.frame.name } : null,
    whatsapp: {
      groupName: whatsappGroupName(client?.name ?? ""),
      link: row.details?.whatsappLink ?? null,
      members: [pm?.name, ...team.map((t) => t.name), contactName].filter((x): x is string => Boolean(x)),
      phone: extra.contact?.phone ?? null,
    },
    kickoff: facts.kickoff,
    briefing: extra.briefing,
    shoots: facts.shoots,
    steps: v.steps,
    phases: v.phases,
    requiredOpen: v.requiredOpen.map((x) => ({ key: x.key, label: x.label })),
    done: v.done,
    total: v.total,
    needsAction: v.needsAction,
    disableable: v.steps.filter((x) => x.key !== "done" && canDisableStep(x.key, isOwner)).map((x) => x.key),
    log: [...(row.log ?? [])].reverse().slice(0, 12),
    followups: await getFollowupsView(clientId).catch(() => []),
  };
}

export async function hasOnboarding(clientId: string): Promise<{ exists: boolean; completed: boolean }> {
  const row = await getOnb(clientId);
  return { exists: Boolean(row), completed: Boolean(row?.completedAt) };
}

export async function saveWelcomeMessage(clientId: string, text: string) {
  await db.update(clientOnboardings).set({ welcomeMessage: text.slice(0, 4000), updatedAt: new Date() }).where(eq(clientOnboardings.clientId, clientId));
}

/* ------------------------------------------------------------------ *
 * Acties vanaf het tabblad Onboarding
 * ------------------------------------------------------------------ */

async function patchDetails(clientId: string, patch: Partial<OnboardingDetails>, log?: Omit<OnboardingLogEntry, "at">) {
  const row = await getOnb(clientId);
  if (!row) return false;
  const details = { ...(row.details ?? {}), ...patch } as OnboardingDetails;
  const entries = log ? [...(row.log ?? []), { at: nowIso(), ...log }].slice(-60) : row.log;
  await db.update(clientOnboardings).set({ details, log: entries, updatedAt: new Date() }).where(eq(clientOnboardings.id, row.id));
  return true;
}

export async function saveWhatsappLink(clientId: string, link: string, actor: string): Promise<{ ok: boolean; message?: string }> {
  const clean = link.trim();
  if (!isWhatsappGroupLink(clean)) return { ok: false, message: "Plak de groepslink uit WhatsApp (begint met https://chat.whatsapp.com/)." };
  await patchDetails(clientId, { whatsappLink: clean }, { step: "whatsapp", event: "klaar", detail: `WhatsApp groep bevestigd door ${actor}`, actor });
  await refreshOnboarding(clientId);
  return { ok: true };
}

/** "Verstuurd": rondt de taken voor welkomstbericht en -bestand af. */
export async function markWelcomeSent(clientId: string, actor: string) {
  for (const key of ["welkomstbericht", "welkomstbestand"]) {
    await db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.dedupeKey, onboardingTaskDedupe(clientId, key)), ne(tasks.status, "done"), isNull(tasks.deletedAt)));
  }
  // Oudere onboardings zonder taak: alsnog een afgeronde taak vastleggen, zodat de stap klaar is.
  const [exists] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.dedupeKey, onboardingTaskDedupe(clientId, "welkomstbericht"))).limit(1);
  if (!exists) {
    const row = await getOnb(clientId);
    const [c] = await db.select({ name: clients.name, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
    if (row && c) {
      await db
        .insert(tasks)
        .values({ clientId, title: `Welkomstbericht en -bestand versturen aan ${c.name}`, status: "done", completedAt: new Date(), category: "klantcontact", assigneeId: c.coordinatorId, entityType: "client_onboarding", entityId: row.id, source: "automation", dedupeKey: onboardingTaskDedupe(clientId, "welkomstbericht") })
        .onConflictDoNothing();
    }
  }
  const row = await getOnb(clientId);
  if (row) {
    await db
      .update(clientOnboardings)
      .set({ log: [...(row.log ?? []), { at: nowIso(), step: "welcome_sent", event: "klaar", detail: `Welkomstbericht verstuurd door ${actor}`, actor }].slice(-60), updatedAt: new Date() })
      .where(eq(clientOnboardings.id, row.id));
  }
  await refreshOnboarding(clientId);
}

export async function confirmStepManually(clientId: string, step: "contract" | "frame", actor: string) {
  const row = await getOnb(clientId);
  if (!row) return;
  const confirmed = { ...(row.details?.confirmed ?? {}), [step]: { by: actor, at: nowIso() } };
  await patchDetails(clientId, { confirmed }, { step, event: "klaar", detail: `${step === "contract" ? "Contract" : "Frame.io project"} handmatig bevestigd door ${actor}`, actor });
  await refreshOnboarding(clientId);
}

export async function setKickoffManual(clientId: string, at: string | null, actor: string): Promise<{ ok: boolean; message?: string }> {
  if (at && Number.isNaN(new Date(at).getTime())) return { ok: false, message: "Kies een geldige datum en tijd." };
  await patchDetails(
    clientId,
    { kickoffManual: at ? { at: new Date(at).toISOString(), by: actor } : null },
    { step: "kickoff", event: at ? "klaar" : "gewijzigd", detail: at ? `Kickoff handmatig vastgelegd door ${actor}` : `Handmatige kickoff gewist door ${actor}`, actor },
  );
  await refreshOnboarding(clientId);
  return { ok: true };
}

export async function setStepDisabled(clientId: string, step: string, disabled: boolean, viewer: { email: string; isOwner: boolean }): Promise<{ ok: boolean; message?: string }> {
  if (!canDisableStep(step, viewer.isOwner)) return { ok: false, message: "Deze stap is verplicht. Alleen Jarno kan hem uitzetten." };
  const row = await getOnb(clientId);
  if (!row) return { ok: false, message: "Onboarding niet gevonden." };
  const cur = new Set(row.details?.disabledSteps ?? []);
  if (disabled) cur.add(step);
  else cur.delete(step);
  await patchDetails(clientId, { disabledSteps: [...cur] }, { step, event: disabled ? "uitgezet" : "aangezet", detail: `Stap ${disabled ? "uitgezet" : "weer aangezet"} door ${viewer.email}`, actor: viewer.email });
  await refreshOnboarding(clientId);
  return { ok: true };
}

/**
 * Briefing opslaan in het klantgeheugen. Per veld één regel met bron
 * "onboarding"; een nieuwe versie vervangt de vorige (geen dubbele regels).
 */
export async function saveBriefing(clientId: string, values: Record<string, string>, viewer: { id: string; email: string }) {
  for (const f of BRIEFING_FIELDS) {
    const body = (values[f.key] ?? "").trim().slice(0, 4000);
    const [existing] = await db
      .select({ id: clientKnowledge.id, body: clientKnowledge.body })
      .from(clientKnowledge)
      .where(and(eq(clientKnowledge.clientId, clientId), eq(clientKnowledge.source, BRIEFING_SOURCE), eq(clientKnowledge.category, f.category), isNull(clientKnowledge.deletedAt)))
      .limit(1);
    if (existing) {
      if (!body) await db.update(clientKnowledge).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(clientKnowledge.id, existing.id));
      else if (body !== existing.body) await db.update(clientKnowledge).set({ body, updatedAt: new Date() }).where(eq(clientKnowledge.id, existing.id));
    } else if (body) {
      await db.insert(clientKnowledge).values({ clientId, category: f.category, title: f.title, body, source: BRIEFING_SOURCE, isPinned: f.required, createdById: viewer.id });
    }
  }
  const row = await getOnb(clientId);
  if (row) {
    await db
      .update(clientOnboardings)
      .set({ log: [...(row.log ?? []), { at: nowIso(), step: "briefing", event: "opgeslagen", detail: `Briefing opgeslagen in het klantgeheugen door ${viewer.email}`, actor: viewer.email }].slice(-60), updatedAt: new Date() })
      .where(eq(clientOnboardings.id, row.id));
  }
  await refreshOnboarding(clientId);
}

/* ------------------------------------------------------------------ *
 * Overzicht
 * ------------------------------------------------------------------ */

/** Overzicht voor de klantenpagina: lopende onboardings plus die van de laatste 14 dagen. */
export type OnboardingListRow = {
  clientId: string;
  slug: string;
  name: string;
  pm: string | null;
  pmId: string | null;
  startOn: string | null;
  done: number;
  total: number;
  workdays: number;
  status: "Afgerond" | "Blokkade" | "Actie nodig" | "Bezig";
  next: string | null;
};

function workdaysSince(from: string, to: string, holidays: Set<string>): number {
  let n = 0;
  for (let d = from; d < to && n < 400; ) {
    d = addWorkingDays(d, 1, holidays);
    if (d <= to) n++;
  }
  return n;
}

export async function listOnboardings(): Promise<OnboardingListRow[]> {
  const since = new Date(Date.now() - 14 * 86400_000);
  const rows = await db
    .select({
      clientId: clientOnboardings.clientId,
      completedAt: clientOnboardings.completedAt,
      createdAt: clientOnboardings.createdAt,
      slug: clients.slug,
      name: clients.name,
      startOn: clients.startedOn,
      pm: users.fullName,
      pmId: clients.coordinatorId,
    })
    .from(clientOnboardings)
    .innerJoin(clients, eq(clients.id, clientOnboardings.clientId))
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(isNull(clients.deletedAt), sql`(${clientOnboardings.completedAt} is null or ${clientOnboardings.completedAt} > ${since})`))
    .orderBy(desc(clientOnboardings.createdAt))
    .limit(30);

  const holidays = nlHolidaySet();
  const today = todayAmsterdam();
  const out: OnboardingListRow[] = [];
  for (const r of rows) {
    const got = await collectFacts(r.clientId);
    if (!got) continue;
    const v = computeSteps(got.facts);
    const started = r.createdAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    const wd = workdaysSince(started, today, holidays);
    const late = LATE_SIGNALS.some((l) => wd > l.afterWorkdays && v.steps.find((x) => x.key === l.step)?.status !== "klaar" && v.steps.find((x) => x.key === l.step)?.status !== "uit");
    const failed = v.steps.find((x) => x.status === "mislukt");
    const firstOpen = failed ?? v.requiredOpen[0] ?? v.steps.find((x) => x.status !== "klaar" && x.status !== "uit" && x.key !== "done");
    out.push({
      clientId: r.clientId,
      slug: r.slug,
      name: r.name,
      pm: r.pm,
      pmId: r.pmId,
      startOn: r.startOn,
      done: v.done,
      total: v.total,
      workdays: wd,
      status: r.completedAt || v.complete ? "Afgerond" : failed ? "Blokkade" : late ? "Actie nodig" : "Bezig",
      next: firstOpen ? `${firstOpen.label}${firstOpen.detail ? `: ${firstOpen.detail}` : ""}` : null,
    });
  }
  return out;
}

/**
 * Signalen bij vertraging, alleen als het echt blijft liggen. Eén melding per
 * stap per klant (dedupe), naar de projectmanager; bij de opnamedagen ook naar
 * Jarno. Verdwijnt vanzelf uit beeld zodra de stap klaar is.
 */
async function lateSignals(clientId: string): Promise<number> {
  const got = await collectFacts(clientId);
  if (!got) return 0;
  const v = computeSteps(got.facts);
  const [client] = await db.select({ name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) return 0;
  const started = got.row.createdAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const wd = workdaysSince(started, todayAmsterdam(), nlHolidaySet());
  const [owner] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${OWNER_EMAIL}`, isNull(users.deletedAt))).limit(1);
  let sent = 0;

  // Zonder projectmanager kan niemand verder: direct naar Jarno.
  if (!client.coordinatorId && owner) {
    sent += await notify({
      userIds: [owner.id], clientId, type: "onboarding_late", level: "warning",
      title: `Onboarding ${client.name}: nog geen projectmanager`, body: "Kies een projectmanager bij de klant, dan komen de taken bij de juiste persoon.",
      href: `/clients/${client.slug}?tab=overzicht`, dedupeKey: `onboarding_late:${clientId}:pm`, allowInactiveClient: true,
    }).then((x) => (x ? 1 : 0));
  }

  for (const l of LATE_SIGNALS) {
    const st = v.steps.find((x) => x.key === l.step);
    if (!st || st.status === "klaar" || st.status === "uit" || wd <= l.afterWorkdays) continue;
    const ids = [client.coordinatorId, l.escalate ? owner?.id : null].filter((x): x is string => Boolean(x));
    if (!ids.length) continue;
    const ok = await notify({
      userIds: [...new Set(ids)], clientId, type: "onboarding_late", level: "warning",
      title: `Onboarding ${client.name}: ${l.label.toLowerCase()}`,
      body: `${wd} werkdagen na de start. ${st.detail ?? ""}`.trim(),
      href: `/clients/${client.slug}?tab=onboarding`, dedupeKey: `onboarding_late:${clientId}:${l.step}`, allowInactiveClient: true,
    });
    if (ok) sent++;
  }
  return sent;
}

/** Elk uur (na de agenda-sync): voortgang van alle lopende onboardings bijwerken. */
export async function syncOpenOnboardings(): Promise<{ ok: boolean; checked: number; completed: number; followupsCreated: number; signals: number }> {
  const open = await db.select({ clientId: clientOnboardings.clientId }).from(clientOnboardings).where(isNull(clientOnboardings.completedAt));
  let completed = 0;
  let signals = 0;
  for (const o of open) {
    try {
      // Een eerder mislukte Drive-stap één keer per uur opnieuw proberen (veilig: idempotent).
      const row = await getOnb(o.clientId);
      if (row?.steps?.drive?.status === "mislukt" && (row.steps.drive.attempts ?? 0) < 12) await runDriveStep(o.clientId);
      const v = await refreshOnboarding(o.clientId);
      if (v?.complete) completed++;
      else signals += await lateSignals(o.clientId);
    } catch (e) {
      console.error("[onboarding.sync]", o.clientId, e);
    }
  }
  const f = await syncAllFollowups().catch(() => ({ created: 0 }));
  return { ok: true, checked: open.length, completed, followupsCreated: f.created, signals };
}

export const PAKKET_LABEL: Record<string, string> = Object.fromEntries(PAKKETTEN.map((p) => [p.value, p.label]));

/* ------------------------------------------------------------------ *
 * Vervolgmomenten (factuur, evaluatie, tevredenheid, verlenging)
 * ------------------------------------------------------------------ */

const BILLING_EMAIL = "milou@shortclips.nl";

async function followupContext(clientId: string) {
  const row = await getOnb(clientId);
  if (!row) return null;
  const [client] = await db
    .select({ id: clients.id, name: clients.name, status: clients.status, startedOn: clients.startedOn, coordinatorId: clients.coordinatorId, deletedAt: clients.deletedAt })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client || client.deletedAt) return null;
  const [contract] = await db
    .select({ endsOn: contracts.endsOn, notice: contracts.noticePeriodDays })
    .from(contracts)
    .where(and(eq(contracts.clientId, clientId), isNull(contracts.deletedAt)))
    .orderBy(desc(contracts.startsOn))
    .limit(1);
  const convertedOn = row.createdAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const plans = planFollowups({
    clientName: client.name,
    convertedOn,
    startOn: client.startedOn ?? convertedOn,
    endsOn: contract?.endsOn ?? null,
    noticeDays: contract?.notice ?? 30,
  });
  return { row, client, plans };
}

async function billingUserId(fallback: string | null): Promise<string | null> {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${BILLING_EMAIL}`, isNull(users.deletedAt), eq(users.status, "active")))
    .limit(1);
  return u?.id ?? fallback;
}

/**
 * Maakt de vervolgtaken aan zodra ze in beeld moeten komen (niet maanden
 * vooruit), en schuift de deadline van een open taak mee als het contract
 * verandert. Idempotent: één taak per moment per klant.
 */
export async function syncFollowups(clientId: string): Promise<{ created: number; updated: number }> {
  const ctx = await followupContext(clientId);
  if (!ctx || isInactiveClientStatus(ctx.client.status)) return { created: 0, updated: 0 };
  const today = todayAmsterdam();
  let created = 0;
  let updated = 0;
  for (const f of ctx.plans) {
    const dedupeKey = onboardingTaskDedupe(clientId, `vervolg_${f.key}`);
    const [existing] = await db
      .select({ id: tasks.id, status: tasks.status, dueOn: tasks.dueOn })
      .from(tasks)
      .where(and(eq(tasks.dedupeKey, dedupeKey), isNull(tasks.deletedAt)))
      .limit(1);
    if (existing) {
      if (existing.status !== "done" && existing.dueOn !== f.dueOn) {
        await db.update(tasks).set({ dueOn: f.dueOn, updatedAt: new Date() }).where(eq(tasks.id, existing.id));
        updated++;
      }
      continue;
    }
    if (f.showFrom > today) continue;
    const assignee = f.owner === "facturatie" ? await billingUserId(ctx.client.coordinatorId) : ctx.client.coordinatorId;
    if (!assignee) continue;
    const res = await db
      .insert(tasks)
      .values({
        clientId,
        title: f.title,
        description: f.description,
        status: "todo",
        priority: "normal",
        category: f.owner === "facturatie" ? "overig" : "klantcontact",
        assigneeId: assignee,
        dueOn: f.dueOn,
        entityType: "client_onboarding",
        entityId: ctx.row.id,
        source: "automation",
        dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    created += res.length;
  }
  return { created, updated };
}

export type FollowupView = FollowupPlan & { state: "gepland" | "open" | "afgerond"; assignee: string | null };

export async function getFollowupsView(clientId: string): Promise<FollowupView[]> {
  const ctx = await followupContext(clientId);
  if (!ctx) return [];
  const out: FollowupView[] = [];
  for (const f of ctx.plans) {
    const [t] = await db
      .select({ status: tasks.status, dueOn: tasks.dueOn, name: users.fullName })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.dedupeKey, onboardingTaskDedupe(clientId, `vervolg_${f.key}`)), isNull(tasks.deletedAt)))
      .limit(1);
    out.push({ ...f, dueOn: t?.dueOn ?? f.dueOn, state: !t ? "gepland" : t.status === "done" ? "afgerond" : "open", assignee: t?.name ?? null });
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** Elk uur: vervolgtaken van alle klanten met een onboarding (ook afgeronde). */
export async function syncAllFollowups(): Promise<{ ok: boolean; clients: number; created: number }> {
  const rows = await db.select({ clientId: clientOnboardings.clientId }).from(clientOnboardings);
  let created = 0;
  for (const r of rows) {
    try {
      created += (await syncFollowups(r.clientId)).created;
    } catch (e) {
      console.error("[onboarding.followups]", r.clientId, e);
    }
  }
  return { ok: true, clients: rows.length, created };
}
