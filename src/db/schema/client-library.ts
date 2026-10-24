import { index, integer, pgTable, text, varchar, uuid } from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { clients } from "./clients";
import { users } from "./identity";

/**
 * De Editing Guide (PDF) per klant — de enige klantbibliotheek-bron die nog niet
 * in de app bestond. Bewust als los bestand in de database (zelfde patroon als
 * edit_project_files), zodat interne medewerkers een nieuwe versie kunnen
 * uploaden en editors automatisch de meest recente zien. Oude versies blijven
 * bewaard (historie); de nieuwste (hoogste createdAt, niet verwijderd) is leidend.
 */
export const clientEditingGuides = pgTable(
  "client_editing_guides",
  {
    id: pk(),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 300 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull().default("application/pdf"),
    /** Base64 van de PDF (zonder data:-prefix). */
    dataBase64: text("data_base64").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("client_editing_guides_client_idx").on(t.clientId)],
);
