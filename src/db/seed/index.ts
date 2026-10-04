/**
 * Development seed voor ShortClips OS.
 *
 * Twee soorten data:
 *   1. Platformconfiguratie (rollen, rechten, statussen, automatiseringen,
 *      integraties) — die hoort óók in productie.
 *   2. Voorbeelddata (klanten, video's, cijfers) — uitsluitend om lokaal mee te
 *      werken. Met `--config-only` sla je die over.
 *
 * Gebruik: npm run db:seed  [--fresh] [--config-only]
 */
import { sql } from "drizzle-orm";
import { db, rawClient } from "../client";
import * as s from "../schema";
import { hashPassword } from "../../server/auth/password";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  permissionsForRole,
} from "../../server/auth/permissions";
import {
  AUTOMATION_RULES,
  INTEGRATIONS,
  SOP_DOCUMENTS,
  WORKFLOW_STATUSES,
} from "./platform-data";
import {
  between,
  dateOffset,
  daysFromNow,
  makeRandom,
  period,
} from "./helpers";

const args = process.argv.slice(2);
const FRESH = args.includes("--fresh");
const CONFIG_ONLY = args.includes("--config-only");
const DEV_PASSWORD = process.env.SEED_PASSWORD ?? "shortclips2026";

const rnd = makeRandom(20260818);

/* ------------------------------------------------------------------ */

async function wipe() {
  const tables = [
    "social_metrics", "daily_metrics", "publications", "content_calendar",
    "client_reports", "revenue_snapshots", "payments", "invoice_lines", "invoices",
    "editor_costs", "editor_assignments", "editors",
    "review_comments", "review_threads", "approvals", "video_versions", "deliverables",
    "script_versions", "scripts", "production_checklist_items", "production_days",
    "productions", "task_dependencies", "tasks", "projects",
    "ai_insights", "activity_events", "notifications", "notification_preferences",
    "automation_runs", "automation_rules", "audit_logs", "error_logs",
    "import_candidates", "import_runs", "integration_events", "sync_jobs",
    "integration_connections", "monday_mappings", "frame_mappings", "drive_mappings",
    "files", "sop_documents", "app_settings", "workflow_statuses",
    "client_knowledge", "social_accounts", "client_integrations", "contracts",
    "client_packages", "client_contacts",
    "time_off", "team_members", "user_roles", "role_permissions", "sessions",
    "clients", "users", "roles", "permissions",
  ];
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`));
  console.log("  · bestaande data verwijderd");
}

/* ---------------------------- Rechten ----------------------------- */

async function seedRbac() {
  const permRows = ALL_PERMISSIONS.map((key) => ({
    key,
    resource: key.split(":")[0]!,
    action: key.split(":")[1]!,
    description: PERMISSIONS[key],
  }));
  const insertedPerms = await db
    .insert(s.permissions)
    .values(permRows)
    .onConflictDoNothing()
    .returning({ id: s.permissions.id, key: s.permissions.key });

  const permByKey = new Map(insertedPerms.map((p) => [p.key, p.id]));
  if (permByKey.size === 0) {
    const existing = await db.select({ id: s.permissions.id, key: s.permissions.key }).from(s.permissions);
    for (const p of existing) permByKey.set(p.key, p.id);
  }

  const roleRows = ROLE_DEFINITIONS.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: true,
    isPortalRole: r.isPortalRole ?? false,
    sortOrder: r.sortOrder,
  }));
  const insertedRoles = await db
    .insert(s.roles)
    .values(roleRows)
    .onConflictDoNothing()
    .returning({ id: s.roles.id, key: s.roles.key });
  const roleByKey = new Map(insertedRoles.map((r) => [r.key, r.id]));

  const links: Array<{ roleId: string; permissionId: string }> = [];
  for (const def of ROLE_DEFINITIONS) {
    const roleId = roleByKey.get(def.key);
    if (!roleId) continue;
    for (const perm of permissionsForRole(def.key)) {
      const permissionId = permByKey.get(perm);
      if (permissionId) links.push({ roleId, permissionId });
    }
  }
  await db.insert(s.rolePermissions).values(links).onConflictDoNothing();

  console.log(`  · ${permByKey.size} rechten, ${roleByKey.size} rollen, ${links.length} koppelingen`);
  return roleByKey;
}

/* --------------------------- Gebruikers --------------------------- */

type TeamSpec = {
  email: string;
  fullName: string;
  /** Sleutel uit ROLE_DEFINITIONS. */
  role: string;
  jobTitle: string;
  videoCapacity?: number;
  color?: string;
};

const TEAM: TeamSpec[] = [
  { email: "jarno@shortclips.nl", fullName: "Jarno Klijnsma", role: "owner", jobTitle: "Eigenaar", color: "#00003B" },
  { email: "milou@shortclips.nl", fullName: "Milou de Vries", role: "project_coordinator", jobTitle: "Projectcoördinator", color: "#00AFFA" },
  { email: "jiska@shortclips.nl", fullName: "Jiska Bakker", role: "project_coordinator", jobTitle: "Projectcoördinator", color: "#8FB300" },
  { email: "sven@shortclips.nl", fullName: "Sven Hoekstra", role: "videographer", jobTitle: "Videograaf", color: "#2E9A6E" },
  { email: "noa@shortclips.nl", fullName: "Noa Veenstra", role: "content_creator", jobTitle: "Content creator", color: "#D98200" },
  { email: "daan@shortclips.nl", fullName: "Daan Wielinga", role: "editor", jobTitle: "Editor", videoCapacity: 12, color: "#5BC5FF" },
  { email: "lotte@shortclips.nl", fullName: "Lotte Dijkstra", role: "editor", jobTitle: "Editor", videoCapacity: 10, color: "#1B5FE0" },
  { email: "ruben@shortclips.nl", fullName: "Ruben Postma", role: "editor", jobTitle: "Editor (freelance)", videoCapacity: 6, color: "#8A8A9C" },
  { email: "finance@shortclips.nl", fullName: "Anke Smid", role: "finance", jobTitle: "Finance", color: "#D9483B" },
];

async function seedUsers(roleByKey: Map<string, string>) {
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const rows = TEAM.map((t) => ({
    email: t.email,
    fullName: t.fullName,
    passwordHash,
    status: "active" as const,
    primaryRole: t.role as "owner",
    clientId: null,
  }));

  const inserted = await db.insert(s.users).values(rows).returning({
    id: s.users.id,
    email: s.users.email,
  });
  const userByEmail = new Map(inserted.map((u) => [u.email, u.id]));

  await db.insert(s.userRoles).values(
    TEAM.map((t) => ({
      userId: userByEmail.get(t.email)!,
      roleId: roleByKey.get(t.role)!,
    })),
  );

  await db.insert(s.teamMembers).values(
    TEAM.map((t) => ({
      userId: userByEmail.get(t.email)!,
      jobTitle: t.jobTitle,
      weeklyCapacityHours: t.role === "editor" ? 32 : 40,
      weeklyVideoCapacity: t.videoCapacity ?? 0,
      isInternal: t.email !== "ruben@shortclips.nl",
      color: t.color ?? null,
    })),
  );

  console.log(`  · ${inserted.length} teamleden (wachtwoord: ${DEV_PASSWORD})`);
  return userByEmail;
}

/* ------------------------ Platformconfiguratie -------------------- */

async function seedPlatform(ownerId: string) {
  await db.insert(s.workflowStatuses).values(
    WORKFLOW_STATUSES.map((w) => ({
      domain: w.domain,
      key: w.key,
      label: w.label,
      color: w.color,
      sortOrder: w.sortOrder,
      isClientVisible: w.isClientVisible,
      slaHours: w.slaHours ?? null,
    })),
  ).onConflictDoNothing();

  await db.insert(s.automationRules).values(
    AUTOMATION_RULES.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      trigger: r.trigger,
      conditions: r.conditions,
      actions: r.actions,
      isEnabled: true,
    })),
  ).onConflictDoNothing();

  await db.insert(s.integrationConnections).values(
    INTEGRATIONS.map((i) => ({
      provider: i.provider,
      status: "not_configured" as const,
      requiredEnv: i.requiredEnv,
      config: i.config,
    })),
  ).onConflictDoNothing();

  await db.insert(s.sopDocuments).values(
    SOP_DOCUMENTS.map((d) => ({
      slug: d.slug,
      title: d.title,
      category: d.category,
      body: d.body,
      ownerId,
      visibleToRoles: [],
    })),
  ).onConflictDoNothing();

  await db.insert(s.appSettings).values([
    { key: "brand.name", value: { value: "ShortClips" }, category: "brand", description: "Naam zoals getoond in de app en het klantportaal" },
    { key: "brand.portalWelcome", value: { value: "Welkom bij jouw ShortClips-omgeving" }, category: "brand" },
    { key: "ops.internalReviewSlaHours", value: { value: 24 }, category: "operations", description: "Streeftijd voor interne controle" },
    { key: "ops.clientReviewSlaHours", value: { value: 72 }, category: "operations", description: "Streeftijd waarbinnen een klant reageert" },
    { key: "ops.contractRenewalNoticeDays", value: { value: 60 }, category: "operations", description: "Hoeveel dagen vooraf een verlenging gesignaleerd wordt" },
    { key: "ai.enabled", value: { value: false }, category: "ai", description: "Taalmodel-analyses aan of uit (rekenkundige analyses werken altijd)" },
  ]).onConflictDoNothing();

  console.log(`  · statussen, ${AUTOMATION_RULES.length} automatiseringen, ${INTEGRATIONS.length} integraties, ${SOP_DOCUMENTS.length} SOP's`);
}

