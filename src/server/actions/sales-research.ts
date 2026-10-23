"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { salesResearch } from "@/db/schema";
import { ForbiddenError, requirePermission, type Viewer } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runJsonResearch, runJsonPrompt } from "@/server/ai/client";
import { RESEARCH_STATUSES } from "@/lib/sales-research";

export type ActionResult = { ok: boolean; message?: string; id?: string };

export type ResearchInput = {
  companyName: string;
  website?: string;
  instagram?: string;
  tiktok?: string;
  linkedin?: string;
  facebook?: string;
  youtube?: string;
  branche?: string;
  city?: string;
  description?: string;
  contactName?: string;
  meetingDate?: string;
  primaryGoal?: string;
  goals?: string[];
  extra?: string;
  clientId?: string | null;
};


/** Gestructureerd onderzoeksresultaat — ook de vorm die de slides voedt. */
export type ResearchResult = {
  periodeOnderzocht?: string;
  bedrijf?: {
    watDoen?: string;
    productenDiensten?: string;
    regio?: string;
    doelgroep?: string;
    positionering?: string;
    sterkePunten?: string[];
    commercieleDoelen?: string[];
    aannames?: string[];
  };
  social?: Array<{
    platform?: string;
    gevonden?: boolean;
    url?: string;
    volgers?: string | null;
    frequentie?: string;
    contentTypes?: string;
    videoAandeel?: string;
    observaties?: string[];
    opmerking?: string;
  }>;
  gaatGoed?: string[];
  pijnpunten?: Array<{
    observatie?: string;
    bewijs?: string;
    waaromGemisteKans?: string;
    impact?: string;
    shortclipsAanpak?: string;
    uit?: boolean;
  }>;
  kansenVoorShortclips?: { aanbevolenOplossing?: string; toelichting?: string };
  videoIdeeen?: Array<{ titel?: string; hook?: string; uitleg?: string; waaromPassend?: string; doel?: string; uit?: boolean }>;
  concurrenten?: Array<{ naam?: string; wat?: string; watWerkt?: string; kansVoorKlant?: string }>;
  vervolgstappen?: string;
  kwaliteitscheck?: string;
  /** Per-slide aan/uit, voor de presentatie. */
  slidesUit?: string[];
};

export type Source = { label: string; url: string };

function clean(v?: string | null): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

