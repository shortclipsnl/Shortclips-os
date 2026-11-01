import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { briefingSets, deliverables, productionDays, scripts } from "@/db/schema";
import { assertClientAccess, type Viewer } from "@/server/auth/context";
import type { EditorBriefing } from "@/server/actions/ai-tools";

export type BriefingStatus = "geen" | "bezig" | "klaar" | "bijgewerkt_script" | "mislukt";

export type ShootBriefing = {
  productionDayId: string;
  status: BriefingStatus;
  generatedAt: string | null;
  content: EditorBriefing | null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Volledige briefing van een opname (intern). Hard gescoopt op klanttoegang. */
export async function getBriefingForShoot(viewer: Viewer, productionDayId: string): Promise<ShootBriefing | null> {
  const [day] = await db
    .select({ id: productionDays.id, clientId: productionDays.clientId })
    .from(productionDays)
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return null;
  assertClientAccess(viewer, day.clientId);

  const [set] = await db
    .select({ status: briefingSets.status, generatedAt: briefingSets.generatedAt, content: briefingSets.content })
    .from(briefingSets)
    .where(and(eq(briefingSets.productionDayId, productionDayId), isNull(briefingSets.deletedAt)))
    .limit(1);

  return {
    productionDayId,
    status: (set?.status as BriefingStatus) ?? "geen",
    generatedAt: set?.generatedAt ? set.generatedAt.toISOString() : null,
    content: set ? ((set.content as unknown as EditorBriefing) ?? null) : null,
  };
}

export type VideoBriefing = {
  productionDayId: string;
  videoTitle: string;
  status: BriefingStatus;
  projectOmschrijving: string;
  algemeneAandachtspunten: string[];
  /** Aandachtspunten van de short die bij déze video hoort. */
  videoAandachtspunten: string[];
  aantalShorts: number;
};

/**
 * Briefing-aandachtspunten voor één video (editor-weergave): de algemene punten
 * van de sessie + de specifieke punten van de short die bij deze video hoort
 * (gematcht op titel). Scope via de klant van de video (en dus de editor-scope).
 */
export async function getBriefingForVideo(viewer: Viewer, videoId: string): Promise<VideoBriefing | null> {
  // De scripttitel (via scriptId) is de betrouwbaarste sleutel: de briefing-
  // shorts worden óók op scripttitel benoemd. De videotitel krijgt in de praktijk
  // een "(vN)"-achtervoegsel, dus die matcht alleen via bevat-logica.
  const [v] = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      clientId: deliverables.clientId,
      productionDayId: deliverables.productionDayId,
      scriptTitle: scripts.title,
    })
    .from(deliverables)
    .leftJoin(scripts, and(eq(scripts.id, deliverables.scriptId), isNull(scripts.deletedAt)))
    .where(and(eq(deliverables.id, videoId), isNull(deliverables.deletedAt)))
    .limit(1);
  if (!v || !v.productionDayId) return null;
  assertClientAccess(viewer, v.clientId);

  const [set] = await db
    .select({ status: briefingSets.status, content: briefingSets.content })
    .from(briefingSets)
    .where(and(eq(briefingSets.productionDayId, v.productionDayId), isNull(briefingSets.deletedAt)))
    .limit(1);
  if (!set) return null;

  const content = (set.content as unknown as EditorBriefing) ?? null;
  const intro = content?.projectIntro;
  const shorts = content?.shorts ?? [];
  // Short bij deze video zoeken. Eerst exact op de scripttitel (de sleutel waarop
  // de shorts zijn benoemd), dan exact op de videotitel, dan bevat-elkaar als
  // terugval voor "(vN)"-achtervoegsels.
  const st = v.scriptTitle ? norm(v.scriptTitle) : "";
  const vt = norm(v.title);
  const match =
    (st ? shorts.find((s) => norm(s.titel) === st) : undefined) ??
    shorts.find((s) => norm(s.titel) === vt) ??
    (st ? shorts.find((s) => norm(s.titel).includes(st) || st.includes(norm(s.titel))) : undefined) ??
    shorts.find((s) => vt && (norm(s.titel).includes(vt) || vt.includes(norm(s.titel)))) ??
    null;

  return {
    productionDayId: v.productionDayId,
    videoTitle: v.title,
    status: (set.status as BriefingStatus) ?? "geen",
    projectOmschrijving: intro?.omschrijving ?? "",
    algemeneAandachtspunten: intro?.algemeneAandachtspunten ?? [],
    videoAandachtspunten: match?.aandachtspunten ?? [],
    aantalShorts: intro?.aantalShorts ?? shorts.length,
  };
}
