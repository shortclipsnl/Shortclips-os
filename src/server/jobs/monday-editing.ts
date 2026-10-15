import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, mondayMappings, users } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { normalizeName, matchScore } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { runJob } from "./runner";

/* EDITING DASHBOARD KLANTEN — editing-pijplijn per klant. */
const EDITING_BOARD = "5060995925";
const CANCELLED_GROUP = "group_mm7qtk79"; // 🗑️ Geannuleerde opnames
const C = {
  editor: "color_mm512fq3",
  deadline: "timerange_mm32pjs",
  fase: "color_mm517q5h",
  shorts: "numeric_mkx1dbx4",
  feedbackTermijn: "timerange_mm7fms4x",
};

/** Fase op het Monday-bord → videostatus in ShortClips OS. */
const FASE_TO_STATUS: Record<
  string,
  "recorded" | "awaiting_editor" | "editing" | "internal_review" | "client_review" | "client_revision"
> = {
  // "Binnenkort beschikbaar"/"nieuw" = nog op te nemen of beelden onderweg —
  // nog NIET bij de editor. Daarom "recorded" (telt niet als editorbelasting en
  // staat niet op "wacht op editor").
  "binnenkort beschikbaar": "recorded",
  nieuw: "recorded",
  "in edit": "editing",
  "interne review": "internal_review",
  "feedback klant": "client_review",
  "feedback verwerken": "client_revision",
};

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? "").trim();
}
function rawVal(item: MondayItem, id: string): string | null {
  return item.column_values.find((c) => c.id === id)?.value ?? null;
}
/** Einddatum uit een timeline-kolom (de opleverdatum). */
function timelineEnd(item: MondayItem, id: string): string | null {
  const raw = rawVal(item, id);
  if (raw) {
    try {
      const v = JSON.parse(raw) as { to?: string; from?: string };
      if (v.to && /^\d{4}-\d{2}-\d{2}/.test(v.to)) return v.to.slice(0, 10);
    } catch {
      /* val terug op tekst */
    }
  }
  const text = col(item, id); // "2026-09-20 - 2026-10-04"
  const m = text.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
  return m ? m[2]! : null;
}

/** Zorgt dat een editor als gebruiker bestaat; geeft het user-id terug. */
async function ensureEditor(name: string): Promise<string> {
  const first = name.trim().split(/\s+/)[0]!.toLowerCase();
  const email = `${first}@shortclips.nl`;
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(users)
    .values({ email, fullName: name.trim(), primaryRole: "editor", status: "active" })
    .returning({ id: users.id });
  return created!.id;
}

/**
 * Importeert de lopende editing-projecten uit het EDITING DASHBOARD van Monday
 * als video's (deliverables), zodat de cockpit en het editing-dashboard echte
 * cijfers tonen: fase, editor, deadline en klant. Idempotent op het Monday-
 * item-id (via monday_mappings). Afgeronde en geannuleerde items worden
 * overgeslagen — die horen niet meer in "in productie".
 */
export async function runMondayEditingImport() {
  return runJob("monday", "monday.import_editing", {}, async (ctx) => {
    // De board-relation naar HOOFDBOARD komt via de Monday-API leeg binnen, maar
    // de naam van een editing-item ís de klantnaam ("365 werk", "Koops Chalets").
    // Daarom matchen we op naam (met dezelfde aliassen als Frame/agenda).
    const clientRows = await db
      .select({ id: clients.id, name: clients.name, slug: clients.slug })
      .from(clients)
      .where(isNull(clients.deletedAt));
    function matchClient(name: string): string | null {
      const n = normalizeName(name);
      if (!n) return null;
      const hits = clientRows.filter((c) => {
        if (normalizeName(c.name) === n || normalizeName(c.slug) === n) return true;
        if (aliasesForSlug(c.slug).some((a) => normalizeName(a) === n)) return true;
        return matchScore(name, c.name) >= 90;
      });
      return hits.length === 1 ? hits[0]!.id : null;
    }

    const editorCache = new Map<string, string>();

    const items = await monday.listItems(EDITING_BOARD, 300);
    ctx.log(`${items.length} editing-items op het bord`);

    for (const item of items) {
      if (item.group?.id === CANCELLED_GROUP) continue;
      const fase = col(item, C.fase).toLowerCase();
      if (fase === "afgerond" || fase === "") continue;
      const status = FASE_TO_STATUS[fase] ?? "editing";

      // Klant bepalen op naam van het editing-item.
      const clientId = matchClient(item.name);
      if (!clientId) {
        ctx.counters.failed++;
        ctx.log(`Geen klant herkend voor "${item.name}"`, "warn");
        continue; // nooit gokken
      }
      ctx.counters.processed++;

      // Editor koppelen (label → gebruiker).
      const editorName = col(item, C.editor);
      let editorId: string | null = null;
      if (editorName && editorName.toLowerCase() !== "nieuw") {
        if (!editorCache.has(editorName)) editorCache.set(editorName, await ensureEditor(editorName));
        editorId = editorCache.get(editorName)!;
      }

      const dueOn = timelineEnd(item, C.deadline);
      // Titel is app-eigen (onderwerp/hook): alleen bij aanmaken vullen, nooit
      // overschrijven met de Monday-itemnaam (die is vaak de klantnaam).
      const base = {
        clientId,
        status,
        ...(editorId ? { editorId } : {}),
        ...(dueOn ? { dueOn } : {}),
        updatedAt: new Date(),
      };

      // Dedup op het Monday-item (monday_mappings).
      const [map] = await db
        .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
        .from(mondayMappings)
        .where(and(eq(mondayMappings.entityType, "editing_item"), eq(mondayMappings.itemId, item.id)))
        .limit(1);

      if (map?.entityId) {
        // "Dagen in fase" vanaf de echte statuswijziging: statusChangedAt alleen
        // bijwerken als de status echt verandert (niet elke sync).
        const [cur] = await db
          .select({ status: deliverables.status })
          .from(deliverables)
          .where(eq(deliverables.id, map.entityId))
          .limit(1);
        const statusChanged = cur && cur.status !== status;
        await db
          .update(deliverables)
          .set({ ...base, ...(statusChanged ? { statusChangedAt: new Date() } : {}) })
          .where(eq(deliverables.id, map.entityId));
        await db
          .update(mondayMappings)
          .set({ lastSyncedAt: new Date() })
          .where(eq(mondayMappings.id, map.id));
        ctx.counters.updated++;
      } else {
        const [created] = await db
          .insert(deliverables)
          .values({ ...base, title: item.name.trim() || "Editing-project", statusChangedAt: new Date() })
          .returning({ id: deliverables.id });
        await db.insert(mondayMappings).values({
          entityType: "editing_item",
          entityId: created!.id,
          boardId: EDITING_BOARD,
          itemId: item.id,
          lastSyncedAt: new Date(),
        });
        ctx.counters.created++;
      }
    }

    ctx.log(`Klaar: ${ctx.counters.created} nieuw, ${ctx.counters.updated} bijgewerkt.`);
  });
}