/* ---------------------------- Klanten ----------------------------- */

const CLIENTS = [
  {
    slug: "friesland-lease", name: "Friesland Lease", sector: "Automotive · Leasing",
    color: "#1B5FE0", quota: 8, revenue: "2450.00", months: 19, risk: "none" as const,
    coordinator: "milou@shortclips.nl", pillars: ["Wagenpark-tips", "Klantverhalen", "Achter de schermen", "Leasekennis"],
  },
  {
    slug: "donkergroen", name: "Donkergroen", sector: "Groenvoorziening",
    color: "#2E9A6E", quota: 6, revenue: "1890.00", months: 14, risk: "none" as const,
    coordinator: "jiska@shortclips.nl", pillars: ["Projecten", "Vakmanschap", "Duurzaamheid", "Werken bij"],
  },
  {
    slug: "campernet", name: "Campernet", sector: "Recreatie · Campers",
    color: "#D98200", quota: 10, revenue: "2980.00", months: 11, risk: "medium" as const,
    coordinator: "milou@shortclips.nl", pillars: ["Camper-reviews", "Reistips", "Onderhoud", "Klantverhalen"],
  },
  {
    slug: "makelaardij-friesland", name: "Makelaardij Friesland", sector: "Vastgoed",
    color: "#00AFFA", quota: 6, revenue: "1650.00", months: 8, risk: "low" as const,
    coordinator: "jiska@shortclips.nl", pillars: ["Woningtours", "Markt-updates", "Koperstips", "Team"],
  },
  {
    slug: "kempernet", name: "Kempernet", sector: "Techniek · Installatie",
    color: "#8FB300", quota: 8, revenue: "2200.00", months: 6, risk: "high" as const,
    coordinator: "milou@shortclips.nl", pillars: ["Zonnepanelen", "Warmtepompen", "Laadpalen", "Monteursverhalen"],
  },
  {
    slug: "bouwbedrijf-de-jong", name: "Bouwbedrijf De Jong", sector: "Bouw",
    color: "#00003B", quota: 4, revenue: "1200.00", months: 3, risk: "none" as const,
    coordinator: "jiska@shortclips.nl", pillars: ["Projecten", "Vakmensen", "Materiaal"],
  },
];

async function seedClients(userByEmail: Map<string, string>) {
  const rows = CLIENTS.map((c) => ({
    slug: c.slug,
    name: c.name,
    legalName: `${c.name} B.V.`,
    sector: c.sector,
    website: `https://www.${c.slug.replace(/-/g, "")}.nl`,
    color: c.color,
    status: "active" as const,
    riskLevel: c.risk,
    riskReason:
      c.risk === "high"
        ? "Twee video's staan langer dan een week op klantcontrole en er is nog geen opname gepland voor volgende maand."
        : c.risk === "medium"
          ? "Contentplanning loopt achter op het afgesproken aantal video's."
          : null,
    startedOn: dateOffset(-c.months * 30),
    coordinatorId: userByEmail.get(c.coordinator)!,
    videographerId: userByEmail.get("sven@shortclips.nl")!,
    monthlyVideoQuota: c.quota,
    monthlyRevenue: c.revenue,
    lastContactAt: daysFromNow(-between(rnd, 1, 18)),
    lastActivityAt: daysFromNow(-between(rnd, 0, 6)),
  }));

  const inserted = await db.insert(s.clients).values(rows).returning({
    id: s.clients.id,
    slug: s.clients.slug,
  });
  const byslug = new Map(inserted.map((c) => [c.slug, c.id]));

  // Contactpersonen
  const contacts: (typeof s.clientContacts.$inferInsert)[] = [];
  const CONTACT_NAMES: Record<string, Array<[string, string]>> = {
    "friesland-lease": [["Marieke Wagenaar", "Marketingmanager"], ["Peter de Boer", "Commercieel directeur"]],
    donkergroen: [["Hans Terpstra", "Communicatie"], ["Ilse Kramer", "Projectleider"]],
    campernet: [["Erik Nijhof", "Eigenaar"], ["Sanne Boersma", "Marketing"]],
    "makelaardij-friesland": [["Wietse van der Meer", "Makelaar"], ["Femke Algra", "Officemanager"]],
    kempernet: [["Rob Kemper", "Directeur"], ["Nynke Visser", "Marketing"]],
    "bouwbedrijf-de-jong": [["Jelle de Jong", "Eigenaar"]],
  };
  for (const [slug, list] of Object.entries(CONTACT_NAMES)) {
    list.forEach(([fullName, role], i) => {
      contacts.push({
        clientId: byslug.get(slug)!,
        fullName,
        role,
        email: `${fullName.split(" ")[0]!.toLowerCase()}@${slug.replace(/-/g, "")}.nl`,
        phone: `06-${between(rnd, 10000000, 99999999)}`,
        isPrimary: i === 0,
        isApprover: i === 0,
      });
    });
  }
  await db.insert(s.clientContacts).values(contacts);

  // Pakketten en contracten
  await db.insert(s.clientPackages).values(
    CLIENTS.map((c) => ({
      clientId: byslug.get(c.slug)!,
      name: c.quota >= 8 ? "Groei" : c.quota >= 6 ? "Basis+" : "Basis",
      videosPerMonth: c.quota,
      shootDaysPerMonth: c.quota >= 8 ? 2 : 1,
      monthlyPrice: c.revenue,
      includesReporting: true,
      includesStrategy: c.quota >= 8,
      startsOn: dateOffset(-c.months * 30),
      isActive: true,
    })),
  );

  await db.insert(s.contracts).values(
    CLIENTS.map((c) => ({
      clientId: byslug.get(c.slug)!,
      reference: `SC-${new Date().getFullYear()}-${c.slug.slice(0, 3).toUpperCase()}`,
      status: "active" as const,
      startsOn: dateOffset(-c.months * 30),
      // Kempernet loopt bewust binnen 60 dagen af → verlengingssignaal.
      endsOn: dateOffset(c.slug === "kempernet" ? 47 : c.slug === "campernet" ? 88 : 365 - c.months * 30 + 365),
      noticePeriodDays: 30,
      autoRenew: c.slug !== "kempernet",
      renewalMonths: 12,
      monthlyValue: c.revenue,
    })),
  );

  // Social accounts
  const platforms = ["instagram", "tiktok", "facebook", "linkedin", "youtube"] as const;
  const accounts: (typeof s.socialAccounts.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    for (const p of platforms.slice(0, c.quota >= 8 ? 5 : 3)) {
      accounts.push({
        clientId: byslug.get(c.slug)!,
        platform: p,
        handle: `@${c.slug.replace(/-/g, "")}`,
        profileUrl: `https://${p}.com/${c.slug.replace(/-/g, "")}`,
        followers: between(rnd, 800, 24000),
        isActive: true,
        connectedAt: daysFromNow(-c.months * 30),
      });
    }
  }
  await db.insert(s.socialAccounts).values(accounts);

  // Klantkennis
  const knowledge: (typeof s.clientKnowledge.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    const id = byslug.get(c.slug)!;
    knowledge.push(
      { clientId: id, category: "tone_of_voice", title: "Tone of voice", body: "Nuchter, Fries-direct, geen marketingtaal. Je-vorm. Korte zinnen. Humor mag, gekunsteld niet.", isPinned: true },
      { clientId: id, category: "audience", title: "Doelgroep", body: `Beslissers en medewerkers in ${c.sector.toLowerCase()}, 28-55 jaar, voornamelijk Noord-Nederland.`, isPinned: true },
      { clientId: id, category: "avoid_words", title: "Woorden vermijden", body: "Geen 'uniek', 'marktleider', 'de beste'. Geen superlatieven zonder onderbouwing.", isPinned: false },
      { clientId: id, category: "hook_style", title: "Hookstijl", body: "Beginnen met een concrete vraag of een cijfer. Nooit met de bedrijfsnaam.", isPinned: true },
      { clientId: id, category: "editing_style", title: "Editingstijl", body: "Snelle cuts, ondertiteling altijd aan, merkkleur als accent, geen stockmuziek met zang.", isPinned: false },
      { clientId: id, category: "content_pillar", title: "Contentpijlers", body: c.pillars.join(" · "), tags: c.pillars, isPinned: true },
      { clientId: id, category: "recurring_correction", title: "Terugkerende correctie", body: "Logo aan het einde te lang in beeld; klant wil maximaal 1 seconde.", source: "derived" },
    );
  }
  await db.insert(s.clientKnowledge).values(knowledge);

  console.log(`  · ${inserted.length} klanten met contacten, pakketten, contracten, accounts en kennis`);
  return byslug;
}

