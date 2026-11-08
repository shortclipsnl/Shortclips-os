import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, editorStatusChecks, productionDays, users } from "@/db/schema";
import { runJob } from "@/server/jobs/runner";
import { notify } from "@/server/notifications";
import { nlHolidaySet } from "@/lib/holidays";
import { isActiveClientStatus } from "@/lib/client-status";
import { editorDeadline } from "@/lib/edit-deadline";
import {
  amsterdamDate,
  editorCycle,
  isEditorProgressStatus,
  isWorkingHours,
  planCheck,
  progressView,
  updatedAgo,
  type EditorProgressStatus,
  type ProgressView,
} from "@/lib/editor-status-check";

/**
 * Automatische statuscheck voor editors.
 *
 *  1. De job (elk uur op werkdagen, alleen 09:00-17:00) zoekt video's die bij
 *     een editor liggen en waarvan 50% van de bewerkingstijd verstreken is, en
 *     zet een check klaar in het editorportaal (+ één melding).
 *  2. De editor antwoordt met één klik (bezig / nog niet begonnen / bijna klaar),
 *     optioneel met een korte toelichting.
 *  3. Team Shortclips ziet de laatste stand per project in de kolom Voortgang op
 *     de Editing-pagina; geen reactie of nog niet begonnen vlak voor de deadline
 *     komt automatisch in Aandachtspunten.
 *
 * Bron van alle regels: src/lib/editor-status-check.ts.
 */

const ACTIVE_AT_EDITOR = ["awaiting_editor", "editing", "editor_revision", "client_revision"] as const;

type CheckRow = typeof editorStatusChecks.$inferSelect;

/** Alle checks van deze video's, nieuwste eerst, per video gegroepeerd. */
async function checksByDeliverable(ids: string[]): Promise<Map<string, CheckRow[]>> {
  const map = new Map<string, CheckRow[]>();
  if (!ids.length) return map;
  const rows = await db
    .select()
    .from(editorStatusChecks)
    .where(inArray(editorStatusChecks.deliverableId, ids))
    .orderBy(desc(editorStatusChecks.sentAt));
  for (const r of rows) {
    const list = map.get(r.deliverableId) ?? [];
    list.push(r);
    map.set(r.deliverableId, list);
  }
  return map;
}

/** Laatste beantwoorde check (respondedAt het nieuwst). */
function lastAnswered(list: CheckRow[]): CheckRow | null {
  let best: CheckRow | null = null;
  for (const c of list) {
    if (!c.respondedAt || !c.status) continue;
    if (!best || c.respondedAt > best.respondedAt!) best = c;
  }
  return best;
}

/** De video's die nu bij een editor liggen, met alles wat nodig is voor de cyclus. */
async function videosAtEditor(filter: { editorId?: string; ids?: string[] } = {}) {
  const conds = [
    isNull(deliverables.deletedAt),
    inArray(deliverables.status, [...ACTIVE_AT_EDITOR]),
    sql`${deliverables.editorId} is not null`,
  ];
  if (filter.editorId) conds.push(eq(deliverables.editorId, filter.editorId));
  if (filter.ids) conds.push(inArray(deliverables.id, filter.ids.length ? filter.ids : ["00000000-0000-0000-0000-000000000000"]));
  return db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      statusChangedAt: deliverables.statusChangedAt,
      shootOn: deliverables.shootOn,
      planShootOn: productionDays.scheduledOn,
      dueOn: deliverables.dueOn,
      editorId: deliverables.editorId,
      clientId: clients.id,
      clientName: clients.name,
      clientStatus: clients.status,
      clientCoordinatorId: clients.coordinatorId,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
    .where(and(...conds));
}

/** Projectnaam zoals het team en de editor hem kennen. */
export function projectLabel(clientName: string, title: string): string {
  return title && title !== clientName ? `${clientName} · ${title}` : clientName;
}

/* ------------------------------------------------------------------ *
 * 1. De job
 * ------------------------------------------------------------------ */

