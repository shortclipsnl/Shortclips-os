import "server-only";
import type { EditPlan, Timeline } from "./plan";
import type { StyleConfig } from "./style-profile";
import { blackFrames, colorStats, loudness, probe } from "./media";
import type { Geometry } from "./render";

/**
 * Automatische kwaliteitscontrole na elke render.
 *
 * Technische fouten blokkeren: een video met een technische fout wordt nooit
 * als klaar getoond en kan niet als definitief worden geëxporteerd.
 * Creatieve aanbevelingen blokkeren niet; ze staan erbij als advies.
 */

export type QcFinding = { code: string; message: string; atS?: number };
export type QcResult = {
  passed: boolean;
  technical: QcFinding[];
  creative: QcFinding[];
  metrics: Record<string, number | string | null>;
  checkedAt: string;
};

type Manifest = {
  captions: Record<string, { x: number; y: number; w: number; h: number }>;
  cards: Record<string, { x: number; y: number; w: number; h: number; fullscreen: boolean; pad?: number }>;
};

export async function runQc(opts: {
  file: string;
  plan: EditPlan;
  timeline: Timeline;
  style: StyleConfig;
  geometry: Geometry;
  manifest: Manifest;
  missingSentences: string[];
  usedGenericLog: string[];
  hasMusic: boolean;
}): Promise<QcResult> {
  const { timeline, style, geometry: g } = opts;
  const technical: QcFinding[] = [];
  const creative: QcFinding[] = [];
  const metrics: QcResult["metrics"] = {};

  // 1. Render, formaat en duur.
  let p;
  try {
    p = await probe(opts.file);
  } catch (e) {
    technical.push({ code: "render", message: `Renderbestand onleesbaar: ${String(e)}` });
    return { passed: false, technical, creative, metrics, checkedAt: new Date().toISOString() };
  }
  metrics.width = p.width;
  metrics.height = p.height;
  metrics.fps = Math.round(p.fps * 100) / 100;
  metrics.durationS = Math.round(p.durationS * 100) / 100;
  if (p.width !== g.W || p.height !== g.H) technical.push({ code: "aspect", message: `Verkeerde resolutie: ${p.width}×${p.height}, verwacht ${g.W}×${g.H}.` });
  if (Math.abs(p.fps - style.export.fps) > 0.05) technical.push({ code: "fps", message: `Verkeerde framerate: ${p.fps}, verwacht ${style.export.fps}.` });
  if (Math.abs(p.durationS - timeline.durationS) > 0.15) technical.push({ code: "duration", message: `Duur wijkt af van het plan (${p.durationS.toFixed(2)} s i.p.v. ${timeline.durationS.toFixed(2)} s): mogelijke renderfout.` });
  if (!p.hasAudio) technical.push({ code: "audio_missing", message: "De video heeft geen geluidsspoor." });

  // 2. Zwarte beelden (alleen onbedoelde; stat-kaarten zijn donkerblauw, niet zwart).
  const blacks = await blackFrames(opts.file);
  for (const b of blacks) technical.push({ code: "black", message: `Zwart beeld van ${b.start.toFixed(2)} tot ${b.end.toFixed(2)} s.`, atS: b.start });

  // 3. Audio: luidheid en pieken.
  const ln = await loudness(opts.file);
  if (ln) {
    metrics.lufs = ln.integrated;
    metrics.truePeak = ln.truePeak;
    metrics.lra = ln.range;
    if (Math.abs(ln.integrated - style.audio.targetLufs) > 1.5) technical.push({ code: "loudness", message: `Luidheid ${ln.integrated} LUFS wijkt af van ${style.audio.targetLufs} LUFS.` });
    if (ln.truePeak > style.audio.truePeakDb + 0.5) technical.push({ code: "peak", message: `Audio piekt te hoog (${ln.truePeak} dBTP).` });
  } else technical.push({ code: "loudness", message: "Luidheid kon niet gemeten worden." });
  if (opts.hasMusic && opts.plan.music.gainDb > 6) creative.push({ code: "music_loud", message: "De muziek staat flink harder dan het profiel; controleer de verstaanbaarheid." });

  // 4. Ondertitels: dekking van alle gesproken woorden + veilige zone.
  if (opts.plan.captionsEnabled) {
    const uncovered = timeline.words.filter((w) => !timeline.captions.some((c) => w.os >= c.startS - 0.05 && w.os < c.endS));
    if (uncovered.length) technical.push({ code: "captions_missing", message: `${uncovered.length} gesproken woord(en) zonder ondertitel, o.a. "${uncovered.slice(0, 3).map((w) => w.w).join(" ")}".`, atS: uncovered[0].os });
    const late = timeline.captions.filter((c, i) => { const w = timeline.words.find((x) => Math.abs(x.os - c.startS) < 0.01); return !w && i > 0; });
    if (late.length) technical.push({ code: "captions_sync", message: `${late.length} ondertitel(s) niet gelijk met het gesproken woord.`, atS: late[0].startS });
    const margin = Math.round(40 * g.scale);
    const bottomSafe = g.H - Math.round(g.H * 0.17);
    for (const [id, m] of Object.entries(opts.manifest.captions)) {
      if (m.x < margin || m.x + m.w > g.W - margin || m.y + m.h > bottomSafe || m.y < Math.round(g.H * 0.12)) {
        const i = Number(id.slice(1));
        technical.push({ code: "safe_zone", message: `Ondertitel "${timeline.captions[i]?.text ?? id}" valt buiten de veilige zone.`, atS: timeline.captions[i]?.startS });
      }
    }
  }
  for (const c of timeline.cards) {
    const m = opts.manifest.cards[c.id];
    if (!m || m.fullscreen) continue;
    const pad = m.pad ?? 0;
    if (m.x + pad < 0 || m.x + m.w - pad > g.W || m.y + pad < Math.round(g.H * 0.1)) technical.push({ code: "safe_zone", message: `Kaart "${c.title}" valt buiten het beeld of de veilige zone.`, atS: c.startS });
  }

  // 5. Inhoud: weggevallen scriptzinnen en takes waarover getwijfeld wordt.
  for (const s of opts.missingSentences) technical.push({ code: "missing_sentence", message: `Scriptzin ontbreekt in de montage: "${s}"` });
  const pending = opts.plan.takes.filter((t) => t.needsUser);
  if (pending.length) technical.push({ code: "take_choice", message: `${pending.length} zin(nen) wachten op jouw take-keuze.` });

  // 6. Onlogische cuts: extreem korte shots.
  const tiny = timeline.segments.filter((s) => s.durS < 0.28);
  if (tiny.length) creative.push({ code: "short_shot", message: `${tiny.length} zeer kort(e) shot(s) (< 0,28 s); kan schokkerig ogen.`, atS: tiny[0].atS });

  // 7. Ritme t.o.v. het profiel (advies).
  const cuts = new Set<number>();
  timeline.segments.forEach((s, i) => { if (i > 0) cuts.add(Math.round(s.atS * 100) / 100); });
  timeline.broll.forEach((b) => { cuts.add(Math.round(b.atS * 100) / 100); cuts.add(Math.round((b.atS + b.durS) * 100) / 100); });
  const cutList = [...cuts].sort((a, b) => a - b);
  const shots = cutList.length + 1;
  const avgShot = timeline.durationS / shots;
  metrics.shots = shots;
  metrics.avgShotS = Math.round(avgShot * 100) / 100;
  const words = timeline.words.length;
  const wpm = timeline.durationS > 0 ? Math.round((words / timeline.durationS) * 60) : 0;
  metrics.wpm = wpm;
  if (cutList[0] == null || cutList[0] > style.editing.firstCutBeforeS) creative.push({ code: "hook", message: `Eerste cut pas op ${cutList[0]?.toFixed(1) ?? "-"} s; in de referenties valt die vóór ${style.editing.firstCutBeforeS} s.` });
  if (avgShot > style.editing.targetShotS * 1.6) creative.push({ code: "pace", message: `Gemiddelde shotlengte ${avgShot.toFixed(1)} s (referentie ~${style.editing.targetShotS} s). Meer b-roll of extra opnamehoeken helpen.` });
  if (wpm < style.editing.targetWpm[0]) creative.push({ code: "wpm", message: `Spreektempo ${wpm} wpm, lager dan de referenties (${style.editing.targetWpm[0]}-${style.editing.targetWpm[1]}).` });
  const gaps = timeline.words.slice(1).map((w, i) => w.os - timeline.words[i].oe);
  const long = gaps.filter((x) => x > 0.6).length;
  if (long) creative.push({ code: "pause", message: `${long} pauze(s) langer dan 0,6 s over.` });
  const firstWord = timeline.words[0]?.os ?? 0;
  metrics.firstWordS = firstWord;
  if (firstWord > 0.25) creative.push({ code: "hook_start", message: `Eerste woord pas op ${firstWord.toFixed(2)} s.` });

  // 8. Belichtingsverschillen tussen shots (gemeten op de render).
  const lumas: number[] = [];
  const covered = (t: number) =>
    timeline.broll.some((b) => t >= b.atS - 0.1 && t <= b.atS + b.durS + 0.1) ||
    timeline.cards.some((c) => c.template === "stat" && t >= c.startS - 0.1 && t <= c.endS + 0.1);
  for (const s of timeline.segments.slice(0, 30)) {
    const t = s.atS + s.durS / 2;
    if (s.durS < 0.3 || covered(t)) continue;
    // Alleen het bovenste deel (gezicht/achtergrond): kaarten en ondertitels vallen eronder.
    const st = await colorStats(opts.file, { startS: t, durS: 0.12, samples: 1, cropTop: 0.4 });
    if (st) lumas.push(st.luma);
  }
  if (lumas.length > 1) {
    const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
    const maxDev = Math.max(...lumas.map((l) => Math.abs(l - mean)));
    metrics.lumaMean = Math.round(mean);
    metrics.lumaMaxDev = Math.round(maxDev);
    if (maxDev > style.color.lumaTolerance * 2.2) technical.push({ code: "exposure_jump", message: `Grote belichtingssprong tussen shots (${Math.round(maxDev)} op 255).` });
    else if (maxDev > style.color.lumaTolerance) creative.push({ code: "exposure", message: `Lichte belichtingsverschillen tussen shots (${Math.round(maxDev)} op 255).` });
    if (Math.abs(mean - style.color.targetLuma) > style.color.lumaTolerance * 1.5) creative.push({ code: "exposure_level", message: `Gemiddelde helderheid ${Math.round(mean)} (profiel ${style.color.targetLuma}).` });
  }
  for (const name of opts.usedGenericLog) creative.push({ code: "generic_log", message: `Log-beelden (${name}) zonder camera-LUT: generieke conversie gebruikt. Voeg in Stijlbeheer de LUT van deze camera toe voor de beste kleur.` });

  return { passed: technical.length === 0, technical, creative, metrics, checkedAt: new Date().toISOString() };
}
