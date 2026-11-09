import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { briefingSets, clientDocuments, clients, deliverables, kbAssetParts, kbAssets, productionDays } from "@/db/schema";
import { recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { shootReviewPdf } from "@/server/captions/generate";
import { runJsonPrompt } from "@/server/ai/client";
import { parseScriptPdf, type ParsedScriptPdf } from "@/server/briefing/script-pdf";
import { HIGHLIGHT_SYSTEM, highlightUserPrompt, pdfPlainText, verifyHighlights, type GuideHighlight } from "@/server/briefing/guide-highlights";
import { isStoreV2, type BriefingStoreV2 } from "@/server/briefing/types";

const STALE_RUNNING_MIN = 10;

export type EnsureBriefingResult =
  | { ok: true; status: "generated" | "updated" }
  | { ok: false; reason: "no_pdf" | "unchanged" | "in_progress" | "cancelled" | "not_found" | "error"; message?: string };

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/** Geldende Editing Guide van de klant: hash + (lazy) bytes. */
async function currentGuide(clientId: string): Promise<{ assetId: string; fileName: string; hash: string } | null> {
  const [g] = await db
    .select({ assetId: clientDocuments.assetId, fileName: clientDocuments.fileName, sha: kbAssets.sha256, complete: kbAssets.isComplete })
    .from(clientDocuments)
    .innerJoin(kbAssets, eq(kbAssets.id, clientDocuments.assetId))
    .where(and(eq(clientDocuments.clientId, clientId), eq(clientDocuments.kind, "editing_guide"), isNull(clientDocuments.deletedAt)))
    .orderBy(desc(clientDocuments.createdAt))
    .limit(1);
  if (!g || !g.complete) return null;
  return { assetId: g.assetId, fileName: g.fileName, hash: g.sha ?? g.assetId };
}

async function assetBytes(assetId: string): Promise<Uint8Array> {
  const parts = await db
    .select({ data: kbAssetParts.data })
    .from(kbAssetParts)
    .where(eq(kbAssetParts.assetId, assetId))
    .orderBy(asc(kbAssetParts.partNo));
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p.data))));
}

/** Highlights uit de guide: AI kiest, de code controleert letterlijkheid. */
async function buildHighlights(clientName: string, assetId: string): Promise<{ highlights: GuideHighlight[]; error: string | null }> {
  try {
    const text = await pdfPlainText(await assetBytes(assetId));
    if (!text.trim()) return { highlights: [], error: "De Editing Guide bevat geen leesbare tekst." };
    // Ruim tokenbudget: het model denkt eerst na; te weinig ruimte geeft een afgekapt (ongeldig) antwoord.
    const res = await runJsonPrompt<{ highlights?: unknown }>({ system: HIGHLIGHT_SYSTEM, user: highlightUserPrompt(clientName, text), maxTokens: 8000 });
    if (!res.ok) return { highlights: [], error: res.reason === "no_provider" ? "AI is niet ingesteld." : `AI niet gelukt (${(res.error ?? "onbekend").slice(0, 160)}); volgende ronde opnieuw.` };
    const highlights = verifyHighlights(res.data?.highlights, text);
    return { highlights, error: highlights.length ? null : "Geen letterlijke richtlijnen gevonden." };
  } catch (e) {
    return { highlights: [], error: e instanceof Error ? e.message.slice(0, 200) : "Onbekende fout." };
  }
}

/**
 * Zorgt dat de editor-briefing (v2) van één opname actueel is.
 *  - Scripts: letterlijk uit de script-PDF (geen AI).
 *  - Highlights: per guide-versie één keer gemaakt en gecontroleerd.
 *  - Handmatige correcties (overrides) blijven altijd staan.
 * Draait als systeem.
 */
