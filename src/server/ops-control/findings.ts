import "server-only";
import { and, eq, inArray, isNull, like, lte, notLike, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks, users } from "@/db/schema";
import type { OpsDomainHealth } from "@/db/schema";
import { viewerForUser } from "@/server/auth/context";
import { getQualityOverview, type QualityItem } from "@/server/quality";
import { integrationHealth } from "@/server/integrations/registry";
import { CORE_STAFF_EMAILS } from "@/server/core-staff";
import { addWorkingDays } from "@/lib/workdays";
import { isClosedKey, SCRIPTING_TASK_PREFIX } from "@/lib/scripting-task-plan";
import { OPS_TASK_PREFIX, type Finding, type OpsDomain } from "@/lib/ops-control/plan";

/**
 * Verzamelt wat de controle moet bewaken, uit de bestaande bronnen van de Hub:
 *  - de automatische signalen van Aandachtspunten (`quality.ts`): editing,
 *    klantfeedback, klantcommunicatie, opnamevoorbereiding, scriptcontrole;
 *  - de scriptingtaken (één per scriptsessie, `scripting-tasks.ts`);
 *  - gewone taken die vandaag af moeten of te laat zijn.
 * Plus per onderdeel of de bron betrouwbaar gecontroleerd kon worden.
 */

/** Categorie uit quality.ts → onderdeel + gedrag. */
type CatRule = { domain: OpsDomain; verifiable: boolean; snooze: number };
const CATEGORY: Record<string, CatRule> = {
  "Deadline in gevaar": { domain: "editing", verifiable: false, snooze: 1 },
  "Video over deadline": { domain: "editing", verifiable: true, snooze: 0 },
  "Eerste versie verwacht": { domain: "editing", verifiable: true, snooze: 0 },
  "Editor moet opleveren": { domain: "editing", verifiable: true, snooze: 0 },
  "Video wacht op controle": { domain: "editing", verifiable: true, snooze: 0 },
  "Productiegegevens ontbreken": { domain: "editing", verifiable: true, snooze: 0 },
  "Feedback niet verwerkt": { domain: "klantfeedback", verifiable: true, snooze: 0 },
  // Wachten op de klant: het team kan alleen herinneren. Afronden = herinnering verstuurd.
  "Feedback ontbreekt": { domain: "klantfeedback", verifiable: false, snooze: 2 },
  "Te laat bij klant": { domain: "klantfeedback", verifiable: false, snooze: 2 },
  "Klant vraagt aandacht": { domain: "klantcommunicatie", verifiable: false, snooze: 5 },
  "Video klaar maar niet verstuurd": { domain: "klantcommunicatie", verifiable: true, snooze: 0 },
  "Video niet gepubliceerd": { domain: "klantcommunicatie", verifiable: true, snooze: 0 },
  "Opname voorbereiden": { domain: "opname", verifiable: true, snooze: 0 },
  "Scripts controleren": { domain: "scripting", verifiable: true, snooze: 0 },
};
// Bewust niet in de controle: koppelingen (eigen melding aan Jarno), contracten
// (commercieel) en dalende resultaten (analyse, geen dagelijkse taak). Die blijven
// op Aandachtspunten staan.

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

export type CollectResult = { findings: Finding[]; health: OpsDomainHealth[]; errors: string[] };