/* ---------------------------- Editors ----------------------------- */

async function seedEditors(userByEmail: Map<string, string>) {
  const specs = [
    { email: "daan@shortclips.nl", name: "Daan Wielinga", rate: "65.00", cap: 12, freelance: false, spec: ["korte content", "ondertiteling"] },
    { email: "lotte@shortclips.nl", name: "Lotte Dijkstra", rate: "65.00", cap: 10, freelance: false, spec: ["storytelling", "kleurcorrectie"] },
    { email: "ruben@shortclips.nl", name: "Ruben Postma", rate: "85.00", cap: 6, freelance: true, spec: ["motion graphics"] },
  ];
  const inserted = await db.insert(s.editors).values(
    specs.map((e) => ({
      userId: userByEmail.get(e.email)!,
      displayName: e.name,
      email: e.email,
      isFreelance: e.freelance,
      ratePerVideo: e.rate,
      ratePerHour: "55.00",
      weeklyCapacity: e.cap,
      specialties: e.spec,
      isActive: true,
    })),
  ).returning({ id: s.editors.id, email: s.editors.email });

  console.log(`  · ${inserted.length} editors`);
  return new Map(inserted.map((e) => [e.email!, e.id]));
}

/* ------------------- Opnamedagen, scripts, video's ---------------- */

const HOOKS = [
  "Dit kost je 800 euro per jaar zonder dat je het doorhebt",
  "Waarom kiest bijna niemand hiervoor? Terwijl het gewoon werkt",
  "3 dingen die iedereen fout doet bij",
  "Dit zag ik vanochtend op locatie en het verbaasde me echt",
  "Even eerlijk: dit hadden we zelf ook niet verwacht",
  "Vraag die we deze week het vaakst kregen",
  "Zo ziet dat er in het echt uit",
  "Niemand vertelt je dit vooraf",
];

const TOPICS: Record<string, string[]> = {
  "friesland-lease": ["Private lease vs. kopen", "Wat kost een leaseauto écht", "Bijtelling in 2 minuten", "Zo lever je je auto netjes in", "Elektrisch leasen: de rekensom", "Klantverhaal: Van der Wal Transport"],
  donkergroen: ["Zo leggen we een daktuin aan", "Onderhoud dat je zelf kunt doen", "Waarom deze beplanting", "Een schoolplein vergroenen", "Werken bij Donkergroen", "Van ontwerp naar uitvoering"],
  campernet: ["Camper winterklaar maken", "De 5 duurste campermisverstanden", "Zo kies je de juiste indeling", "Onderhoudsbeurt van dichtbij", "Klantverhaal: eerste reis", "Wat kost camperbezit per jaar"],
  "makelaardij-friesland": ["Woningtour: jaren-30 in Leeuwarden", "Overbieden: wanneer wel", "Wat doet een makelaar echt", "Taxatie in 60 seconden", "De woningmarkt deze maand", "Zo bereid je een bezichtiging voor"],
  kempernet: ["Zonnepanelen: terugverdientijd", "Warmtepomp in een oud huis", "Laadpaal thuis installeren", "Monteur voor een dag", "Salderen stopt: en dan", "Isolatie eerst of panelen eerst"],
  "bouwbedrijf-de-jong": ["Van fundering tot oplevering", "Werken met vakmensen", "Materiaalkeuze uitgelegd"],
};

const PIPELINE_PLAN: Array<{ status: typeof s.deliverables.$inferInsert["status"]; count: number; ageDays: [number, number] }> = [
  { status: "recorded", count: 2, ageDays: [0, 2] },
  { status: "footage_upload", count: 1, ageDays: [1, 3] },
  { status: "awaiting_editor", count: 3, ageDays: [2, 6] },
  { status: "editing", count: 4, ageDays: [1, 5] },
  { status: "internal_review", count: 3, ageDays: [1, 4] },
  { status: "editor_revision", count: 2, ageDays: [2, 5] },
  { status: "client_review", count: 4, ageDays: [1, 9] },
  { status: "client_revision", count: 1, ageDays: [2, 4] },
  { status: "approved", count: 2, ageDays: [1, 3] },
  { status: "ready_to_publish", count: 2, ageDays: [0, 2] },
  { status: "scheduled", count: 3, ageDays: [0, 4] },
  { status: "published", count: 14, ageDays: [3, 70] },
];

