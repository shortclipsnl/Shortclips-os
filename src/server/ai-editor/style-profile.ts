import { z } from "zod";

/**
 * Het montageprofiel "Shortclips Ads Style".
 *
 * Alle waarden zijn gemeten op de referentie-advertenties van oktober 2026
 * (Het Jaarplan, Januari komt sneller dan je denkt, Het plan staat). Waar een
 * waarde niet objectief te meten is (typografie van de kaarten, muziekkeuze)
 * staat dat erbij en is die handmatig bevestigd.
 *
 * Het profiel is versioned in de database (ad_style_profiles). Dit bestand
 * levert het schema en de startversie.
 */

export const STYLE_PROFILE_NAME = "Shortclips Ads Style";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const styleConfigSchema = z.object({
  export: z.object({
    width: z.number().int().default(1080),
    height: z.number().int().default(1920),
    fps: z.number().int().default(25),
    /** x264 CRF voor de definitieve export (lager = hogere kwaliteit). */
    crf: z.number().default(16),
    maxBitrateKbps: z.number().default(16000),
    audioBitrateKbps: z.number().default(320),
  }),
  editing: z.object({
    /** Langste toegestane pauze tussen woorden binnen de montage (s). */
    maxPauseS: z.number().default(0.35),
    /** Marge vóór het eerste en na het laatste woord van een fragment (s). */
    headHandleS: z.number().default(0.05),
    tailHandleS: z.number().default(0.1),
    /** Na het laatste woord van de video nog zo lang beeld (s). */
    endTailS: z.number().default(0.35),
    /** Opvulwoorden die worden weggeknipt. */
    fillers: z.array(z.string()).default(["eh", "ehm", "uh", "uhm", "euh", "hm", "hmm", "uhh", "ehh"]),
    /** Doel voor de gemiddelde shotlengte (s) — dient als controlewaarde. */
    targetShotS: z.number().default(2.3),
    /** De eerste cut moet vóór deze tijd vallen (s). */
    firstCutBeforeS: z.number().default(4.2),
    /** Doel-spreektempo na montage (woorden per minuut), controlewaarde. */
    targetWpm: z.tuple([z.number(), z.number()]).default([180, 225]),
  }),
  zoom: z.object({
    enabled: z.boolean().default(true),
    /** Langzame push-in binnen een shot (eindschaal). */
    pushInTo: z.number().default(1.06),
    /** Harde punch-in bij een jumpcut binnen dezelfde opname. */
    punchIn: z.number().default(1.14),
    /** Alleen shots langer dan dit krijgen een push-in (s). */
    minShotForPushS: z.number().default(1.6),
  }),
  broll: z.object({
    enabled: z.boolean().default(true),
    clipMinS: z.number().default(0.7),
    clipMaxS: z.number().default(1.3),
    /** Niet in de eerste seconden (hook) en niet op de CTA. */
    notBeforeS: z.number().default(3.5),
  }),
  captions: z.object({
    enabled: z.boolean().default(true),
    font: z.string().default("Poppins-Bold"),
    sizePx: z.number().default(42),
    textColor: hex.default("#FFFFFF"),
    boxColor: hex.default("#019DFC"),
    boxRadiusPx: z.number().default(10),
    paddingXPx: z.number().default(18),
    boxHeightPx: z.number().default(77),
    /** Verticaal midden van het ondertitelblok (px vanaf boven, op 1920). */
    centerYPx: z.number().default(1425),
    wordsMin: z.number().int().default(2),
    wordsMax: z.number().int().default(4),
    maxChars: z.number().int().default(26),
  }),
  cards: z.object({
    enabled: z.boolean().default(true),
    font: z.string().default("Inter-Bold"),
    cardBg: hex.default("#FFFFFF"),
    textColor: hex.default("#020020"),
    pillPrimary: hex.default("#0FADF0"),
    pillSecondary: hex.default("#020020"),
    statBg: hex.default("#0B0B45"),
    statAccent: hex.default("#0FADF0"),
    widthPx: z.number().default(680),
    radiusPx: z.number().default(26),
    /** Onderkant van de kaart (px vanaf boven) — boven het ondertitelblok. */
    bottomYPx: z.number().default(1340),
  }),
  color: z.object({
    /** Doelwaarden, gemeten met dezelfde methode als de render-meting. */
    targetLuma: z.number().default(99),
    lumaTolerance: z.number().default(7),
    targetSaturation: z.number().default(0.42),
    targetWarmth: z.number().default(5),
    blackPoint: z.number().default(2.5),
    /** Maximale automatische witbalanscorrectie per kanaal (fractie). */
    maxWbCorrection: z.number().default(0.08),
    /** Creatieve laag bovenop de technische correctie. */
    creative: z.object({
      contrast: z.number().default(1.04),
      warmth: z.number().default(0.012),
    }),
  }),
  audio: z.object({
    targetLufs: z.number().default(-16.5),
    truePeakDb: z.number().default(-1),
    denoise: z.boolean().default(true),
    /** Muziek zoveel dB onder de stem. */
    musicBelowVoiceDb: z.number().default(14),
    music: z.boolean().default(true),
    sfx: z.boolean().default(true),
    sfxGainDb: z.number().default(-20),
  }),
});

