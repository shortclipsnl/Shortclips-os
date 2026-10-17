import "server-only";
import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, productionDays, users } from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";
import { addWorkingDays, workingDaysUntil } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { videoPhase } from "@/lib/statuses";
import type { Tone } from "@/components/ui";

/**
 * Automatische deadlinebewaking per klantopname (§7), zoals in Monday.
 * Vanaf de opnamedatum loopt een timer van 14 werkdagen tot de klantoplevering;
 * de editor moet 2 werkdagen eerder opleveren voor interne controle. Werkdagen
 * tellen weekenden én Nederlandse feestdagen niet mee. Alles wordt live uit de
 * datum van vandaag berekend, dus het werkt zich dagelijks vanzelf bij.
 */

const TOTAL_WORKDAYS = 14; // opname → klantoplevering
const EDITOR_LEAD = 2; // editor levert 2 werkdagen vóór de klantdeadline

/** Status waarin de video (nog) bij de editor ligt. */
const AT_EDITOR = ["awaiting_editor", "editing", "editor_revision"];
/** Vanaf welke status is de video door de editor aangeleverd voor interne controle. */
const DELIVERED = ["internal_review", "client_review", "client_revision", "approved", "ready_to_publish", "scheduled", "published", "analysis_available"];

export type ShootColor = "groen" | "blauw" | "oranje" | "rood";

export type ShootShort = {
  id: string;
  title: string;
  status: string;
  phaseLabel: string;
  phaseTone: Tone;
  editorName: string | null;
  editorAvatar: string | null;
  delivered: boolean;
  atEditor: boolean;
};

export type ShootDeadline = {
  shootId: string;
  shootDate: string;
  title: string | null;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  editorDeadline: string;
  clientDeadline: string;
  elapsedWorkdays: number;
  totalWorkdays: number;
  remainingWorkdays: number;
  workdaysToEditorDeadline: number;
  workdaysToClientDeadline: number;
  color: ShootColor;
  atRisk: boolean;
  riskReason: string | null;
  deliveredCount: number;
  totalCount: number;
  shorts: ShootShort[];
};

export async function getShootDeadlines(viewer: Viewer): Promise<ShootDeadline[]> {
  const holidays = nlHolidaySet();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  // Opnames vanaf 40 dagen terug: binnen dat venster is de 14-werkdagentimer nog relevant.
  const windowStart = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);

  const conds = [
    isNull(deliverables.deletedAt),
    isNotNull(deliverables.productionDayId),
    isNull(productionDays.deletedAt),
    gte(productionDays.scheduledOn, windowStart),
    scopeToClients(viewer, deliverables.clientId),
  ];
  if (viewer.isEditorOnly) conds.push(eq(deliverables.editorId, viewer.id));

  const rows = await db
    .select({
      shootId: productionDays.id,
      shootDate: productionDays.scheduledOn,
      shootTitle: productionDays.title,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      videoId: deliverables.id,
      videoTitle: deliverables.title,
      status: deliverables.status,
      editorName: users.fullName,
      editorAvatar: users.avatarUrl,
    })
    .from(deliverables)
    .innerJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(users, eq(users.id, deliverables.editorId))
    .where(and(...conds))
    .orderBy(desc(productionDays.scheduledOn));

  // Groeperen per opname.
  const byShoot = new Map<string, ShootDeadline>();
  for (const r of rows) {
    let shoot = byShoot.get(r.shootId);
    if (!shoot) {
      const clientDeadline = addWorkingDays(r.shootDate, TOTAL_WORKDAYS, holidays);
      const editorDeadline = addWorkingDays(r.shootDate, TOTAL_WORKDAYS - EDITOR_LEAD, holidays);
      const elapsed = Math.max(0, Math.min(TOTAL_WORKDAYS, workingDaysUntil(r.shootDate, today, holidays)));
      shoot = {
        shootId: r.shootId,
        shootDate: r.shootDate,
        title: r.shootTitle,
        clientName: r.clientName,
        clientSlug: r.clientSlug,
        clientColor: r.clientColor,
        clientLogo: r.clientLogo,
        editorDeadline,
        clientDeadline,
        elapsedWorkdays: elapsed,
        totalWorkdays: TOTAL_WORKDAYS,
        remainingWorkdays: Math.max(0, TOTAL_WORKDAYS - elapsed),
        workdaysToEditorDeadline: workingDaysUntil(today, editorDeadline, holidays),
        workdaysToClientDeadline: workingDaysUntil(today, clientDeadline, holidays),
        color: "groen",
        atRisk: false,
        riskReason: null,
        deliveredCount: 0,
        totalCount: 0,
        shorts: [],
      };
      byShoot.set(r.shootId, shoot);
    }
    const phase = videoPhase(r.status);
    const delivered = DELIVERED.includes(r.status);
    shoot.shorts.push({
      id: r.videoId,
      title: r.videoTitle,
      status: r.status,
      phaseLabel: phase.label,
      phaseTone: phase.tone,
      editorName: r.editorName,
      editorAvatar: r.editorAvatar,
      delivered,
      atEditor: AT_EDITOR.includes(r.status),
    });
    shoot.totalCount++;
    if (delivered) shoot.deliveredCount++;
  }

  // Kleur + risico per opname bepalen.
  const result = [...byShoot.values()].map((s) => {
    const allDelivered = s.deliveredCount === s.totalCount;
    const anyAtEditor = s.shorts.some((v) => v.atEditor);
    const clientOverdue = !allDelivered && s.workdaysToClientDeadline < 0;
    const editorOverdue = !allDelivered && s.workdaysToEditorDeadline < 0;
    const editorSoon = !allDelivered && s.workdaysToEditorDeadline >= 0 && s.workdaysToEditorDeadline <= 2;

    let color: ShootColor;
    let riskReason: string | null = null;
    if (clientOverdue) { color = "rood"; riskReason = "Klantdeadline verstreken"; }
    else if (editorOverdue) { color = "rood"; riskReason = "Editordeadline verstreken"; }
    else if (editorSoon) { color = "oranje"; riskReason = `Editordeadline over ${s.workdaysToEditorDeadline} werkdag(en)`; }
    else if (anyAtEditor) color = "blauw";
    else color = "groen";

    return { ...s, color, atRisk: color === "rood" || color === "oranje", riskReason };
  });

  // Meest urgent bovenaan.
  const order: Record<ShootColor, number> = { rood: 0, oranje: 1, blauw: 2, groen: 3 };
  result.sort((a, b) => order[a.color] - order[b.color] || a.clientDeadline.localeCompare(b.clientDeadline));
  return result;
}
