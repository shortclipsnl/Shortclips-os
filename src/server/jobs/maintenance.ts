import "server-only";
import { and, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  contentCalendar,
  contracts,
  deliverables,
  invoices,
  productionDays,
  scripts,
  tasks,
  users,
} from "@/db/schema";
import { dispatch } from "@/server/automation";
import { notify } from "@/server/notifications";
import { getVrijdagcheck } from "@/server/vrijdagcheck";
import { CORE_STAFF_EMAILS } from "@/server/core-staff";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { internalDeadline, isFirstVersionPending } from "@/lib/edit-deadline";
import { getDeadlineSettings } from "@/server/deadline-settings";
import { deadlineMisses } from "@/db/schema";
import { runJob } from "./runner";

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/**
 * De dagelijkse en uurlijkse signaleringen. Deze taken zoeken situaties op die
 * aandacht vragen en laten de automation engine de bijbehorende acties doen.
 * Zo staan de regels op één plek in plaats van verspreid door de code.
 */
export async function runDailySignals() {
  return runJob("monday", "signals.daily", {}, async (ctx) => {
    const settings = await getDeadlineSettings();
    // 1. Contracten die binnen 60 dagen aflopen
    const expiring = await db
      .select({
        id: contracts.id,
        clientId: contracts.clientId,
        endsOn: contracts.endsOn,
        clientName: clients.name,
        coordinatorId: clients.coordinatorId,
        slug: clients.slug,
      })
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .where(
        and(
          eq(contracts.status, "active"),
          isNull(contracts.deletedAt),
          lte(contracts.endsOn, day(60)),
          gte(contracts.endsOn, day(0)),
        ),
      );

    for (const contract of expiring) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: contract.clientId,
        entityType: "contract",
        entityId: contract.id,
        data: {
          contractEndsInDays: 60,
          // Periode = de einddatum zelf: verlengt het contract (nieuwe einddatum),
          // dan hoort daar een nieuwe sleutel (en taak) bij.
          periodKey: contract.endsOn,
          title: `Contract ${contract.clientName} loopt af op ${contract.endsOn}`,
          coordinatorId: contract.coordinatorId,
          href: `/clients/${contract.slug}?tab=contract`,
        },
      });
    }
    ctx.log(`${expiring.length} aflopende contracten gesignaleerd`);

    // 1b. Contract-aftelling op vaste mijlpalen (45 / 7 / 0 dagen voor einde).
    const tierByDate = new Map<string, number>([
      [day(45), 45],
      [day(28), 28],
      [day(7), 7],
      [day(0), 0],
    ]);
    const tierContracts = await db
      .select({
        id: contracts.id,
        clientId: contracts.clientId,
        endsOn: contracts.endsOn,
        clientName: clients.name,
        coordinatorId: clients.coordinatorId,
        slug: clients.slug,
      })
      .from(contracts)
      .innerJoin(clients, eq(clients.id, contracts.clientId))
      .where(
        and(
          eq(contracts.status, "active"),
          isNull(contracts.deletedAt),
          inArray(contracts.endsOn, [day(45), day(28), day(7), day(0)]),
        ),
      );

    for (const contract of tierContracts) {
      const tier = tierByDate.get(contract.endsOn ?? "");
      if (tier === undefined) continue;
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: contract.clientId,
        entityType: "contract",
        entityId: contract.id,
        data: {
          contractDaysLeft: tier,
          dedupe: `contract-${tier}`,
          title:
            tier === 0
              ? `Contract ${contract.clientName} verloopt vandaag`
              : `Contract ${contract.clientName} loopt over ${tier} dagen af`,
          coordinatorId: contract.coordinatorId,
          href: `/clients/${contract.slug}?tab=contract`,
        },
      });
    }
    ctx.log(`${tierContracts.length} contracten op een mijlpaal (45/28/7/0 dagen)`);

    // 2. Video's die te lang op klantfeedback wachten (instelbare termijn, default 3 dagen)
    const clientFeedbackDays = settings["deadline.clientFeedbackDays"];
    const stale = await db
      .select({
        id: deliverables.id,
        clientId: deliverables.clientId,
        title: deliverables.title,
        coordinatorId: clients.coordinatorId,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, ["client_review", "client_revision"]),
          lt(deliverables.statusChangedAt, sql`now() - (${clientFeedbackDays} * interval '1 day')`),
        ),
      );

    for (const video of stale) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: video.clientId,
        entityType: "deliverable",
        entityId: video.id,
        data: {
          // Stabiele marker voor de regels; de exacte termijn is instelbaar.
          awaitingClientStale: true,
          awaitingClientDays: clientFeedbackDays,
          // Dag-gebaseerde sleutel voor de klantmelding: elke dag dat het blijft
          // openstaan krijgt de klant opnieuw een herinnering (stopt zodra hij
          // reageert). `to` stuurt de notify-dedup; de opvolgtaak van de
          // coördinator blijft eenmalig (die leest `to` niet).
          to: day(0),
          title: video.title,
          coordinatorId: video.coordinatorId,
          href: `/videos/${video.id}`,
        },
      });
    }
    ctx.log(`${stale.length} video's wachten te lang op de klant (>${clientFeedbackDays}d)`);

    // 2b. Scripts die te lang op klantcontrole wachten (instelbare termijn, default 3 dagen)
    const scriptFeedbackDays = settings["deadline.scriptFeedbackDays"];
    const staleScripts = await db
      .select({
        id: scripts.id,
        clientId: scripts.clientId,
        title: scripts.title,
        coordinatorId: clients.coordinatorId,
      })
      .from(scripts)
      .innerJoin(clients, eq(clients.id, scripts.clientId))
      .where(
        and(
          isNull(scripts.deletedAt),
          eq(scripts.status, "client_review"),
          lt(scripts.updatedAt, sql`now() - (${scriptFeedbackDays} * interval '1 day')`),
        ),
      );

    for (const script of staleScripts) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: script.clientId,
        entityType: "script",
        entityId: script.id,
        data: {
          awaitingClientScriptStale: true,
          awaitingClientScriptDays: scriptFeedbackDays,
          // Dag-gebaseerde klantmelding (zie toelichting bij de video-variant).
          to: day(0),
          title: `Script wacht op klant: ${script.title}`,
          coordinatorId: script.coordinatorId,
          href: `/scripts/${script.id}`,
        },
      });
    }
    ctx.log(`${staleScripts.length} scripts wachten te lang op de klant (>${scriptFeedbackDays}d)`);

    // 3. Vervallen facturen
    const overdue = await db
      .select({ id: invoices.id, clientId: invoices.clientId, number: invoices.number })
      .from(invoices)
      .where(
        and(
          isNull(invoices.deletedAt),
          inArray(invoices.status, ["sent", "partially_paid"]),
          lt(invoices.dueOn, day(0)),
        ),
      );

    for (const invoice of overdue) {
      ctx.counters.processed++;
      await db.update(invoices).set({ status: "overdue" }).where(eq(invoices.id, invoice.id));
      await dispatch({
        trigger: "schedule.daily",
        clientId: invoice.clientId,
        entityType: "invoice",
        entityId: invoice.id,
        data: { invoiceOverdue: true, title: `Factuur ${invoice.number} is vervallen` },
      });
    }
    ctx.log(`${overdue.length} vervallen facturen`);

    // 4. Publicaties die morgen live moeten maar nog niet klaar zijn
    const tomorrow = await db
      .select({
        id: contentCalendar.id,
        clientId: contentCalendar.clientId,
        title: contentCalendar.title,
        status: contentCalendar.status,
      })
      .from(contentCalendar)
      .where(
        and(
          isNull(contentCalendar.deletedAt),
          eq(contentCalendar.scheduledOn, day(1)),
          inArray(contentCalendar.status, ["to_prepare", "ready"]),
        ),
      );

    for (const item of tomorrow) {
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: item.clientId,
        entityType: "calendar_item",
        entityId: item.id,
        data: {
          publishInDays: 1,
          statusNot: ["scheduled", "published"],
          title: `Morgen publiceren: ${item.title}`,
          href: "/calendar",
        },
      });
    }
    ctx.log(`${tomorrow.length} publicaties morgen`);

    // 5. Opnames over 7 of 2 dagen zonder videograaf (Monday: "Wie gaat filmen?").
    const shootTier = new Map<string, number>([
      [day(7), 7],
      [day(2), 2],
    ]);
    const shootsNoFilmer = await db
      .select({
        id: productionDays.id,
        clientId: productionDays.clientId,
        scheduledOn: productionDays.scheduledOn,
        title: productionDays.title,
        coordinatorId: productionDays.coordinatorId,
      })
      .from(productionDays)
      .where(
        and(
          isNull(productionDays.deletedAt),
          isNull(productionDays.videographerId),
          inArray(productionDays.scheduledOn, [day(7), day(2)]),
          inArray(productionDays.status, ["planned", "confirmed"]),
        ),
      );

    for (const shoot of shootsNoFilmer) {
      const tier = shootTier.get(shoot.scheduledOn ?? "");
      if (tier === undefined) continue;
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.daily",
        clientId: shoot.clientId,
        entityType: "production_day",
        entityId: shoot.id,
        data: {
          videographerMissing: true,
          shootDaysLeft: tier,
          dedupe: `shoot-nofilmer-${tier}`,
          title: `Opname over ${tier} dagen zonder videograaf: ${shoot.title}`,
          coordinatorId: shoot.coordinatorId,
          href: `/productions/${shoot.id}`,
        },
      });
    }
    ctx.log(`${shootsNoFilmer.length} opnames zonder videograaf (7/2 dagen)`);
  });
}

