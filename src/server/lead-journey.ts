import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  journeyTemplates,
  leadJourneys,
  quotes,
  salesLeads,
  tasks,
  users,
  type JourneyPhaseState,
} from "@/db/schema";
import { requireLeadsAccess } from "@/server/auth/context";
import { getOnboardingView, listProjectManagers, type PmOption } from "@/server/onboarding";
import { WELCOME_FILES } from "@/lib/onboarding-plan";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import {
  currentPhase,
  effectiveStatus,
  emptyFacts,
  journeyTaskDedupe,
  journeyTaskTitle,
  LINK_DEFS,
  MESSAGE_BY_KEY,
  MESSAGES,
  PHASES,
  phaseProgress,
  renderMessage,
  type JourneyFacts,
  type JourneyStatus,
  type PhaseDef,
} from "@/lib/lead-journey";

/**
 * Leadreis: lezen en bijwerken. Alle afleidbare feiten (offerte, klant,
 * WhatsApp, kickoff) komen live uit de bestaande Hub-onderdelen. Er wordt
 * hier nooit iets naar een klant verstuurd.
 */

const SIGNED = new Set(["ondertekend", "geaccepteerd"]);

function todayAmsterdam(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

export type PhaseView = {
  def: PhaseDef;
  status: JourneyStatus;
  done: number;
  total: number;
  checks: { key: string; label: string; checked: boolean; auto: boolean }[];
  assigneeId: string | null;
  assigneeName: string | null;
  doneAt: string | null;
  isCurrent: boolean;
};

export type MessageView = {
  key: string;
  title: string;
  hint: string;
  /** Tekst zoals die nu getoond wordt (lead-aanpassing > centrale standaard > code). */
  text: string;
  source: "lead" | "standaard" | "code";
  /** Standaardtekst zonder lead-aanpassing, met {placeholders}. */
  defaultBody: string;
  missing: string[];
};

export type JourneyView = {
  leadId: string;
  company: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  clientSlug: string | null;
  started: boolean;
  phases: PhaseView[];
  currentKey: string | null;
  messages: MessageView[];
  links: { key: string; label: string; central: string; lead: string }[];
  pandadocLink: string;
  pms: PmOption[];
  facts: JourneyFacts;
  kickoffAt: string | null;
};

async function templateRows() {
  const rows = await db.select().from(journeyTemplates);
  return new Map(rows.map((r) => [r.key, r]));
}

async function loadFacts(leadId: string, lead: { email: string | null; phone: string | null; contactName: string | null; followUpOn: string | null; convertedClientId: string | null }) {
  const [q] = await db
    .select({ status: quotes.status, sentAt: quotes.sentAt })
    .from(quotes)
    .where(and(eq(quotes.leadId, leadId), isNull(quotes.deletedAt)))
    .orderBy(sql`case when ${quotes.status} in ('ondertekend','geaccepteerd') then 0 else 1 end`, sql`coalesce(${quotes.sentAt}, ${quotes.createdAt}) desc`)
    .limit(1);
  const facts: JourneyFacts = {
    ...emptyFacts,
    hasContact: Boolean(lead.contactName && (lead.email || lead.phone)),
    hasFollowUp: Boolean(lead.followUpOn),
    quoteSent: Boolean(q && (q.sentAt || q.status !== "concept")),
    quoteSigned: Boolean(q && SIGNED.has(q.status)),
    clientCreated: Boolean(lead.convertedClientId),
  };
  let kickoffAt: string | null = null;
  let welcomeFileUrl: string | null = null;
  let coordinatorName: string | null = null;
  if (lead.convertedClientId) {
    const view = await getOnboardingView(lead.convertedClientId).catch(() => null);
    if (view) {
      const stepDone = (k: string) => view.steps.some((s) => s.key === k && s.status === "klaar");
      facts.whatsappLinked = Boolean(view.whatsapp.link) || stepDone("whatsapp");
      facts.welcomeSent = stepDone("welcome_sent");
      kickoffAt = view.kickoff.at;
      const t = kickoffAt ? new Date(kickoffAt).getTime() : NaN;
      facts.kickoffPlanned = Boolean(kickoffAt);
      facts.kickoffDone = Number.isFinite(t) && t < Date.now();
      facts.briefingDone = stepDone("briefing");
      facts.shootsPlanned = stepDone("first_shoot");
      welcomeFileUrl = view.welcomeFile?.url ?? null;
      coordinatorName = view.pmName;
    }
  }
  return { facts, kickoffAt, welcomeFileUrl, coordinatorName };
}

export async function getJourneyView(leadId: string): Promise<JourneyView | null> {
  await requireLeadsAccess();
  const [lead] = await db
    .select({
      id: salesLeads.id,
      company: salesLeads.company,
      contactName: salesLeads.contactName,
      email: salesLeads.email,
      phone: salesLeads.phone,
      status: salesLeads.status,
      followUpOn: salesLeads.followUpOn,
      ownerId: salesLeads.ownerId,
      convertedClientId: salesLeads.convertedClientId,
    })
    .from(salesLeads)
    .where(and(eq(salesLeads.id, leadId), isNull(salesLeads.deletedAt)))
    .limit(1);
  if (!lead) return null;

  const [journey] = await db.select().from(leadJourneys).where(eq(leadJourneys.leadId, leadId)).limit(1);
  const states = (journey?.phases ?? {}) as Record<string, JourneyPhaseState>;
  const { facts, kickoffAt, welcomeFileUrl } = await loadFacts(leadId, lead);
  const pms = await listProjectManagers();
  const templates = await templateRows();

  let clientSlug: string | null = null;
  let coordinatorId: string | null = null;
  if (lead.convertedClientId) {
    const [c] = await db.select({ slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, lead.convertedClientId)).limit(1);
    clientSlug = c?.slug ?? null;
    coordinatorId = c?.coordinatorId ?? null;
  }

  const jarno = pms.find((p) => p.email.toLowerCase() === "jarno@shortclips.nl") ?? null;
  const nameOf = new Map<string, string>(pms.map((p) => [p.id, p.name]));
  const extraIds = [lead.ownerId, ...Object.values(states).map((s) => s.assigneeId)].filter((x): x is string => Boolean(x) && !nameOf.has(x as string));
  if (extraIds.length) {
    const more = await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, extraIds));
    for (const m of more) nameOf.set(m.id, m.name);
  }

  const cur = currentPhase(states);
  const phases: PhaseView[] = PHASES.map((def) => {
    const st = states[def.key];
    const prog = phaseProgress(def, st, facts);
    const defaultAssignee = def.role === "owner" ? lead.ownerId ?? jarno?.id ?? null : def.role === "pm" ? coordinatorId : null;
    const assigneeId = st?.assigneeId ?? defaultAssignee;
    return {
      def,
      status: effectiveStatus(def, states, facts),
      done: prog.done,
      total: prog.total,
      checks: def.checklist.map((c) => ({
        key: c.key,
        label: c.label,
        checked: Boolean(c.auto && facts[c.auto]) || Boolean(st?.checks?.[c.key]),
        auto: Boolean(c.auto && facts[c.auto]),
      })),
      assigneeId,
      assigneeName: assigneeId ? nameOf.get(assigneeId) ?? null : def.role === "team" ? "Productieteam" : null,
      doneAt: st?.doneAt ?? null,
      isCurrent: cur?.key === def.key,
    };
  });

  const centralLinks = new Map(
    LINK_DEFS.map((l) => [l.key, templates.get(l.key)?.body?.trim() ?? ""] as const),
  );
  const leadLinks = (journey?.links ?? {}) as Record<string, string>;
  const pandadocLink = (leadLinks.pandadoc_link ?? "").trim();
  const welcomeFile = welcomeFileUrl ?? `https://drive.google.com/file/d/${WELCOME_FILES.organisch.id}/view`;
  const values = {
    voornaam: lead.contactName,
    bedrijf: lead.company,
    pandadoc_link: pandadocLink,
    kickoff_link: (leadLinks.kickoff_link ?? "").trim() || centralLinks.get("kickoff_link") || "",
    rutger_video: (leadLinks.rutger_video ?? "").trim() || centralLinks.get("rutger_video") || "",
    welkomstbestand: welcomeFile,
  };

  const messages: MessageView[] = MESSAGES.map((m) => {
    const override = journey?.messages?.[m.key];
    const central = templates.get(m.key);
    const defaultBody = central?.body?.trim() ? central.body : m.body;
    const body = override?.trim() ? override : defaultBody;
    const text = override?.trim() ? override : renderMessage(defaultBody, values);
    return {
      key: m.key,
      title: m.title,
      hint: m.hint,
      // Een lead-aanpassing wordt letterlijk getoond; de standaard wordt ingevuld.
      text: override?.trim() ? body : text,
      source: override?.trim() ? "lead" : central?.body?.trim() ? "standaard" : "code",
      defaultBody,
      missing: [...(override?.trim() ? body : text).matchAll(/\[nog koppelen: ([^\]]+)\]/g)].map((x) => x[1]!),
    };
  });

  return {
    leadId,
    company: lead.company,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    clientSlug,
    started: Boolean(journey),
    phases,
    currentKey: cur?.key ?? null,
    messages,
    links: LINK_DEFS.map((l) => ({ key: l.key, label: l.label, central: centralLinks.get(l.key) ?? "", lead: (leadLinks[l.key] ?? "").trim() })),
    pandadocLink,
    pms,
    facts,
    kickoffAt,
  };
}

