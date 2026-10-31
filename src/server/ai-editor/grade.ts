import "server-only";
import type { GradeAdjust, SourceGrade } from "./plan";
import type { StyleConfig } from "./style-profile";
import { colorStats, type ColorStats } from "./media";

/**
 * Kleurcorrectie in twee lagen, in deze volgorde:
 * 1. Technische conversie: log → Rec.709 (camera-LUT uit Stijlbeheer, of een
 *    generieke curve als er geen LUT is — dat wordt in de QC gemeld).
 * 2. Correctie + creatieve grade: witbalans, belichting, verzadiging en
 *    contrast worden per bron zo gezet dat de gemeten waarden op de
 *    doelwaarden van het profiel uitkomen (shot-matching). Een vaste LUT alleen
 *    is niet genoeg; daarom wordt na de eerste schatting opnieuw gemeten en
 *    bijgesteld (gesloten lus).
 */

export const GENERIC_LOG_CURVE = "curves=all='0/0 0.1/0.025 0.3/0.22 0.55/0.6 0.8/0.9 1/1'";

export function inputTransformFilter(transform: string, lutPath: string | null): string | null {
  if (transform === "generic_log") return GENERIC_LOG_CURVE;
  if (transform.startsWith("lut:") && lutPath) return `lut3d=file='${lutPath.replace(/'/g, "'\\''")}':interp=tetrahedral`;
  return null;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** ffmpeg-filters voor de correctie + creatieve laag. */
export function gradeFilter(g: SourceGrade, adjust: GradeAdjust, seg: GradeAdjust | undefined, style: StyleConfig): string {
  const warmth = (adjust.warmth ?? 0) + (seg?.warmth ?? 0);
  const exposure = (adjust.exposure ?? 0) + (seg?.exposure ?? 0);
  const sat = (adjust.saturation ?? 0) + (seg?.saturation ?? 0);
  const con = (adjust.contrast ?? 0) + (seg?.contrast ?? 0);
  const gamma = clamp(g.gamma * Math.pow(2, exposure * 0.5), 0.5, 2);
  const parts = [
    `colorchannelmixer=rr=${r3(g.r)}:gg=${r3(g.g)}:bb=${r3(g.b)}`,
    `eq=gamma=${r3(gamma)}:contrast=${r3(clamp(g.contrast + con, 0.7, 1.4))}:brightness=${r3(g.brightness)}:saturation=${r3(clamp(g.saturation * (1 + sat), 0.4, 1.8))}`,
  ];
  const w = style.color.creative.warmth + warmth * 0.06;
  if (Math.abs(w) > 0.001) parts.push(`colorbalance=rm=${r3(w)}:bm=${r3(-w)}:rh=${r3(w * 0.5)}:bh=${r3(-w * 0.5)}`);
  return parts.join(",");
}

/** Eerste schatting op basis van de gemeten bronwaarden. */
export function estimateGrade(stats: ColorStats, style: StyleConfig, inputTransform: string): SourceGrade {
  const c = style.color;
  const L = (stats.r + stats.g + stats.b) / 3 || 1;
  const maxWb = c.maxWbCorrection;
  // Witbalans: richting neutraal + gewenste warmte (R-B) en een lichte groen-tint zoals in de referenties.
  const rGain = clamp((L + c.targetWarmth / 2) / Math.max(1, stats.r), 1 - maxWb, 1 + maxWb);
  const bGain = clamp((L - c.targetWarmth / 2) / Math.max(1, stats.b), 1 - maxWb, 1 + maxWb);
  const gGain = clamp((L + 2) / Math.max(1, stats.g), 1 - maxWb / 2, 1 + maxWb / 2);
  // Belichting via gamma: (luma/255)^(1/gamma) ≈ target/255.
  const cur = clamp(stats.luma / 255, 0.03, 0.97);
  const tgt = clamp(c.targetLuma / 255, 0.05, 0.95);
  const gamma = clamp(Math.log(cur) / Math.log(tgt), 0.6, 1.7);
  const saturation = clamp(c.targetSaturation / Math.max(0.05, stats.saturation), 0.6, 1.5);
  return { r: rGain, g: gGain, b: bGain, gamma, brightness: 0, contrast: c.creative.contrast, saturation, inputTransform };
}

/**
 * Gesloten lus: past de grade toe op dezelfde samples, meet opnieuw en stelt
 * gamma, verzadiging en witbalans bij. Twee iteraties is in de praktijk ruim.
 */
export async function matchGrade(opts: {
  file: string;
  startS: number;
  durS: number;
  baseVf: string; // crop/rotatie + technische conversie
  stats: ColorStats;
  style: StyleConfig;
  inputTransform: string;
}): Promise<{ grade: SourceGrade; before: ColorStats; after: ColorStats | null }> {
  const { style } = opts;
  let grade = estimateGrade(opts.stats, style, opts.inputTransform);
  let after: ColorStats | null = null;
  for (let i = 0; i < 2; i++) {
    const vf = [opts.baseVf, gradeFilter(grade, {}, undefined, style)].filter(Boolean).join(",");
    after = await colorStats(opts.file, { startS: opts.startS, durS: opts.durS, vf, samples: 5, cropTop: 0.6 });
    if (!after) break;
    const c = style.color;
    const cur = clamp(after.luma / 255, 0.03, 0.97);
    const tgt = clamp(c.targetLuma / 255, 0.05, 0.95);
    const gFix = clamp(Math.log(cur) / Math.log(tgt), 0.85, 1.18);
    const sFix = clamp(c.targetSaturation / Math.max(0.05, after.saturation), 0.85, 1.18);
    const wFix = (c.targetWarmth - after.warmth) / 255;
    grade = {
      ...grade,
      gamma: clamp(grade.gamma * gFix, 0.55, 1.8),
      saturation: clamp(grade.saturation * sFix, 0.5, 1.6),
      r: clamp(grade.r + wFix * 0.5, 1 - style.color.maxWbCorrection * 1.5, 1 + style.color.maxWbCorrection * 1.5),
      b: clamp(grade.b - wFix * 0.5, 1 - style.color.maxWbCorrection * 1.5, 1 + style.color.maxWbCorrection * 1.5),
    };
    if (Math.abs(after.luma - c.targetLuma) < c.lumaTolerance / 2 && Math.abs(after.saturation - c.targetSaturation) < 0.04) break;
  }
  return { grade, before: opts.stats, after };
}