export async function collectFindings(today: string, holidays?: Set<string>): Promise<CollectResult> {
  const errors: string[] = [];
  const findings: Finding[] = [];
  const unavailable = new Set<OpsDomain>();
  const partial = new Map<OpsDomain, string>();
  partial.set("klantcommunicatie", "Berichten in WhatsApp en Outlook zijn niet gekoppeld; feedback, verzending en klantrisico wel.");

  const core = await db.select({ id: users.id, email: users.email }).from(users)
    .where(and(inArray(sql`lower(${users.email})`, [...CORE_STAFF_EMAILS]), isNull(users.deletedAt)));
  const coreIds = new Set(core.map((u) => u.id));
  const clientRows = await db.select({ id: clients.id, name: clients.name }).from(clients).where(isNull(clients.deletedAt));
  const clientIdByName = new Map(clientRows.map((c) => [c.name, c.id]));

  /* ---- 1. Signalen uit Aandachtspunten ---- */
  try {
    const [owner] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.primaryRole, "owner"), isNull(users.deletedAt))).limit(1);
    const viewer = owner ? await viewerForUser(owner.id) : null;
    if (!viewer) throw new Error("Geen eigenaar gevonden om de signalen te lezen.");
    const { items } = await getQualityOverview(viewer, { trusted: true });
    for (const it of items) {
      const f = fromQuality(it, clientIdByName);
      if (f) findings.push(f);
    }
  } catch (e) {
    errors.push(`Signalen niet te lezen: ${e instanceof Error ? e.message : String(e)}`);
    for (const d of ["editing", "klantfeedback", "klantcommunicatie", "opname"] as OpsDomain[]) unavailable.add(d);
  }

  /* ---- 2. Koppelingen: bron niet bereikbaar = niet te controleren ---- */
  try {
    const health = await integrationHealth();
    const bad = (p: string) => health.some((h) => h.spec.provider === p && h.configured && ["error", "stale", "never_synced"].includes(h.status));
    if (bad("google_calendar")) {
      unavailable.add("opname");
      partial.set("scripting", "Google Agenda synchroniseert niet: opnamedata kunnen verouderd zijn.");
    }
    if (bad("frameio")) {
      partial.set("editing", "Frame.io synchroniseert niet: nieuwe versies kunnen ontbreken.");
      partial.set("klantfeedback", "Frame.io synchroniseert niet: nieuwe klantfeedback kan ontbreken.");
    }
    if (bad("google_drive")) partial.set("scripting", "Google Drive synchroniseert niet: nieuwe script-PDF's kunnen ontbreken.");
  } catch (e) {
    errors.push(`Koppelingsstatus niet te lezen: ${e instanceof Error ? e.message : String(e)}`);
  }

  /* ---- 3. Scriptingtaken met deadline binnen 48 uur of te laat ---- */
  const in48h = addWorkingDays(today, 2, holidays);
  try {
    const rows = await db.select({
      id: tasks.id, title: tasks.title, dueOn: tasks.dueOn, assigneeId: tasks.assigneeId,
      clientId: tasks.clientId, clientName: clients.name, entityId: tasks.entityId, dedupeKey: tasks.dedupeKey,
    }).from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(and(
        like(tasks.dedupeKey, `${SCRIPTING_TASK_PREFIX}%`), isNull(tasks.deletedAt), isNull(tasks.archivedAt),
        inArray(tasks.status, ["todo", "in_progress", "blocked"]), lte(tasks.dueOn, in48h),
      ));
    for (const t of rows) {
      if (!t.dueOn || isClosedKey(t.dedupeKey)) continue;
      const late = t.dueOn < today;
      const action = t.title.split(" | ")[1] ?? t.title;
      findings.push({
        key: `scripting:sessie:${t.entityId ?? t.id}`, domain: "scripting", category: "Scripts op tijd klaar",
        clientId: t.clientId, clientLabel: t.clientName, ownerId: t.assigneeId,
        action, reason: late ? `Scriptdeadline ${fmt(t.dueOn)} is verstreken` : t.dueOn === today ? "Scriptdeadline is vandaag" : `Scriptdeadline ${fmt(t.dueOn)}`,
        href: t.entityId ? `/scripting?sessie=${t.entityId}` : "/scripting",
        priority: t.dueOn <= today ? "hoog" : "normaal", severity: late ? "rood" : "oranje",
        verifiable: true, snoozeWorkdays: 0, createTask: false, linkedTaskId: t.id, dueOn: t.dueOn,
      });
    }
  } catch (e) {
    errors.push(`Scriptingtaken niet te lezen: ${e instanceof Error ? e.message : String(e)}`);
    unavailable.add("scripting");
  }

  /* ---- 4. Gewone taken die vandaag af moeten of te laat zijn ---- */
  try {
    const rows = await db.select({
      id: tasks.id, title: tasks.title, dueOn: tasks.dueOn, assigneeId: tasks.assigneeId, priority: tasks.priority,
      clientId: tasks.clientId, clientName: clients.name,
    }).from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(and(
        isNull(tasks.deletedAt), isNull(tasks.archivedAt), inArray(tasks.status, ["todo", "in_progress", "blocked"]),
        lte(tasks.dueOn, today), notLike(sql`coalesce(${tasks.dedupeKey}, '')`, `${SCRIPTING_TASK_PREFIX}%`),
        notLike(sql`coalesce(${tasks.dedupeKey}, '')`, `${OPS_TASK_PREFIX}%`),
      ));
    for (const t of rows) {
      if (!t.dueOn || !t.assigneeId || !coreIds.has(t.assigneeId)) continue;
      const late = t.dueOn < today;
      const important = t.priority === "high" || t.priority === "urgent";
      findings.push({
        key: `taken:${t.id}`, domain: "taken", category: late ? "Taak over deadline" : "Taak vandaag af",
        clientId: t.clientId, clientLabel: t.clientName, ownerId: t.assigneeId,
        action: t.title.slice(0, 200), reason: late ? `Deadline ${fmt(t.dueOn)} is verstreken` : "Deadline is vandaag",
        href: "/tasks", priority: important ? "hoog" : "normaal", severity: late && important ? "rood" : "oranje",
        verifiable: true, snoozeWorkdays: 0, createTask: false, linkedTaskId: t.id, dueOn: t.dueOn,
      });
    }
  } catch (e) {
    errors.push(`Taken niet te lezen: ${e instanceof Error ? e.message : String(e)}`);
    unavailable.add("taken");
  }

  const all: OpsDomain[] = ["scripting", "editing", "klantfeedback", "klantcommunicatie", "opname", "taken"];
  const health: OpsDomainHealth[] = all.map((d) =>
    unavailable.has(d)
      ? { domain: d, check: "unavailable", note: "Controle niet mogelijk: de bron was niet bereikbaar." }
      : partial.has(d) ? { domain: d, check: "partial", note: partial.get(d) } : { domain: d, check: "checked" });

  return { findings, health, errors };
}

function fmt(d: string): string {
  const [, m, day] = d.split("-");
  return `${Number(day)}-${Number(m)}`;
}

function fromQuality(it: QualityItem, clientIdByName: Map<string, string>): Finding | null {
  const rule = CATEGORY[it.category];
  if (!rule) return null;
  if (it.priority === "laag") return null;
  const clientId = it.clientName ? clientIdByName.get(it.clientName) ?? null : null;
  const scope = clientId ?? (it.clientName ? `naam-${slug(it.clientName)}` : `persoon-${it.ownerId ?? "team"}`);
  const severity = it.severity === "rood" ? "rood" : "oranje";
  const jarnoReason = it.category === "Klant vraagt aandacht" && severity === "rood"
    ? `Klant met hoog risico: ${it.reason}` : null;
  return {
    key: `${rule.domain}:${slug(it.category)}:${scope}`,
    domain: rule.domain, category: it.category,
    clientId, clientLabel: it.clientName ?? null, ownerId: it.ownerId ?? null,
    action: it.action.slice(0, 200), reason: it.reason,
    href: it.href ?? null, priority: it.priority === "hoog" ? "hoog" : "normaal", severity,
    verifiable: rule.verifiable, snoozeWorkdays: rule.snooze, createTask: true, jarnoReason,
  };
}