/** Uurlijkse controle op opnames die binnen 48 uur niet rond zijn. */
export async function runHourlySignals() {
  return runJob("monday", "signals.hourly", {}, async (ctx) => {
    const soon = await db
      .select({
        id: productionDays.id,
        clientId: productionDays.clientId,
        title: productionDays.title,
        clientName: clients.name,
        coordinatorId: clients.coordinatorId,
        openBlockers: sql<number>`(
          select count(*) from production_checklist_items ci
          where ci.production_day_id = production_days.id and ci.is_blocking = true and ci.is_done = false
        )`,
        unapproved: sql<number>`(
          select count(*) from scripts sc
          where sc.production_day_id = production_days.id and sc.deleted_at is null
            and sc.status not in ('approved','ready_to_shoot','shot')
        )`,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          gte(productionDays.scheduledOn, day(0)),
          lte(productionDays.scheduledOn, day(2)),
          inArray(productionDays.status, ["planned", "confirmed"]),
        ),
      );

    for (const shoot of soon) {
      const blockers = Number(shoot.openBlockers) + Number(shoot.unapproved);
      if (blockers === 0) continue;
      ctx.counters.processed++;
      await dispatch({
        trigger: "schedule.hourly",
        clientId: shoot.clientId,
        entityType: "production_day",
        entityId: shoot.id,
        data: {
          shootWithinHours: 48,
          scriptsApproved: false,
          title: `Opname ${shoot.clientName} is nog niet rond`,
          coordinatorId: shoot.coordinatorId,
          href: `/productions/${shoot.id}`,
        },
      });
    }
    ctx.log(`${ctx.counters.processed} opnames met openstaande punten`);
  });
}

