import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/db/client";
import { productionDays } from "@/db/schema";
import { assertClientAccess, canManageEditingProjects, editorMayOpenShoot, ForbiddenError, type Viewer } from "@/server/auth/context";
import { assembleBriefing, coverImageDataUri, type BriefingDoc } from "./assemble";
import { renderBriefingHtml } from "./render-html";

/**
 * Eén poort voor de briefing (pagina én PDF): Team Shortclips binnen de eigen
 * klanten; editors alleen voor een opname die aan hen is toegewezen.
 * Editors kunnen alleen lezen en downloaden (`canEdit` = false).
 */
export async function loadBriefingFor(viewer: Viewer, productionDayId: string): Promise<{ doc: BriefingDoc; canEdit: boolean } | null> {
  if (viewer.isPortalUser) throw new ForbiddenError("Geen toegang.");
  const [day] = await db
    .select({ clientId: productionDays.clientId })
    .from(productionDays)
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return null;
  assertClientAccess(viewer, day.clientId);
  if (!(await editorMayOpenShoot(viewer, productionDayId))) throw new ForbiddenError("Deze opname is niet aan jou toegewezen.");
  const doc = await assembleBriefing(productionDayId);
  if (!doc) return null;
  return { doc, canEdit: canManageEditingProjects(viewer) };
}

let logoCache: string | null | undefined;
function logoDataUri(): string | null {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), "public", "shortclips-logo-ondark.png"));
    logoCache = `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

export async function briefingHtml(doc: BriefingDoc, mode: "screen" | "pdf"): Promise<string> {
  const cover = await coverImageDataUri(doc);
  return renderBriefingHtml(doc, { coverDataUri: cover, logoDataUri: logoDataUri(), mode, appUrl: process.env.APP_URL });
}
