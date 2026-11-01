import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentResearchRuns, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { runJob } from "@/server/jobs/runner";

const MILOU = "milou@shortclips.nl";
const JISKA = "jiska@shortclips.nl";

/**
 * Wekelijkse melding dat er nieuwe content-ideeën klaarstaan.
 * - Maandag ~10:00 Amsterdam: Milou én Jiska.
 * - Dinsdag ~10:00 Amsterdam: Milou.
 * De cron draait op twee UTC-tijden (zomer-/wintertijd); de lokale-uur-check laat
 * er precies één om 10:xx Amsterdam doorkomen. Dedupe = één melding per persoon
 * per dag.
 */
export async function runContentResearchNotify() {
  return runJob("system", "content_research.notify", {}, async (ctx) => {
    const now = new Date();
    const weekday = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "Europe/Amsterdam" });
    const hhmm = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Amsterdam" });
    const hour = Number(hhmm.slice(0, 2));
    const dayKey = now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

    if (hour !== 10 || (weekday !== "Mon" && weekday !== "Tue")) {
      ctx.log(`Lokaal ${weekday} ${hhmm} (Amsterdam) — niet ma/di 10:xx, overgeslagen.`);
      return;
    }
    const emails = weekday === "Mon" ? [MILOU, JISKA] : [MILOU];

    // Hoeveel nieuwe ideeën/klanten de afgelopen 7 dagen (vooral uit maandag­onderzoek).
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const runs = await db
      .select({ clientId: contentResearchRuns.clientId, newCount: contentResearchRuns.newCount })
      .from(contentResearchRuns)
      .where(and(eq(contentResearchRuns.status, "klaar"), gte(contentResearchRuns.finishedAt, since), isNull(contentResearchRuns.deletedAt)));
    const klanten = new Set(runs.map((r) => r.clientId)).size;
    const ideeen = runs.reduce((s, r) => s + (r.newCount ?? 0), 0);

    const recipients = await db
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.status, "active"), inArray(sql`lower(${users.email})`, emails)));

    const body = ideeen > 0
      ? `Er staan ${ideeen} nieuwe content-ideeën klaar voor ${klanten} klant${klanten === 1 ? "" : "en"}. Bekijk, spar en stuur de beste door naar de scriptgenerator.`
      : "Bekijk de nieuwste content-ideeën per klant, spar met de AI en stuur de beste door naar de scriptgenerator.";

    for (const r of recipients) {
      ctx.counters.processed++;
      const n = await notify({
        userIds: [r.id],
        type: "content_research_ready",
        level: "info",
        title: "Nieuwe content-ideeën staan klaar",
        body,
        href: "/ai/content-research",
        dedupeKey: `content_research_ready:${r.id}:${dayKey}`,
      });
      if (n > 0) ctx.counters.updated++;
    }
    ctx.log(`${ctx.counters.updated}/${recipients.length} melding(en) verstuurd (${weekday}).`);
  });
}