/**
 * Dagelijkse deadline-herinnering per editor: één melding met het aantal video's
 * dat te laat is of waarvan de deadline binnen 2 dagen valt. In-app, dus geen
 * externe sleutel nodig. Dedupe per dag, zodat niemand dubbele meldingen krijgt.
 */
export async function runEditorDeadlineReminders() {
  return runJob("monday", "reminders.editor_deadlines", {}, async (ctx) => {
    const settings = await getDeadlineSettings();
    const today = day(0);
    const soon = day(settings["deadline.editorSoonDays"]);
    const holidays = nlHolidaySet();
    // Alleen de eerste-versie-fases: hiervoor geldt de INTERNE deadline (opname +
    // 7 werkdagen). Daarna is de eerste versie al opgeleverd.
    const firstVersionStages = ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"] as const;

    const rows = await db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        shootOn: deliverables.shootOn,
        dueOn: deliverables.dueOn,
        editorId: deliverables.editorId,
        clientName: clients.name,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          inArray(deliverables.status, [...firstVersionStages]),
          sql`${deliverables.editorId} is not null`,
        ),
      );

    // Per editor groeperen op basis van de interne deadline (in JS berekend; het
    // werkdagen-rekenwerk kan niet in SQL).
    type Proj = { id: string; label: string };
    const byEditor = new Map<string, { overdue: Proj[]; soon: Proj[] }>();
    for (const r of rows) {
      if (!r.editorId || !isFirstVersionPending(r.status)) continue;
      const internal = internalDeadline(r.shootOn, r.dueOn, holidays);
      if (!internal) continue;
      const g = byEditor.get(r.editorId) ?? { overdue: [], soon: [] };
      const proj: Proj = { id: r.id, label: `${r.clientName} — ${r.title}` };
      if (internal < today) g.overdue.push(proj);
      else if (internal <= soon) g.soon.push(proj);
      byEditor.set(r.editorId, g);
    }

    for (const [editorId, g] of byEditor) {
      const total = g.overdue.length + g.soon.length;
      if (total === 0) continue;
      ctx.counters.processed++;
      const parts: string[] = [];
      if (g.overdue.length > 0) parts.push(`${g.overdue.length} over de interne deadline`);
      if (g.soon.length > 0) parts.push(`${g.soon.length} met interne deadline binnen ${settings["deadline.editorSoonDays"]} dagen`);
      const projects = [...g.overdue, ...g.soon];
      const namen = projects.slice(0, 4).map((p) => p.label).join(" · ") + (projects.length > 4 ? ` · +${projects.length - 4} meer` : "");
      // Eén project → direct doorklikbaar; meerdere → naar het eigen editingbord.
      const href = total === 1 ? `/videos/${projects[0]!.id}` : "/videos";
      await notify({
        userIds: [editorId],
        type: "editor_deadlines",
        level: g.overdue.length > 0 ? "warning" : "info",
        title: g.overdue.length > 0 ? "Eerste versie over de interne deadline" : "Interne deadline komt eraan",
        body: `${parts.join(" · ")}: ${namen}. Pak deze met voorrang op.`,
        href,
        dedupeKey: `editor_deadlines:${editorId}:${today}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} editors een deadline-herinnering gestuurd`);
  });
}

/**
 * Dagelijkse taak-herinnering per teamlid: één melding met het aantal taken dat
 * te laat is of met een deadline binnen 2 dagen. In-app, dedupe per dag.
 */
export async function runTaskDeadlineReminders() {
  return runJob("monday", "reminders.task_deadlines", {}, async (ctx) => {
    const settings = await getDeadlineSettings();
    const today = day(0);
    const soon = day(settings["deadline.taskSoonDays"]);
    const rows = await db
      .select({
        assigneeId: tasks.assigneeId,
        overdue: sql<number>`count(*) filter (where ${tasks.dueOn} < ${today})`,
        dueSoon: sql<number>`count(*) filter (where ${tasks.dueOn} >= ${today} and ${tasks.dueOn} <= ${soon})`,
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          inArray(tasks.status, ["todo", "in_progress", "blocked"]),
          lte(tasks.dueOn, soon),
        ),
      )
      .groupBy(tasks.assigneeId);

    for (const r of rows) {
      if (!r.assigneeId) continue;
      const overdue = Number(r.overdue);
      const dueSoon = Number(r.dueSoon);
      if (overdue + dueSoon === 0) continue;
      ctx.counters.processed++;
      const parts: string[] = [];
      if (overdue > 0) parts.push(`${overdue} te laat`);
      if (dueSoon > 0) parts.push(`${dueSoon} binnen ${settings["deadline.taskSoonDays"]} dagen`);
      await notify({
        userIds: [r.assigneeId],
        type: "task_deadlines",
        level: overdue > 0 ? "warning" : "info",
        title: overdue > 0 ? "Je hebt taken over de deadline" : "Taken met een deadline",
        body: `${parts.join(" · ")}.`,
        href: "/tasks",
        dedupeKey: `task_deadlines:${r.assigneeId}:${today}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} teamleden een taak-herinnering gestuurd`);
  });
}

/**
 * Dagelijkse 13:30-reminder voor het kantoorteam (Jarno, Milou, Jiska, Rutger):
 * één melding die herinnert om de to-do's van vandaag af te ronden en om de
 * editors + de op te sturen projecten te checken. Draait via twee cron-slots
 * (11:30 en 12:30 UTC) voor zomer-/wintertijd; de tijdcheck (alleen in het
 * 13:xx-uur Amsterdam) + dedupe zorgen dat elk teamlid max. één keer per dag
 * rond 13:30 lokaal een reminder krijgt.
 */
export async function runDailyTeamTodoReminder() {
  return runJob("monday", "reminders.daily_todo", {}, async (ctx) => {
    const hhmm = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Amsterdam",
    });
    const hour = Number(hhmm.slice(0, 2));
    if (hour !== 13) {
      ctx.log(`Lokale tijd is ${hhmm} (Amsterdam), niet 13:xx — reminder overgeslagen.`);
      return;
    }

    const today = day(0);
    const team = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.status, "active"),
          inArray(sql`lower(${users.email})`, [...CORE_STAFF_EMAILS]),
        ),
      );

    for (const member of team) {
      ctx.counters.processed++;
      await notify({
        userIds: [member.id],
        type: "daily_todo_reminder",
        level: "info",
        title: "Reminder: rond je to-do's van vandaag af",
        body: "Kijk goed wat je vandaag écht moet afmaken en rond het af. Check ook de editors en welke projecten opgestuurd kunnen worden.",
        href: "/dashboard",
        dedupeKey: `daily_todo_reminder:${member.id}:${today}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} teamleden een dagelijkse to-do-reminder gestuurd`);
  });
}

