import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, files, scriptReviewVersions, scriptReviews, shootScriptSources } from "@/db/schema";
import { newestSource } from "@/lib/script-versions";
import { drive } from "@/server/integrations/drive";
import { runJsonPrompt, type AiDoc } from "@/server/ai/client";
import { SHORTCLIPS_IDENTITY } from "@/server/ai/identity";
import {
  captionProfileToText,
  centralKnowledgeText,
  clientLearnedText,
  getClientAiProfile,
  type CaptionProfile,
} from "@/server/ai/knowledge";
import { downloadScriptPdf } from "@/server/scripts/script-storage";
import type { ShortCaption } from "@/server/actions/ai-tools";

export type GenerateResult =
  | { ok: true; data: ShortCaption[] }
  | { ok: false; reason?: "no_provider"; error: string };

function docFrom(pdfBase64?: string | null): AiDoc[] {
  return pdfBase64 ? [{ base64: pdfBase64, mediaType: "application/pdf" }] : [];
}

async function clientName(clientId: string): Promise<string> {
  const [c] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return c?.name ?? "de klant";
}

/**
 * Bouwt de system-prompt voor captions voor één klant. Gedeeld door de
 * handmatige Caption Maker en de automatische generatie, zodat de Shortclips-
 * stijl identiek is.
 */
export async function buildCaptionSystemPrompt(clientId: string, lang: "nl" | "en"): Promise<string> {
  const name = await clientName(clientId);
  const profile = await getClientAiProfile(clientId);
  const caption = captionProfileToText((profile?.captionProfile as CaptionProfile) ?? null);
  const knowledge = await centralKnowledgeText(["branding", "schrijfstijl", "communicatie", "algemeen"]);
  const learned = await clientLearnedText(clientId);

  return `${SHORTCLIPS_IDENTITY}

Je maakt social media captions voor klant "${name}".

CAPTIONPROFIEL VAN DEZE KLANT:
${caption}
${learned ? `\nGELEERDE KLANTVOORKEUREN (bevestigd uit eerder werk — volg deze):\n${learned}\n` : ""}

${knowledge ? `ALGEMENE SHORTCLIPS-KENNIS:\n${knowledge}\n` : ""}
REGELS VOOR DE CAPTIONS:
- HEEL BELANGRIJK: de caption draait volledig om de hoek/hook van de video. Pak uit het script de hook (de invalshoek waarmee de video opent) en spreek de kijker daar direct op aan. Niet het script navertellen of samenvatten.
- ZEER KORT en pakkend: 1 à 2 korte zinnen, zoals het team ze écht schrijft. Nooit lange captions.
- Gebruik de tone of voice en schrijfstijl van deze klant. Laat het natuurlijk klinken, nooit herkenbaar als AI.
- Gebruik passende emoji's alleen als dat bij deze klant past.
- Voeg contactgegevens alleen toe als dat onderdeel is van de captionstijl van de klant, en uitsluitend de gegevens die in het profiel staan. Verzin nooit gegevens.
- Eén caption per short die werkt op Instagram, TikTok, Facebook én YouTube Shorts (niet per platform verschillend).
- Zet GEEN hashtags in de caption zelf; die geef je apart als eventueel toepasbare hashtags (relevant voor onderwerp en branche, geen generieke of willekeurige — mag een lege lijst zijn).
- Zorg dat de captions onderling variëren — niet elke video dezelfde soort opening.
${lang === "en"
  ? "- TAAL: schrijf ALLE captions in natuurlijk, vloeiend ENGELS (geen Nederlands), passend bij de tone of voice van deze klant. Ook de hashtags in het Engels waar logisch. shortTitle en hook mag je in het Engels teruggeven."
  : "- TAAL: schrijf alle captions in natuurlijk Nederlands."}`;
}

/** De user-prompt: laat Claude zelf de losse shorts herkennen uit het document. */
export function captionUserPrompt(scriptText?: string): string {
  return `Hieronder staat een document of tekst met één of meer scripts voor afzonderlijke shorts. Herken automatisch hoeveel losse shorts erin staan. Analyseer per short de hook, het onderwerp, de inhoud en de call to action. Genereer per short ÉÉN caption die bruikbaar is voor Instagram, TikTok, Facebook en YouTube Shorts, plus eventueel toepasbare hashtags.

Geef UITSLUITEND geldige JSON terug in exact dit formaat, zonder omliggende tekst:
[
  {
    "shortTitle": "korte titel van de short",
    "hook": "de herkende hook",
    "caption": "de caption (zonder hashtags erin)",
    "hashtags": ["#..", "#.."]
  }
]

${scriptText?.trim() ? `De scripts:\n\n${scriptText.trim()}` : "De scripts staan in het bijgevoegde document."}`;
}