export type StyleConfig = z.infer<typeof styleConfigSchema>;

/** Startversie: alle defaults uit het schema. */
export function defaultStyleConfig(): StyleConfig {
  return styleConfigSchema.parse({
    export: {},
    editing: {},
    zoom: {},
    broll: {},
    captions: {},
    cards: {},
    color: { creative: {} },
    audio: {},
  });
}

/** Valideert een (deels) opgeslagen config en vult ontbrekende velden aan. */
export function normalizeStyleConfig(raw: unknown): StyleConfig {
  const base = defaultStyleConfig();
  const r = (raw ?? {}) as Partial<Record<keyof StyleConfig, Record<string, unknown>>>;
  const merged = {
    export: { ...base.export, ...(r.export ?? {}) },
    editing: { ...base.editing, ...(r.editing ?? {}) },
    zoom: { ...base.zoom, ...(r.zoom ?? {}) },
    broll: { ...base.broll, ...(r.broll ?? {}) },
    captions: { ...base.captions, ...(r.captions ?? {}) },
    cards: { ...base.cards, ...(r.cards ?? {}) },
    color: { ...base.color, ...(r.color ?? {}), creative: { ...base.color.creative, ...((r.color?.creative as object) ?? {}) } },
    audio: { ...base.audio, ...(r.audio ?? {}) },
  };
  return styleConfigSchema.parse(merged);
}

/** Welke kenmerken objectief gemeten zijn en welke handmatig bevestigd. */
export const STYLE_PROVENANCE: Array<{ field: string; source: "gemeten" | "handmatig"; note: string }> = [
  { field: "Montageritme en pauzes", source: "gemeten", note: "Shotlengte gem. 2,3 s, max pauze 0,5-0,7 s, 185-215 wpm, eerste woord op 0,0 s." },
  { field: "Ondertitels", source: "gemeten", note: "Poppins Bold ~42 px, wit op #019DFC, centrum op 1425 px (74%), 2-4 woorden." },
  { field: "Kleur", source: "gemeten", note: "Luma ~99/255, verzadiging ~0,42, licht warm, diepe zwarten; geen creatieve LUT herkend." },
  { field: "Audio", source: "gemeten", note: "-16,5 LUFS geïntegreerd, LRA ~2 LU, muziekbed ~14 dB onder de stem, pop bij kaarten." },
  { field: "Zooms", source: "gemeten", note: "Push-in tot ~1,06-1,12; veel beweging in de referenties is camerabeweging (gimbal)." },
  { field: "UI-kaarten", source: "handmatig", note: "Inter Bold, witte kaart, pills #0FADF0/#020020. Lay-out nagebouwd als sjablonen; per video ontworpen kaarten zijn niet volledig te reproduceren." },
  { field: "Muziekkeuze", source: "handmatig", note: "Te kiezen uit de muziekbibliotheek in Stijlbeheer." },
];