/**
 * Vrijdagherinnering voor editors: op vrijdagochtend (09:00 Amsterdam) een
 * melding om vóór 13:00 af te ronden wat nog deze week de deur uit kan — zodat
 * het team het vóór het weekend naar de klant kan sturen (buiten werktijd
 * sturen we niets richting klanten). Eén melding per editor per vrijdag.
 * De cron draait op twee UTC-tijden; de lokale-uur-check laat er precies één
 * om 09:xx Amsterdam doorkomen (zomer- én wintertijd).
 */
export async function runEditorFridayWrapUp() {
  return runJob("monday", "reminders.editor_friday_wrapup", {}, async (ctx) => {
    const now = new Date();
    const weekday = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Amsterdam" });
    const hhmm = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" });
    const hour = Number(hhmm.slice(0, 2));
    if (weekday !== "Fri" || hour !== 9) {
      ctx.log(`Lokaal ${weekday} ${hhmm} (Amsterdam) — niet vrijdag 09:xx, overgeslagen.`);
      return;
    }

    const editors = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.status, "active"), eq(users.primaryRole, "editor")));

    const fri = day(0);
    for (const e of editors) {
      ctx.counters.processed++;
      await notify({
        userIds: [e.id],
        type: "editor_friday_wrapup",
        level: "warning",
        title: "Vrijdag: rond vóór 13:00 af wat nog deze week de deur uit kan",
        body: "Maak de video's en taken die nog deze week opgeleverd kunnen worden vóór 13:00 af, zodat we ze nog vóór het weekend naar de klant kunnen sturen. Buiten werktijd sturen we niets richting klanten.",
        href: "/dashboard",
        dedupeKey: `editor_friday_wrapup:${e.id}:${fri}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} editors een vrijdag-afrondherinnering gestuurd`);
  });
}

/**
 * Vrijdagherinnering schoonmaak voor Milou & Jiska (de projectcoördinatoren op
 * kantoor): op vrijdag 15:00 Amsterdam één wegklikbare melding om de keuken voor
 * het weekend netjes achter te laten. Alleen voor deze twee. De cron draait op
 * twee UTC-tijden; de lokale-uur-check laat er precies één om 15:xx Amsterdam
 * doorkomen (zomer- én wintertijd). Dedupe = één melding per persoon per vrijdag.
 */
export async function runCleaningFridayReminder() {
  return runJob("monday", "reminders.cleaning_friday", {}, async (ctx) => {
    const now = new Date();
    const weekday = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Amsterdam" });
    const hhmm = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" });
    const hour = Number(hhmm.slice(0, 2));
    if (weekday !== "Fri" || hour !== 15) {
      ctx.log(`Lokaal ${weekday} ${hhmm} (Amsterdam) — niet vrijdag 15:xx, overgeslagen.`);
      return;
    }

    // Milou en Jiska op e-mail (Jiska is geen projectcoördinator maar hoort er wel bij).
    const coords = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.status, "active"), inArray(sql`lower(${users.email})`, ["milou@shortclips.nl", "jiska@shortclips.nl"])));

    const fri = day(0);
    for (const c of coords) {
      ctx.counters.processed++;
      await notify({
        userIds: [c.id],
        type: "cleaning_friday_reminder",
        level: "info",
        title: "Vrijdag: keuken netjes voor het weekend",
        body: "Even voor het weekend: zijn de koffiezetapparaten schoongemaakt, is de keuken netjes en staat de vaatwasser aan? Dan is alles fris als we maandag terugkomen.",
        href: "/dashboard",
        dedupeKey: `cleaning_friday_reminder:${c.id}:${fri}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} coördinatoren een vrijdag-schoonmaakherinnering gestuurd`);
  });
}

/**
 * Vrijdagcheck als melding (vervangt de losse pagina): controleert of volgende
 * week rond staat en stuurt de uitkomst als één melding naar de coördinator(en)
 * en content creative. Eén melding per week (dedupe). Bedoeld voor een cron op
 * vrijdag; handmatig triggeren mag op elke dag.
 */