async function seedWork(
  clientBySlug: Map<string, string>,
  userByEmail: Map<string, string>,
) {
  const coordinators = ["milou@shortclips.nl", "jiska@shortclips.nl"];
  const editorEmails = ["daan@shortclips.nl", "lotte@shortclips.nl", "ruben@shortclips.nl"];

  /* --- Projecten per klant voor de huidige maand --- */
  const projectRows = CLIENTS.map((c) => ({
    clientId: clientBySlug.get(c.slug)!,
    name: `Contentcyclus ${period()}`,
    description: `Maandelijkse productie van ${c.quota} video's.`,
    status: "active" as const,
    period: period(),
    startsOn: dateOffset(-15),
    dueOn: dateOffset(15),
    ownerId: userByEmail.get(c.coordinator)!,
  }));
  const projects = await db.insert(s.projects).values(projectRows)
    .returning({ id: s.projects.id, clientId: s.projects.clientId });
  const projectByClient = new Map(projects.map((p) => [p.clientId, p.id]));

  /* --- Opnamedagen: verleden en toekomst --- */
  const dayRows: (typeof s.productionDays.$inferInsert)[] = [];
  CLIENTS.forEach((c, ci) => {
    const clientId = clientBySlug.get(c.slug)!;
    // twee afgeronde dagen + één aankomende
    dayRows.push({
      clientId, title: `Opnamedag ${c.name} — ${period(-1)}`,
      scheduledOn: dateOffset(-30 - ci), startTime: "09:00", endTime: "15:00",
      locationName: `${c.name} hoofdvestiging`, locationAddress: "Leeuwarden",
      status: "completed", videographerId: userByEmail.get("sven@shortclips.nl")!,
      coordinatorId: userByEmail.get(c.coordinator)!,
      driveFolderId: `drive-${c.slug}-${period(-1)}`,
    });
    dayRows.push({
      clientId, title: `Opnamedag ${c.name} — ${period()}`,
      scheduledOn: dateOffset(-12 - ci), startTime: "09:30", endTime: "16:00",
      locationName: `${c.name} hoofdvestiging`, locationAddress: "Leeuwarden",
      status: "completed", videographerId: userByEmail.get("sven@shortclips.nl")!,
      coordinatorId: userByEmail.get(c.coordinator)!,
      driveFolderId: `drive-${c.slug}-${period()}`,
    });
    // Kempernet krijgt bewust een opname binnen 48 uur → risicosignaal
    const ahead = c.slug === "kempernet" ? 2 : 8 + ci * 4;
    dayRows.push({
      clientId, title: `Opnamedag ${c.name} — ${period(1)}`,
      scheduledOn: dateOffset(ahead), startTime: "09:00", endTime: "15:30",
      locationName: c.slug === "kempernet" ? "Project Sneek — nieuwbouwwijk" : `${c.name} hoofdvestiging`,
      locationAddress: c.slug === "kempernet" ? "Sneek" : "Leeuwarden",
      status: c.slug === "bouwbedrijf-de-jong" ? "planned" : "confirmed",
      videographerId: userByEmail.get("sven@shortclips.nl")!,
      coordinatorId: userByEmail.get(c.coordinator)!,
      schedule: "09:00 aankomst en opbouw\n09:30 interviews\n11:30 sfeerbeelden\n13:00 lunch\n13:30 productshots\n15:00 afronden",
    });
  });
  const days = await db.insert(s.productionDays).values(dayRows)
    .returning({ id: s.productionDays.id, clientId: s.productionDays.clientId, scheduledOn: s.productionDays.scheduledOn, title: s.productionDays.title });

  // Checklist voor aankomende dagen
  const checklist: (typeof s.productionChecklistItems.$inferInsert)[] = [];
  const today = dateOffset(0);
  for (const d of days.filter((x) => x.scheduledOn >= today)) {
    const items = [
      ["Scripts goedgekeurd door klant", "scripts", true],
      ["Shotlist compleet", "scripts", true],
      ["Camera + 2 lenzen", "apparatuur", true],
      ["2x draadloze microfoon", "apparatuur", true],
      ["Lampenset", "apparatuur", false],
      ["Locatie bevestigd met contactpersoon", "logistiek", true],
      ["Drive-map aangemaakt", "logistiek", false],
    ] as const;
    items.forEach(([label, category, blocking], i) => {
      checklist.push({
        productionDayId: d.id, label, category,
        isBlocking: blocking,
        // Kempernet (opname over 2 dagen) heeft bewust nog open blokkerende punten
        isDone: d.title.includes("Kempernet") ? i > 3 : i < 5,
        sortOrder: i * 10,
      });
    });
  }
  await db.insert(s.productionChecklistItems).values(checklist);

  /* --- Scripts --- */
  const scriptRows: (typeof s.scripts.$inferInsert)[] = [];
  const scriptStatuses = ["approved", "approved", "ready_to_shoot", "client_review", "internal_review", "concept", "idea"] as const;
  CLIENTS.forEach((c) => {
    const clientId = clientBySlug.get(c.slug)!;
    const upcoming = days.find((d) => d.clientId === clientId && d.scheduledOn >= today);
    const topics = TOPICS[c.slug] ?? [];
    topics.forEach((topic, i) => {
      scriptRows.push({
        clientId,
        productionDayId: i < 4 ? upcoming?.id ?? null : null,
        title: topic,
        status: scriptStatuses[i % scriptStatuses.length]!,
        pillar: c.pillars[i % c.pillars.length]!,
        format: i % 3 === 0 ? "Talking head" : i % 3 === 1 ? "Voice-over + b-roll" : "Interview",
        hook: HOOKS[(i + c.slug.length) % HOOKS.length]!,
        body: `[Hook]\n${HOOKS[(i + c.slug.length) % HOOKS.length]}\n\n[Kern]\nIn drie punten uitleggen wat ${topic.toLowerCase()} betekent voor de kijker. Concreet, met een voorbeeld uit de praktijk van ${c.name}.\n\n[Afsluiting]\nSamenvatting in één zin.`,
        cta: "Meer weten? Stuur ons een bericht of kijk op de website.",
        shotList: "1. Aankomst / establishing\n2. Talking head medium\n3. Detailshots\n4. Over-the-shoulder\n5. Afsluitshot met logo",
        requirements: "Bedrijfskleding, rustige locatie, product beschikbaar",
        locationName: `${c.name} hoofdvestiging`,
        presenter: "Contactpersoon klant",
        creatorId: userByEmail.get("noa@shortclips.nl")!,
        currentVersion: i % 3 === 0 ? 2 : 1,
        approvedAt: i < 2 ? daysFromNow(-between(rnd, 2, 10)) : null,
        approvedById: i < 2 ? userByEmail.get(c.coordinator)! : null,
      });
    });
  });
  const scripts = await db.insert(s.scripts).values(scriptRows)
    .returning({ id: s.scripts.id, clientId: s.scripts.clientId, title: s.scripts.title, status: s.scripts.status, currentVersion: s.scripts.currentVersion });

  // Versiegeschiedenis
  const versionRows: (typeof s.scriptVersions.$inferInsert)[] = [];
  for (const sc of scripts) {
    for (let v = 1; v <= sc.currentVersion; v++) {
      versionRows.push({
        scriptId: sc.id,
        versionNumber: v,
        snapshot: { title: sc.title, version: v },
        changeSummary: v === 1 ? "Eerste versie" : "Hook aangescherpt na interne controle",
        status: v === sc.currentVersion ? sc.status : "concept",
        authorId: userByEmail.get("noa@shortclips.nl")!,
      });
    }
  }
  await db.insert(s.scriptVersions).values(versionRows);

  /* --- Video's door de hele pipeline --- */
  const deliverableRows: (typeof s.deliverables.$inferInsert)[] = [];
  CLIENTS.forEach((c, ci) => {
    const clientId = clientBySlug.get(c.slug)!;
    const clientScripts = scripts.filter((x) => x.clientId === clientId);
    const pastDay = days.find((d) => d.clientId === clientId && d.scheduledOn < today);
    let n = 0;
    for (const step of PIPELINE_PLAN) {
      // Kleinere klanten krijgen minder video's
      const count = c.quota <= 4 ? Math.max(1, Math.floor(step.count / 2)) : step.count;
      for (let i = 0; i < count; i++) {
        const script = clientScripts[n % Math.max(clientScripts.length, 1)];
        const ageDays = between(rnd, step.ageDays[0], step.ageDays[1]);
        // Kempernet: klantcontrole bewust lang laten liggen
        const stale = c.slug === "kempernet" && step.status === "client_review" ? between(rnd, 9, 14) : ageDays;
        const isPublished = step.status === "published";
        deliverableRows.push({
          clientId,
          projectId: projectByClient.get(clientId) ?? null,
          scriptId: script?.id ?? null,
          productionDayId: pastDay?.id ?? null,
          title: `${script?.title ?? "Video"} ${isPublished ? "" : "(v" + (i + 1) + ")"}`.trim(),
          status: step.status,
          statusChangedAt: daysFromNow(-stale),
          editorId: ["awaiting_editor", "recorded", "footage_upload"].includes(step.status as string)
            ? null
            : userByEmail.get(editorEmails[(n + ci) % editorEmails.length]!)!,
          // Gepubliceerde video's hebben hun deadline vóór de publicatiedatum
          // liggen; de meeste zijn op tijd, een enkele bewust te laat.
          dueOn: dateOffset(
            isPublished ? -ageDays + (n % 7 === 0 ? -2 : 1) : between(rnd, -3, 12),
          ),
          plannedPublishOn: dateOffset(isPublished ? -ageDays : between(rnd, 1, 25)),
          durationSeconds: between(rnd, 18, 62),
          currentVersion: isPublished ? between(rnd, 1, 3) : between(rnd, 0, 2),
          internalRevisionRounds: between(rnd, 0, 2),
          clientRevisionRounds: between(rnd, 0, 2),
          editCost: String(between(rnd, 55, 95)) + ".00",
          approvedAt: ["approved", "ready_to_publish", "scheduled", "published", "analysis_available"].includes(step.status as string)
            ? daysFromNow(-stale - 1) : null,
          publishedAt: isPublished ? daysFromNow(-ageDays) : null,
          briefing: "Ondertiteling in merkkleur, logo maximaal 1 seconde in beeld, CTA aan het einde.",
        });
        n++;
      }
    }
  });
  const deliverables = await db.insert(s.deliverables).values(deliverableRows)
    .returning({ id: s.deliverables.id, clientId: s.deliverables.clientId, status: s.deliverables.status, title: s.deliverables.title, editorId: s.deliverables.editorId, publishedAt: s.deliverables.publishedAt, currentVersion: s.deliverables.currentVersion });

  console.log(`  · ${days.length} opnamedagen, ${scripts.length} scripts, ${deliverables.length} video's`);
  return { days, scripts, deliverables, projectByClient, editorEmails, coordinators };
}

