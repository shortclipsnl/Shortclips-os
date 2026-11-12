import { createHash } from "node:crypto";

/**
 * Stijlprofiel van een klant (puur deel, zonder database of AI).
 *
 * Bron: de echte Shortclips-scripts van de klant uit Google Drive (PDF, Word,
 * Google Docs), aangevuld met geleerde scriptregels en klantfeedback. NIET de
 * captions of eigen posts van de klant: dat zijn vaak eigen Facebook-fotoposts
 * in een heel andere toon ("HALLOOOO, WAT EEN KNALLER"), en die vervuilden de
 * hooks.
 */

export type StyleProfile = {
  /** In 2-3 zinnen: hoe Shortclips voor deze klant schrijft. */
  samenvatting: string;
  /** Vorm van de video's: presentator, interview (cameraman/medewerker), voice-over... */
  format: string;
  /** Aanspreekvorm: je/jij, u, wij/ik. */
  aanspreekvorm: string;
  /** Terugkerende hookpatronen, met korte uitleg. */
  hookPatronen: string[];
  /** Letterlijke hooks uit de scripts (zoals ze er staan). */
  voorbeeldHooks: string[];
  /** Hooks waarvan een document of de video-data aantoont dat ze goed werkten, met bewijs. */
  bewezenHooks: string[];
  /** Hoe het middenstuk is opgebouwd (zinslengte, opsommingen, plaatshouders). */
  middenstukStijl: string;
  /** Hoe de CTA's zijn opgebouwd. */
  ctaStijl: string;
  /** Letterlijke CTA's uit de scripts. */
  voorbeeldCtas: string[];
  /** Schrijfkenmerken (HOOFDLETTERS voor nadruk, "Maarrr", korte zinnen, ...). */
  schrijfkenmerken: string[];
  /** Vaste woorden en begrippen van deze klant. */
  woordenschat: string[];
  /** Wat NIET bij deze klant past (nooit in de scripts, of afgekeurd). */
  pastNiet: string[];
  /** Onderwerpen die al in scripts zijn behandeld (niet herhalen zonder reden). */
  onderwerpen: string[];
};

export const EMPTY_STYLE: StyleProfile = {
  samenvatting: "",
  format: "",
  aanspreekvorm: "",
  hookPatronen: [],
  voorbeeldHooks: [],
  bewezenHooks: [],
  middenstukStijl: "",
  ctaStijl: "",
  voorbeeldCtas: [],
  schrijfkenmerken: [],
  woordenschat: [],
  pastNiet: [],
  onderwerpen: [],
};

function str(v: unknown, max = 800): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function list(v: unknown, cap: number, max = 300): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const t = str(x, max);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

export function normalizeStyle(raw: unknown): StyleProfile {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    samenvatting: str(o.samenvatting),
    format: str(o.format),
    aanspreekvorm: str(o.aanspreekvorm, 200),
    hookPatronen: list(o.hookPatronen, 10),
    voorbeeldHooks: list(o.voorbeeldHooks, 16),
    bewezenHooks: list(o.bewezenHooks, 12),
    middenstukStijl: str(o.middenstukStijl),
    ctaStijl: str(o.ctaStijl),
    voorbeeldCtas: list(o.voorbeeldCtas, 8),
    schrijfkenmerken: list(o.schrijfkenmerken, 12),
    woordenschat: list(o.woordenschat, 20, 80),
    pastNiet: list(o.pastNiet, 12),
    onderwerpen: list(o.onderwerpen, 40, 160),
  };
}

export function hasStyle(p: StyleProfile | null | undefined): p is StyleProfile {
  return Boolean(p && (p.voorbeeldHooks.length > 0 || p.samenvatting));
}

