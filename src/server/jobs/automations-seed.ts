import "server-only";
import { db } from "@/db/client";
import { automationRules } from "@/db/schema";
import { AUTOMATION_RULES } from "@/db/seed/platform-data";

/**
 * Zet de in code gedefinieerde automatiseringsregels in de database. Idempotent:
 * bestaande regels (op `key`) blijven ongemoeid — zo kunnen nieuwe regels worden
 * uitgerold zonder de volledige seed te draaien en zonder handmatige aanpassingen
 * te overschrijven.
 */
export async function seedAutomationRules() {
  const before = await db.select({ key: automationRules.key }).from(automationRules);
  const existing = new Set(before.map((r) => r.key));

  await db
    .insert(automationRules)
    .values(
      AUTOMATION_RULES.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        trigger: r.trigger,
        conditions: r.conditions,
        actions: r.actions,
        isEnabled: true,
      })),
    )
    .onConflictDoNothing();

  const added = AUTOMATION_RULES.filter((r) => !existing.has(r.key)).map((r) => r.key);
  return { ok: true, total: AUTOMATION_RULES.length, added, addedCount: added.length };
}
