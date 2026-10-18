import "server-only";
import { and, between, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { addWorkingDays, workingDaysUntil } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";

const TOTAL_WORKDAYS = 14; // opname → klantoplevering
const EDITOR_LEAD = 2; // editor levert 2 werkdagen eerder op

export type BatteryColor = "groen" | "blauw" | "oranje" | "rood";

export type EditingProject = {
  id: string;
  shootDate: string;
  title: string | null;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  editorId: string | null;
  editorName: string | null;
  editorAvatar: string | null;
  editStatus: string;
  plannedShorts: number | null;
  shortsCount: number;
  footageUrl: string | null;
  scriptUrl: string | null;
  editorDeadline: string;
  clientDeadline: string;
  elapsedWorkdays: number;
  totalWorkdays: number;
  remainingWorkdays: number;
  workdaysToClientDeadline: number;
  batteryColor: BatteryColor;
};

/**
 * Editing-projecten = opnames (production_days), met de 14-werkdagenbatterij,
 * de toegewezen editor, de editingfase en het aantal shorts. Opnames komen al
 * automatisch uit Google Agenda, dus dit board werkt zich vanzelf bij als er
 * een opname bijkomt of verdwijnt. Editors zien (buiten het board om) alleen
 * hun eigen projecten.
 */
export async function listEditingProjects(
  viewer: Viewer,
  opts: { editorId?: string } = {},
): Promise<EditingProject[]> {
  const holidays = nlHolidaySet();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const windowStart = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const windowEnd = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const conds = [
    isNull(productionDays.deletedAt),
    ne(productionDays.status, "cancelled"),
    between(productionDays.scheduledOn, windowStart, windowEnd),
    scopeToClients(viewer, productionDays.clientId),
  ];
  // Editors zien alleen hun eigen projecten; anderen kunnen op editor filteren.
  const filterEditor = viewer.isEditorOnly ? viewer.id : opts.editorId;
  if (filterEditor) conds.push(eq(productionDays.editorId, filterEditor));

  const rows = await db
    .select({
      id: productionDays.id,
      shootDate: productionDays.scheduledOn,
      title: productionDays.title,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      editorId: productionDays.editorId,
      editorName: users.fullName,
      editorAvatar: users.avatarUrl,
      editStatus: productionDays.editStatus,
      plannedShorts: productionDays.plannedShorts,
      footageUrl: productionDays.footageUrl,
      scriptUrl: productionDays.scriptUrl,
      shortsCount: sql<number>`(select count(*) from deliverables d where d.production_day_id = production_days.id and d.deleted_at is null)`,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.editorId))
    .where(and(...conds))
    .orderBy(desc(productionDays.scheduledOn))
    .limit(400);

  const result = rows.map((r) => {
    const clientDeadline = addWorkingDays(r.shootDate, TOTAL_WORKDAYS, holidays);
    const editorDeadline = addWorkingDays(r.shootDate, TOTAL_WORKDAYS - EDITOR_LEAD, holidays);
    const elapsed = Math.max(0, Math.min(TOTAL_WORKDAYS, workingDaysUntil(r.shootDate, today, holidays)));
    const workdaysToClientDeadline = workingDaysUntil(today, clientDeadline, holidays);
    const done = r.editStatus === "afgerond";
    const atEditor = r.editStatus === "in_edit" || r.editStatus === "feedback_verwerken";

    let batteryColor: BatteryColor;
    if (done) batteryColor = "groen";
    else if (workdaysToClientDeadline < 0) batteryColor = "rood";
    else if (workdaysToClientDeadline <= 2) batteryColor = "oranje";
    else if (atEditor) batteryColor = "blauw";
    else batteryColor = "groen";

    return {
      id: r.id,
      shootDate: r.shootDate,
      title: r.title,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      clientColor: r.clientColor,
      clientLogo: r.clientLogo,
      editorId: r.editorId,
      editorName: r.editorName,
      editorAvatar: r.editorAvatar,
      editStatus: r.editStatus,
      plannedShorts: r.plannedShorts,
      shortsCount: Number(r.shortsCount ?? 0),
      footageUrl: r.footageUrl,
      scriptUrl: r.scriptUrl,
      editorDeadline,
      clientDeadline,
      elapsedWorkdays: elapsed,
      totalWorkdays: TOTAL_WORKDAYS,
      remainingWorkdays: Math.max(0, TOTAL_WORKDAYS - elapsed),
      workdaysToClientDeadline,
      batteryColor,
    };
  });

  // Meest urgent bovenaan (afgerond onderaan).
  const order: Record<BatteryColor, number> = { rood: 0, oranje: 1, blauw: 2, groen: 3 };
  result.sort((a, b) => {
    const ad = a.editStatus === "afgerond" ? 1 : 0;
    const bd = b.editStatus === "afgerond" ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return order[a.batteryColor] - order[b.batteryColor] || a.clientDeadline.localeCompare(b.clientDeadline);
  });
  return result;
}
