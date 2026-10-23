import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ *
 * Vermogensdashboard (privé, alleen eigenaar Jarno)
 *
 * Het persoonlijke vermogensdashboard is een losstaande pagina met een eigen,
 * document-georiënteerde opslag (zoals de claude.ai-db die het vroeger
 * gebruikte). Eén tabel met vrije JSON-documenten per pad volstaat: de paden
 * (v/cfg, v/prognose, v/cfg/saldi/<id>, v/cfg/pf/<id>, v/cfg/inleg/<id>,
 * v/cfg/flows/<id>) en de documentvorm liggen vast in de dashboardpagina zelf.
 * Zo hoeft die pagina niet te worden aangepast en blijven alle berekeningen,
 * schermen en bankimports werken zoals ze waren.
 * ------------------------------------------------------------------ */

/** Eén document = één pad (bijv. "v/cfg" of "v/cfg/saldi/<rekening>_<datum>"). */
export const vermogenDocs = pgTable("vermogen_docs", {
  /** Opslagpad; altijd beginnend met "v/". Primaire sleutel. */
  path: text("path").primaryKey(),
  /** Het volledige document als JSON. */
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