/* ------------------ Review, versies en goedkeuringen -------------- */

async function seedReview(
  deliverables: Awaited<ReturnType<typeof seedWork>>["deliverables"],
  userByEmail: Map<string, string>,
) {
  const versionRows: (typeof s.videoVersions.$inferInsert)[] = [];
  for (const d of deliverables) {
    for (let v = 1; v <= d.currentVersion; v++) {
      versionRows.push({
        deliverableId: d.id,
        versionNumber: v,
        label: v === 1 ? "Eerste versie" : `Revisie ${v - 1}`,
        durationSeconds: between(rnd, 18, 62),
        uploadedById: d.editorId,
        uploadedAt: daysFromNow(-between(rnd, 1, 20)),
        isCurrent: v === d.currentVersion,
      });
    }
  }
  if (versionRows.length) await db.insert(s.videoVersions).values(versionRows);

  const INTERNAL = [
    "Hook mag strakker: eerste zin nu te lang.",
    "Ondertiteling loopt op 0:07 uit beeld.",
    "Logo staat 2 seconden in beeld, moet 1 seconde zijn.",
    "Audio linkerkanaal iets luider dan rechts.",
  ];
  const CLIENT = [
    "Kun je onze nieuwe slogan er nog in verwerken?",
    "Het shot van de werkplaats mag iets langer.",
    "Prima zo, alleen de naam van onze collega staat verkeerd gespeld.",
    "Mooi geworden, wat ons betreft akkoord.",
  ];

  const threadRows: (typeof s.reviewThreads.$inferInsert)[] = [];
  const targets = deliverables.filter((d) =>
    ["internal_review", "editor_revision", "client_review", "client_revision", "approved"].includes(d.status as string),
  );
  for (const d of targets) {
    const isClientPhase = ["client_review", "client_revision"].includes(d.status as string);
    threadRows.push({
      deliverableId: d.id,
      visibility: "internal",
      timecodeMs: between(rnd, 1000, 20000),
      isResolved: d.status === "approved",
    });
    if (isClientPhase || d.status === "approved") {
      threadRows.push({
        deliverableId: d.id,
        visibility: "client",
        timecodeMs: between(rnd, 1000, 20000),
        isResolved: d.status === "approved",
      });
    }
  }
  const threads = await db.insert(s.reviewThreads).values(threadRows)
    .returning({ id: s.reviewThreads.id, visibility: s.reviewThreads.visibility });

  const commentRows: (typeof s.reviewComments.$inferInsert)[] = threads.map((t, i) => ({
    threadId: t.id,
    body: t.visibility === "internal" ? INTERNAL[i % INTERNAL.length]! : CLIENT[i % CLIENT.length]!,
    authorUserId: t.visibility === "internal" ? userByEmail.get("milou@shortclips.nl")! : null,
    authorName: t.visibility === "internal" ? "Milou de Vries" : "Contactpersoon klant",
    source: t.visibility === "internal" ? "shortclips_os" : "portal",
    timecodeMs: between(rnd, 1000, 20000),
  }));
  if (commentRows.length) await db.insert(s.reviewComments).values(commentRows);

  const approvalRows: (typeof s.approvals.$inferInsert)[] = deliverables
    .filter((d) => ["client_review", "client_revision", "approved"].includes(d.status as string))
    .map((d) => ({
      clientId: d.clientId,
      kind: "video" as const,
      entityId: d.id,
      status: d.status === "approved" ? ("approved" as const) : d.status === "client_revision" ? ("changes_requested" as const) : ("pending" as const),
      requestedAt: daysFromNow(-between(rnd, 1, 10)),
      requestedById: userByEmail.get("milou@shortclips.nl")!,
      decidedAt: d.status === "client_review" ? null : daysFromNow(-between(rnd, 0, 4)),
      source: "portal",
    }));
  if (approvalRows.length) await db.insert(s.approvals).values(approvalRows);

  console.log(`  · ${versionRows.length} videoversies, ${threads.length} feedbackdraden, ${approvalRows.length} goedkeuringen`);
}

/* -------------- Planning, publicaties en statistieken ------------- */