export async function createResearch(input: ResearchInput): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    const name = clean(input.companyName);
    if (!name) return { ok: false, message: "Geef een bedrijfsnaam op." };

    const goals = Array.isArray(input.goals) ? input.goals.filter((g) => typeof g === "string" && g.trim()).slice(0, 10) : [];
    const [created] = await db
      .insert(salesResearch)
      .values({
        companyName: name,
        website: clean(input.website),
        instagram: clean(input.instagram),
        tiktok: clean(input.tiktok),
        linkedin: clean(input.linkedin),
        facebook: clean(input.facebook),
        youtube: clean(input.youtube),
        branche: clean(input.branche),
        city: clean(input.city),
        description: clean(input.description),
        contactName: clean(input.contactName),
        meetingDate: clean(input.meetingDate),
        primaryGoal: clean(input.primaryGoal),
        goals: goals as unknown as Record<string, unknown>,
        extra: clean(input.extra),
        clientId: input.clientId || null,
        status: "concept",
        createdById: viewer.id,
      })
      .returning({ id: salesResearch.id });

    await auditLog({ viewer, action: "sales.research_created", entityType: "sales_research", entityId: created!.id });
    revalidatePath("/ai/bedrijfsonderzoek");
    return { ok: true, id: created!.id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

async function loadResearch(viewer: Viewer, id: string) {
  const [row] = await db.select().from(salesResearch).where(and(eq(salesResearch.id, id), isNull(salesResearch.deletedAt))).limit(1);
  void viewer;
  return row ?? null;
}

export async function runResearch(id: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    const row = await loadResearch(viewer, id);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };

    // Markeer het dossier als "onderzoek bezig" zolang de AI werkt.
    await db.update(salesResearch).set({ status: "onderzoek_bezig", updatedAt: new Date() }).where(eq(salesResearch.id, id));

    const goalsArr = Array.isArray(row.goals) ? (row.goals as unknown[]).filter((g): g is string => typeof g === "string") : [];

    const system = `Je bent de sales-onderzoeker van Shortclips, een bureau dat resultaatgerichte korte videocontent maakt voor TikTok, Instagram, YouTube Shorts en Facebook. Je voert ECHT onderzoek uit met de beschikbare web-tools (zoeken en pagina's ophalen). Je doel: een potentiële klant scherp in beeld brengen voor een salesgesprek.

HARDE REGELS:
- Gebruik uitsluitend controleerbare, actuele bronnen. Zoek de website op en bekijk die; zoek en verifieer de social-kanalen; bekijk waar mogelijk de daadwerkelijke content, niet alleen de bio.
- Verzin NOOIT cijfers (volgers, weergaven, bereik, omzet). Zijn ze niet openbaar beschikbaar, zet dan het veld op null en schrijf in 'opmerking' dat het platform die data niet openbaar maakt.
- Voor YouTube mag je publieke kanaalinfo gebruiken als je die vindt. Voor Instagram/TikTok/Facebook zijn exacte cijfers meestal niet openbaar — meld dat eerlijk.
- Maak duidelijk onderscheid tussen feiten, inschattingen en aanbevelingen (zet aannames in 'aannames').
- Analyseer de laatste ~30–90 dagen waar mogelijk en benoem de onderzochte periode.
- Noem pijnpunten alleen als het onderzoek daar aanleiding toe geeft; elk pijnpunt met concrete observatie + bewijs.
- Maak het specifiek voor DIT bedrijf — geen algemene marketingadviezen. Onderbouw contentobservaties met concrete voorbeelden (welke video's/pagina's bekeken).
- Houd rekening met de doelstellingen van de prospect; bepaal ook zelf welke doelstellingen waarschijnlijk relevant zijn, zonder onbevestigde aannames als feit te presenteren.
- Vermijd onrealistische garanties over bereik, leads, omzet of viral gaan.
- Bewaar de bronnen (URLs) die je gebruikt in 'bronnen'.
- Voer vóór je afrondt een korte eigen kwaliteitscontrole uit en vat die samen in 'kwaliteitscheck'.`;

    const user = `Onderzoek dit bedrijf grondig en lever een sales-analyse.

Bedrijf: ${row.companyName}
${row.website ? `Website: ${row.website}` : ""}
${row.city ? `Vestigingsplaats: ${row.city}` : ""}
${row.branche ? `Branche: ${row.branche}` : ""}
${row.description ? `Beschrijving (van ons salesteam): ${row.description}` : ""}
${row.instagram ? `Instagram: ${row.instagram}` : ""}
${row.tiktok ? `TikTok: ${row.tiktok}` : ""}
${row.linkedin ? `LinkedIn: ${row.linkedin}` : ""}
${row.facebook ? `Facebook: ${row.facebook}` : ""}
${row.youtube ? `YouTube: ${row.youtube}` : ""}
${row.primaryGoal ? `Belangrijkste doelstelling van de prospect: ${row.primaryGoal}` : ""}
${goalsArr.length ? `Gekozen doelstellingen: ${goalsArr.join(", ")}` : ""}
${row.extra ? `Aanvullende opmerkingen van ons salesteam: ${row.extra}` : ""}

Zoek zelf ontbrekende social-kanalen op en controleer of ze echt bij dit bedrijf horen. Analyseer het bedrijf, de huidige social media (idealiter de laatste 15–30 relevante publicaties per platform, mits toegankelijk), of de huidige content aansluit bij de doelstellingen, de pijnpunten/gemiste kansen, en wat Shortclips concreet kan betekenen. Bedenk 5 concrete, specifieke video-ideeën (met titel, hook, concept, doel). Doe optioneel 2–3 concurrenten. Stem alles af op de doelstellingen van de prospect.

Geef UITSLUITEND geldige JSON terug in exact dit formaat (laat velden leeg/[] als er geen onderbouwing is):
{
  "periodeOnderzocht": "bijv. laatste 60 dagen (gecontroleerd op <datum>)",
  "bedrijf": { "watDoen": "", "productenDiensten": "", "regio": "", "doelgroep": "", "positionering": "", "sterkePunten": [], "commercieleDoelen": [], "aannames": [] },
  "social": [ { "platform": "Instagram", "gevonden": true, "url": "", "volgers": null, "frequentie": "", "contentTypes": "", "videoAandeel": "", "observaties": [], "opmerking": "" } ],
  "gaatGoed": [],
  "pijnpunten": [ { "observatie": "", "bewijs": "", "waaromGemisteKans": "", "impact": "", "shortclipsAanpak": "" } ],
  "kansenVoorShortclips": { "aanbevolenOplossing": "", "toelichting": "" },
  "videoIdeeen": [ { "titel": "", "hook": "", "uitleg": "", "waaromPassend": "", "doel": "" } ],
  "concurrenten": [ { "naam": "", "wat": "", "watWerkt": "", "kansVoorKlant": "" } ],
  "vervolgstappen": "",
  "kwaliteitscheck": "",
  "bronnen": [ { "label": "", "url": "" } ]
}`;

    const res = await runJsonResearch<ResearchResult & { bronnen?: Source[] }>({ system, user, maxUses: 12, maxTokens: 24000 });
    if (!res.ok) {
      // Niet blijven hangen op "bezig": terug naar concept zodat opnieuw proberen kan.
      await db.update(salesResearch).set({ status: "concept", updatedAt: new Date() }).where(eq(salesResearch.id, id));
      return res.reason === "no_provider"
        ? { ok: false, message: "Er is nog geen AI-sleutel ingesteld — zet ANTHROPIC_API_KEY in .env.local." }
        : { ok: false, message: res.error ?? "Onderzoek mislukt." };
    }

    const { bronnen, ...result } = res.data;
    await db
      .update(salesResearch)
      .set({ result: result as Record<string, unknown>, sources: (bronnen ?? []) as unknown as Record<string, unknown>, status: "onderzoek_afgerond", updatedAt: new Date() })
      .where(eq(salesResearch.id, id));

    await auditLog({ viewer, action: "sales.research_ran", entityType: "sales_research", entityId: id });
    revalidatePath("/ai/bedrijfsonderzoek");
    revalidatePath(`/ai/bedrijfsonderzoek/${id}`);
    return { ok: true, id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateResearchResult(id: string, result: ResearchResult): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    const row = await loadResearch(viewer, id);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };

    await db.update(salesResearch).set({
      result: result as Record<string, unknown>,
      resultVersions: pushVersion(row.resultVersions, row.result) as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(salesResearch.id, id));
    await auditLog({ viewer, action: "sales.research_edited", entityType: "sales_research", entityId: id });
    revalidatePath(`/ai/bedrijfsonderzoek/${id}`);
    revalidatePath(`/ai/bedrijfsonderzoek/${id}/presentatie`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Houdt de laatste 10 eerdere resultaten bij voor undo. */
function pushVersion(existing: unknown, current: unknown): Array<{ at: string; result: unknown }> {
  const arr = Array.isArray(existing) ? (existing as Array<{ at: string; result: unknown }>) : [];
  return [{ at: new Date().toISOString(), result: current }, ...arr].slice(0, 10);
}

/** "Verbeter met AI": verfijnt het onderzoek/presentatie-inhoud op basis van feedback,
 *  zonder nieuw webonderzoek. Verzint geen cijfers; bewaart de vorige versie (undo). */
export async function refineResearch(id: string, instruction: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    const row = await loadResearch(viewer, id);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    const feedback = (instruction ?? "").trim();
    if (!feedback) return { ok: false, message: "Geef aan wat er beter moet." };

    const current = (row.result ?? {}) as ResearchResult;
    const system = `Je bent de sales-redacteur van Shortclips. Je verbetert een bestaand bedrijfsonderzoek (de inhoud die de salespresentatie voedt) op basis van feedback. Behoud de JSON-structuur exact. Verzin NOOIT cijfers, volgers, weergaven of resultaten die niet in de huidige data staan; laat onbekende waarden null of leeg. Blijf specifiek voor dit bedrijf, nuchter en commercieel sterk. Vermijd onrealistische garanties.`;
    const user = `Huidig onderzoek (JSON):
${JSON.stringify(current)}

Feedback van het salesteam:
${feedback.slice(0, 2000)}

Verwerk uitsluitend de feedback; laat de rest intact. Geef UITSLUITEND dezelfde JSON-structuur terug (zelfde velden), verbeterd.`;

    const res = await runJsonPrompt<ResearchResult>({ system, user, maxTokens: 12000 });
    if (!res.ok) {
      return res.reason === "no_provider"
        ? { ok: false, message: "Er is nog geen AI-sleutel ingesteld." }
        : { ok: false, message: res.error ?? "Verbeteren mislukt." };
    }

    await db.update(salesResearch).set({
      result: res.data as Record<string, unknown>,
      resultVersions: pushVersion(row.resultVersions, current) as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(salesResearch.id, id));
    await auditLog({ viewer, action: "sales.research_refined", entityType: "sales_research", entityId: id });
    revalidatePath(`/ai/bedrijfsonderzoek/${id}`);
    revalidatePath(`/presentatie/${id}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Zet de dossierstatus (concept → … → klant geworden). */
export async function setResearchStatus(id: string, status: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    if (!(RESEARCH_STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Onbekende status." };
    await db.update(salesResearch).set({ status, updatedAt: new Date() }).where(eq(salesResearch.id, id));
    await auditLog({ viewer, action: "sales.research_status", entityType: "sales_research", entityId: id, changes: { status } });
    revalidatePath("/ai/bedrijfsonderzoek");
    revalidatePath(`/ai/bedrijfsonderzoek/${id}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Zet een eerdere versie terug (undo). */
export async function restoreResearchVersion(id: string, index: number): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    const row = await loadResearch(viewer, id);
    if (!row) return { ok: false, message: "Onderzoek niet gevonden." };
    const versions = Array.isArray(row.resultVersions) ? (row.resultVersions as Array<{ at: string; result: unknown }>) : [];
    const v = versions[index];
    if (!v) return { ok: false, message: "Versie niet gevonden." };
    const rest = versions.filter((_, i) => i !== index);
    await db.update(salesResearch).set({
      result: v.result as Record<string, unknown>,
      resultVersions: [{ at: new Date().toISOString(), result: row.result }, ...rest].slice(0, 10) as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(salesResearch.id, id));
    revalidatePath(`/ai/bedrijfsonderzoek/${id}`);
    revalidatePath(`/presentatie/${id}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Koppel het onderzoek aan een bestaande klant (wanneer de prospect klant wordt). */
export async function coupleResearchToClient(id: string, clientId: string | null): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    await db.update(salesResearch).set({ clientId: clientId || null, updatedAt: new Date() }).where(eq(salesResearch.id, id));
    await auditLog({ viewer, action: "sales.research_coupled", entityType: "sales_research", entityId: id, changes: { clientId } });
    revalidatePath(`/ai/bedrijfsonderzoek/${id}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteResearch(id: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("ai:run");
    await db.update(salesResearch).set({ deletedAt: new Date() }).where(eq(salesResearch.id, id));
    await auditLog({ viewer, action: "sales.research_deleted", entityType: "sales_research", entityId: id });
    revalidatePath("/ai/bedrijfsonderzoek");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Data: lijst eerder onderzochte bedrijven. */
export async function listResearch() {
  return db
    .select({
      id: salesResearch.id,
      companyName: salesResearch.companyName,
      status: salesResearch.status,
      contactName: salesResearch.contactName,
      meetingDate: salesResearch.meetingDate,
      city: salesResearch.city,
      clientId: salesResearch.clientId,
      createdAt: salesResearch.createdAt,
      updatedAt: salesResearch.updatedAt,
      result: salesResearch.result,
    })
    .from(salesResearch)
    .where(isNull(salesResearch.deletedAt))
    .orderBy(desc(salesResearch.updatedAt))
    .limit(60);
}