export async function ensureBriefingForShoot(productionDayId: string, opts: { force?: boolean } = {}): Promise<EnsureBriefingResult> {
  const [day] = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      status: productionDays.status,
      scheduledOn: productionDays.scheduledOn,
      clientName: clients.name,
      coordinatorId: clients.coordinatorId,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return { ok: false, reason: "not_found" };
  if (day.status === "cancelled") return { ok: false, reason: "cancelled" };

  const pdf = await shootReviewPdf(productionDayId);
  if (!pdf) return { ok: false, reason: "no_pdf" };
  const guide = await currentGuide(day.clientId);

  const [existing] = await db
    .select({ id: briefingSets.id, status: briefingSets.status, sourceHash: briefingSets.sourceHash, startedAt: briefingSets.startedAt, content: briefingSets.content })
    .from(briefingSets)
    .where(and(eq(briefingSets.productionDayId, productionDayId), isNull(briefingSets.deletedAt)))
    .limit(1);
  const prev: BriefingStoreV2 | null = existing && isStoreV2(existing.content) ? existing.content : null;

  if (existing && !opts.force) {
    const guideSame = (prev?.guide.hash ?? null) === (guide?.hash ?? null) && !prev?.guide.error;
    if (prev && prev.scriptPages && existing.sourceHash === pdf.hash && guideSame && existing.status !== "mislukt" && existing.status !== "bezig") {
      return { ok: false, reason: "unchanged" };
    }
    if (existing.status === "bezig" && existing.startedAt) {
      const ageMin = (Date.now() - existing.startedAt.getTime()) / 60000;
      if (ageMin < STALE_RUNNING_MIN) return { ok: false, reason: "in_progress" };
    }
  }
  const scriptChanged = !prev || prev.source.hash !== pdf.hash;

  const now = new Date();
  const [set] = await db
    .insert(briefingSets)
    .values({ productionDayId, clientId: day.clientId, status: "bezig", startedAt: now })
    .onConflictDoUpdate({ target: briefingSets.productionDayId, set: { status: "bezig", startedAt: now, deletedAt: null, updatedAt: now } })
    .returning({ id: briefingSets.id });
  const setId = set!.id;

  const fail = async (message: string): Promise<EnsureBriefingResult> => {
    await db
      .update(briefingSets)
      .set({ status: "mislukt", errorMessage: message.slice(0, 500), startedAt: null, updatedAt: new Date() })
      .where(eq(briefingSets.id, setId));
    return { ok: false, reason: "error", message };
  };

  // 1. Scripts letterlijk uit de PDF.
  let scripts: ParsedScriptPdf;
  try {
    scripts = await parseScriptPdf(new Uint8Array(Buffer.from(pdf.pdfBase64, "base64")));
  } catch (e) {
    const name = pdf.fileName ?? "";
    return fail(
      name.startsWith("._")
        ? `"${name}" is een macOS-hulpbestand, geen script. Koppel het juiste bestand.`
        : `De script-PDF kon niet worden gelezen (${e instanceof Error ? e.message.slice(0, 120) : "onbekende fout"}).`,
    );
  }
  // Geen titels herkend (afwijkende opmaak)? Dan toch een briefing: alle pagina's
  // met tekst gaan mee als scriptpagina's en de briefing meldt dat de titels ontbreken.
  if (scripts.scripts.length === 0 && scripts.pageCount === scripts.imagePages.length) {
    return fail(scripts.warnings[0] ?? "De script-PDF bevat geen leesbare tekst.");
  }

  // 2. De scriptpagina's zelf (exact zoals in de PDF), zonder voorblad en
  //    beeldpagina's. Hergebruiken zolang de script-PDF niet is veranderd.
  let scriptPages: BriefingStoreV2["scriptPages"] = null;
  const pages = scripts.scripts.length
    ? [...new Set(scripts.scripts.flatMap((s) => s.pages))].sort((a, b) => a - b)
    : Array.from({ length: scripts.pageCount }, (_, i) => i + 1).filter((p) => !scripts.imagePages.includes(p));
  if (pages.length) scriptPages = { pages, sourceHash: pdf.hash };

  // 3. Highlights: hergebruiken zolang de guide gelijk is.
  let guidePart: BriefingStoreV2["guide"];
  if (!guide) guidePart = { hash: null, fileName: null, highlights: [], error: null };
  else if (prev && prev.guide.hash === guide.hash && !prev.guide.error && prev.guide.highlights.length) guidePart = prev.guide;
  else {
    const hl = await buildHighlights(day.clientName, guide.assetId);
    guidePart = { hash: guide.hash, fileName: guide.fileName, highlights: hl.highlights, error: hl.error };
  }

  const content: BriefingStoreV2 = {
    v: 2,
    source: { fileName: pdf.fileName ?? "script.pdf", origin: pdf.origin === "review" ? "review" : "drive", hash: pdf.hash, parsedAt: new Date().toISOString() },
    scripts,
    scriptPages,
    guide: guidePart,
    // Handmatige correcties nooit overschrijven.
    ...(prev?.overrides ? { overrides: prev.overrides } : {}),
    // Oude velden voor bestaande weergaven (editingbord, videopagina).
    projectIntro: {
      client: day.clientName,
      aantalShorts: scripts.scripts.length,
      omschrijving: "",
      algemeneAandachtspunten: (prev?.overrides?.highlights?.length ? prev.overrides.highlights : guidePart.highlights).map((h) => `${h.niet ? "Niet: " : ""}${h.tekst}`),
    },
    shorts: scripts.scripts.map((s) => ({ titel: s.title, omschrijving: "", aandachtspunten: [] })),
  };

  const finalStatus = prev && scriptChanged ? "bijgewerkt_script" : prev && existing?.status === "bijgewerkt_script" ? "bijgewerkt_script" : "klaar";
  await db
    .update(briefingSets)
    .set({
      status: finalStatus,
      // Overrides die tijdens deze run zijn opgeslagen, blijven staan.
      content: sql`${JSON.stringify(content)}::jsonb || case when ${briefingSets.content} ? 'overrides' then jsonb_build_object('overrides', ${briefingSets.content}->'overrides') else '{}'::jsonb end`,
      sourceHash: pdf.hash,
      sourceReviewVersionId: pdf.reviewVersionId,
      generatedAt: new Date(),
      startedAt: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(briefingSets.id, setId));

  // Alleen melden bij een nieuwe briefing of een nieuw script; een guide-update
  // of een herberekening is geen reden om editors te storen.
  if (scriptChanged) {
    const editorRows = await db
      .selectDistinct({ editorId: deliverables.editorId })
      .from(deliverables)
      .where(and(eq(deliverables.productionDayId, productionDayId), isNull(deliverables.deletedAt)));
    const editorIds = editorRows.map((e) => e.editorId).filter((x): x is string => !!x);
    const userIds = [day.coordinatorId, ...editorIds].filter((x): x is string => !!x);
    const dateLabel = fmtDate(day.scheduledOn as unknown as string);
    await notify({
      roles: ["owner"],
      userIds: userIds.length ? userIds : undefined,
      clientId: day.clientId,
      level: "info",
      type: "briefing_ready",
      title: prev ? "Editor-briefing bijgewerkt (nieuw script)" : "Editor-briefing klaar",
      body: `De editor-briefing voor de opname van ${day.clientName}${dateLabel ? ` (${dateLabel})` : ""} staat klaar.`,
      href: `/productions/${productionDayId}/briefing`,
      entityType: "briefing_set",
      entityId: setId,
      dedupeKey: `briefing_ready:${productionDayId}:${pdf.hash.slice(0, 12)}`,
    }).catch(() => undefined);
    await recordActivity({
      clientId: day.clientId,
      type: "briefing.generated",
      title: prev ? "Editor-briefing bijgewerkt na nieuw script" : "Editor-briefing automatisch gemaakt",
      isClientVisible: false,
    }).catch(() => undefined);
  }

  return { ok: true, status: prev ? "updated" : "generated" };
}