async function seedPublishing(
  clientBySlug: Map<string, string>,
  deliverables: Awaited<ReturnType<typeof seedWork>>["deliverables"],
  userByEmail: Map<string, string>,
) {
  const calendarRows: (typeof s.contentCalendar.$inferInsert)[] = [];
  const published = deliverables.filter((d) => d.status === "published");
  const upcoming = deliverables.filter((d) => ["scheduled", "ready_to_publish", "approved"].includes(d.status as string));

  for (const d of published) {
    calendarRows.push({
      clientId: d.clientId, deliverableId: d.id, title: d.title,
      scheduledOn: dateOffset(-between(rnd, 3, 70)), scheduledAt: "12:00",
      status: "published",
      platforms: ["instagram", "tiktok", "facebook"],
      caption: `${d.title}\n\nMeer weten? Stuur ons gerust een bericht.`,
      hashtags: "#friesland #ondernemen #shortvideo",
      contentType: "Reel",
    });
  }
  upcoming.forEach((d, i) => {
    calendarRows.push({
      clientId: d.clientId, deliverableId: d.id, title: d.title,
      scheduledOn: dateOffset(between(rnd, 0, 21)), scheduledAt: "12:00",
      status: d.status === "scheduled" ? "scheduled" : i % 2 === 0 ? "ready" : "to_prepare",
      platforms: ["instagram", "tiktok"],
      caption: `${d.title}\n\nMeer weten? Stuur ons gerust een bericht.`,
      hashtags: "#friesland #ondernemen",
      contentType: "Reel",
      ownerId: userByEmail.get("milou@shortclips.nl")!,
    });
  });
  const calendar = await db.insert(s.contentCalendar).values(calendarRows)
    .returning({ id: s.contentCalendar.id, clientId: s.contentCalendar.clientId, deliverableId: s.contentCalendar.deliverableId, status: s.contentCalendar.status, scheduledOn: s.contentCalendar.scheduledOn });

  const accounts = await db.select({
    id: s.socialAccounts.id, clientId: s.socialAccounts.clientId, platform: s.socialAccounts.platform,
  }).from(s.socialAccounts);

  const pubRows: (typeof s.publications.$inferInsert)[] = [];
  for (const item of calendar.filter((c) => c.status === "published")) {
    const clientAccounts = accounts.filter((a) => a.clientId === item.clientId).slice(0, 3);
    for (const acc of clientAccounts) {
      pubRows.push({
        clientId: item.clientId, calendarItemId: item.id, deliverableId: item.deliverableId,
        socialAccountId: acc.id, platform: acc.platform, status: "published",
        publishedAt: new Date(`${item.scheduledOn}T12:00:00Z`),
        externalPostId: `${acc.platform}-${item.id.slice(0, 8)}`,
        externalUrl: `https://${acc.platform}.com/p/${item.id.slice(0, 8)}`,
      });
    }
  }
  const pubs = await db.insert(s.publications).values(pubRows)
    .returning({ id: s.publications.id, clientId: s.publications.clientId, platform: s.publications.platform, publishedAt: s.publications.publishedAt });

  // Dagelijkse snapshots per publicatie: de eerste dagen groeien snel, daarna vlakt het af.
  const metricRows: (typeof s.socialMetrics.$inferInsert)[] = [];
  for (const p of pubs) {
    const base = between(rnd, 2000, 40000);
    const publishedDay = p.publishedAt ? new Date(p.publishedAt) : daysFromNow(-10);
    const daysLive = Math.min(
      14,
      Math.max(1, Math.floor((Date.now() - publishedDay.getTime()) / 86400000)),
    );
    for (let d = 1; d <= daysLive; d++) {
      const growth = 1 - Math.exp(-d / 3);
      const views = Math.round(base * growth);
      const measured = new Date(publishedDay);
      measured.setDate(measured.getDate() + d);
      metricRows.push({
        publicationId: p.id, clientId: p.clientId, platform: p.platform,
        measuredOn: measured.toISOString().slice(0, 10),
        views,
        reach: Math.round(views * 0.72),
        likes: Math.round(views * 0.041),
        comments: Math.round(views * 0.0035),
        shares: Math.round(views * 0.0062),
        saves: Math.round(views * 0.0088),
        watchTimeSeconds: Math.round(views * between(rnd, 6, 14)),
        avgWatchSeconds: String(between(rnd, 6, 16)),
        completionRate: String((between(rnd, 32, 68) / 100).toFixed(4)),
        profileVisits: Math.round(views * 0.012),
        followerDelta: Math.round(views * 0.0016),
        source: "seed",
      });
    }
  }
  // In blokken invoegen: één statement met tienduizenden rijen is traag.
  for (let i = 0; i < metricRows.length; i += 500) {
    await db.insert(s.socialMetrics).values(metricRows.slice(i, i + 500));
  }

  // Dagtotalen per klant/platform over 90 dagen
  const dailyRows: (typeof s.dailyMetrics.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    const clientAccounts = accounts.filter((a) => a.clientId === clientId);
    for (const acc of clientAccounts) {
      let followers = between(rnd, 800, 9000);
      for (let d = 90; d >= 0; d--) {
        const delta = between(rnd, -3, 26);
        followers += delta;
        dailyRows.push({
          clientId, platform: acc.platform, measuredOn: dateOffset(-d),
          views: between(rnd, 400, 9000),
          reach: between(rnd, 300, 7000),
          engagements: between(rnd, 20, 500),
          followers, followerDelta: delta,
          postsPublished: d % 3 === 0 ? 1 : 0,
          source: "seed",
        });
      }
    }
  }
  for (let i = 0; i < dailyRows.length; i += 500) {
    await db.insert(s.dailyMetrics).values(dailyRows.slice(i, i + 500));
  }

  console.log(`  · ${calendar.length} planningsitems, ${pubs.length} publicaties, ${metricRows.length} videostatistieken, ${dailyRows.length} dagtotalen`);
  return { calendar, pubs };
}

/* ---------------------------- Finance ----------------------------- */

async function seedFinance(
  clientBySlug: Map<string, string>,
  editorByEmail: Map<string, string>,
  deliverables: Awaited<ReturnType<typeof seedWork>>["deliverables"],
) {
  const invoiceRows: (typeof s.invoices.$inferInsert)[] = [];
  let seq = 1;
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    for (let m = 3; m >= 0; m--) {
      const total = Number(c.revenue);
      const vat = +(total * 0.21).toFixed(2);
      // De lopende maand is nog niet verstuurd; één klant is bewust te laat.
      const status = m === 0 ? "draft" : m === 1 && c.slug === "kempernet" ? "overdue" : m === 1 ? "sent" : "paid";
      invoiceRows.push({
        clientId,
        number: `2026-${String(seq++).padStart(4, "0")}`,
        status: status as "paid",
        issuedOn: dateOffset(-m * 30),
        dueOn: dateOffset(-m * 30 + 14),
        period: period(-m),
        subtotal: total.toFixed(2),
        vatAmount: vat.toFixed(2),
        total: (total + vat).toFixed(2),
        amountPaid: status === "paid" ? (total + vat).toFixed(2) : "0.00",
      });
    }
  }
  const invoices = await db.insert(s.invoices).values(invoiceRows)
    .returning({ id: s.invoices.id, clientId: s.invoices.clientId, status: s.invoices.status, total: s.invoices.total, issuedOn: s.invoices.issuedOn, period: s.invoices.period });

  await db.insert(s.invoiceLines).values(
    invoices.map((inv) => ({
      invoiceId: inv.id,
      description: `Maandelijkse contentproductie ${inv.period}`,
      quantity: "1",
      unitPrice: (Number(inv.total) / 1.21).toFixed(2),
      vatRate: "0.2100",
      lineTotal: (Number(inv.total) / 1.21).toFixed(2),
    })),
  );

  const paid = invoices.filter((i) => i.status === "paid");
  if (paid.length) {
    await db.insert(s.payments).values(
      paid.map((inv) => ({
        invoiceId: inv.id, clientId: inv.clientId, amount: inv.total,
        paidOn: inv.issuedOn ?? dateOffset(-30), method: "bankoverschrijving",
      })),
    );
  }

  // Editorkosten per opgeleverde video
  const editorIds = [...editorByEmail.values()];
  const costRows: (typeof s.editorCosts.$inferInsert)[] = deliverables
    .filter((d) => ["published", "approved", "scheduled", "ready_to_publish"].includes(d.status as string))
    .map((d, i) => ({
      editorId: editorIds[i % editorIds.length]!,
      deliverableId: d.id,
      clientId: d.clientId,
      amount: String(between(rnd, 55, 95)) + ".00",
      period: period(-(i % 3)),
      description: `Edit: ${d.title}`,
      isPaid: i % 4 !== 0,
    }));
  if (costRows.length) await db.insert(s.editorCosts).values(costRows);

  // Maandelijkse omzet-snapshots
  const snapshots: (typeof s.revenueSnapshots.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    for (let m = 5; m >= 0; m--) {
      snapshots.push({
        clientId, period: period(-m), mrr: c.revenue, invoiced: c.revenue,
        editorCost: String(c.quota * 70) + ".00",
        videosDelivered: between(rnd, Math.max(1, c.quota - 2), c.quota),
      });
    }
  }
  await db.insert(s.revenueSnapshots).values(snapshots).onConflictDoNothing();

  console.log(`  · ${invoices.length} facturen, ${costRows.length} editorkosten, ${snapshots.length} omzetsnapshots`);
}

