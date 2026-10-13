import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientIntegrations, clients } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { runJob } from "./runner";

/*
 * KLANT VERDELING → klant-complexiteit + aandachtspunten.
 *
 * De meeste kolommen op dit bord zijn spiegels uit HOOFDBOARD/PROJECT PLANNING
 * (al geïmporteerd) of vervallen overdrachtsvelden. Eigen, blijvend nuttige
 * data is alleen: complexiteit (werklast laag/gemiddeld/hoog) en de
 * aandachtspunten per klant. Die nemen we over naar clients.complexity /
 * clients.attentionNotes. Koppeling gebeurt via het gekoppelde HOOFDBOARD-item
 * (board_relation), dat al als client_integrations.externalId bestaat.
 */
const DISTRIBUTION_BOARD = "5101867194";
const C = {
  klantKoppeling: "board_relation_mm62b8dd", // → HOOFDBOARD item
  complexiteit: "color_mm62m34c", // Laag/Gemiddeld/Hoog
  aandachtspunten: "long_text_mm62nx6a",
};

function col(item: MondayItem, id: string): { text: string; value: string | null } {
  const c = item.column_values.find((x) => x.id === id);
  return { text: (c?.text ?? "").trim(), value: c?.value ?? null };
}

/** HOOFDBOARD-item-id uit de board-relation halen (robuuste klantkoppeling). */
function linkedHoofdboardId(item: MondayItem): string | null {
  const { value } = col(item, C.klantKoppeling);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { linkedPulseIds?: { linkedPulseId: number }[] };
    const first = parsed.linkedPulseIds?.[0]?.linkedPulseId;
    return first ? String(first) : null;
  } catch {
    return null;
  }
}

function mapComplexity(label: string): "laag" | "gemiddeld" | "hoog" | null {
  const s = label.toLowerCase();
  if (s.startsWith("laag")) return "laag";
  if (s.startsWith("gemiddeld")) return "gemiddeld";
  if (s.startsWith("hoog")) return "hoog";
  return null;
}

export async function runMondayClientDistributionImport() {
  return runJob("monday", "monday.import_client_distribution", {}, async (ctx) => {
    const items = await monday.listItems(DISTRIBUTION_BOARD, 200);
    ctx.log(`${items.length} rijen op KLANT VERDELING`);

    for (const item of items) {
      const complexity = mapComplexity(col(item, C.complexiteit).text);
      const attention = col(item, C.aandachtspunten).text || null;
      if (!complexity && !attention) continue;

      // Klant zoeken: eerst via gekoppeld HOOFDBOARD-item, anders op naam.
      const hoofdboardId = linkedHoofdboardId(item);
      let clientId: string | null = null;
      if (hoofdboardId) {
        const [hit] = await db
          .select({ clientId: clientIntegrations.clientId })
          .from(clientIntegrations)
          .where(and(eq(clientIntegrations.provider, "monday"), eq(clientIntegrations.externalId, hoofdboardId)))
          .limit(1);
        clientId = hit?.clientId ?? null;
      }
      if (!clientId) {
        const name = (item.name ?? "").trim().toLowerCase();
        if (name) {
          const [hit] = await db
            .select({ id: clients.id })
            .from(clients)
            .where(and(isNull(clients.deletedAt), sql`lower(${clients.name}) = ${name}`))
            .limit(1);
          clientId = hit?.id ?? null;
        }
      }
      if (!clientId) {
        ctx.counters.failed++;
        continue;
      }
      ctx.counters.processed++;

      await db
        .update(clients)
        .set({
          ...(complexity ? { complexity } : {}),
          ...(attention ? { attentionNotes: attention } : {}),
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId));
      ctx.counters.updated++;
    }
    ctx.log(`Klaar: ${ctx.counters.updated} klanten bijgewerkt, ${ctx.counters.failed} zonder match.`);
  });
}
