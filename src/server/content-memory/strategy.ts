import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { aiOutputs, clients } from "@/db/schema";
import { aiConfigured, aiModelStrong, runPrompt } from "@/server/ai/client";
import { loadToneOfVoice } from "@/server/content-research/sources";
import { loadStoredStyle } from "@/server/content-research/style";
import type { ContentMemory, MemoryGroup, MemoryVideo } from "./analyze";

/**
 * Contentstrategie per klant: de AI-laag bovenop het rekenwerk van het
 * Contentgeheugen. Eén aanroep per klant levert:
 *  1. de filmstijl per video (alleen als die uit hook, caption of script
 *     herkenbaar is; anders "Onbekend", zodat er niets verzonnen wordt);
 *  2. per succesvol format twee nieuwe formatvoorstellen (nog te testen);
 *  3. de ideale scriptopbouw, afgeleid uit de best presterende video's en de
 *     echte scripts in Drive.
 *
 * Opgeslagen in ai_outputs (tool "contentgeheugen-strategie"). Wordt opnieuw
 * gemaakt zodra de onderliggende resultaten veranderen (handtekening), via de
 * ochtendjob of direct op de pagina als er nog niets klaarstaat.
 * Of iets bewezen is, bepaalt nooit de AI maar het rekenwerk (playbook.ts).
 */

export const STRATEGY_TOOL = "contentgeheugen-strategie";

export const FILM_STYLES = ["Presentator in beeld", "POV", "Interview", "Rondleiding", "Dynamische shots", "Voiceover"] as const;
export type FilmStyle = (typeof FILM_STYLES)[number];

export type FormatIdea = { name: string; description: string; why: string; hook: string };
export type FormatIdeas = { format: string; ideas: FormatIdea[]; createdAt: string };
export type ScriptBlueprint = { opening: string; informatie: string; tempo: string; spanning: string; cta: string };

export type MemoryStrategy = {
  signature: string;
  styles: Record<string, FilmStyle>;
  formatIdeas: Record<string, FormatIdeas>;
  script: ScriptBlueprint | null;
  /** Op hoeveel best presterende video's de scriptopbouw gebaseerd is. */
  scriptBasis: number;
  updatedAt: string;
  model: string | null;
};

/** De succesvolle formats die op de pagina staan (zelfde selectie overal). */
export function shownFormats(m: ContentMemory, max = 6): MemoryGroup[] {
  return m.formats.filter((g) => g.n >= 2 && g.medianPerf >= 1).slice(0, max);
}

