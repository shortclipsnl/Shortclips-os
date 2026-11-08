import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  briefingSets,
  clientDocuments,
  clients,
  deliverables,
  files,
  frameAssets,
  productionDays,
  scripts as scriptsTable,
  shootScriptSources,
  users,
} from "@/db/schema";
import { editorDeadline } from "@/lib/edit-deadline";
import { nlHolidaySet } from "@/lib/holidays";
import type { GuideHighlight } from "./guide-highlights";
import type { ParsedScript } from "./script-pdf";
import { isStoreV2, type BriefingStoreV2 } from "./types";

export type BriefingLink = { key: string; label: string; href: string | null; note?: string };
export type BriefingStill = { assetId: string; name: string; frameFileId: string };

/** Alles wat de briefing nodig heeft, live samengesteld. */
export type BriefingDoc = {
  productionDayId: string;
  status: string;
  generatedAt: string | null;
  updatedAt: string | null;
  client: { id: string; name: string; logoUrl: string | null };
  session: { title: string; date: string; sessionName: string | null; projectName: string | null };
  editor: { name: string | null };
  /** Editor deadline (zie lib/edit-deadline): nooit de klantdeadline. */
  editorDueOn: string | null;
  /** Uitleg als er (nu) geen editor deadline is. */
  editorDueNote: string | null;
  shortsCount: number;
  scripts: ParsedScript[];
  scriptWarnings: string[];
  imagePages: number[];
  highlights: GuideHighlight[];
  highlightsCorrected: boolean;
  /** Guide is gewijzigd ná een handmatige correctie van de highlights. */
  highlightsStale: boolean;
  guideAvailable: boolean;
  teamNote: string | null;
  links: BriefingLink[];
  missing: string[];
  checks: string[];
  stills: BriefingStill[];
  coverAssetId: string | null;
  sourceFileName: string | null;
};