export async function runVrijdagcheckNotification() {
  const { weekLabel, checks, okCount } = await getVrijdagcheck();
  const open = checks.filter((c) => !c.ok);
  // Eigenaar erbij: Jarno wil de vrijdagcheck zelf ook als melding ontvangen.
  const roles = ["owner", "project_coordinator", "content_creator"];
  const dedupeKey = `vrijdagcheck:${mondayIso()}`;

  if (open.length === 0) {
    const sent = await notify({
      roles,
      type: "vrijdagcheck",
      level: "success",
      title: `Vrijdagcheck: alles staat klaar voor volgende week (${weekLabel})`,
      body: `Alle ${checks.length} punten zijn op orde. Fijn weekend!`,
      href: "/dashboard",
      dedupeKey,
    });
    return { week: weekLabel, okCount, open: 0, sent };
  }

  const lines = open.map((c) => `• ${c.label}: ${c.summary}`).join("\n");
  const sent = await notify({
    roles,
    type: "vrijdagcheck",
    level: "warning",
    title: `Vrijdagcheck: ${okCount}/${checks.length} op orde — ${open.length} punt(en) nog regelen (${weekLabel})`,
    body: `Voor volgende week vragen deze punten nog aandacht:\n${lines}`,
    // Eén melding kan maar één link hebben; spring naar het eerste open punt.
    href: open[0]?.href ?? "/dashboard",
    dedupeKey,
  });
  return { week: weekLabel, okCount, open: open.length, sent };
}

/**
 * Maandelijkse herinnering aan de eigenaar (Jarno) om de kosten/boekhouding van
 * de maand toe te voegen, zodat het financieel overzicht actueel blijft. Eén
 * melding per maand (dedupe). Bedoeld voor een cron tegen het einde van de maand.
 */
export async function runFinanceMonthReminder() {
  const period = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7); // YYYY-MM
  const sent = await notify({
    roles: ["owner"],
    type: "finance_month_reminder",
    level: "info",
    title: "Voeg de kosten van deze maand toe aan Financiën",
    body: "Upload de DigiBoox-/boekhoudexport en vul de maandkosten in, zodat het financieel overzicht actueel blijft.",
    href: "/financien",
    dedupeKey: `finance_month_reminder:${period}`,
  });
  return { period, sent };
}

/** Maandag van de huidige week (voor wekelijkse dedupe). */
function mondayIso(): string {
  const d = new Date();
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
}

/**
 * Signaleert actieve klanten zonder geplande volgende opname (Deel 2.1). Slaat
 * bewust gepauzeerde klanten en klanten met voldoende contentvoorraad over, en
 * stuurt de verantwoordelijke coördinator één melding per week (dedupe).
 */