/**
 * Kernfunctie: genereert captions uit een script-PDF (base64) voor één klant.
 * Geen auth, geen opslag — de aanroeper regelt toegang en waar het resultaat
 * terechtkomt. Gebruikt door de handmatige Caption Maker én de automatiek.
 */
export async function generateCaptionsForPdf(input: {
  clientId: string;
  pdfBase64?: string;
  scriptText?: string;
  language?: "nl" | "en";
}): Promise<GenerateResult> {
  const lang = input.language === "en" ? "en" : "nl";
  const system = await buildCaptionSystemPrompt(input.clientId, lang);
  const user = captionUserPrompt(input.scriptText);
  const res = await runJsonPrompt<ShortCaption[]>({
    system,
    user,
    documents: docFrom(input.pdfBase64),
    maxTokens: 12000,
  });
  if (!res.ok) {
    return res.reason === "no_provider"
      ? { ok: false, reason: "no_provider", error: "Er is nog geen AI-sleutel ingesteld." }
      : { ok: false, error: res.error ?? "Genereren mislukt." };
  }
  const data = Array.isArray(res.data) ? res.data : [];
  // Defensief normaliseren: Claude kan losse velden missen.
  return {
    ok: true,
    data: data.map((s) => ({
      shortTitle: String(s?.shortTitle ?? "").trim(),
      hook: String(s?.hook ?? "").trim(),
      caption: String(s?.caption ?? "").trim(),
      hashtags: Array.isArray(s?.hashtags) ? s.hashtags.map((h) => String(h)).filter(Boolean) : [],
    })),
  };
}

export type ShootPdf = {
  /** script_review_versions.id, of null als de bron een Drive-PDF is. */
  reviewVersionId: string | null;
  pdfBase64: string;
  hash: string;
  fileName: string;
  /** Waar de PDF vandaan komt — voor logging/weergave. */
  origin: "review" | "drive";
};

/**
 * Haalt de script-PDF van een opname op als bron voor de captions, met een
 * sha256-hash voor wijzigingsdetectie. Bronnen:
 *  - de laatste scriptcontrole-PDF uit het klantportaal;
 *  - de gekoppelde script-PDF uit Google Drive (shoot_script_sources,
 *    status "gekoppeld").
 * Staan ze er allebei, dan wint de NIEUWSTE: een later gekoppelde of in Drive
 * bijgewerkte PDF gaat vóór een oudere portaalversie, en andersom. Zo zijn de
 * captions altijd gebaseerd op de laatste versie van het script. Lukt het
 * ophalen van de gekozen bron niet, dan valt hij terug op de andere.
 * Geeft null als er (nog) geen bruikbare PDF voor deze opname is.
 */
export async function shootReviewPdf(productionDayId: string): Promise<ShootPdf | null> {
  const [review] = await db
    .select({ id: scriptReviews.id })
    .from(scriptReviews)
    .where(and(eq(scriptReviews.productionDayId, productionDayId), isNull(scriptReviews.deletedAt)))
    .limit(1);
  const [version] = review
    ? await db
        .select({
          id: scriptReviewVersions.id,
          fileName: scriptReviewVersions.fileName,
          dataBase64: scriptReviewVersions.dataBase64,
          storagePath: scriptReviewVersions.storagePath,
          createdAt: scriptReviewVersions.createdAt,
        })
        .from(scriptReviewVersions)
        .where(eq(scriptReviewVersions.reviewId, review.id))
        .orderBy(desc(scriptReviewVersions.versionNumber))
        .limit(1)
    : [];

  const driveAt = await driveVersionAt(productionDayId);
  const first = newestSource(version ? { createdAt: toIso(version.createdAt)! } : null, driveAt);
  if (!first) return null;

  const fromReview = async (): Promise<ShootPdf | null> => {
    if (!version) return null;
    let pdfBase64 = version.dataBase64 ?? undefined;
    if (!pdfBase64 && version.storagePath) {
      const buf = await downloadScriptPdf(version.storagePath);
      if (buf) pdfBase64 = buf.toString("base64");
    }
    if (!pdfBase64) return null;
    const hash = createHash("sha256").update(pdfBase64).digest("hex");
    return { reviewVersionId: version.id, pdfBase64, hash, fileName: version.fileName, origin: "review" };
  };
  const fromDrive = () => (driveAt ? driveSourcedPdf(productionDayId) : Promise.resolve(null));

  return first === "drive"
    ? (await fromDrive()) ?? (await fromReview())
    : (await fromReview()) ?? (await fromDrive());
}

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x.getTime()) ? null : x.toISOString();
}

