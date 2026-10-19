import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, scripts } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import type { ScriptForDoc } from "./document-build";

export { buildScriptDocx, scriptSections, type ScriptForDoc, type ScriptSections } from "./document-build";

/* ------------------------------ Data ophalen ------------------------------ */

const SCRIPT_COLS = {
  id: scripts.id,
  clientId: scripts.clientId,
  title: scripts.title,
  pillar: scripts.pillar,
  format: scripts.format,
  hook: scripts.hook,
  body: scripts.body,
  cta: scripts.cta,
  locationName: scripts.locationName,
  presenter: scripts.presenter,
  requirements: scripts.requirements,
} as const;

export type ScriptExportResult = {
  scripts: ScriptForDoc[];
  clientId: string;
  clientName: string;
  clientSlug: string;
  sessionTitle: string | null;
  sessionDate: string | null;
  fileBase: string;
};

/** Haalt de scripts op voor één script of een hele opnamesessie, met toegang­
 *  scontrole, in de juiste volgorde. */
export async function fetchScriptsForExport(
  viewer: Viewer,
  input: { scriptId?: string; sessionId?: string },
): Promise<ScriptExportResult | null> {
  if (input.sessionId) {
    const rows = await db
      .select({ ...SCRIPT_COLS, clientName: clients.name, clientSlug: clients.slug, sessionTitle: productionDays.title, sessionDate: productionDays.scheduledOn })
      .from(scripts)
      .innerJoin(clients, eq(clients.id, scripts.clientId))
      .leftJoin(productionDays, eq(productionDays.id, scripts.productionDayId))
      .where(and(eq(scripts.productionDayId, input.sessionId), isNull(scripts.deletedAt)))
      .orderBy(asc(scripts.createdAt));
    if (rows.length === 0) return null;
    assertClientAccess(viewer, rows[0]!.clientId);
    const first = rows[0]!;
    const dateLabel = first.sessionDate ? new Date(`${first.sessionDate}T00:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : null;
    return {
      scripts: rows.map(toScriptForDoc),
      clientId: first.clientId,
      clientName: first.clientName,
      clientSlug: first.clientSlug,
      sessionTitle: first.sessionTitle,
      sessionDate: first.sessionDate,
      fileBase: slugFile(`${first.clientName} scripts ${first.sessionTitle ?? dateLabel ?? ""}`),
    };
  }

  if (input.scriptId) {
    const [row] = await db
      .select({ ...SCRIPT_COLS, clientName: clients.name, clientSlug: clients.slug, sessionTitle: productionDays.title, sessionDate: productionDays.scheduledOn })
      .from(scripts)
      .innerJoin(clients, eq(clients.id, scripts.clientId))
      .leftJoin(productionDays, eq(productionDays.id, scripts.productionDayId))
      .where(and(eq(scripts.id, input.scriptId), isNull(scripts.deletedAt)))
      .limit(1);
    if (!row) return null;
    assertClientAccess(viewer, row.clientId);
    return {
      scripts: [toScriptForDoc(row)],
      clientId: row.clientId,
      clientName: row.clientName,
      clientSlug: row.clientSlug,
      sessionTitle: row.sessionTitle,
      sessionDate: row.sessionDate,
      fileBase: slugFile(`${row.clientName} ${row.title}`),
    };
  }

  return null;
}

function toScriptForDoc(r: ScriptForDoc): ScriptForDoc {
  return {
    id: r.id, title: r.title, pillar: r.pillar, format: r.format, hook: r.hook, body: r.body,
    cta: r.cta, locationName: r.locationName, presenter: r.presenter, requirements: r.requirements,
  };
}

function slugFile(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "script";
}
