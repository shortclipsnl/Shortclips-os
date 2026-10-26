import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientAiProfiles,
  clientEditingGuides,
  clientKnowledge,
  clients,
  deliverables,
  productionDays,
} from "@/db/schema";
import { can, canManageClients, isOwner, requireInternal, type Viewer } from "@/server/auth/context";

/**
 * Persoonlijke klantenbibliotheek voor editors. Puur ter informatie: de Editing
 * Guide-PDF en de editinginfo uit de kennisbank (clientKnowledge,
 * clientAiProfiles.editingProfile). Editors krijgen hier BEWUST geen toegang tot
 * projectbestanden (scripts/PDF's uit Google Drive) — die horen hier niet thuis.
 * Een editor ziet uitsluitend de klanten waaraan hij gekoppeld is; de grens
 * wordt server-side afgedwongen (niet alleen in de UI).
 */

/** Categorieën klantkennis die als editingrichtlijn gelden. */
const EDITING_CATEGORIES = ["editing_style", "tone_of_voice", "hook_style", "avoid_words", "recurring_correction", "branding", "content_pillar"];
/** Categorieën die "over de klant" beschrijven. */
const ABOUT_CATEGORIES = ["fact", "strategy", "doelgroep", "competitor"];

const CATEGORY_LABEL: Record<string, string> = {
  editing_style: "Editingstijl", tone_of_voice: "Tone of voice", hook_style: "Hookstijl",
  avoid_words: "Niet gebruiken", recurring_correction: "Terugkerende correctie", branding: "Branding",
  content_pillar: "Contentpijler", fact: "Over de klant", strategy: "Strategie", doelgroep: "Doelgroep",
  competitor: "Concurrentie", strong_example: "Goed voorbeeld", weak_example: "Minder voorbeeld",
};

export type MyClient = {
  id: string; name: string; slug: string; logoUrl: string | null; color: string | null;
  sector: string | null; description: string | null;
  hasGuide: boolean; guideUpdatedAt: Date | null; richtlijnenCount: number;
  lastUpdated: Date | null;
};

/** Mag deze gebruiker de bibliotheek beheren (Editing Guide uploaden)? */
export function canManageLibrary(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return isOwner(viewer) || canManageClients(viewer) || can(viewer, "clients:write") || can(viewer, "knowledge:write");
}

/**
 * De klant-ids waaraan deze gebruiker gekoppeld is. Voor een editor = klanten
 * waarvoor hij een video (deliverable) of opnamedag heeft, plus de normale scope.
 * Voor de eigenaar/`clients:read_all` → null (alle klanten).
 */
export async function getMyClientIds(viewer: Viewer): Promise<Set<string> | null> {
  if (viewer.clientScope === null) return null;
  const ids = new Set<string>(viewer.clientScope);
  // Toekomstbestendig: ook klanten waar de editor (nog) alleen aan een opnamedag hangt.
  const pd = await db
    .selectDistinct({ id: productionDays.clientId })
    .from(productionDays)
    .where(and(eq(productionDays.editorId, viewer.id), isNull(productionDays.deletedAt)));
  for (const r of pd) if (r.id) ids.add(r.id);
  // En klanten waarvoor hij een deliverable heeft (zit meestal al in scope, maar
  // expliciet voor de zekerheid).
  const dv = await db
    .selectDistinct({ id: deliverables.clientId })
    .from(deliverables)
    .where(and(eq(deliverables.editorId, viewer.id), isNull(deliverables.deletedAt)));
  for (const r of dv) ids.add(r.id);
  return ids;
}

/** Lijst met de klanten van deze gebruiker, met samenvattende tellingen. */
export async function listMyClients(viewer: Viewer): Promise<MyClient[]> {
  const myIds = await getMyClientIds(viewer);
  if (myIds && myIds.size === 0) return [];

  const whereClient = and(
    isNull(clients.deletedAt),
    sql`${clients.status} <> 'churned'`,
    myIds ? inArray(clients.id, [...myIds]) : undefined,
  );
  const rows = await db
    .select({
      id: clients.id, name: clients.name, slug: clients.slug, logoUrl: clients.logoUrl,
      color: clients.color, sector: clients.sector, description: clients.description, updatedAt: clients.updatedAt,
    })
    .from(clients)
    .where(whereClient)
    .orderBy(clients.name);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // Per-klant aanvullende cijfers in losse grouped queries (vermijdt zware joins).
  const guideRows = await db
    .select({ clientId: clientEditingGuides.clientId, laatste: sql<string>`max(${clientEditingGuides.createdAt})` })
    .from(clientEditingGuides)
    .where(and(inArray(clientEditingGuides.clientId, ids), isNull(clientEditingGuides.deletedAt)))
    .groupBy(clientEditingGuides.clientId);
  const guideByClient = new Map(guideRows.map((g) => [g.clientId, g.laatste ? new Date(g.laatste) : null]));

  const knRows = await db
    .select({ clientId: clientKnowledge.clientId, n: sql<number>`count(*)::int` })
    .from(clientKnowledge)
    .where(and(inArray(clientKnowledge.clientId, ids), isNull(clientKnowledge.deletedAt), inArray(clientKnowledge.category, EDITING_CATEGORIES)))
    .groupBy(clientKnowledge.clientId);
  const knByClient = new Map(knRows.map((k) => [k.clientId, Number(k.n)]));

  return rows.map((c) => {
    const guideUpdatedAt = guideByClient.get(c.id) ?? null;
    const lastUpdated = guideUpdatedAt ?? c.updatedAt ?? null;
    return {
      id: c.id, name: c.name, slug: c.slug, logoUrl: c.logoUrl, color: c.color, sector: c.sector,
      description: c.description,
      hasGuide: guideByClient.has(c.id),
      guideUpdatedAt,
      richtlijnenCount: knByClient.get(c.id) ?? 0,
      lastUpdated,
    };
  });
}