/**
 * "Versiemoment" van de gekoppelde Drive-PDF: het laatste van koppelen (door
 * het team of de versiecontrole) en de laatste wijziging van het bestand in
 * Drive. Null als er geen gekoppelde Drive-PDF is.
 */
async function driveVersionAt(productionDayId: string): Promise<string | null> {
  const [src] = await db
    .select({ confirmedAt: shootScriptSources.confirmedAt, fileModifiedAt: files.modifiedAt })
    .from(shootScriptSources)
    .leftJoin(files, and(eq(files.externalId, shootScriptSources.fileExternalId), eq(files.clientId, shootScriptSources.clientId)))
    .where(and(eq(shootScriptSources.productionDayId, productionDayId), eq(shootScriptSources.status, "gekoppeld")))
    .limit(1);
  if (!src) return null;
  const moments = [toIso(src.confirmedAt), toIso(src.fileModifiedAt)].filter((x): x is string => Boolean(x)).sort();
  // Gekoppeld maar nog nooit bevestigd en geen bestandsdatum: oudste denkbare moment.
  return moments.at(-1) ?? "1970-01-01T00:00:00.000Z";
}

/** Download de gekoppelde Drive-script-PDF van een opname (status "gekoppeld"). */
async function driveSourcedPdf(productionDayId: string): Promise<ShootPdf | null> {
  const [src] = await db
    .select({ fileExternalId: shootScriptSources.fileExternalId, fileName: shootScriptSources.fileName })
    .from(shootScriptSources)
    .where(and(eq(shootScriptSources.productionDayId, productionDayId), eq(shootScriptSources.status, "gekoppeld")))
    .limit(1);
  if (!src) return null;
  try {
    const bytes = await drive.downloadBytes(src.fileExternalId);
    const pdfBase64 = Buffer.from(bytes).toString("base64");
    if (!pdfBase64) return null;
    const hash = createHash("sha256").update(pdfBase64).digest("hex");
    // Bijwerken zodat we een gewijzigde Drive-PDF kunnen herkennen (weergave).
    await db
      .update(shootScriptSources)
      .set({ contentHash: hash, updatedAt: new Date() })
      .where(eq(shootScriptSources.productionDayId, productionDayId))
      .catch(() => undefined);
    return { reviewVersionId: null, pdfBase64, hash, fileName: src.fileName, origin: "drive" };
  } catch {
    // Drive niet bereikbaar / bestand weg → geen bron (cron probeert later opnieuw).
    return null;
  }
}

/**
 * Welke opnames hebben een bruikbare script-PDF? Telt zowel de portaal-review-PDF
 * als een automatisch gekoppelde Drive-PDF (status "gekoppeld"). Goedkoop (geen bytes).
 */
export async function shootHasReviewPdf(productionDayIds: string[]): Promise<Set<string>> {
  if (productionDayIds.length === 0) return new Set();
  const wanted = new Set(productionDayIds);
  const out = new Set<string>();

  const reviewRows = await db
    .select({ productionDayId: scriptReviews.productionDayId })
    .from(scriptReviews)
    .innerJoin(scriptReviewVersions, eq(scriptReviewVersions.reviewId, scriptReviews.id))
    .where(isNull(scriptReviews.deletedAt));
  for (const r of reviewRows) if (wanted.has(r.productionDayId)) out.add(r.productionDayId);

  const driveRows = await db
    .select({ productionDayId: shootScriptSources.productionDayId })
    .from(shootScriptSources)
    .where(and(eq(shootScriptSources.status, "gekoppeld"), inArray(shootScriptSources.productionDayId, productionDayIds)));
  for (const r of driveRows) out.add(r.productionDayId);

  return out;
}