export async function runClientsWithoutShootSignal() {
  return runJob("monday", "signals.clients_without_shoot", {}, async (ctx) => {
    const week = mondayIso();
    const res = await db.execute(sql`
      select c.id, c.name, c.slug, c.coordinator_id,
        coalesce(c.monthly_video_quota, 0)::int quota,
        (select max(pd.scheduled_on) from production_days pd where pd.client_id = c.id and pd.deleted_at is null) last_shoot,
        (select count(*) from deliverables d where d.client_id = c.id and d.deleted_at is null
           and d.status in ('approved','ready_to_publish','scheduled'))::int voorraad
      from clients c
      where c.deleted_at is null and c.status = 'active'
        and not exists (
          select 1 from production_days pd
          where pd.client_id = c.id and pd.deleted_at is null
            and pd.status <> 'cancelled' and pd.scheduled_on >= current_date
        )`);
    const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{
      id: string; name: string; slug: string; coordinator_id: string | null; quota: number; last_shoot: string | null; voorraad: number;
    }>;

    // Per coördinator bundelen: één melding met alle klanten zonder opname,
    // i.p.v. een stortvloed van (bijna) identieke losse meldingen.
    const byCoord = new Map<string, string[]>();
    for (const c of rows) {
      ctx.counters.processed++;
      // Voldoende voorraad (minstens één maand publicaties klaar) → geen waarschuwing.
      if (c.voorraad >= Math.max(c.quota, 1)) continue;
      if (!c.coordinator_id) continue; // zonder verantwoordelijke geen gerichte melding
      const list = byCoord.get(c.coordinator_id) ?? [];
      list.push(c.name);
      byCoord.set(c.coordinator_id, list);
    }
    for (const [coordId, names] of byCoord) {
      await notify({
        userIds: [coordId],
        type: "client_without_shoot",
        level: "warning",
        title: names.length === 1 ? `${names[0]} heeft geen volgende opname gepland` : `${names.length} klanten zonder geplande opname`,
        body: names.length === 1 ? "Plan een opnamedag in." : `${names.join(", ")} → plan opnamedagen in.`,
        href: "/productions",
        dedupeKey: `client_without_shoot:${coordId}:${week}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} gebundelde meldingen voor klanten zonder opname`);
  });
}

/**
 * Signaleert een gat in de contentplanning: actieve klanten zonder enige geplande
 * publicatie in de komende 10 werkdagen. De verantwoordelijke coördinator krijgt
 * één gebundelde melding per week (dedupe), zodat het team scherp blijft op
 * klanten die dreigen stil te vallen.
 */
export async function runContentGapSignal() {
  return runJob("monday", "signals.content_gap", {}, async (ctx) => {
    const week = mondayIso();
    const today = day(0);
    const until = addWorkingDays(today, 10); // ~10 werkdagen vooruit
    const res = await db.execute(sql`
      select c.id, c.name, c.slug, c.coordinator_id
      from clients c
      where c.deleted_at is null and c.status = 'active'
        and not exists (
          select 1 from content_calendar cc
          where cc.client_id = c.id and cc.deleted_at is null
            and cc.status <> 'failed'
            and cc.scheduled_on >= ${today} and cc.scheduled_on <= ${until}
        )`);
    const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{
      id: string; name: string; slug: string; coordinator_id: string | null;
    }>;

    // Per coördinator bundelen: één melding met alle klanten met een planningsgat.
    const byCoord = new Map<string, string[]>();
    for (const c of rows) {
      ctx.counters.processed++;
      if (!c.coordinator_id) continue;
      const list = byCoord.get(c.coordinator_id) ?? [];
      list.push(c.name);
      byCoord.set(c.coordinator_id, list);
    }
    for (const [coordId, names] of byCoord) {
      await notify({
        userIds: [coordId],
        type: "content_gap",
        level: "warning",
        title: names.length === 1 ? `Gat in de planning: ${names[0]}` : `${names.length} klanten met een gat in de planning`,
        body:
          names.length === 1
            ? "Geen publicatie gepland in de komende 10 werkdagen — plan content in."
            : `${names.join(", ")} hebben geen publicatie in de komende 10 werkdagen — plan content in.`,
        href: "/calendar",
        dedupeKey: `content_gap:${coordId}:${week}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} gebundelde meldingen voor gaten in de contentplanning`);
  });
}

/** Eerste-versie-fases (interne editor-deadline geldt). */
const FV_STAGES = ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"] as const;
/** Gesigneerd verschil in kalenderdagen (a − b) tussen twee YYYY-MM-DD-datums. */
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const toDateStr = (d: Date | string | null): string | null => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
};

/**
 * Escalatie bij editor-deadlines: staat een eerste versie een instelbaar aantal
 * dagen óver de interne deadline, dan wordt de coördinator ingeschakeld; staat
 * hij nóg langer open, dan ook de eigenaar. De editor krijgt zijn eigen
 * herinnering via runEditorDeadlineReminders; dit is de opvolging als er niets
 * gebeurt. Eén gebundelde melding per coördinator/eigenaar per dag (dedupe).
 */
export async function runEditorEscalations() {
  return runJob("monday", "escalations.editor_deadlines", {}, async (ctx) => {
    const settings = await getDeadlineSettings();
    const today = day(0);
    const holidays = nlHolidaySet();
    const coordDays = settings["deadline.escalateCoordinatorDays"];
    const ownerDays = settings["deadline.escalateOwnerDays"];

    const rows = await db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        shootOn: deliverables.shootOn,
        dueOn: deliverables.dueOn,
        editorId: deliverables.editorId,
        clientId: deliverables.clientId,
        clientName: clients.name,
        coordinatorId: clients.coordinatorId,
        editorName: users.fullName,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(users, eq(users.id, deliverables.editorId))
      .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, [...FV_STAGES]), sql`${deliverables.editorId} is not null`));

    type Item = { label: string; daysLate: number };
    const byCoord = new Map<string, Item[]>();
    const ownerItems: Item[] = [];

    for (const r of rows) {
      if (!isFirstVersionPending(r.status)) continue;
      const internal = internalDeadline(r.shootOn, r.dueOn, holidays);
      if (!internal) continue;
      const late = dayDiff(today, internal);
      if (late < Math.max(coordDays, 0)) continue;
      ctx.counters.processed++;
      const who = r.editorName ? `${r.editorName}: ` : "";
      const item: Item = { label: `${who}${r.clientName} — ${r.title} (${late}d te laat)`, daysLate: late };
      if (r.coordinatorId) {
        const list = byCoord.get(r.coordinatorId) ?? [];
        list.push(item);
        byCoord.set(r.coordinatorId, list);
      }
      if (late >= ownerDays) ownerItems.push(item);
    }

    for (const [coordId, items] of byCoord) {
      items.sort((a, b) => b.daysLate - a.daysLate);
      const names = items.slice(0, 4).map((i) => i.label).join(" · ") + (items.length > 4 ? ` · +${items.length - 4} meer` : "");
      await notify({
        userIds: [coordId],
        type: "editor_deadline_escalation",
        level: "warning",
        title: items.length === 1 ? "Editor-deadline te laat — pak dit op" : `${items.length} editor-deadlines te laat`,
        body: `Deze eerste versies staan over de interne deadline en vragen opvolging: ${names}.`,
        href: "/videos?filter=te-laat",
        dedupeKey: `editor_escalation_coord:${coordId}:${today}`,
      });
      ctx.counters.updated++;
    }

    if (ownerItems.length > 0) {
      ownerItems.sort((a, b) => b.daysLate - a.daysLate);
      const names = ownerItems.slice(0, 5).map((i) => i.label).join(" · ") + (ownerItems.length > 5 ? ` · +${ownerItems.length - 5} meer` : "");
      await notify({
        roles: ["owner"],
        type: "editor_deadline_escalation_owner",
        level: "critical",
        title: `${ownerItems.length} eerste versie(s) fors over de deadline (${ownerDays}+ dagen)`,
        body: `Vraagt jouw aandacht: ${names}.`,
        href: "/videos?filter=te-laat",
        dedupeKey: `editor_escalation_owner:${today}`,
      });
      ctx.counters.updated++;
    }
    ctx.log(`${byCoord.size} coördinator-escalaties, ${ownerItems.length > 0 ? 1 : 0} eigenaar-escalatie`);
  });
}

