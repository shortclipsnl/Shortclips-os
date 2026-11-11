import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notify } from "@/server/notifications";
import { runJob } from "./runner";

/**
 * Achtergrondbewaking van de publicatiecheck: zodra er vandaag video's gepland
 * staan waarvan de publicatietijd is bereikt en die nog niet online zijn, krijgt
 * het kernteam een melding — ook als niemand de Contentplanning open heeft. Eén
 * melding per dag (dedupe), met een link naar de pagina waar de check automatisch
 * openstaat.
 */
export async function runPublicationDueCheck() {
  return runJob("system", "publications.due_check", {}, async (ctx) => {
    const res = await db.execute(sql`
      select cc.id, c.name as client
      from content_calendar cc
      join clients c on c.id = cc.client_id and c.deleted_at is null
      where cc.deleted_at is null
        and cc.status in ('ready','scheduled')
        and cc.scheduled_on = (now() at time zone 'Europe/Amsterdam')::date
        and (cc.scheduled_at is null or cc.scheduled_at <= (now() at time zone 'Europe/Amsterdam')::time)
      order by c.name
    `);
    const rows = ((res as unknown as { rows?: Array<{ id: string; client: string }> }).rows ?? []) as Array<{ id: string; client: string }>;
    if (rows.length === 0) {
      ctx.log("Geen openstaande publicaties.");
      return;
    }
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    const namen = [...new Set(rows.map((r) => r.client))];
    const sent = await notify({
      roles: ["owner", "operational_manager", "project_coordinator"],
      type: "publication_due",
      level: "warning",
      title: `${rows.length} ${rows.length === 1 ? "video staat" : "video's staan"} klaar om online te zetten`,
      body: `Loop de publicatiecheck na en zet online: ${namen.slice(0, 6).join(", ")}${namen.length > 6 ? "…" : ""}.`,
      href: "/calendar",
      dedupeKey: `publication_due:${today}`,
    });
    ctx.counters.updated += sent;
    ctx.log(`${rows.length} openstaande publicatie(s), ${sent} melding(en).`);
  });
}
