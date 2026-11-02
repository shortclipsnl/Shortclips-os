import "server-only";
import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, scriptReviews } from "@/db/schema";
import { matchDriveScriptsForShoots, type ShootForMatch } from "@/server/captions/drive-script-match";
import { ensureCaptionsForShoot } from "@/server/captions/run";

/** Venster: bestaande opnames (terug) t/m komende opnames (vooruit), in dagen. */
const PAST_DAYS = 120;
const FUTURE_DAYS = 60;
/** Max. aantal opnames waarvoor per ronde captions (opnieuw) gegenereerd worden. */
const MAX_GENERATE_PER_RUN = 25;

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Koppelt automatisch script-PDF's uit Google Drive aan de juiste opname en
 * bereidt daarna de captions voor. Pakt opnames die (nog) geen scriptcontrole-PDF
 * in het portaal hebben — juist daar ontbreekt de bron. Draait op de achtergrond
 * (cron), dus zonder dat iemand hoeft te refreshen. Bestaande opnames worden
 * óók opnieuw gecontroleerd (inhaalslag binnen het venster).
 */
export async function runCaptionDriveLink(): Promise<{
  scanned: number;
  linked: number;
  suggested: number;
  generated: number;
  failed: number;
}> {
  const rows = await db
    .select({
      productionDayId: productionDays.id,
      clientId: productionDays.clientId,
      scheduledOn: productionDays.scheduledOn,
      title: productionDays.title,
      clientName: clients.name,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(scriptReviews, and(eq(scriptReviews.productionDayId, productionDays.id), isNull(scriptReviews.deletedAt)))
    .where(
      and(
        isNull(productionDays.deletedAt),
        ne(productionDays.status, "cancelled"),
        gte(productionDays.scheduledOn, isoOffset(-PAST_DAYS)),
        lte(productionDays.scheduledOn, isoOffset(FUTURE_DAYS)),
        // Alleen opnames zonder portaal-scriptReview: daar is de Drive-PDF de bron.
        sql`${scriptReviews.id} is null`,
      ),
    )
    .limit(500);

  if (rows.length === 0) return { scanned: 0, linked: 0, suggested: 0, generated: 0, failed: 0 };

  const shoots: ShootForMatch[] = rows.map((r) => ({
    productionDayId: r.productionDayId,
    clientId: r.clientId,
    scheduledOn: r.scheduledOn,
    title: r.title,
    clientName: r.clientName,
  }));

  const outcomes = await matchDriveScriptsForShoots(shoots);
  const linked = outcomes.filter((o) => o.linked).map((o) => o.productionDayId);
  const suggested = outcomes.reduce((n, o) => n + o.suggested, 0);

  // Voor zeker gekoppelde opnames meteen de captions (laten) voorbereiden.
  let generated = 0;
  let failed = 0;
  for (const productionDayId of linked.slice(0, MAX_GENERATE_PER_RUN)) {
    try {
      const res = await ensureCaptionsForShoot(productionDayId);
      if (res.ok) generated++;
      else if (res.reason === "error") failed++;
    } catch {
      failed++;
    }
  }

  return { scanned: rows.length, linked: linked.length, suggested, generated, failed };
}