/* ------------- Taken, meldingen, tijdlijn, AI, bestanden ---------- */

async function seedOps(
  clientBySlug: Map<string, string>,
  userByEmail: Map<string, string>,
  work: Awaited<ReturnType<typeof seedWork>>,
) {
  const { deliverables, days, scripts } = work;

  /* Taken */
  const taskRows: (typeof s.tasks.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    const coordinatorId = userByEmail.get(c.coordinator)!;
    taskRows.push(
      { clientId, title: `Contentplanning ${period(1)} afstemmen`, status: "todo", priority: "high", assigneeId: coordinatorId, dueOn: dateOffset(between(rnd, 1, 7)) },
      { clientId, title: "Maandrapportage opstellen en publiceren", status: "todo", priority: "normal", assigneeId: coordinatorId, dueOn: dateOffset(between(rnd, 2, 10)) },
      { clientId, title: "Openstaande klantfeedback opvolgen", status: "in_progress", priority: c.risk === "high" ? "urgent" : "normal", assigneeId: coordinatorId, dueOn: dateOffset(between(rnd, -2, 3)) },
    );
  }
  taskRows.push(
    { clientId: clientBySlug.get("kempernet")!, title: "Verlenging Kempernet bespreken (contract loopt af)", status: "todo", priority: "urgent", assigneeId: userByEmail.get("jarno@shortclips.nl")!, dueOn: dateOffset(5) },
    { clientId: clientBySlug.get("kempernet")!, title: "Scripts goedkeuren vóór opname over 2 dagen", status: "todo", priority: "urgent", assigneeId: userByEmail.get("milou@shortclips.nl")!, dueOn: dateOffset(1) },
    { clientId: clientBySlug.get("campernet")!, title: "Nieuwe opnamedag inplannen", status: "todo", priority: "high", assigneeId: userByEmail.get("jiska@shortclips.nl")!, dueOn: dateOffset(4) },
    { clientId: null, title: "Kwartaalcijfers doornemen met het team", status: "todo", priority: "normal", assigneeId: userByEmail.get("jarno@shortclips.nl")!, dueOn: dateOffset(9) },
  );
  const tasks = await db.insert(s.tasks).values(taskRows).returning({ id: s.tasks.id });

  /* Meldingen */
  const notifRows: (typeof s.notifications.$inferInsert)[] = [];
  const stale = deliverables.filter((d) => d.status === "client_review").slice(0, 4);
  stale.forEach((d, i) => {
    notifRows.push({
      userId: userByEmail.get("milou@shortclips.nl")!,
      clientId: d.clientId,
      type: "video.awaiting_client",
      level: i === 0 ? "warning" : "info",
      title: "Video wacht op klantfeedback",
      body: `"${d.title}" staat al enkele dagen bij de klant.`,
      href: `/videos/${d.id}`,
      entityType: "deliverable", entityId: d.id,
      dedupeKey: `awaiting_client:${d.id}`,
    });
  });
  notifRows.push(
    { userId: userByEmail.get("jarno@shortclips.nl")!, clientId: clientBySlug.get("kempernet")!, type: "contract.expiring", level: "warning", title: "Contract Kempernet loopt af", body: "Over 47 dagen. Opzegtermijn is 30 dagen.", href: "/clients/kempernet", dedupeKey: "contract:kempernet" },
    { userId: userByEmail.get("milou@shortclips.nl")!, clientId: clientBySlug.get("kempernet")!, type: "production.at_risk", level: "critical", title: "Opname over 2 dagen — scripts niet rond", body: "Twee blokkerende checklistpunten staan nog open.", href: "/productions", dedupeKey: "production_risk:kempernet" },
    { userId: userByEmail.get("finance@shortclips.nl")!, clientId: clientBySlug.get("kempernet")!, type: "invoice.overdue", level: "warning", title: "Factuur vervallen", body: "Factuur van vorige maand is nog niet betaald.", href: "/finance", dedupeKey: "invoice_overdue:kempernet" },
  );
  await db.insert(s.notifications).values(notifRows).onConflictDoNothing();

  /* Tijdlijn */
  const activityRows: (typeof s.activityEvents.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    const clientDeliverables = deliverables.filter((d) => d.clientId === clientId).slice(0, 6);
    const clientScripts = scripts.filter((x) => x.clientId === clientId).slice(0, 3);
    const day = days.find((d) => d.clientId === clientId);
    let offset = 40;
    for (const sc of clientScripts) {
      activityRows.push({ clientId, type: "script.created", title: `Script aangemaakt: ${sc.title}`, entityType: "script", entityId: sc.id, actorUserId: userByEmail.get("noa@shortclips.nl")!, actorName: "Noa Veenstra", occurredAt: daysFromNow(-(offset -= 2)) });
    }
    if (day) activityRows.push({ clientId, type: "production.scheduled", title: `Opnamedag gepland: ${day.title}`, entityType: "production_day", entityId: day.id, actorUserId: userByEmail.get(c.coordinator)!, actorName: "Projectcoördinator", isClientVisible: true, occurredAt: daysFromNow(-(offset -= 3)) });
    for (const d of clientDeliverables) {
      activityRows.push(
        { clientId, type: "video.assigned", title: `Video toegewezen aan editor: ${d.title}`, entityType: "deliverable", entityId: d.id, occurredAt: daysFromNow(-(offset -= 2)) },
        { clientId, type: "video.version_uploaded", title: `Nieuwe versie geplaatst: ${d.title}`, entityType: "deliverable", entityId: d.id, isClientVisible: true, occurredAt: daysFromNow(-(offset -= 1)) },
      );
      if (d.status === "published") {
        activityRows.push({ clientId, type: "publication.published", title: `Video gepubliceerd: ${d.title}`, entityType: "deliverable", entityId: d.id, isClientVisible: true, occurredAt: d.publishedAt ?? daysFromNow(-(offset -= 1)) });
      }
    }
  }
  for (let i = 0; i < activityRows.length; i += 500) {
    await db.insert(s.activityEvents).values(activityRows.slice(i, i + 500));
  }

  /* AI-inzichten — altijd met bronvermelding */
  const insightRows: (typeof s.aiInsights.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    insightRows.push(
      {
        clientId, kind: "hook_performance",
        title: "Vraag-hooks presteren beter dan stelling-hooks",
        body: "Video's die openen met een vraag halen gemiddeld 34% meer weergaven dan video's die met een stelling openen. Het verschil is het grootst op TikTok.",
        evidence: [
          { type: "metric", label: "Gemiddelde weergaven vraag-hook", value: 18420, source: "social_metrics" },
          { type: "metric", label: "Gemiddelde weergaven stelling-hook", value: 13750, source: "social_metrics" },
          { type: "query", label: "Periode", value: "laatste 90 dagen" },
        ],
        sampleSize: between(rnd, 14, 32), method: "deterministic", period: period(),
      },
      {
        clientId, kind: "bottleneck",
        title: "Interne controle is de langste stap",
        body: "Video's staan gemiddeld 2,1 dag op interne controle, tegenover 0,8 dag bij de editor. Daar zit de meeste winst in doorlooptijd.",
        evidence: [
          { type: "metric", label: "Gem. dagen interne controle", value: 2.1, source: "deliverables.status_changed_at" },
          { type: "metric", label: "Gem. dagen bij editor", value: 0.8, source: "editor_assignments" },
        ],
        sampleSize: between(rnd, 10, 28), method: "deterministic", period: period(),
      },
    );
  }
  insightRows.push({
    clientId: clientBySlug.get("kempernet")!, kind: "risk_signal",
    title: "Kempernet loopt risico",
    body: "Drie signalen tegelijk: contract loopt binnen 60 dagen af, twee video's wachten langer dan een week op feedback, en er is nog geen opname gepland voor de maand daarna.",
    evidence: [
      { type: "record", label: "Contract eindigt", value: dateOffset(47), source: "contracts" },
      { type: "metric", label: "Video's >7 dagen bij klant", value: 2, source: "deliverables" },
      { type: "metric", label: "Geplande opnames volgende maand", value: 0, source: "production_days" },
    ],
    sampleSize: 3, method: "deterministic", period: period(),
  });
  await db.insert(s.aiInsights).values(insightRows);

  /* Bestanden (Drive-metadata) */
  const fileRows: (typeof s.files.$inferInsert)[] = [];
  const categories = ["Strategie", "Scripts", "Opnames", "Video", "Rapportages", "Branding", "Contracten"];
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    for (const cat of categories) {
      fileRows.push({
        clientId, name: cat, source: "google_drive", isFolder: true,
        externalId: `folder-${c.slug}-${cat.toLowerCase()}`,
        externalUrl: `https://drive.google.com/drive/folders/folder-${c.slug}-${cat.toLowerCase()}`,
        category: cat, path: `/${c.name}/${cat}`,
        modifiedAt: daysFromNow(-between(rnd, 1, 60)),
      });
      for (let i = 1; i <= 3; i++) {
        fileRows.push({
          clientId, name: `${cat} ${period(-(i - 1))}.${cat === "Video" ? "mp4" : cat === "Rapportages" ? "pdf" : "docx"}`,
          source: "google_drive", isFolder: false,
          mimeType: cat === "Video" ? "video/mp4" : cat === "Rapportages" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: String(between(rnd, 40000, 90000000)),
          externalId: `file-${c.slug}-${cat}-${i}`,
          externalUrl: `https://drive.google.com/file/d/file-${c.slug}-${cat}-${i}`,
          parentExternalId: `folder-${c.slug}-${cat.toLowerCase()}`,
          category: cat, path: `/${c.name}/${cat}`,
          modifiedAt: daysFromNow(-between(rnd, 1, 90)),
        });
      }
    }
  }
  await db.insert(s.files).values(fileRows);

  /* Rapportages */
  const reportRows: (typeof s.clientReports.$inferInsert)[] = [];
  for (const c of CLIENTS) {
    const clientId = clientBySlug.get(c.slug)!;
    for (let m = 2; m >= 1; m--) {
      reportRows.push({
        clientId, periodType: "month", period: period(-m),
        title: `Maandrapportage ${period(-m)}`,
        summary: `In ${period(-m)} zijn ${c.quota} video's opgeleverd en gepubliceerd op ${c.quota >= 8 ? "vijf" : "drie"} kanalen.`,
        metrics: { videos: c.quota, views: between(rnd, 40000, 320000), reach: between(rnd, 30000, 240000), followerGrowth: between(rnd, 60, 900) },
        manualNote: "Sterke maand op TikTok. Volgende maand meer inzetten op klantverhalen, die scoren consequent beter.",
        isPublished: true, publishedAt: daysFromNow(-m * 28),
      });
    }
  }
  await db.insert(s.clientReports).values(reportRows).onConflictDoNothing();

  console.log(`  · ${tasks.length} taken, ${notifRows.length} meldingen, ${activityRows.length} tijdlijnitems, ${insightRows.length} AI-inzichten, ${fileRows.length} bestanden`);
}