/**
 * Prestatieregistratie: legt gemiste deadlines vast in `deadline_misses`, zodat
 * je per editor/medewerker ziet hoe vaak en hoeveel dagen te laat. Draait
 * dagelijks. Idempotent: één rij per entiteit, `daysLate` loopt op zolang het
 * openstaat en wordt vastgezet zodra het is afgerond. Zo blijft de historie
 * bewaard, ook nadat de video/taak is afgerond en uit de actieve lijsten valt.
 */
export async function recordDeadlinePerformance() {
  return runJob("monday", "performance.record_deadlines", {}, async (ctx) => {
    const today = day(0);
    const holidays = nlHolidaySet();

    // Welke deliverable-/taak-missers staan nu nog open?
    const openDel = await db.select({ entityId: deadlineMisses.entityId }).from(deadlineMisses)
      .where(and(eq(deadlineMisses.entityType, "deliverable"), eq(deadlineMisses.resolved, false)));
    const openDelIds = new Set(openDel.map((r) => r.entityId));

    // 1) Deliverables die nu over de interne deadline staan (eerste versie) → vastleggen/bijwerken.
    const dels = await db
      .select({
        id: deliverables.id, status: deliverables.status, shootOn: deliverables.shootOn,
        dueOn: deliverables.dueOn, editorId: deliverables.editorId, clientId: deliverables.clientId, title: deliverables.title,
      })
      .from(deliverables)
      .where(and(isNull(deliverables.deletedAt), inArray(deliverables.status, [...FV_STAGES]), sql`${deliverables.editorId} is not null`));

    for (const d of dels) {
      const internal = internalDeadline(d.shootOn, d.dueOn, holidays);
      if (!internal || internal >= today) continue; // nog niet te laat
      const late = dayDiff(today, internal);
      ctx.counters.processed++;
      await db.insert(deadlineMisses).values({
        entityType: "deliverable", entityId: d.id, responsibleUserId: d.editorId, clientId: d.clientId,
        title: d.title, dueOn: internal, firstLateOn: today, resolved: false, daysLate: late,
      }).onConflictDoUpdate({
        target: [deadlineMisses.entityType, deadlineMisses.entityId],
        // firstLateOn blijft staan (niet in set); daysLate loopt op.
        set: { responsibleUserId: d.editorId, clientId: d.clientId, title: d.title, dueOn: internal, daysLate: late, updatedAt: new Date() },
      });
      openDelIds.delete(d.id);
    }

    // 2) Open deliverable-missers die nu NIET meer in de eerste-versie-fase staan → afronden (vastzetten).
    if (openDelIds.size > 0) {
      const done = await db
        .select({ id: deliverables.id, statusChangedAt: deliverables.statusChangedAt, status: deliverables.status })
        .from(deliverables)
        .where(and(inArray(deliverables.id, [...openDelIds])));
      for (const d of done) {
        if (isFirstVersionPending(d.status)) continue; // nog steeds pending; later afronden
        const [row] = await db.select({ dueOn: deadlineMisses.dueOn }).from(deadlineMisses)
          .where(and(eq(deadlineMisses.entityType, "deliverable"), eq(deadlineMisses.entityId, d.id))).limit(1);
        if (!row) continue;
        const resolvedRaw = toDateStr(d.statusChangedAt) ?? today;
        const resolvedOn = resolvedRaw < row.dueOn ? row.dueOn : resolvedRaw;
        await db.update(deadlineMisses)
          .set({ resolved: true, resolvedOn, daysLate: Math.max(0, dayDiff(resolvedOn, row.dueOn)), updatedAt: new Date() })
          .where(and(eq(deadlineMisses.entityType, "deliverable"), eq(deadlineMisses.entityId, d.id), eq(deadlineMisses.resolved, false)));
        ctx.counters.updated++;
      }
    }

    // 3) Taken die over hun deadline staan (open) → vastleggen/bijwerken.
    const openTask = await db.select({ entityId: deadlineMisses.entityId }).from(deadlineMisses)
      .where(and(eq(deadlineMisses.entityType, "task"), eq(deadlineMisses.resolved, false)));
    const openTaskIds = new Set(openTask.map((r) => r.entityId));

    const lateTasks = await db
      .select({ id: tasks.id, assigneeId: tasks.assigneeId, clientId: tasks.clientId, title: tasks.title, dueOn: tasks.dueOn })
      .from(tasks)
      .where(and(
        isNull(tasks.deletedAt),
        inArray(tasks.status, ["todo", "in_progress", "blocked"]),
        lt(tasks.dueOn, today),
        sql`${tasks.dueOn} is not null`,
        sql`${tasks.assigneeId} is not null`,
      ));
    for (const t of lateTasks) {
      if (!t.dueOn || !t.assigneeId) continue;
      const late = dayDiff(today, t.dueOn);
      ctx.counters.processed++;
      await db.insert(deadlineMisses).values({
        entityType: "task", entityId: t.id, responsibleUserId: t.assigneeId, clientId: t.clientId,
        title: t.title, dueOn: t.dueOn, firstLateOn: today, resolved: false, daysLate: late,
      }).onConflictDoUpdate({
        target: [deadlineMisses.entityType, deadlineMisses.entityId],
        set: { responsibleUserId: t.assigneeId, clientId: t.clientId, title: t.title, dueOn: t.dueOn, daysLate: late, updatedAt: new Date() },
      });
      openTaskIds.delete(t.id);
    }

    // 4) Open taak-missers die nu af (done) of weg zijn → afronden.
    if (openTaskIds.size > 0) {
      const taskRows = await db.select({ id: tasks.id, status: tasks.status, updatedAt: tasks.updatedAt, deletedAt: tasks.deletedAt })
        .from(tasks).where(inArray(tasks.id, [...openTaskIds]));
      const seen = new Set(taskRows.map((t) => t.id));
      for (const t of taskRows) {
        const isClosed = t.status === "done" || t.deletedAt != null;
        if (!isClosed) continue;
        const [row] = await db.select({ dueOn: deadlineMisses.dueOn }).from(deadlineMisses)
          .where(and(eq(deadlineMisses.entityType, "task"), eq(deadlineMisses.entityId, t.id))).limit(1);
        if (!row) continue;
        const resolvedRaw = toDateStr(t.updatedAt) ?? today;
        const resolvedOn = resolvedRaw < row.dueOn ? row.dueOn : resolvedRaw;
        await db.update(deadlineMisses)
          .set({ resolved: true, resolvedOn, daysLate: Math.max(0, dayDiff(resolvedOn, row.dueOn)), updatedAt: new Date() })
          .where(and(eq(deadlineMisses.entityType, "task"), eq(deadlineMisses.entityId, t.id), eq(deadlineMisses.resolved, false)));
        ctx.counters.updated++;
      }
      // Taken die helemaal verdwenen zijn (hard weg): laat de open misser staan zoals hij is.
      void seen;
    }

    ctx.log(`prestatie: ${ctx.counters.processed} lopend te laat, ${ctx.counters.updated} afgerond vastgezet`);
  });
}

