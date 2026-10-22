import "server-only";

/**
 * Deterministische kwaliteitscheck (Laag A) voor een gegenereerd script.
 * Vangt de klassieke AI-verraders zónder taalmodel: te veel/weinig gesproken
 * woorden, een te lange hook, verboden woorden/structuren en monotoon ritme.
 * Captions ([Caption: ...]) en regie ([..]) tellen niet mee — alleen de
 * gesproken tekst. Gebaseerd op de bewezen lint van de losse ShortClips
 * script-engine.
 */

export type ScriptPlatform = "tiktok" | "reels" | "shorts" | "youtube" | "linkedin";

const PLATFORMS: Record<ScriptPlatform, { woorden: [number, number]; hookWoordenMax: number }> = {
  tiktok: { woorden: [70, 190], hookWoordenMax: 14 },
  reels: { woorden: [70, 190], hookWoordenMax: 14 },
  shorts: { woorden: [60, 160], hookWoordenMax: 14 },
  youtube: { woorden: [300, 1600], hookWoordenMax: 22 },
  linkedin: { woorden: [90, 240], hookWoordenMax: 18 },
};

const FORBIDDEN_WORDS = [
  "naadloos", "moeiteloos", "game-changer", "gamechanger", "duik in", "duik mee in",
  "ontketen", "in de wereld van", "in het huidige digitale landschap", "in een wereld waarin",
  "boordevol", "een ware", "het is belangrijk om", "het is geen geheim dat",
  "laten we eerlijk zijn", "laat me je meenemen", "stel je eens voor", "kortom",
  "al met al", "tot slot", "de kracht van", "unlock", "unleash", "revolutionair", "baanbrekend",
];

const FORBIDDEN_PATTERNS: RegExp[] = [
  /niet alleen\s+\w+,?\s+maar ook/i,
  /of je nu\s+.+\s+of\s+.+,/i,
  /\bten eerste\b[\s\S]{0,400}\bten tweede\b/i,
  /dat\s+is\s+precies\s+waarom/i,
];

/** Strip captions en regie tussen [haakjes]; dat is geen gesproken tekst. */
function stripBrackets(t: string | null | undefined): string {
  return (t ?? "").replace(/\[[^\]]*\]/g, " ");
}
function words(t: string): string[] {
  return t.trim().split(/\s+/).filter(Boolean);
}
function sentences(t: string): string[] {
  return t.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
}

export type LintIssue = { level: "hard" | "warn"; check: string; message: string };
export type LintResult = {
  ok: boolean; // geen harde fouten
  wordCount: number;
  hookWords: number;
  rhythmCv: number;
  issues: LintIssue[];
};

export function lintScript(
  platform: ScriptPlatform,
  parts: { hook?: string | null; body?: string | null; cta?: string | null },
): LintResult {
  const cfg = PLATFORMS[platform] ?? PLATFORMS.reels;
  const issues: LintIssue[] = [];
  const spoken = stripBrackets([parts.hook, parts.body, parts.cta].filter(Boolean).join("\n"));
  const wordCount = words(spoken).length;

  const [min, max] = cfg.woorden;
  if (wordCount < min) issues.push({ level: "hard", check: "woordenaantal", message: `Te kort: ${wordCount} gesproken woorden (minimaal ${min}).` });
  if (wordCount > max) issues.push({ level: "hard", check: "woordenaantal", message: `Te lang: ${wordCount} gesproken woorden (maximaal ${max}).` });

  const hookWords = words(stripBrackets(parts.hook)).length;
  if (hookWords > cfg.hookWoordenMax) issues.push({ level: "warn", check: "hook-lengte", message: `Hook is ${hookWords} woorden (max ${cfg.hookWoordenMax}). Korter = sterker.` });

  const lower = spoken.toLowerCase();
  const badWords = FORBIDDEN_WORDS.filter((w) => lower.includes(w));
  if (badWords.length) issues.push({ level: "hard", check: "verboden-woorden", message: `Verboden/AI-woorden: ${badWords.join(", ")}.` });
  if (FORBIDDEN_PATTERNS.some((p) => p.test(spoken))) issues.push({ level: "hard", check: "verboden-structuren", message: `Verboden AI-structuur gevonden (bijv. "niet alleen … maar ook").` });

  const sent = sentences(spoken);
  let rhythmCv = 0;
  if (sent.length >= 4) {
    const lens = sent.map((s) => words(s).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    rhythmCv = mean > 0 ? sd / mean : 0;
    if (rhythmCv < 0.45) issues.push({ level: "warn", check: "ritme", message: `Monotoon ritme (variatie ${rhythmCv.toFixed(2)}, min 0.45). Wissel korte en lange zinnen af.` });
  }

  return { ok: issues.every((i) => i.level !== "hard"), wordCount, hookWords, rhythmCv, issues };
}

/** Korte, bruikbare opsomming van de problemen voor een gerichte AI-herschrijf. */
export function lintIssuesText(result: LintResult): string {
  return result.issues.map((i) => `- (${i.level}) ${i.message}`).join("\n");
}