/* ------------------------------ Main ------------------------------ */

async function main() {
  console.log("ShortClips OS — seed");
  if (FRESH) await wipe();

  console.log("Platformconfiguratie:");
  const roleByKey = await seedRbac();
  const userByEmail = await seedUsers(roleByKey);
  await seedPlatform(userByEmail.get("jarno@shortclips.nl")!);

  if (CONFIG_ONLY) {
    console.log("\n✓ Alleen configuratie geplaatst (--config-only).");
  } else {
    console.log("\nVoorbeelddata:");
    const clientBySlug = await seedClients(userByEmail);
    const editorByEmail = await seedEditors(userByEmail);
    const work = await seedWork(clientBySlug, userByEmail);
    await seedReview(work.deliverables, userByEmail);
    await seedPublishing(clientBySlug, work.deliverables, userByEmail);
    await seedFinance(clientBySlug, editorByEmail, work.deliverables);
    await seedOps(clientBySlug, userByEmail, work);

    // Eén klantaccount voor het portaal.
    const portalRole = roleByKey.get("client")!;
    const passwordHash = await hashPassword(DEV_PASSWORD);
    const [portalUser] = await db.insert(s.users).values({
      email: "marieke@frieslandlease.nl",
      fullName: "Marieke Wagenaar",
      passwordHash,
      status: "active",
      primaryRole: "client",
      clientId: clientBySlug.get("friesland-lease")!,
    }).returning({ id: s.users.id });
    await db.insert(s.userRoles).values({ userId: portalUser!.id, roleId: portalRole });
    console.log("  · 1 klantaccount voor het portaal");
  }

  console.log("\n✓ Seed voltooid.\n");
  console.log("  Inloggen op http://localhost:3000/login");
  console.log(`  Eigenaar        jarno@shortclips.nl      / ${DEV_PASSWORD}`);
  console.log(`  Coördinator     milou@shortclips.nl      / ${DEV_PASSWORD}`);
  console.log(`  Editor          daan@shortclips.nl       / ${DEV_PASSWORD}`);
  console.log(`  Finance         finance@shortclips.nl    / ${DEV_PASSWORD}`);
  if (!CONFIG_ONLY) {
    console.log(`  Klantportaal    marieke@frieslandlease.nl / ${DEV_PASSWORD}`);
  }

  const raw = rawClient() as { end?: () => Promise<void>; close?: () => Promise<void> };
  await raw.end?.();
  await raw.close?.();
}

main().catch((error) => {
  console.error("\n✗ Seed mislukt:", error);
  process.exit(1);
});
