import "server-only";
import { and, eq, inArray, isNull, like, notInArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { getRetentionOverview, retentionContext } from "@/server/client-retention";
import { notify } from "@/server/notifications";
import { nlHolidaySet } from "@/lib/holidays";
import { addWorkingDays, workingDaysBetween } from "@/lib/workdays";
import { escalationTarget, platformLabel, routeSignal } from "@/lib/client-retention";
import type { AttentionItem } from "@/server/attention";
import { runJob } from "./runner";

/**
 * Nachtelijk: zet de klantbehoud-signalen die een concrete taak vragen om in
 * taken voor de verantwoordelijke (op de bestaande takenpagina):
 *  - resultaten lopen terug → "resultaten analyseren", één per klant per maand;
 *  - contractmoment over 30 dagen → "contact opnemen", één per beslismoment.
 * Elke taak heeft een vaste dedupe-sleutel, dus er ontstaat nooit een dubbele.
 * Taken waarvan het signaal is verdwenen (contract verlengd/aangepast) worden
 * gearchiveerd, zodat de takenlijst schoon blijft. Er gaat geen melding uit:
 * de taak staat in de lijst en in het overzicht van de dag.
 */
export async function runRetentionTasks() {
  return runJob("system", "retention.tasks", {}, async (job) => {
    const ctx = await retentionContext();
    const list = await getRetentionOverview(ctx);
    const holidays = nlHolidaySet();
    const month = ctx.today.slice(0, 7);
    const keep: string[] = [];
    job.counters.processed = list.length;

    for (const c of list) {
      if (c.results.state === "daling") {
        const dedupeKey = `retentie_resultaten:${c.clientId}:${month}`;
        keep.push(dedupeKey);
        const lines = c.results.platforms.flatMap((p) => p.declined.map((m) => `- ${platformLabel(p.platform)}: ${m.label.toLowerCase()} ${m.prev.toLocaleString("nl-NL")} → ${m.cur.toLocaleString("nl-NL")} (${m.pct}%)`));
        const r = await db.insert(tasks).values({
          clientId: c.clientId, title: `${c.name}: resultaten analyseren en verbeteractie bepalen`.slice(0, 240),
          description: `${c.results.summary}\n\n${lines.join("\n")}\n\nBekijk de resultaten (/analytics/${c.slug}) en bepaal welke verbeteringen nodig zijn voor de volgende contentproductie. Leg de verbeteractie vast bij het aandachtspunt.\n\n(Automatisch uit de klantbehoud-signalering.)`,
          priority: "normal", category: "klantcontact", status: "todo",
          assigneeId: ctx.ownerFor(routeSignal("resultaten", c.coordinatorKey)), dueOn: addWorkingDays(ctx.today, 5, holidays),
          entityType: "retentie_resultaten", entityId: c.clientId, source: "automation", dedupeKey,
        }).onConflictDoNothing().returning({ id: tasks.id });
        if (r[0]) job.counters.created++;
      }

      const k = c.contract;
      if (k.contractId && k.decisionDate && (k.stage === 30 || k.stage === 14)) {
        const dedupeKey = `retentie_contract:${k.contractId}:${k.decisionDate}`;
        keep.push(dedupeKey);
        const label = k.decisionLabel === "opzegdeadline" ? "opzegdeadline" : "einddatum";
        const r = await db.insert(tasks).values({
          clientId: c.clientId, title: `${c.name}: contact opnemen over de samenwerking`.slice(0, 240),
          description: `De ${label} van het contract is ${k.decisionDate}. Neem contact op, evalueer de samenwerking en leg vast wat er is afgesproken.${k.verified ? "" : "\n\nLet op: de contractgegevens zijn nog niet gecontroleerd. Check ze eerst op de klantpagina (tab Klantbehoud)."}\n\n(Automatisch uit de klantbehoud-signalering.)`,
          priority: "high", category: "klantcontact", status: "todo",
          assigneeId: ctx.ownerFor(routeSignal("contract", c.coordinatorKey)),
          // Afronden vóór de 14-dagencontrole.
          dueOn: addWorkingDays(ctx.today, Math.max(1, Math.min(5, (k.daysToDecision ?? 15) - 14)), holidays),
          entityType: "retentie_contract", entityId: k.contractId, source: "automation", dedupeKey,
        }).onConflictDoNothing().returning({ id: tasks.id });
        if (r[0]) job.counters.created++;
      }
    }

    // Opruimen: open contracttaken waarvan het beslismoment niet meer klopt.
    const stale = await db.update(tasks).set({ archivedAt: new Date() }).where(and(
      eq(tasks.source, "automation"), eq(tasks.entityType, "retentie_contract"), isNull(tasks.archivedAt), isNull(tasks.deletedAt),
      inArray(tasks.status, ["todo", "in_progress", "blocked"]),
      keep.length ? notInArray(tasks.dedupeKey, keep) : like(tasks.dedupeKey, "retentie_contract:%"),
    )).returning({ id: tasks.id });
    job.counters.updated = stale.length;
    job.log(`${list.length} klanten beoordeeld, ${job.counters.created} taken aangemaakt, ${stale.length} verouderde contracttaken gearchiveerd.`);
  });
}

/**
 * Escalatie (draait mee met de aandachtspunten-melding, 's ochtends en
 * 's middags): een kritiek klantbehoud-punt dat na één werkdag nog niet is
 * opgepakt, of een klacht waarvan de deadline verstreken is, gaat één keer naar
 * de vaste escalatie (Milou, of Jiska als Milou zelf eigenaar of afwezig is).
 * Niet naar het hele team en niet naar Jarno: die krijgt alleen wat buiten de
 * bevoegdheid valt via de Beslissingshulp.
 */
export async function runRetentionEscalations(items: AttentionItem[]): Promise<number> {
  const ctx = await retentionContext();
  const holidays = nlHolidaySet();
  let sent = 0;
  for (const i of items) {
    if (!i.key.startsWith("retentie-") || i.status !== "open" || !i.ownerId) continue;
    const critical = i.key.startsWith("retentie-feedback-") || /^retentie-contract-.*-14$/.test(i.key);
    if (!critical) continue;
    const waited = workingDaysBetween(i.since.slice(0, 10), ctx.today, holidays);
    const late = i.dueOn != null && i.dueOn < ctx.today;
    if (!(i.priority === "hoog" && waited >= 1) && !late) continue;
    const ownerKey = ctx.staffKeyById.get(i.ownerId);
    if (!ownerKey) continue;
    const target = escalationTarget(ownerKey, ctx.absent);
    const targetId = target ? ctx.staff.get(target) : null;
    if (!targetId || targetId === i.ownerId) continue;
    sent += await notify({
      userIds: [targetId], type: "retention_escalation", level: "warning",
      title: `Nog niet opgepakt: ${i.clientName ? `${i.clientName} · ` : ""}${i.action}`.slice(0, 240),
      body: `${i.reason}. Verantwoordelijke: ${ownerKey[0].toUpperCase()}${ownerKey.slice(1)}. Stem af wie dit vandaag oppakt.`.slice(0, 300),
      href: "/kwaliteit", dedupeKey: `retentie-escalatie:${i.key}`,
    });
  }
  return sent;
}

/** Hulpje voor tests: welke taken zijn er voor klantbehoud. */
export async function retentionTaskKeys(): Promise<string[]> {
  const r = await db.select({ k: tasks.dedupeKey }).from(tasks)
    .where(and(isNull(tasks.deletedAt), or(like(tasks.dedupeKey, "retentie_resultaten:%"), like(tasks.dedupeKey, "retentie_contract:%"))));
  return r.map((x) => x.k!).filter(Boolean);
}