const cleanTitle = (t: string) =>
  t
    .replace(/^\s*\d{1,2}[:.]\d{2}(\s*-\s*\d{1,2}[:.]\d{2})?\s*[-–]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const toIsoDay = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Volgnummer uit een Frame-bestandsnaam ("3. TITEL - Shortclips.mp4" → 3). */
const leadingNo = (name: string) => Number(name.match(/^\s*(\d{1,2})[.\s]/)?.[1] ?? 999);

export async function assembleBriefing(
  productionDayId: string,
  opts: { storeOverride?: BriefingStoreV2 } = {},
): Promise<BriefingDoc | null> {
  const [day] = await db
    .select({
      id: productionDays.id,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      clientId: productionDays.clientId,
      editorId: productionDays.editorId,
      footageUrl: productionDays.footageUrl,
      scriptUrl: productionDays.scriptUrl,
      driveFolderId: productionDays.driveFolderId,
      plannedShorts: productionDays.plannedShorts,
      clientName: clients.name,
      logoUrl: clients.logoUrl,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return null;

  const [set] = await db
    .select({ status: briefingSets.status, content: briefingSets.content, generatedAt: briefingSets.generatedAt, updatedAt: briefingSets.updatedAt })
    .from(briefingSets)
    .where(and(eq(briefingSets.productionDayId, productionDayId), isNull(briefingSets.deletedAt)))
    .limit(1);
  const store: BriefingStoreV2 | null = opts.storeOverride ?? (set && isStoreV2(set.content) ? set.content : null);

  // Het editingproject van deze opname (meestal één per sessie).
  const projects = await db
    .select({
      id: deliverables.id,
      status: deliverables.status,
      dueOn: deliverables.dueOn,
      shootOn: deliverables.shootOn,
      editorId: deliverables.editorId,
      footageUrl: deliverables.footageUrl,
      driveFolderId: deliverables.driveFolderId,
      briefing: deliverables.briefing,
      plannedShorts: deliverables.plannedShorts,
    })
    .from(deliverables)
    .where(and(eq(deliverables.productionDayId, productionDayId), isNull(deliverables.deletedAt)))
    .orderBy(asc(deliverables.createdAt));
  const project = projects[0] ?? null;

  const editorId = day.editorId ?? project?.editorId ?? null;
  const [editor] = editorId
    ? await db.select({ name: users.fullName }).from(users).where(eq(users.id, editorId)).limit(1)
    : [];

  const holidays = nlHolidaySet();
  const editorDueOn = project
    ? editorDeadline(project.status, day.scheduledOn ?? project.shootOn, project.dueOn, holidays)
    : null;
  const AT_TEAM: Record<string, string> = {
    internal_review: "Ligt bij Team Shortclips",
    client_review: "Ligt bij de klant",
    approved: "Goedgekeurd",
    scheduled: "Afgerond",
    published: "Afgerond",
  };
  const editorDueNote = editorDueOn ? null : project ? AT_TEAM[project.status] ?? null : null;

  // Script-bron (Drive-PDF of scriptcontrole in het portaal).
  const [src] = await db
    .select({ fileName: shootScriptSources.fileName, url: files.externalUrl, externalId: shootScriptSources.fileExternalId })
    .from(shootScriptSources)
    .leftJoin(files, and(eq(files.externalId, shootScriptSources.fileExternalId), isNull(files.deletedAt)))
    .where(and(eq(shootScriptSources.productionDayId, productionDayId), eq(shootScriptSources.status, "gekoppeld")))
    .limit(1);

  // Editing Guide (geldende versie).
  const [guide] = await db
    .select({ id: clientDocuments.id, fileName: clientDocuments.fileName })
    .from(clientDocuments)
    .where(and(eq(clientDocuments.clientId, day.clientId), eq(clientDocuments.kind, "editing_guide"), isNull(clientDocuments.deletedAt)))
    .orderBy(desc(clientDocuments.createdAt))
    .limit(1);

  // Stills uit Frame.io van deze sessie.
  const stillRows = await db
    .select({ id: frameAssets.id, name: frameAssets.name, frameFileId: frameAssets.frameFileId, sessionViewUrl: frameAssets.sessionViewUrl, sessionName: frameAssets.sessionName })
    .from(frameAssets)
    .where(eq(frameAssets.sessionProductionDayId, productionDayId))
    .limit(60);
  const stills = stillRows
    .map((s) => ({ assetId: s.id, name: s.name, frameFileId: s.frameFileId }))
    .sort((a, b) => leadingNo(a.name) - leadingNo(b.name) || a.name.localeCompare(b.name));
  const frameSessionUrl = stillRows.find((s) => s.sessionViewUrl)?.sessionViewUrl ?? null;
  const sessionName = stillRows.find((s) => s.sessionName)?.sessionName ?? null;

  const scripts = store?.scripts.scripts ?? [];
  const fileBase = (store?.source.fileName ?? src?.fileName ?? "")
    .replace(/^\._/, "")
    .replace(/\.pdf$/i, "")
    .replace(/\s+kopie$/i, "")
    .replace(/^(organisch|advertentie[s]?)\s*-\s*/i, "")
    .replace(/^(short\s*(form\s*)?video\s*)?scripts?\s*-\s*/i, "")
    .replace(/^shortclips\s*-\s*/i, "")
    .trim();
  const projectName = fileBase || (sessionName ? sessionName.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : null);
  const scriptWarnings = [...(store?.scripts.warnings ?? [])];

  // ---------- Links (alleen echte, gekoppelde links; niets verzinnen) ----------
  const footage = project?.footageUrl || day.footageUrl || null;
  const driveFolder = project?.driveFolderId || day.driveFolderId || null;
  const referenceLinks = [...new Set(scripts.flatMap((s) => s.links))];
  const scriptHref = src?.url || (src?.externalId ? `https://drive.google.com/file/d/${src.externalId}/view` : null) || day.scriptUrl || null;
  const links: BriefingLink[] = [
    { key: "footage", label: "Ruwe videobeelden", href: footage },
    {
      key: "extra",
      label: "Aanvullende beelden",
      href: driveFolder ? `https://drive.google.com/drive/folders/${driveFolder}` : null,
      note: driveFolder ? undefined : "geen aparte map gekoppeld",
    },
    { key: "script", label: "Script-PDF (origineel)", href: scriptHref, note: src?.fileName ?? undefined },
    { key: "guide", label: "Volledige Editing Guide", href: guide ? `/api/klantdocumenten/${day.clientId}/editing_guide` : null },
    ...(frameSessionUrl ? [{ key: "frame", label: "Frame.io sessie", href: frameSessionUrl }] : []),
    ...referenceLinks.map((href, i) => ({ key: `ref${i}`, label: referenceLinks.length > 1 ? `Referentievideo ${i + 1}` : "Referentievideo", href })),
  ];

  // ---------- Wat ontbreekt ----------
  const missing: string[] = [];
  if (!store) missing.push("Briefing nog niet gemaakt: er is nog geen leesbare script-PDF gekoppeld aan deze opname.");
  if (!editor?.name) missing.push("Nog geen editor toegewezen.");
  if (!editorDueOn && !editorDueNote) missing.push("Nog geen editor deadline (opnamedatum of klantdeadline ontbreekt, of het werk ligt niet bij de editor).");
  if (!footage) missing.push("Link naar de ruwe videobeelden ontbreekt.");
  if (!guide) missing.push(`Er staat nog geen Editing Guide voor ${day.clientName} in het portaal.`);
  if (src?.fileName?.startsWith("._")) {
    missing.push(`De gekoppelde script-PDF "${src.fileName}" is een macOS-hulpbestand, geen echt script. Koppel het juiste bestand (zonder "._").`);
  }

  // ---------- Controles ----------
  const checks: string[] = [];
  const planned = project?.plannedShorts ?? day.plannedShorts ?? Number(day.title.match(/(\d{1,2})\s*shorts?/i)?.[1] ?? NaN);
  if (store && Number.isFinite(planned) && planned > 0 && planned !== scripts.length) {
    checks.push(`Aantal klopt niet: de opname noemt ${planned} shorts, de script-PDF bevat ${scripts.length} scripts.`);
  }
  // Videotitels in het portaal (scripts gekoppeld aan deze opname) vs. de PDF.
  const portalTitles = await db
    .select({ title: scriptsTable.title })
    .from(scriptsTable)
    .where(and(eq(scriptsTable.productionDayId, productionDayId), isNull(scriptsTable.deletedAt)));
  if (store && portalTitles.length > 0) {
    const inPdf = new Set(scripts.map((s) => norm(s.title)));
    const notInPdf = portalTitles.filter((t) => !inPdf.has(norm(t.title))).map((t) => t.title);
    if (notInPdf.length) checks.push(`Deze titels staan in het portaal maar niet (exact zo) in de script-PDF: ${notInPdf.join(", ")}.`);
  }

  const ov = store?.overrides ?? {};
  const corrected = Array.isArray(ov.highlights) && ov.highlights.length > 0;
  const highlights = corrected ? ov.highlights! : store?.guide.highlights ?? [];
  const highlightsStale = Boolean(corrected && ov.highlightsGuideHash && store?.guide.hash && ov.highlightsGuideHash !== store.guide.hash);
  if (highlightsStale) checks.push("De Editing Guide is vervangen na de handmatige correctie van de highlights. Controleer of ze nog kloppen.");
  if (store && guide && !corrected && highlights.length === 0) {
    checks.push(store.guide.error ? `Highlights uit de Editing Guide nog niet beschikbaar: ${store.guide.error}` : "Er zijn nog geen highlights uit de Editing Guide gehaald.");
  }

  const coverAssetId = ov.coverAssetId && stills.some((s) => s.assetId === ov.coverAssetId) ? ov.coverAssetId : stills[0]?.assetId ?? null;

  return {
    productionDayId,
    status: set?.status ?? "geen",
    generatedAt: set?.generatedAt ? new Date(set.generatedAt).toISOString() : null,
    updatedAt: set?.updatedAt ? new Date(set.updatedAt).toISOString() : null,
    client: { id: day.clientId, name: day.clientName, logoUrl: day.logoUrl },
    session: { title: cleanTitle(day.title), date: toIsoDay(day.scheduledOn), sessionName, projectName },
    editor: { name: editor?.name ?? null },
    editorDueOn,
    editorDueNote,
    shortsCount: scripts.length,
    scripts,
    scriptWarnings,
    imagePages: store?.scripts.imagePages ?? [],
    highlights,
    highlightsCorrected: corrected,
    highlightsStale,
    guideAvailable: Boolean(guide),
    teamNote: project?.briefing?.trim() || null,
    links,
    missing,
    checks,
    stills,
    coverAssetId,
    sourceFileName: store?.source.fileName ?? src?.fileName ?? null,
  };
}

/** Haalt het omslagbeeld op als data-URI (werkt in het portaal én in de PDF). */
export async function coverImageDataUri(doc: BriefingDoc): Promise<string | null> {
  const still = doc.stills.find((s) => s.assetId === doc.coverAssetId);
  if (!still) return null;
  try {
    const { frameio } = await import("@/server/integrations/frameio");
    const url = (await frameio.getFileThumbnailHq(still.frameFileId)) ?? (await frameio.getFileThumbnail(still.frameFileId));
    if (!url) return null;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 2_500_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