export async function runEditorStatusChecks() {
  return runJob("system", "editors.status_checks", {}, async (ctx) => {
    const now = new Date();
    const holidays = nlHolidaySet();
    if (!isWorkingHours(now, holidays)) {
      ctx.log(`Buiten werktijd (${now.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}), niets verstuurd.`);
      return;
    }
    const today = amsterdamDate(now);
    const videos = (await videosAtEditor()).filter((v) => isActiveClientStatus(v.clientStatus));
    const checks = await checksByDeliverable(videos.map((v) => v.id));

    for (const v of videos) {
      ctx.counters.processed++;
      const cycle = editorCycle(
        { status: v.status, shootOn: v.planShootOn ?? v.shootOn, dueOn: v.dueOn, statusSince: amsterdamDate(v.statusChangedAt) },
        holidays,
      );
      if (!cycle || !v.editorId) continue;
      // Checks van een vorige editor tellen niet mee voor de nieuwe editor.
      const list = (checks.get(v.id) ?? []).filter((c) => c.editorId === v.editorId);
      const inCycle = list.filter((c) => c.cycleKey === cycle.cycleKey);
      const answered = lastAnswered(list);
      const answeredInCycle = lastAnswered(inCycle);
      const plan = planCheck(
        cycle,
        today,
        {
          hasHalfwayThisCycle: inCycle.some((c) => c.kind === "halfway"),
          hasPreDeadlineThisCycle: inCycle.some((c) => c.kind === "pre_deadline"),
          hasOpenCheck: list.some((c) => !c.respondedAt),
          lastResponse: answered && isEditorProgressStatus(answered.status)
            ? { status: answered.status, on: amsterdamDate(answered.respondedAt!) }
            : null,
          lastResponseThisCycle: answeredInCycle && isEditorProgressStatus(answeredInCycle.status) ? answeredInCycle.status : null,
          unansweredThisCycle: inCycle.some((c) => !c.respondedAt),
        },
        holidays,
      );
      if (!plan) continue;

      const [created] = await db
        .insert(editorStatusChecks)
        .values({ deliverableId: v.id, editorId: v.editorId, kind: plan.kind, cycleKey: cycle.cycleKey, editorDueOn: cycle.deadline })
        .onConflictDoNothing()
        .returning({ id: editorStatusChecks.id });
      if (!created) continue;
      ctx.counters.created++;

      // Halverwege: één melding in het portaal. Kort voor de deadline geen extra
      // melding: de bestaande deadlineherinnering stuurt de editor al naar Vandaag,
      // waar de check bovenaan staat. Zo krijgt niemand twee pings op één dag.
      if (plan.kind === "halfway") {
        await notify({
          userIds: [v.editorId],
          clientId: v.clientId,
          type: "editor_status_check",
          level: "info",
          title: `Halverwege de deadline van ${projectLabel(v.clientName, v.title)}`,
          body: "Geef met één klik door hoe ver je bent, zodat Team Shortclips weet hoe het ervoor staat.",
          href: "/dashboard#statuscheck",
          entityType: "deliverable",
          entityId: v.id,
          dedupeKey: `editor_status_check:${created.id}`,
        });
      }
    }
    ctx.log(`${ctx.counters.created} statuschecks klaargezet (${ctx.counters.processed} video's bij editors bekeken).`);
  });
}

/* ------------------------------------------------------------------ *
 * 2. Editorkant: openstaande checks + antwoorden
 * ------------------------------------------------------------------ */

export type OpenStatusCheck = {
  id: string;
  deliverableId: string;
  projectName: string;
  editorDueOn: string | null;
  kind: "halfway" | "pre_deadline";
};

/** Openstaande checks van deze editor, één per project (de nieuwste). Projecten
 *  die inmiddels niet meer bij de editor liggen vallen automatisch weg. */
export async function listOpenStatusChecks(editorId: string): Promise<OpenStatusCheck[]> {
  const holidays = nlHolidaySet();
  const open = await db
    .select()
    .from(editorStatusChecks)
    .where(and(eq(editorStatusChecks.editorId, editorId), isNull(editorStatusChecks.respondedAt)))
    .orderBy(desc(editorStatusChecks.sentAt));
  if (!open.length) return [];
  const videos = await videosAtEditor({ editorId, ids: [...new Set(open.map((c) => c.deliverableId))] });
  const byId = new Map(videos.map((v) => [v.id, v]));
  const seen = new Set<string>();
  const out: OpenStatusCheck[] = [];
  for (const c of open) {
    const v = byId.get(c.deliverableId);
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({
      id: c.id,
      deliverableId: v.id,
      projectName: projectLabel(v.clientName, v.title),
      // Altijd de actuele editor deadline tonen (kan na versturen verschoven zijn).
      editorDueOn: editorDeadline(v.status, v.planShootOn ?? v.shootOn, v.dueOn, holidays) ?? c.editorDueOn,
      kind: c.kind === "pre_deadline" ? "pre_deadline" : "halfway",
    });
  }
  return out.sort((a, b) => (a.editorDueOn ?? "9999").localeCompare(b.editorDueOn ?? "9999"));
}

/**
 * Antwoord van de editor opslaan. Geldt voor alle openstaande checks van dit
 * project (bijv. een onbeantwoorde halverwege-check én de check vlak voor de
 * deadline). Alleen de editor zelf mag antwoorden.
 */