export type GuideMeta = { id: string; fileName: string; sizeBytes: number; updatedAt: Date };

/** De meest recente Editing Guide van een klant (metadata, zonder de bytes). */
export async function getLatestEditingGuide(clientId: string): Promise<GuideMeta | null> {
  const [g] = await db
    .select({ id: clientEditingGuides.id, fileName: clientEditingGuides.fileName, sizeBytes: clientEditingGuides.sizeBytes, updatedAt: clientEditingGuides.createdAt })
    .from(clientEditingGuides)
    .where(and(eq(clientEditingGuides.clientId, clientId), isNull(clientEditingGuides.deletedAt)))
    .orderBy(desc(clientEditingGuides.createdAt))
    .limit(1);
  return g ? { id: g.id, fileName: g.fileName, sizeBytes: g.sizeBytes, updatedAt: g.updatedAt as Date } : null;
}

export type KnowledgeItem = { category: string; categoryLabel: string; title: string; body: string; isPinned: boolean };
export type ClientLibraryDetail = {
  client: { id: string; name: string; slug: string; logoUrl: string | null; color: string | null; sector: string | null; website: string | null; description: string | null; attentionNotes: string | null };
  overDeKlant: KnowledgeItem[];
  richtlijnen: KnowledgeItem[];
  editingAandachtspunten: string[];
  guide: GuideMeta | null;
  canManage: boolean;
};

/**
 * Volledige detailinformatie voor één klant. Dwingt server-side af dat de klant
 * tot de set van de gebruiker behoort; zo niet, dan null (de pagina toont 404).
 */
export async function getClientLibraryDetail(viewer: Viewer, slug: string): Promise<ClientLibraryDetail | null> {
  const [client] = await db
    .select({
      id: clients.id, name: clients.name, slug: clients.slug, logoUrl: clients.logoUrl, color: clients.color,
      sector: clients.sector, website: clients.website, description: clients.description, attentionNotes: clients.attentionNotes,
    })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) return null;

  // Toegang: klant moet in de set van deze gebruiker zitten (server-side grens).
  const myIds = await getMyClientIds(viewer);
  if (myIds && !myIds.has(client.id)) return null;

  const [knowledge, profile, guide] = await Promise.all([
    db.select({ category: clientKnowledge.category, title: clientKnowledge.title, body: clientKnowledge.body, isPinned: clientKnowledge.isPinned })
      .from(clientKnowledge)
      .where(and(eq(clientKnowledge.clientId, client.id), isNull(clientKnowledge.deletedAt)))
      .orderBy(desc(clientKnowledge.isPinned)),
    db.select({ editingProfile: clientAiProfiles.editingProfile }).from(clientAiProfiles).where(eq(clientAiProfiles.clientId, client.id)).limit(1),
    getLatestEditingGuide(client.id),
  ]);

  const toItem = (k: { category: string; title: string; body: string; isPinned: boolean }): KnowledgeItem => ({
    category: k.category, categoryLabel: CATEGORY_LABEL[k.category] ?? k.category, title: k.title, body: k.body, isPinned: k.isPinned,
  });
  const richtlijnen = knowledge.filter((k) => EDITING_CATEGORIES.includes(k.category)).map(toItem);
  const overDeKlant = knowledge.filter((k) => ABOUT_CATEGORIES.includes(k.category)).map(toItem);
  const ep = (profile[0]?.editingProfile ?? {}) as { aandachtspunten?: unknown };
  const editingAandachtspunten = Array.isArray(ep.aandachtspunten) ? (ep.aandachtspunten as unknown[]).map(String).filter(Boolean) : [];

  return {
    client,
    overDeKlant,
    richtlijnen,
    editingAandachtspunten,
    guide,
    canManage: canManageLibrary(viewer),
  };
}

/** Bevestigt dat de gebruiker toegang heeft tot deze klant (voor de PDF-route). */
export async function assertLibraryAccess(viewer: Viewer, clientId: string): Promise<boolean> {
  const myIds = await getMyClientIds(viewer);
  return myIds === null || myIds.has(clientId);
}
