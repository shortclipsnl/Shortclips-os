import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { EFFECT_LABEL, platformName, type Effect } from "@/lib/result-alerts";

/**
 * Lessen uit afgehandelde verbeteracties per klant: welk probleem, welke actie,
 * en wat het effect was op de video's die daarna online kwamen. Voedt het
 * Contentgeheugen (intern) en de Script Engine, zodat Shortclips per klant
 * leert wat wel en niet werkt. Alleen gemeten uitkomsten, nooit aannames.
 */

export type Lesson = {
  id: string;
  problem: string;
  action: string;
  resolvedAt: string;
  verdict: NonNullable<Effect["verdict"]> | null;
  verdictLabel: string;
  changePct: number | null;
  videosAfter: number;
  needed: number;
  platforms: string[];
};

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

export async function lessonsForClient(clientId: string): Promise<Lesson[]> {
  const res = await db.execute(sql`
    select id, headline, action_text, resolution_note, resolved_at, effect, platforms
    from result_alerts
    where client_id = ${clientId} and kind = 'negatief' and status = 'opgelost'
    order by resolved_at desc limit 8`);
  return rowsOf<Record<string, unknown>>(res).map((r) => {
    const e = (r.effect as Effect | null) ?? null;
    const verdict = e?.status === "gemeten" ? e.verdict : null;
    return {
      id: String(r.id),
      problem: String(r.headline),
      action: String(r.action_text || r.resolution_note || "Verbeteractie uitgevoerd"),
      resolvedAt: new Date(r.resolved_at as string).toISOString(),
      verdict,
      verdictLabel: verdict ? EFFECT_LABEL[verdict] : "Effect wordt nog gemeten",
      changePct: verdict ? e!.changePct : null,
      videosAfter: e?.videosAfter ?? 0,
      needed: e?.needed ?? 3,
      platforms: ((r.platforms as string[]) ?? []).map(platformName),
    };
  });
}

/** Als tekst voor de Script Engine (alleen gemeten uitkomsten). */
export async function lessonsPromptText(clientId: string): Promise<string> {
  const ls = (await lessonsForClient(clientId).catch(() => [])).filter((l) => l.verdict);
  if (!ls.length) return "";
  return `LESSEN UIT EERDERE VERBETERACTIES (gemeten op de video's na de actie):\n${ls
    .slice(0, 5)
    .map((l) => `- Probleem: ${l.problem}. Actie: ${l.action}. Uitkomst: ${l.verdictLabel.toLowerCase()}${l.changePct != null ? ` (${l.changePct > 0 ? "+" : ""}${l.changePct}% weergaven t.o.v. normaal)` : ""}.`)
    .join("\n")}`;
}