/** Tekstblok voor prompts. Teamcorrecties staan bovenaan en gaan altijd voor. */
export function styleToText(p: StyleProfile | null, teamNotes?: string | null): string {
  const lines: string[] = [];
  if (teamNotes?.trim()) lines.push(`CORRECTIES VAN HET TEAM (gaan altijd voor):\n${teamNotes.trim()}`);
  if (!hasStyle(p)) return lines.join("\n\n");
  if (p.samenvatting) lines.push(`Samenvatting: ${p.samenvatting}`);
  if (p.format) lines.push(`Format: ${p.format}`);
  if (p.aanspreekvorm) lines.push(`Aanspreekvorm: ${p.aanspreekvorm}`);
  if (p.hookPatronen.length) lines.push(`Hookpatronen:\n- ${p.hookPatronen.join("\n- ")}`);
  if (p.voorbeeldHooks.length) lines.push(`Letterlijke hooks uit eerdere scripts:\n- ${p.voorbeeldHooks.join("\n- ")}`);
  if (p.bewezenHooks.length) lines.push(`Bewezen hooks (met bewijs):\n- ${p.bewezenHooks.join("\n- ")}`);
  if (p.middenstukStijl) lines.push(`Middenstuk: ${p.middenstukStijl}`);
  if (p.ctaStijl) lines.push(`CTA: ${p.ctaStijl}`);
  if (p.voorbeeldCtas.length) lines.push(`Letterlijke CTA's:\n- ${p.voorbeeldCtas.join("\n- ")}`);
  if (p.schrijfkenmerken.length) lines.push(`Schrijfkenmerken:\n- ${p.schrijfkenmerken.join("\n- ")}`);
  if (p.woordenschat.length) lines.push(`Woordenschat: ${p.woordenschat.join(", ")}`);
  if (p.pastNiet.length) lines.push(`PAST NIET bij deze klant:\n- ${p.pastNiet.join("\n- ")}`);
  if (p.onderwerpen.length) lines.push(`Al behandeld in scripts: ${p.onderwerpen.join(" · ")}`);
  return lines.join("\n\n");
}

/* ------------------------- Welke scriptbestanden lezen ------------------------- */

export type ScriptFileRow = {
  externalId: string | null;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedAt: Date | string | null;
};

export type ScriptFileKind = "pdf" | "docx" | "gdoc";

/** Bestanden die geen gesproken organische scripts bevatten. */
const EXCLUDE = /(draaiboek|advertentie|filmversie|factuur|offerte|planning|briefing|contract)/i;

export function scriptKind(r: Pick<ScriptFileRow, "name" | "mimeType">): ScriptFileKind | null {
  const mime = r.mimeType ?? "";
  const n = r.name.toLowerCase();
  if (mime.includes("application/vnd.google-apps.document")) return "gdoc";
  if (mime.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  if (mime.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  return null;
}

function stamp(d: Date | string | null): string {
  if (!d) return "";
  return (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
}

/**
 * Kiest de recentste echte scriptbestanden: alleen PDF/Word/Google Docs, geen
 * macOS-restbestanden ("._"), draaiboeken, advertentiescripts of dubbele
 * exports (zelfde grootte of zelfde naam zonder "(1)"/"kopie").
 */
export function pickStyleFiles<T extends ScriptFileRow>(rows: T[], limit = 8): Array<T & { kind: ScriptFileKind }> {
  const sorted = [...rows].sort((a, b) => stamp(b.modifiedAt).localeCompare(stamp(a.modifiedAt)));
  const out: Array<T & { kind: ScriptFileKind }> = [];
  const seenSize = new Set<number>();
  const seenName = new Set<string>();
  for (const r of sorted) {
    if (!r.externalId) continue;
    if (r.name.startsWith("._")) continue;
    if (EXCLUDE.test(r.name)) continue;
    const kind = scriptKind(r);
    if (!kind) continue;
    if (r.sizeBytes != null && r.sizeBytes > 0 && r.sizeBytes < 1500 && kind !== "gdoc") continue;
    const base = r.name.toLowerCase().replace(/\.(pdf|docx?)$/, "").replace(/\(\d+\)|kopie|copy/g, "").replace(/\s+/g, " ").trim();
    if (seenName.has(base)) continue;
    if (r.sizeBytes && kind !== "gdoc" && seenSize.has(r.sizeBytes)) continue;
    seenName.add(base);
    if (r.sizeBytes) seenSize.add(r.sizeBytes);
    out.push({ ...r, kind });
    if (out.length >= limit) break;
  }
  return out;
}

/** Vingerafdruk van de gekozen bestanden: verandert er iets, dan profiel verversen. */
export function styleFingerprint(files: Array<Pick<ScriptFileRow, "externalId" | "modifiedAt">>, extra = ""): string {
  const key = files.map((f) => `${f.externalId}@${stamp(f.modifiedAt)}`).join("|") + `#${extra}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

/** Opschonen van uitgelezen scripttekst: witruimte, dubbele lege regels. */
export function cleanScriptText(t: string, max = 9000): string {
  return t
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, max);
}