export async function answerStatusCheck(
  editorId: string,
  checkId: string,
  status: EditorProgressStatus,
  note: string | null,
): Promise<{ ok: true; checkIds: string[] } | { ok: false; message: string }> {
  const [check] = await db.select().from(editorStatusChecks).where(eq(editorStatusChecks.id, checkId)).limit(1);
  if (!check || check.editorId !== editorId) return { ok: false, message: "Deze statuscheck is niet voor jou." };
  const now = new Date();
  const updated = await db
    .update(editorStatusChecks)
    .set({ status, note: note?.trim().slice(0, 500) || null, respondedAt: now, updatedAt: now })
    .where(and(
      eq(editorStatusChecks.deliverableId, check.deliverableId),
      eq(editorStatusChecks.editorId, editorId),
      isNull(editorStatusChecks.respondedAt),
    ))
    .returning({ id: editorStatusChecks.id });
  // Al eerder beantwoord (bijv. dubbel geklikt of op een tweede apparaat): het
  // laatste antwoord wint, zodat de editor zijn status ook kan bijwerken.
  if (!updated.length) {
    await db
      .update(editorStatusChecks)
      .set({ status, note: note?.trim().slice(0, 500) || null, respondedAt: now, updatedAt: now })
      .where(eq(editorStatusChecks.id, checkId));
  }
  return { ok: true, checkIds: [...new Set([checkId, ...updated.map((u) => u.id)])] };
}

/* ------------------------------------------------------------------ *
 * 3. Teamkant: voortgang per project + aandachtspunten
 * ------------------------------------------------------------------ */

export type EditorProgress = ProgressView & {
  /** "2 uur geleden", of null als er nog niets is. */
  updatedAgo: string | null;
  updatedAt: string | null;
  note: string | null;
};

/** Laatste stand per video voor de kolom Voortgang. Alleen voor video's die nu
 *  bij de editor liggen; daarna is de check niet meer relevant. */
export async function getEditorProgress(
  videos: { id: string; status: string; editorId: string | null; editorDueOn: string | null }[],
): Promise<Map<string, EditorProgress>> {
  const out = new Map<string, EditorProgress>();
  const relevant = videos.filter((v) => v.editorId && (ACTIVE_AT_EDITOR as readonly string[]).includes(v.status));
  if (!relevant.length) return out;
  const holidays = nlHolidaySet();
  const now = new Date();
  const checks = await checksByDeliverable(relevant.map((v) => v.id));
  for (const v of relevant) {
    const list = (checks.get(v.id) ?? []).filter((c) => c.editorId === v.editorId);
    // Een nieuwere, nog onbeantwoorde check gaat voor een ouder antwoord.
    const latest = list[0] ?? null;
    const answered = lastAnswered(list);
    const show = latest && !latest.respondedAt && (!answered || latest.sentAt > answered.respondedAt!) ? latest : (answered ?? latest);
    const view = progressView(
      show ? { status: isEditorProgressStatus(show.status) ? show.status : null, sentAt: show.sentAt, respondedAt: show.respondedAt } : null,
      now,
      v.editorDueOn,
      holidays,
    );
    const at = show ? (show.respondedAt ?? show.sentAt) : null;
    out.set(v.id, {
      ...view,
      updatedAt: show?.respondedAt?.toISOString() ?? null,
      updatedAgo: show?.respondedAt ? updatedAgo(show.respondedAt, now) : at ? `gevraagd ${updatedAgo(at, now)}` : null,
      note: show?.note ?? null,
    });
  }
  return out;
}

export type EditorStatusSignal = {
  deliverableId: string;
  clientName: string;
  title: string;
  editorName: string | null;
  kind: "geen_reactie" | "risico";
  editorDueOn: string | null;
  note: string | null;
};

/** Voor Aandachtspunten: geen reactie na één werkdag, of nog niet begonnen terwijl
 *  de editor deadline dichtbij is. */
export async function getEditorStatusSignals(clientScope: (clientId: string) => boolean): Promise<EditorStatusSignal[]> {
  const holidays = nlHolidaySet();
  const videos = (await videosAtEditor()).filter((v) => isActiveClientStatus(v.clientStatus) && clientScope(v.clientId));
  const withDue = videos.map((v) => ({
    ...v,
    editorDueOn: editorDeadline(v.status, v.planShootOn ?? v.shootOn, v.dueOn, holidays),
  }));
  const progress = await getEditorProgress(withDue);
  const editorIds = [...new Set(withDue.map((v) => v.editorId!).filter(Boolean))];
  const names = editorIds.length
    ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, editorIds))
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.fullName]));
  const out: EditorStatusSignal[] = [];
  for (const v of withDue) {
    const p = progress.get(v.id);
    if (!p || (p.key !== "geen_reactie" && p.key !== "risico")) continue;
    out.push({
      deliverableId: v.id,
      clientName: v.clientName,
      title: v.title,
      editorName: v.editorId ? (nameById.get(v.editorId) ?? null) : null,
      kind: p.key,
      editorDueOn: v.editorDueOn,
      note: p.note,
    });
  }
  return out;
}