/** Verandert zodra er nieuwe resultaten zijn die de strategie kunnen veranderen. */
export function strategySignature(m: ContentMemory): string {
  const key = [m.videoCount, shownFormats(m).map((g) => g.label).join(","), m.topVideos.slice(0, 10).map((v) => v.id).join(",")].join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

/** Ontbreekt er iets dat de pagina direct nodig heeft? */
export function strategyMissing(m: ContentMemory, s: MemoryStrategy | null): boolean {
  if (!m.videoCount || m.videoCount < 3) return false;
  if (!s) return true;
  return shownFormats(m).some((g) => !s.formatIdeas[g.label]);
}

async function loadRow(clientId: string) {
  const [row] = await db
    .select({ id: aiOutputs.id, output: aiOutputs.output })
    .from(aiOutputs)
    .where(and(eq(aiOutputs.clientId, clientId), eq(aiOutputs.tool, STRATEGY_TOOL), isNull(aiOutputs.deletedAt)))
    .orderBy(desc(aiOutputs.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function loadStrategy(clientId: string): Promise<MemoryStrategy | null> {
  const row = await loadRow(clientId).catch(() => null);
  const o = row?.output as Partial<MemoryStrategy> | undefined;
  if (!o || typeof o !== "object" || !o.updatedAt) return null;
  return {
    signature: String(o.signature ?? ""),
    styles: o.styles && typeof o.styles === "object" ? o.styles : {},
    formatIdeas: o.formatIdeas && typeof o.formatIdeas === "object" ? o.formatIdeas : {},
    script: o.script ?? null,
    scriptBasis: Number(o.scriptBasis) || 0,
    updatedAt: o.updatedAt,
    model: o.model ?? null,
  };
}

const SYSTEM = `Je bent hoofd contentstrategie bij Shortclips, een Nederlands bureau voor short video (TikTok, Instagram Reels, YouTube Shorts, Facebook). Je krijgt de gepubliceerde video's van één klant met hun echte resultaten, de formats die bij deze klant aantoonbaar goed werken en (indien beschikbaar) het schrijfprofiel uit de echte scripts.

Prestatie is uitgedrukt t.o.v. het normale niveau van deze klant op hetzelfde platform (1,0x = normaal). Retentie = gemiddeld deel van de video dat bekeken werd.

Taken:
1. styles: geef per video-id de filmstijl, precies één van: "Presentator in beeld", "POV", "Interview", "Rondleiding", "Dynamische shots", "Voiceover", "Onbekend". Kies alleen een stijl als hook, caption, titel of het schrijfprofiel die echt laten zien (bijv. "Ik neem je mee" = Rondleiding; vragen aan een medewerker = Interview; ik-vorm vanuit kijkersperspectief = POV). Twijfel je, kies "Onbekend". Raad niet.
2. formatIdeas: geef per opgegeven succesvol format precies twee NIEUWE formatideeën die voortbouwen op wat dat format succesvol maakt, maar echt iets nieuws zijn (geen hernoemd bestaand format). Per idee: name (korte herkenbare naam, max 6 woorden), description (1 zin: wat je ziet en hoe het werkt), why (1 zin: waarom het kansrijk is, met verwijzing naar de echte cijfers van het succesvolle format; noem het een verwachting, geen bewijs), hook (een eerste zin om mee te testen, max 15 woorden).
3. script: beschrijf de ideale scriptopbouw voor deze klant, gebaseerd op wat de best presterende video's gemeen hebben (en het schrijfprofiel). Per onderdeel één of twee korte, concrete zinnen die een scriptschrijver direct kan toepassen:
   - opening: hoe de eerste 1 tot 3 seconden eruitzien
   - informatie: hoe de informatie gebracht wordt (volgorde, hoeveelheid, aanspreekvorm)
   - tempo: zinslengte, snelheid, wanneer een nieuw beeld of punt
   - spanning: hoe de kijker blijft kijken tot het einde
   - cta: hoe de video afsluit

Regels:
- Nederlands, zakelijk en concreet. Geen gedachtestreepjes (— of –), geen emoji, geen hashtags.
- Verzin geen cijfers, prijzen, namen of feiten. Gebruik invulvelden tussen blokhaken waar een concreet gegeven nodig is, bijv. [prijs], [plaats].
- Kopieer geen eerdere hooks letterlijk.

Antwoord ALLEEN met geldige JSON:
{"styles":{"<id>":"<stijl>"},"formatIdeas":[{"format":"<exacte formatnaam>","ideas":[{"name":"","description":"","why":"","hook":""},{"name":"","description":"","why":"","hook":""}]}],"script":{"opening":"","informatie":"","tempo":"","spanning":"","cta":""}}`;

const clean = (t: unknown, max = 400) =>
  Array.from(
    String(t ?? "")
      .replace(/[—–]/g, ",")
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, max).join("");

const cut = (t: string, n: number) => Array.from(t.replace(/\s+/g, " ")).slice(0, n).join("");

function videoLine(v: MemoryVideo, full: boolean): string {
  const bits = [
    `id=${v.id}`,
    v.platform,
    `${v.perf.toFixed(2)}x normaal`,
    `${v.views} weergaven`,
    v.retention != null ? `retentie ${Math.round(v.retention * 100)}%` : "",
    v.durationSeconds ? `${Math.round(v.durationSeconds)} sec` : "",
    v.format ? `format: ${v.format}` : "",
    `hook: "${cut(v.hook, 160)}"`,
    full ? `titel: ${cut(v.title, 100)} | caption: ${cut(v.caption, 380)}` : `caption: ${cut(v.caption, 160)}`,
  ];
  return bits.filter(Boolean).join(" | ");
}

/**
 * Maakt (of vernieuwt) de strategie. Zonder force alleen als de handtekening
 * veranderd is of er formatvoorstellen ontbreken.
 */
export async function generateStrategy(
  clientId: string,
  memory: ContentMemory,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; generated: boolean; reason?: string }> {
  if (!aiConfigured()) return { ok: false, generated: false, reason: "Geen AI-sleutel ingesteld" };
  if (memory.videoCount < 3) return { ok: false, generated: false, reason: "Te weinig video's" };
  const prev = await loadStrategy(clientId);
  const signature = strategySignature(memory);
  if (!opts.force && prev && prev.signature === signature && !strategyMissing(memory, prev)) return { ok: true, generated: false };

  const [c] = await db
    .select({ name: clients.name, sector: clients.sector, description: clients.description })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const [tone, style] = await Promise.all([
    loadToneOfVoice(clientId).catch(() => ""),
    loadStoredStyle(clientId).catch(() => null),
  ]);
  const p = style?.profile;
  const styleText = p
    ? [
        p.samenvatting && `Samenvatting: ${p.samenvatting}`,
        p.format && `Vorm van de video's: ${p.format}`,
        p.aanspreekvorm && `Aanspreekvorm: ${p.aanspreekvorm}`,
        p.hookPatronen?.length && `Hookpatronen: ${p.hookPatronen.join(" · ")}`,
        p.middenstukStijl && `Middenstuk: ${p.middenstukStijl}`,
        p.ctaStijl && `CTA-stijl: ${p.ctaStijl}`,
        p.schrijfkenmerken?.length && `Schrijfkenmerken: ${p.schrijfkenmerken.join(" · ")}`,
      ].filter(Boolean).join("\n")
    : "";

  const formats = shownFormats(memory);
  const formatText = formats
    .map((g) => `- ${g.label}: ${g.medianPerf.toFixed(1)}x normaal, ${Math.round(g.hitRate * g.n)} van ${g.n} video's boven normaal, mediaan ${g.medianViews} weergaven${g.medianWatchSeconds ? `, ${g.medianWatchSeconds} sec kijktijd` : ""}`)
    .join("\n");
  const top = memory.all.slice(0, 12);
  const weak = [...memory.all].reverse().slice(0, 6);
  const toLabel = memory.all.slice(0, 90);

  const user = [
    `Klant: ${c?.name ?? "onbekend"}`,
    c?.sector ? `Branche: ${c.sector}` : "",
    c?.description ? `Omschrijving: ${cut(c.description, 600)}` : "",
    tone ? `Tone of voice en doelgroep:\n${cut(tone, 1500)}` : "",
    styleText ? `SCHRIJFPROFIEL UIT DE ECHTE SCRIPTS IN DRIVE:\n${styleText}` : "",
    formats.length ? `SUCCESVOLLE FORMATS (maak voor elk precies twee nieuwe formatideeën):\n${formatText}` : "SUCCESVOLLE FORMATS: nog geen. Geef formatIdeas als lege lijst.",
    `BEST PRESTERENDE VIDEO'S (basis voor de scriptopbouw):\n${top.map((v) => videoLine(v, true)).join("\n")}`,
    `MINST PRESTERENDE VIDEO'S (ter vergelijking):\n${weak.map((v) => videoLine(v, false)).join("\n")}`,
    `ALLE VIDEO'S OM EEN FILMSTIJL TE GEVEN:\n${toLabel.map((v) => videoLine(v, false)).join("\n")}`,
  ].filter(Boolean).join("\n\n");

  const res = await runPrompt({ system: SYSTEM, user, maxTokens: 9000, cacheSystem: true, model: aiModelStrong() });
  if (!res.ok) return { ok: false, generated: false, reason: res.error ?? res.reason };
  let parsed: {
    styles?: Record<string, string>;
    formatIdeas?: Array<{ format?: string; ideas?: Array<Partial<FormatIdea>> }>;
    script?: Partial<ScriptBlueprint>;
  };
  try {
    parsed = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1));
  } catch {
    return { ok: false, generated: false, reason: "AI-antwoord was geen geldige JSON" };
  }

  const now = new Date().toISOString();
  const known = new Set(memory.all.map((v) => v.id));
  const styles: Record<string, FilmStyle> = { ...(prev?.styles ?? {}) };
  for (const [id, s] of Object.entries(parsed.styles ?? {})) {
    if (!known.has(id)) continue;
    if ((FILM_STYLES as readonly string[]).includes(s)) styles[id] = s as FilmStyle;
    else if (s === "Onbekend") delete styles[id];
  }

  const formatIdeas: Record<string, FormatIdeas> = { ...(prev?.formatIdeas ?? {}) };
  for (const f of parsed.formatIdeas ?? []) {
    const g = formats.find((x) => x.label.toLowerCase() === String(f.format ?? "").trim().toLowerCase());
    if (!g) continue;
    const ideas = (f.ideas ?? [])
      .map((i) => ({ name: clean(i.name, 60), description: clean(i.description, 260), why: clean(i.why, 260), hook: clean(i.hook, 160) }))
      .filter((i) => i.name && i.description && i.name.toLowerCase() !== g.label.toLowerCase());
    if (ideas.length) formatIdeas[g.label] = { format: g.label, ideas: ideas.slice(0, 2), createdAt: now };
  }

  const sc = parsed.script ?? {};
  const script: ScriptBlueprint | null = sc.opening && sc.cta
    ? { opening: clean(sc.opening), informatie: clean(sc.informatie), tempo: clean(sc.tempo), spanning: clean(sc.spanning), cta: clean(sc.cta) }
    : prev?.script ?? null;

  const output: MemoryStrategy = { signature, styles, formatIdeas, script, scriptBasis: top.length, updatedAt: now, model: res.model ?? null };
  const row = await loadRow(clientId);
  if (row) await db.update(aiOutputs).set({ output, updatedAt: new Date(), inputSummary: `${memory.videoCount} video's` }).where(eq(aiOutputs.id, row.id));
  else await db.insert(aiOutputs).values({ clientId, tool: STRATEGY_TOOL, title: "Contentgeheugen: strategie", inputSummary: `${memory.videoCount} video's`, output });
  return { ok: true, generated: true };
}
