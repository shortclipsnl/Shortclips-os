import { index, integer, pgTable, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";
import { kbAssets } from "./kennisbank";

/**
 * Centrale bron voor de vaste klantdocumenten (nov 2026): per klant een
 * Klanten Guide en een Editing Guide. Productie → Klanten, de Klantenbibliotheek
 * in de kennisbank en "Mijn klanten" (editors) lezen allemaal uit deze tabel via
 * één vaste link per document (/api/klantdocumenten/[clientId]/[kind]). Een
 * nieuwe upload wordt de geldende versie; oude versies blijven als historie
 * bewaard (soft delete = handmatig weggehaald).
 *
 * De bytes staan in kb_assets/kb_asset_parts (in delen, met Range-streaming),
 * dezelfde opslag als de kennisbank.
 *
 * `variant` is normaal leeg. Alleen als één klant meerdere merken heeft
 * (bijv. Ausnutria en Kabrita) staat hier de merknaam, zodat beide guides
 * naast elkaar bestaan.
 */
export const CLIENT_DOCUMENT_KINDS = ["klanten_guide", "editing_guide"] as const;
export type ClientDocumentKind = (typeof CLIENT_DOCUMENT_KINDS)[number];

export const clientDocuments = pgTable(
  "client_documents",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).$type<ClientDocumentKind>().notNull(),
    variant: varchar("variant", { length: 80 }).notNull().default(""),
    assetId: uuid("asset_id").notNull().references(() => kbAssets.id, { onDelete: "restrict" }),
    fileName: varchar("file_name", { length: 300 }).notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("client_documents_client_kind_idx").on(t.clientId, t.kind)],
);
