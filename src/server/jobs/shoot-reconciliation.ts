import "server-only";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import { notify } from "@/server/notifications";
import { hasShortsCount, isInternalEmail } from "@/server/integrations/calendar-matching";
import { runJob } from "./runner";

/**
 * Dagelijkse reconciliatie van opnames: controleert of alle opnames uit de
 * gekoppelde Google-agenda's ook daadwerkelijk in de opnameplanning staan, en
 * waarschuwt het team over afspraken die er wél uitzien als een opname maar niet
 * (automatisch) in de planning belanden — zodat niets stilletjes verdwijnt.
 *
 * Twee categorieën (nooit gokken, nooit dubbel aanmaken):
 *   1. Opname herkend, maar geen klant gekoppeld → staat niet in de planning;
 *      koppel de klant (één klik) en de opname verschijnt.
 *   2. Afspraak met een aantal shorts in de titel + een externe gast, maar niet
 *      als opname geclassificeerd → mogelijk een gemiste opname; controleer.
 *
 * De afspraken zelf staan al veilig in calendar_events; dit is de proactieve
 * controle + melding (het "ik wil niet zelf hoeven checken"-deel).
 */
type Flagged = { id: string; title: string | null; when: Date | null; calendar: string | null; reason: string };

const dayLabel = (d: Date | null) =>
  d ? d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Amsterdam" }) : "onbekend";

export async function runShootReconciliation() {
  return runJob("google_calendar", "shoots.reconcile", {}, async (ctx) => {
    const now = new Date();
    // Venster: recent verleden (2 dagen) t/m 120 dagen vooruit — zo vangen we ook
    // "vorige week ontbrak er een opname" nog net, plus alle toekomstige.
    const from = new Date(now.getTime() - 2 * 86_400_000);
    const to = new Date(now.getTime() + 120 * 86_400_000);

    // 1. Herkende opnames zonder gekoppelde klant (komen niet in de planning).
    const noClient = await db
      .select({ id: calendarEvents.id, title: calendarEvents.title, startsAt: calendarEvents.startsAt, calendarName: calendarEvents.calendarName })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.kind, "opname"),
          isNull(calendarEvents.clientId),
          sql`${calendarEvents.status} is distinct from 'cancelled'`,
          gte(calendarEvents.startsAt, from),
          lte(calendarEvents.startsAt, to),
        ),
      )
      .orderBy(asc(calendarEvents.startsAt));

    // 2. Mogelijk gemiste opnames: niet als opname geclassificeerd ("overig"),
    //    maar met een aantal shorts in de titel én een externe gast. Alleen
    //    toekomstige (verleden is niet meer te herstellen).
    const overigRows = await db
      .select({ id: calendarEvents.id, title: calendarEvents.title, startsAt: calendarEvents.startsAt, calendarName: calendarEvents.calendarName, attendees: calendarEvents.attendees })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.kind, "overig"),
          sql`${calendarEvents.status} is distinct from 'cancelled'`,
          gte(calendarEvents.startsAt, now),
          lte(calendarEvents.startsAt, to),
        ),
      )
      .orderBy(asc(calendarEvents.startsAt));
    const maybeMissed = overigRows.filter((e) => {
      if (!hasShortsCount(e.title)) return false;
      const attendees = (e.attendees ?? []) as Array<{ email?: string | null }>;
      return attendees.some((a) => a.email && !isInternalEmail(a.email));
    });

    const flagged: Flagged[] = [
      ...noClient.map((r) => ({ id: r.id, title: r.title, when: r.startsAt, calendar: r.calendarName, reason: "opname herkend, geen klant gekoppeld" })),
      ...maybeMissed.map((r) => ({ id: r.id, title: r.title, when: r.startsAt, calendar: r.calendarName, reason: "mogelijk een gemiste opname (aantal shorts + externe gast)" })),
    ];

    ctx.counters.processed = noClient.length + overigRows.length;

    if (flagged.length === 0) {
      ctx.log("Geen afwijkingen: alle herkende opnames staan gekoppeld in de planning.");
      return;
    }

    // Eén nette melding met een beknopte lijst, gededupliceerd per dag. Een hash
    // van de betrokken afspraak-ids zorgt dat een nieuwe afwijking wél opnieuw
    // meldt, maar dezelfde lijst niet elke run opnieuw.
    const idHash = flagged.map((f) => f.id).sort().join(",").slice(0, 120);
    const dayKey = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    const lines = flagged
      .slice(0, 12)
      .map((f) => `• ${dayLabel(f.when)} — ${f.title ?? "zonder titel"} (${f.reason})`)
      .join("\n");
    const extra = flagged.length > 12 ? `\n…en nog ${flagged.length - 12} meer.` : "";

    const sent = await notify({
      roles: ["owner", "operational_manager", "project_coordinator"],
      level: "warning",
      type: "shoot_reconciliation",
      title: `${flagged.length} opname${flagged.length === 1 ? "" : "s"} vraagt aandacht in de planning`,
      body: `Deze afspraken staan (nog) niet gekoppeld in de opnameplanning. Koppel ze in één klik via Instellingen → Koppelingen.\n\n${lines}${extra}`.slice(0, 600),
      href: "/settings/integrations",
      dedupeKey: `shoot_reconciliation:${dayKey}:${idHash}`,
    }).catch(() => 0);

    ctx.counters.updated = sent;
    ctx.log(`${flagged.length} afwijking(en): ${noClient.length} opname-zonder-klant, ${maybeMissed.length} mogelijk gemist. ${sent} melding(en) verstuurd.`);
  });
}
