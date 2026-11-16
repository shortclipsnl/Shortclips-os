/**
 * Statusregels voor opnamedagen (Gepland / Afgerond / Geannuleerd).
 *
 * Uitgangspunt: een opname is pas "Afgerond" als er bewijs is dat er echt
 * gefilmd is. Een verstreken datum alleen is geen bewijs. Bewijs = minstens
 * één video van die opname is verder dan "opgenomen" (beelden geüpload, in
 * montage, bij de klant, goedgekeurd, gepubliceerd ...). Zonder bewijs blijft
 * een opname uit het verleden "Gepland" en vraagt de pagina om bevestiging.
 */

export type ShootStatus = "concept" | "planned" | "confirmed" | "in_progress" | "completed" | "cancelled";

/** Videostatussen die aantonen dat de opname heeft plaatsgevonden. */
export const SHOOT_EVIDENCE_VIDEO_STATUSES = [
  "footage_upload",
  "awaiting_editor",
  "editing",
  "internal_review",
  "editor_revision",
  "client_review",
  "client_revision",
  "approved",
  "ready_to_publish",
  "scheduled",
  "published",
  "analysis_available",
] as const;

/** Vandaag als YYYY-MM-DD in Nederlandse tijd. */
export function todayAmsterdam(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/**
 * Welke status een opnamedag krijgt als de bijbehorende afspraak (nog) actief
 * in Google Agenda staat. De agenda is leidend voor datum en tijd, maar mag
 * een afgeronde of handmatig afgesloten opname niet terugzetten.
 *
 *  - Nieuw                         → Gepland
 *  - Afgerond, datum in verleden   → blijft Afgerond
 *  - Afgerond, verplaatst naar de toekomst → Gepland (het is weer een opname die nog moet komen)
 *  - Geannuleerd, afspraak staat in de toekomst weer actief → Gepland
 *  - Geannuleerd in het verleden (handmatig bevestigd) → blijft Geannuleerd
 *  - Overige statussen blijven staan.
 */
export function syncedShootStatus(current: ShootStatus | string | null, scheduledOn: string, today: string): ShootStatus {
  if (!current) return "planned";
  if (current === "completed") return scheduledOn > today ? "planned" : "completed";
  if (current === "cancelled") return scheduledOn >= today ? "planned" : "cancelled";
  return current as ShootStatus;
}