/**
 * Zorgt voor precies één open automatische to-do per dedupe-sleutel (zelfde
 * patroon als de automation engine). Geeft true terug als er een nieuwe taak is
 * aangemaakt. Gebruikt voor de opname-herinneringen hieronder.
 */
async function ensureTask(input: {
  clientId: string | null;
  title: string;
  assigneeId: string | null;
  dueOn: string | null;
  priority?: "normal" | "high" | "urgent";
  entityType: string;
  entityId: string;
  dedupeKey: string;
}): Promise<boolean> {
  const existing = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.dedupeKey, input.dedupeKey), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`))
    .limit(1);
  if (existing[0]) return false;
  const [row] = await db
    .insert(tasks)
    .values({
      clientId: input.clientId,
      title: input.title,
      assigneeId: input.assigneeId,
      dueOn: input.dueOn,
      priority: input.priority ?? "normal",
      status: "todo",
      entityType: input.entityType,
      entityId: input.entityId,
      source: "automation",
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: tasks.id });
  return Boolean(row);
}

/**
 * Script-herinnering als to-do: zodra een opname binnen 7 dagen valt en de
 * scripting nog niet 'final' is, krijgt de verantwoordelijke coördinator een
 * to-do "script afronden/afstemmen". Eén open taak per opname (dedupe); verdwijnt
 * vanzelf zodra hij afgevinkt wordt.
 */
export async function runScriptTodoReminders() {
  return runJob("monday", "reminders.script_todo", {}, async (ctx) => {
    const today = day(0);
    const in7 = day(7);
    const rows = await db
      .select({
        id: productionDays.id,
        scheduledOn: productionDays.scheduledOn,
        clientId: productionDays.clientId,
        clientName: clients.name,
        coordA: productionDays.coordinatorId,
        coordB: clients.coordinatorId,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          ne(productionDays.status, "cancelled"),
          gte(productionDays.scheduledOn, today),
          lte(productionDays.scheduledOn, in7),
          ne(productionDays.scriptingStatus, "final"),
        ),
      );
    for (const r of rows) {
      ctx.counters.processed++;
      const created = await ensureTask({
        clientId: r.clientId,
        title: `Script afronden/afstemmen — ${r.clientName} (opname ${r.scheduledOn})`,
        assigneeId: r.coordA ?? r.coordB ?? null,
        dueOn: today,
        priority: "high",
        entityType: "production_day",
        entityId: r.id,
        dedupeKey: `script_todo:${r.id}`,
      });
      if (created) ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} script-to-do's aangemaakt`);
  });
}

/**
 * Na-opname-herinnering als to-do: voor opnames van de afgelopen 2 dagen krijgt
 * de verantwoordelijke coördinator een to-do "stuur de klant een berichtje over
 * de editing". Eén open taak per opname (dedupe).
 */
export async function runPostShootTodoReminders() {
  return runJob("monday", "reminders.post_shoot_todo", {}, async (ctx) => {
    const today = day(0);
    const from = day(-2);
    const rows = await db
      .select({
        id: productionDays.id,
        scheduledOn: productionDays.scheduledOn,
        clientId: productionDays.clientId,
        clientName: clients.name,
        coordA: productionDays.coordinatorId,
        coordB: clients.coordinatorId,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(
        and(
          isNull(productionDays.deletedAt),
          ne(productionDays.status, "cancelled"),
          gte(productionDays.scheduledOn, from),
          lte(productionDays.scheduledOn, today),
        ),
      );
    for (const r of rows) {
      ctx.counters.processed++;
      const created = await ensureTask({
        clientId: r.clientId,
        title: `Stuur ${r.clientName} een berichtje over de editing (opname ${r.scheduledOn})`,
        assigneeId: r.coordA ?? r.coordB ?? null,
        dueOn: today,
        priority: "normal",
        entityType: "production_day",
        entityId: r.id,
        dedupeKey: `postshoot_msg:${r.id}`,
      });
      if (created) ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated} na-opname-to-do's aangemaakt`);
  });
}
