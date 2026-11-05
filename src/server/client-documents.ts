import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientDocuments, clients, kbChapters, CLIENT_DOCUMENT_KINDS, type ClientDocumentKind } from "@/db/schema";
import { canManageClients, type Viewer } from "@/server/auth/context";
import { getMyClientIds } from "@/server/client-library";

/**
 * Centrale bron voor de Klanten Guide en Editing Guide per klant.
 *
 * Iedere plek in het portaal (Productie → Klanten, Kennisbank →
 * Klantenbibliotheek, Mijn klanten voor editors) linkt naar dezelfde vaste URL
 * per klant en documentsoort. Die URL serveert altijd de nieuwste versie, dus
 * een vervangen PDF is direct overal zichtbaar zonder links bij te werken.
 */

export const DOC_LABEL: Record<ClientDocumentKind, string> = {
  klanten_guide: "Klanten Guide",
  editing_guide: "Editing Guide",
};

export function isDocKind(v: string): v is ClientDocumentKind {
  return (CLIENT_DOCUMENT_KINDS as readonly string[]).includes(v);
}

/** Vaste link naar de geldende versie van een document. */
export function clientDocUrl(clientId: string, kind: ClientDocumentKind, variant = ""): string {
  return `/api/klantdocumenten/${clientId}/${kind}${variant ? `?v=${encodeURIComponent(variant)}` : ""}`;
}

export type ClientDoc = {
  id: string;
  clientId: string;
  kind: ClientDocumentKind;
  variant: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: Date;
  url: string;
};

/** Eén knop per documentsoort; bij meerdere merken (varianten) één per merk. */
export type DocSlot = { kind: ClientDocumentKind; label: string; doc: ClientDoc | null };

/**
 * De geldende documenten (nieuwste per klant + soort + variant) voor een set
 * klanten. Oude versies en verwijderde uploads vallen weg.
 */
export async function getCurrentDocs(clientIds: string[]): Promise<Map<string, ClientDoc[]>> {
  const out = new Map<string, ClientDoc[]>();
  if (clientIds.length === 0) return out;
  const rows = await db
    .select({
      id: clientDocuments.id, clientId: clientDocuments.clientId, kind: clientDocuments.kind, variant: clientDocuments.variant,
      fileName: clientDocuments.fileName, sizeBytes: clientDocuments.sizeBytes, createdAt: clientDocuments.createdAt,
    })
    .from(clientDocuments)
    .where(and(inArray(clientDocuments.clientId, clientIds), isNull(clientDocuments.deletedAt)))
    .orderBy(desc(clientDocuments.createdAt));
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.clientId}|${r.kind}|${r.variant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const doc: ClientDoc = {
      id: r.id, clientId: r.clientId, kind: r.kind, variant: r.variant,
      label: r.variant ? `${DOC_LABEL[r.kind]} ${r.variant}` : DOC_LABEL[r.kind],
      fileName: r.fileName, sizeBytes: r.sizeBytes, updatedAt: r.createdAt as Date,
      url: clientDocUrl(r.clientId, r.kind, r.variant),
    };
    const list = out.get(r.clientId) ?? [];
    list.push(doc);
    out.set(r.clientId, list);
  }
  // Vaste volgorde: Klanten Guide(s) eerst, daarna Editing Guide(s), op variant.
  for (const list of out.values()) {
    list.sort((a, b) => CLIENT_DOCUMENT_KINDS.indexOf(a.kind) - CLIENT_DOCUMENT_KINDS.indexOf(b.kind) || a.variant.localeCompare(b.variant));
  }
  return out;
}

/** Altijd beide soorten tonen; ontbreekt er één, dan een lege plek ("volgt"). */
export function toSlots(docs: ClientDoc[] | undefined, opts?: { kinds?: ClientDocumentKind[] }): DocSlot[] {
  const kinds = opts?.kinds ?? [...CLIENT_DOCUMENT_KINDS];
  const slots: DocSlot[] = [];
  for (const kind of kinds) {
    const ofKind = (docs ?? []).filter((d) => d.kind === kind);
    if (ofKind.length === 0) slots.push({ kind, label: DOC_LABEL[kind], doc: null });
    else for (const d of ofKind) slots.push({ kind, label: d.label, doc: d });
  }
  return slots;
}

/** Wie mag documenten uploaden/vervangen: Jarno, Milou, Jiska, Rutger (klantbeheer). */
export function canManageClientDocs(viewer: Viewer | null): boolean {
  return canManageClients(viewer);
}

/** Welke soorten mag deze gebruiker zien? Editors alleen de Editing Guide. */
export function visibleKinds(viewer: Viewer): ClientDocumentKind[] {
  return viewer.isEditorOnly ? ["editing_guide"] : [...CLIENT_DOCUMENT_KINDS];
}

/** Server-side toegangscontrole voor het openen van een document. */
export async function canViewClientDoc(viewer: Viewer, clientId: string, kind: ClientDocumentKind): Promise<boolean> {
  if (viewer.isPortalUser) return false;
  if (!visibleKinds(viewer).includes(kind)) return false;
  const mine = await getMyClientIds(viewer);
  return mine === null || mine.has(clientId);
}

/** Het geldende document (nieuwste versie) voor de route. */
export async function getCurrentDoc(clientId: string, kind: ClientDocumentKind, variant: string) {
  const [row] = await db
    .select({ assetId: clientDocuments.assetId, fileName: clientDocuments.fileName })
    .from(clientDocuments)
    .where(and(eq(clientDocuments.clientId, clientId), eq(clientDocuments.kind, kind), eq(clientDocuments.variant, variant), isNull(clientDocuments.deletedAt)))
    .orderBy(desc(clientDocuments.createdAt))
    .limit(1);
  return row ?? null;
}

export async function clientExists(clientId: string): Promise<{ id: string; slug: string; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  const [c] = await db.select({ id: clients.id, slug: clients.slug, name: clients.name }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
  return c ?? null;
}

/**
 * Klanthoofdstuk in de kennisbank (Klantenbibliotheek): de gekoppelde klant en
 * de knoppen voor zijn twee guides. null als het hoofdstuk geen klant heeft.
 */
export async function getChapterClientDocs(viewer: Viewer, chapterId: string | null): Promise<{ clientName: string; clientSlug: string; slots: DocSlot[] } | null> {
  if (!chapterId) return null;
  const [row] = await db
    .select({ clientId: kbChapters.clientId, name: clients.name, slug: clients.slug })
    .from(kbChapters)
    .innerJoin(clients, eq(clients.id, kbChapters.clientId))
    .where(and(eq(kbChapters.id, chapterId), isNull(kbChapters.deletedAt)))
    .limit(1);
  if (!row?.clientId) return null;
  const docs = (await getCurrentDocs([row.clientId])).get(row.clientId);
  return { clientName: row.name, clientSlug: row.slug, slots: toSlots(docs, { kinds: visibleKinds(viewer) }) };
}

/** Is dit een vaste link naar een klantdocument (voor de bijlagenweergave)? */
export function isClientDocUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith("/api/klantdocumenten/");
}