/** Fase per lead voor de lijst: wie een reis heeft volgt die, anders een nette afleiding. */
export type LeadPhaseSummary = { nr: number; title: string; status: JourneyStatus; started: boolean };

export async function listLeadPhases(
  leads: { id: string; status: string }[],
  quoteInfo: Record<string, { status: string; sentAt: Date | string | null } | undefined>,
): Promise<Record<string, LeadPhaseSummary | null>> {
  await requireLeadsAccess();
  const rows = await db.select({ leadId: leadJourneys.leadId, phases: leadJourneys.phases }).from(leadJourneys);
  const byLead = new Map(rows.map((r) => [r.leadId, r.phases as Record<string, JourneyPhaseState>]));
  const out: Record<string, LeadPhaseSummary | null> = {};
  for (const l of leads) {
    if (l.status === "verloren") { out[l.id] = null; continue; }
    const states = byLead.get(l.id);
    if (states) {
      const cur = currentPhase(states);
      const def = cur ?? PHASES[PHASES.length - 1]!;
      out[l.id] = { nr: def.nr, title: def.title, status: cur ? (states[cur.key]?.status ?? "bezig") : "klaar", started: true };
      continue;
    }
    const q = quoteInfo[l.id];
    const signed = q ? SIGNED.has(q.status) : false;
    const nr = l.status === "gewonnen" ? 5 : signed ? 4 : q && (q.sentAt || q.status !== "concept") ? 3 : l.status === "offerte" || l.status === "onderhandeling" ? 3 : 1;
    const def = PHASES[nr - 1]!;
    out[l.id] = { nr, title: def.title, status: "nog_niet", started: false };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Bijwerken
 * ------------------------------------------------------------------ */

async function ensureJourney(leadId: string, userId: string) {
  const [row] = await db.select().from(leadJourneys).where(eq(leadJourneys.leadId, leadId)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(leadJourneys)
    .values({ leadId, startedById: userId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(leadJourneys).where(eq(leadJourneys.leadId, leadId)).limit(1);
  return again!;
}

async function savePhases(id: string, phases: Record<string, JourneyPhaseState>) {
  await db.update(leadJourneys).set({ phases, updatedAt: new Date() }).where(eq(leadJourneys.id, id));
}

export async function toggleCheck(leadId: string, phaseKey: string, itemKey: string, value: boolean) {
  const viewer = await requireLeadsAccess();
  const def = PHASES.find((p) => p.key === phaseKey);
  if (!def || !def.checklist.some((c) => c.key === itemKey)) return { ok: false as const, message: "Onbekend punt." };
  const row = await ensureJourney(leadId, viewer.id);
  const phases = { ...(row.phases ?? {}) };
  const st: JourneyPhaseState = { ...(phases[phaseKey] ?? {}), status: phases[phaseKey]?.status ?? "bezig" };
  st.checks = { ...(st.checks ?? {}), [itemKey]: value };
  if (st.status === "nog_niet") st.status = "bezig";
  phases[phaseKey] = st;
  await savePhases(row.id, phases);
  await syncJourneyTasks(leadId);
  return { ok: true as const };
}

export async function setPhaseStatus(leadId: string, phaseKey: string, status: JourneyStatus) {
  const viewer = await requireLeadsAccess();
  if (!PHASES.some((p) => p.key === phaseKey)) return { ok: false as const, message: "Onbekende fase." };
  const row = await ensureJourney(leadId, viewer.id);
  const phases = { ...(row.phases ?? {}) };
  const st: JourneyPhaseState = { ...(phases[phaseKey] ?? {}), status };
  if (status === "klaar") {
    st.doneAt = new Date().toISOString();
    st.doneBy = viewer.email;
  } else {
    st.doneAt = null;
    st.doneBy = null;
  }
  phases[phaseKey] = st;
  // Fases na een heropende fase gaan terug naar "nog niet", zodat de volgorde klopt.
  if (status !== "klaar") {
    const idx = PHASES.findIndex((p) => p.key === phaseKey);
    for (const later of PHASES.slice(idx + 1)) {
      if (phases[later.key]?.status === "klaar") phases[later.key] = { ...phases[later.key]!, status: "nog_niet", doneAt: null, doneBy: null };
    }
  }
  await savePhases(row.id, phases);
  await syncJourneyTasks(leadId);
  return { ok: true as const };
}

export async function completePhase(leadId: string, phaseKey: string) {
  const viewer = await requireLeadsAccess();
  const idx = PHASES.findIndex((p) => p.key === phaseKey);
  if (idx < 0) return { ok: false as const, message: "Onbekende fase." };
  const row = await ensureJourney(leadId, viewer.id);
  const phases = { ...(row.phases ?? {}) };
  const now = new Date().toISOString();
  // Alle eerdere fases zijn per definitie afgerond: je kunt een fase niet overslaan.
  for (const p of PHASES.slice(0, idx + 1)) {
    const prev = phases[p.key];
    phases[p.key] = prev?.status === "klaar" ? prev : { ...(prev ?? {}), status: "klaar", doneAt: now, doneBy: viewer.email };
  }
  const next = PHASES[idx + 1];
  if (next && !phases[next.key]) phases[next.key] = { status: "bezig" };
  await savePhases(row.id, phases);
  await syncJourneyTasks(leadId);
  return { ok: true as const, next: next?.key ?? null };
}

export async function setAssignee(leadId: string, phaseKey: string, assigneeId: string | null) {
  const viewer = await requireLeadsAccess();
  if (!PHASES.some((p) => p.key === phaseKey)) return { ok: false as const, message: "Onbekende fase." };
  const row = await ensureJourney(leadId, viewer.id);
  const phases = { ...(row.phases ?? {}) };
  phases[phaseKey] = { ...(phases[phaseKey] ?? { status: "nog_niet" as const }), assigneeId };
  await savePhases(row.id, phases);
  // De open taak van deze fase moet bij de nieuwe eigenaar komen te staan.
  await db
    .update(tasks)
    .set({ assigneeId, updatedAt: new Date() })
    .where(and(eq(tasks.dedupeKey, journeyTaskDedupe(leadId, phaseKey)), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`));
  return { ok: true as const };
}

/** Bericht aanpassen voor alleen deze lead. Leeg = terug naar de standaard. */
export async function saveLeadMessage(leadId: string, key: string, text: string | null) {
  const viewer = await requireLeadsAccess();
  if (!MESSAGE_BY_KEY.has(key)) return { ok: false as const, message: "Onbekend bericht." };
  const row = await ensureJourney(leadId, viewer.id);
  const messages = { ...(row.messages ?? {}) };
  if (text && text.trim()) messages[key] = text.slice(0, 6000);
  else delete messages[key];
  await db.update(leadJourneys).set({ messages, updatedAt: new Date() }).where(eq(leadJourneys.id, row.id));
  return { ok: true as const };
}

/** De huidige tekst als nieuwe standaard voor alle leads. Zet {voornaam} e.d. er zelf in. */
export async function saveDefaultMessage(key: string, body: string | null, userId: string) {
  if (!MESSAGE_BY_KEY.has(key)) return { ok: false as const, message: "Onbekend bericht." };
  if (!body || !body.trim()) {
    await db.delete(journeyTemplates).where(eq(journeyTemplates.key, key));
    return { ok: true as const };
  }
  await db
    .insert(journeyTemplates)
    .values({ key, kind: "message", body: body.slice(0, 6000), updatedById: userId })
    .onConflictDoUpdate({ target: journeyTemplates.key, set: { body: body.slice(0, 6000), updatedById: userId, updatedAt: new Date() } });
  return { ok: true as const };
}

export async function saveCentralLink(key: string, url: string | null, userId: string) {
  if (!LINK_DEFS.some((l) => l.key === key)) return { ok: false as const, message: "Onbekende link." };
  const clean = (url ?? "").trim();
  if (clean && !/^https?:\/\//i.test(clean)) return { ok: false as const, message: "Begin de link met https://." };
  if (!clean) {
    await db.delete(journeyTemplates).where(eq(journeyTemplates.key, key));
    return { ok: true as const };
  }
  await db
    .insert(journeyTemplates)
    .values({ key, kind: "link", body: clean, updatedById: userId })
    .onConflictDoUpdate({ target: journeyTemplates.key, set: { body: clean, updatedById: userId, updatedAt: new Date() } });
  return { ok: true as const };
}

export async function saveLeadLink(leadId: string, key: string, url: string | null) {
  const viewer = await requireLeadsAccess();
  if (!["pandadoc_link", "kickoff_link", "rutger_video"].includes(key)) return { ok: false as const, message: "Onbekende link." };
  const clean = (url ?? "").trim();
  if (clean && !/^https?:\/\//i.test(clean)) return { ok: false as const, message: "Begin de link met https://." };
  const row = await ensureJourney(leadId, viewer.id);
  const links = { ...(row.links ?? {}) };
  if (clean) links[key] = clean;
  else delete links[key];
  await db.update(leadJourneys).set({ links, updatedAt: new Date() }).where(eq(leadJourneys.id, row.id));
  return { ok: true as const };
}

/* ------------------------------------------------------------------ *
 * Taken: de openstaande fase staat als taak in het bestaande takenoverzicht
 * ------------------------------------------------------------------ */

export async function syncJourneyTasks(leadId: string): Promise<{ created: boolean }> {
  const [lead] = await db
    .select({ company: salesLeads.company, status: salesLeads.status, ownerId: salesLeads.ownerId, convertedClientId: salesLeads.convertedClientId })
    .from(salesLeads)
    .where(and(eq(salesLeads.id, leadId), isNull(salesLeads.deletedAt)))
    .limit(1);
  const [journey] = await db.select().from(leadJourneys).where(eq(leadJourneys.leadId, leadId)).limit(1);
  if (!lead || !journey) return { created: false };
  const states = (journey.phases ?? {}) as Record<string, JourneyPhaseState>;

  // Afgeronde fases: taak afvinken.
  const doneKeys = PHASES.filter((p) => states[p.key]?.status === "klaar").map((p) => journeyTaskDedupe(leadId, p.key));
  if (doneKeys.length) {
    await db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(tasks.dedupeKey, doneKeys), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`));
  }
  if (lead.status === "verloren") return { created: false };

  const cur = currentPhase(states);
  // Fase 8 is het productieproces zelf: daar is geen aparte leadtaak meer voor.
  if (!cur || cur.role === "team") return { created: false };

  const dedupeKey = journeyTaskDedupe(leadId, cur.key);
  const [exists] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dedupeKey, dedupeKey), isNull(tasks.deletedAt))).limit(1);
  if (exists) return { created: false };

  let assigneeId: string | null = states[cur.key]?.assigneeId ?? null;
  let clientSlug: string | null = null;
  if (lead.convertedClientId) {
    const [c] = await db.select({ slug: clients.slug, coordinatorId: clients.coordinatorId }).from(clients).where(eq(clients.id, lead.convertedClientId)).limit(1);
    clientSlug = c?.slug ?? null;
    if (!assigneeId && cur.role === "pm") assigneeId = c?.coordinatorId ?? null;
  }
  if (!assigneeId) assigneeId = lead.ownerId ?? null;
  if (!assigneeId) {
    const [jarno] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = 'jarno@shortclips.nl'`).limit(1);
    assigneeId = jarno?.id ?? null;
  }

  const open = cur.checklist.map((c) => `- ${c.label}`).join("\n");
  const where = clientSlug ? `/clients/${clientSlug}?tab=onboarding` : `/leads/${leadId}`;
  await db
    .insert(tasks)
    .values({
      title: journeyTaskTitle(lead.company, cur),
      description: `${cur.explain}\n\nChecklist:\n${open}\n\nOpen de leadreis: ${where === `/leads/${leadId}` ? where : `/leads/${leadId}`}`,
      status: "todo",
      priority: "normal",
      category: "klantcontact",
      assigneeId,
      dueOn: addWorkingDays(todayAmsterdam(), 1, nlHolidaySet()),
      entityType: "lead",
      entityId: leadId,
      source: "automation",
      dedupeKey,
    })
    .onConflictDoNothing();
  return { created: true };
}
