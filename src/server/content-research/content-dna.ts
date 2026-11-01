import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentResearchProfiles } from "@/db/schema";

/**
 * Content DNA van een klant: het interne profiel dat stuurt hoe we ideeën
 * bedenken. Automatisch bijgewerkt bij onderzoek én handmatig aanpasbaar.
 */
export type ContentDna = {
  toneOfVoice: string;
  doelgroep: string;
  favorieteFormats: string[];
  geaccepteerdeConcepten: string[];
  afgekeurdeConcepten: string[];
  voorkeuren: string[];
  creatieveBeperkingen: string[];
  gewensteUitstraling: string;
};

export const EMPTY_DNA: ContentDna = {
  toneOfVoice: "",
  doelgroep: "",
  favorieteFormats: [],
  geaccepteerdeConcepten: [],
  afgekeurdeConcepten: [],
  voorkeuren: [],
  creatieveBeperkingen: [],
  gewensteUitstraling: "",
};

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function list(v: unknown, cap = 30): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))].slice(0, cap);
}

export function normalizeDna(raw: unknown): ContentDna {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    toneOfVoice: s(o.toneOfVoice),
    doelgroep: s(o.doelgroep),
    favorieteFormats: list(o.favorieteFormats),
    geaccepteerdeConcepten: list(o.geaccepteerdeConcepten),
    afgekeurdeConcepten: list(o.afgekeurdeConcepten),
    voorkeuren: list(o.voorkeuren),
    creatieveBeperkingen: list(o.creatieveBeperkingen),
    gewensteUitstraling: s(o.gewensteUitstraling),
  };
}

/**
 * Voegt een nieuw (AI-)profiel samen met het bestaande: beschrijvende velden
 * worden ververst (maar niet geleegd als de AI niets levert), en de
 * geaccepteerde/afgekeurde concepten blijven cumulatief behouden — die worden
 * door teamacties (favoriet/afwijzen) opgebouwd en mogen nooit verdwijnen.
 */
export function mergeDna(existing: ContentDna, incoming: ContentDna): ContentDna {
  const pick = (a: string, b: string) => (b.trim() ? b : a);
  const union = (a: string[], b: string[], cap = 40) => [...new Set([...a, ...b])].slice(0, cap);
  return {
    toneOfVoice: pick(existing.toneOfVoice, incoming.toneOfVoice),
    doelgroep: pick(existing.doelgroep, incoming.doelgroep),
    favorieteFormats: incoming.favorieteFormats.length ? incoming.favorieteFormats : existing.favorieteFormats,
    geaccepteerdeConcepten: union(existing.geaccepteerdeConcepten, incoming.geaccepteerdeConcepten),
    afgekeurdeConcepten: union(existing.afgekeurdeConcepten, incoming.afgekeurdeConcepten),
    voorkeuren: incoming.voorkeuren.length ? incoming.voorkeuren : existing.voorkeuren,
    creatieveBeperkingen: incoming.creatieveBeperkingen.length ? incoming.creatieveBeperkingen : existing.creatieveBeperkingen,
    gewensteUitstraling: pick(existing.gewensteUitstraling, incoming.gewensteUitstraling),
  };
}

export function dnaToText(dna: ContentDna): string {
  const lines: string[] = [];
  if (dna.toneOfVoice) lines.push(`Tone of voice: ${dna.toneOfVoice}`);
  if (dna.doelgroep) lines.push(`Doelgroep: ${dna.doelgroep}`);
  if (dna.favorieteFormats.length) lines.push(`Favoriete formats: ${dna.favorieteFormats.join(", ")}`);
  if (dna.voorkeuren.length) lines.push(`Voorkeuren: ${dna.voorkeuren.join(" · ")}`);
  if (dna.gewensteUitstraling) lines.push(`Gewenste uitstraling: ${dna.gewensteUitstraling}`);
  if (dna.geaccepteerdeConcepten.length) lines.push(`Geaccepteerde concepten: ${dna.geaccepteerdeConcepten.join(" · ")}`);
  if (dna.afgekeurdeConcepten.length) lines.push(`Afgekeurd (NIET voorstellen): ${dna.afgekeurdeConcepten.join(" · ")}`);
  if (dna.creatieveBeperkingen.length) lines.push(`Creatieve beperkingen: ${dna.creatieveBeperkingen.join(" · ")}`);
  return lines.join("\n");
}

/** Haalt het Content DNA van een klant op (of het lege profiel). */
export async function loadDna(clientId: string): Promise<{ dna: ContentDna; manualNotes: string; exists: boolean }> {
  const [row] = await db
    .select({ profile: contentResearchProfiles.profile, manualNotes: contentResearchProfiles.manualNotes })
    .from(contentResearchProfiles)
    .where(eq(contentResearchProfiles.clientId, clientId))
    .limit(1);
  return {
    dna: row ? normalizeDna(row.profile) : { ...EMPTY_DNA },
    manualNotes: row?.manualNotes ?? "",
    exists: Boolean(row),
  };
}

/** Upsert van het Content DNA (profiel + optioneel autoSummary/manualNotes). */
export async function saveDna(input: {
  clientId: string;
  dna: ContentDna;
  autoSummary?: string | null;
  manualNotes?: string | null;
  updatedById?: string | null;
}): Promise<void> {
  const now = new Date();
  const set: Record<string, unknown> = {
    profile: input.dna as unknown as Record<string, unknown>,
    updatedById: input.updatedById ?? null,
    updatedAt: now,
  };
  if (input.autoSummary !== undefined) set.autoSummary = input.autoSummary;
  if (input.manualNotes !== undefined) set.manualNotes = input.manualNotes;

  await db
    .insert(contentResearchProfiles)
    .values({
      clientId: input.clientId,
      profile: input.dna as unknown as Record<string, unknown>,
      autoSummary: input.autoSummary ?? null,
      manualNotes: input.manualNotes ?? null,
      updatedById: input.updatedById ?? null,
    })
    .onConflictDoUpdate({ target: contentResearchProfiles.clientId, set });
}

/** Voegt een concept toe aan de afgekeurde lijst (leren van afwijzing). */
export async function addRejectedConcept(clientId: string, concept: string, updatedById?: string | null): Promise<void> {
  const { dna, manualNotes } = await loadDna(clientId);
  const label = concept.trim();
  if (!label) return;
  const next = mergeDna(dna, { ...EMPTY_DNA, afgekeurdeConcepten: [label] });
  await saveDna({ clientId, dna: next, manualNotes, updatedById });
}

/** Voegt een concept toe aan de geaccepteerde lijst (favoriet). */
export async function addAcceptedConcept(clientId: string, concept: string, updatedById?: string | null): Promise<void> {
  const { dna, manualNotes } = await loadDna(clientId);
  const label = concept.trim();
  if (!label) return;
  const next = mergeDna(dna, { ...EMPTY_DNA, geaccepteerdeConcepten: [label] });
  await saveDna({ clientId, dna: next, manualNotes, updatedById });
}
