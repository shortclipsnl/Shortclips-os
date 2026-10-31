/**
 * Feedback → bewerkingen op het montageplan.
 *
 * Vrije tekst ("De ondertiteling mag iets kleiner", "Gebruik de tweede take
 * voor de laatste zin") wordt vertaald naar een vaste set bewerkingen. Eerst
 * met vaste patronen (gratis, voorspelbaar); lukt dat niet en is er een
 * AI-sleutel, dan vertaalt Claude de feedback naar dezelfde bewerkingen. Het
 * plan wordt aangepast, niet opnieuw opgebouwd; de render hergebruikt alle
 * segmenten die niet veranderd zijn.
 */
import type { EditPlan, GradeAdjust, TakeChoice } from "./plan";
import type { StyleConfig } from "./style-profile";

export type FeedbackOp =
  | { op: "caption_scale"; factor: number }
  | { op: "caption_offset"; px: number }
  | { op: "captions"; enabled: boolean }
  | { op: "tighten"; untilS: number | null; maxPauseS: number }
  | { op: "remove_zoom"; atS: number | null }
  | { op: "zoom_all"; enabled: boolean }
  | { op: "choose_take"; sentence: "first" | "last" | number; rank: number }
  | { op: "grade"; adjust: GradeAdjust }
  | { op: "music_volume"; deltaDb: number }
  | { op: "music"; enabled: boolean }
  | { op: "remove_card"; atS: number | null }
  | { op: "remove_broll"; atS: number | null }
  | { op: "sfx"; enabled: boolean };

const ORD: Record<string, number> = { eerste: 1, tweede: 2, derde: 3, vierde: 4, vijfde: 5, "1e": 1, "2e": 2, "3e": 3, "4e": 4, "5e": 5 };

function num(s: string): number {
  return Number(s.replace(",", "."));
}

/** Vaste patronen voor veelvoorkomende feedback. Geeft [] als er niets herkend is. */
export function parseFeedbackRules(text: string): FeedbackOp[] {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  const ops: FeedbackOp[] = [];
  const strong = /\b(veel|flink|een stuk|duidelijk)\b/.test(t);
  const mild = /\b(iets|ietsje|beetje|wat|licht)\b/.test(t);
  const amount = strong ? 2 : mild ? 0.6 : 1;

  if (/(ondertitel|ondertiteling|subtitle|caption|tekst onder)/.test(t)) {
    if (/kleiner/.test(t)) ops.push({ op: "caption_scale", factor: 1 - 0.1 * amount });
    else if (/groter/.test(t)) ops.push({ op: "caption_scale", factor: 1 + 0.1 * amount });
    if (/hoger|omhoog/.test(t)) ops.push({ op: "caption_offset", px: -Math.round(60 * amount) });
    else if (/lager|omlaag/.test(t)) ops.push({ op: "caption_offset", px: Math.round(60 * amount) });
    if (/(weg|uit|geen)\b/.test(t) && !/kleiner|groter|hoger|lager/.test(t)) ops.push({ op: "captions", enabled: false });
  }

  const first = t.match(/eerste (\d+|drie|twee|vier|vijf) seconden?.*(sneller|strakker|vlotter|korter)/) ?? t.match(/(sneller|strakker|vlotter).*eerste (\d+|drie|twee|vier|vijf) seconden?/);
  if (first) {
    const raw = (first[1].match(/\d+|drie|twee|vier|vijf/) ? first[1] : first[2]) ?? "3";
    const words: Record<string, number> = { twee: 2, drie: 3, vier: 4, vijf: 5 };
    const n = /\d/.test(raw) ? num(raw) : words[raw] ?? 3;
    ops.push({ op: "tighten", untilS: n, maxPauseS: 0.12 });
  } else if (/(sneller|strakker|vlotter|tempo omhoog|minder pauze)/.test(t) && !/muziek/.test(t)) {
    ops.push({ op: "tighten", untilS: null, maxPauseS: 0.18 });
  }

  const zoomAt = t.match(/zoom.*(?:seconde|sec|s)\s*(\d+(?:[.,]\d+)?)/) ?? t.match(/(?:seconde|sec)\s*(\d+(?:[.,]\d+)?).*zoom/);
  if (/zoom/.test(t) && /(eruit|weg|uit|verwijder|niet)/.test(t)) {
    if (zoomAt) ops.push({ op: "remove_zoom", atS: num(zoomAt[1]) });
    else if (/(alle|overal|geen) zoom/.test(t)) ops.push({ op: "zoom_all", enabled: false });
    else ops.push({ op: "remove_zoom", atS: null });
  }

  const take = t.match(/(eerste|tweede|derde|vierde|vijfde|1e|2e|3e|4e|5e|\d+)\s*(?:take|opname|versie|poging).*?(laatste|eerste|tweede|derde|vierde|vijfde|zesde|zevende|achtste|negende|tiende|(\d+)(?:e|ste|de)?) zin/);
  if (take) {
    const rank = ORD[take[1]] ?? num(take[1]);
    const SENT: Record<string, number> = { tweede: 2, derde: 3, vierde: 4, vijfde: 5, zesde: 6, zevende: 7, achtste: 8, negende: 9, tiende: 10 };
    const s = take[2] === "laatste" ? "last" : take[2] === "eerste" ? "first" : SENT[take[2]] ?? num(take[3] ?? "1");
    ops.push({ op: "choose_take", sentence: s, rank });
  }

  if (/(grading|kleur|beeld|look)/.test(t) || /te (warm|koud|donker|licht|fel|flets)/.test(t)) {
    const adj: GradeAdjust = {};
    if (/te warm|koeler|minder warm/.test(t)) adj.warmth = -0.5 * amount;
    if (/te koud|warmer|minder koud/.test(t)) adj.warmth = 0.5 * amount;
    if (/te donker|lichter|helderder/.test(t)) adj.exposure = 0.25 * amount;
    if (/te licht|donkerder|overbelicht/.test(t)) adj.exposure = -0.25 * amount;
    if (/te fel|minder verzadig|te kleurrijk/.test(t)) adj.saturation = -0.1 * amount;
    if (/flets|meer kleur|verzadig(der)?\b(?!.*minder)/.test(t) && !/minder/.test(t)) adj.saturation = 0.1 * amount;
    if (/meer contrast/.test(t)) adj.contrast = 0.05 * amount;
    if (/minder contrast/.test(t)) adj.contrast = -0.05 * amount;
    if (Object.keys(adj).length) ops.push({ op: "grade", adjust: adj });
  }

  if (/muziek/.test(t)) {
    if (/(zachter|te hard|lager|minder hard)/.test(t)) ops.push({ op: "music_volume", deltaDb: -3 * amount });
    else if (/(harder|luider|te zacht)/.test(t)) ops.push({ op: "music_volume", deltaDb: 3 * amount });
    else if (/(weg|eruit|uit|geen)/.test(t)) ops.push({ op: "music", enabled: false });
    else if (/(erbij|toevoegen|aan)/.test(t)) ops.push({ op: "music", enabled: true });
  }

  if (/(kaart|grafiek|overlay|pop-?up|card)/.test(t) && /(eruit|weg|verwijder)/.test(t)) {
    const at = t.match(/(?:seconde|sec)\s*(\d+(?:[.,]\d+)?)/);
    ops.push({ op: "remove_card", atS: at ? num(at[1]) : null });
  }
  if (/b-?roll/.test(t) && /(eruit|weg|verwijder)/.test(t)) {
    const at = t.match(/(?:seconde|sec)\s*(\d+(?:[.,]\d+)?)/);
    ops.push({ op: "remove_broll", atS: at ? num(at[1]) : null });
  }
  if (/(geluidseffect|sfx|plop|pop)/.test(t) && /(eruit|weg|uit|geen)/.test(t)) ops.push({ op: "sfx", enabled: false });
  return ops;
}

export function feedbackPrompt(text: string, plan: EditPlan, timeline: { segments: Array<{ id: string; atS: number; durS: number; sentenceIdx: number }>; cards: Array<{ id: string; startS: number; title: string }> }): { system: string; user: string } {
  return {
    system: `Je vertaalt feedback van het Shortclips-team op een gemonteerde advertentie naar bewerkingen. Antwoord uitsluitend met JSON: {"ops":[...],"reply":"korte bevestiging in het Nederlands"}.
Toegestane ops:
{"op":"caption_scale","factor":0.9}  (0.6-1.4)
{"op":"caption_offset","px":-60}      (negatief = hoger)
{"op":"captions","enabled":false}
{"op":"tighten","untilS":3,"maxPauseS":0.12}  (untilS null = hele video)
{"op":"remove_zoom","atS":12}  (atS null = alle zooms)
{"op":"zoom_all","enabled":true}
{"op":"choose_take","sentence":"last"|"first"|<zinnummer vanaf 1>,"rank":2}
{"op":"grade","adjust":{"warmth":-0.5,"exposure":0.2,"saturation":-0.1,"contrast":0.05}}  (warmth -1..1, exposure in stops -1..1)
{"op":"music_volume","deltaDb":-3}
{"op":"music","enabled":false}
{"op":"remove_card","atS":8}
{"op":"remove_broll","atS":15}
{"op":"sfx","enabled":false}
Is de feedback niet met deze ops uit te voeren (bijv. een inhoudelijke tekstwijziging), geef dan "ops":[] en leg in "reply" uit wat het team zelf moet doen. Verzin geen tekst.`,
    user: `Feedback: "${text}"
Video: ${timeline.segments.length} segmenten, ${plan.takes.length} zinnen. Segmenttijden: ${timeline.segments.map((s) => `${s.atS.toFixed(1)}s(zin ${s.sentenceIdx + 1})`).join(", ")}.
Kaarten: ${timeline.cards.map((c) => `${c.startS.toFixed(1)}s "${c.title}"`).join(", ") || "geen"}.`,
  };
}

export function parseAiOps(text: string): { ops: FeedbackOp[]; reply: string } | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const j = JSON.parse(text.slice(s, e + 1)) as { ops?: FeedbackOp[]; reply?: string };
    const allowed = new Set(["caption_scale", "caption_offset", "captions", "tighten", "remove_zoom", "zoom_all", "choose_take", "grade", "music_volume", "music", "remove_card", "remove_broll", "sfx"]);
    return { ops: (j.ops ?? []).filter((o) => o && allowed.has(o.op)), reply: String(j.reply ?? "") };
  } catch {
    return null;
  }
}

export type ApplyContext = {
  style: StyleConfig;
  /** Herbouwt segmenten uit gewijzigde take-keuzes (planner.segmentsFromTakes). */
  rebuildSegments: (takes: TakeChoice[]) => EditPlan["segments"];
  /** Plaatst kaarten/b-roll opnieuw na een herbouw (ankers kunnen veranderd zijn). */
  reanchor: (oldPlan: EditPlan, newPlan: EditPlan) => void;
  /** Tijdlijn-informatie voor ops met een tijdstip. */
  segmentAt: (plan: EditPlan, atS: number) => string | null;
  cardAt: (plan: EditPlan, atS: number) => string | null;
  brollAt: (plan: EditPlan, atS: number) => string | null;
  /** Herknipt segmenten met een andere maximale pauze tot een bepaalde tijd. */
  retighten: (plan: EditPlan, untilS: number | null, maxPauseS: number) => EditPlan["segments"];
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Past bewerkingen toe; geeft een nieuw plan + leesbare beschrijving. */
export function applyOps(plan: EditPlan, ops: FeedbackOp[], ctx: ApplyContext): { plan: EditPlan; done: string[]; skipped: string[] } {
  let p: EditPlan = JSON.parse(JSON.stringify(plan));
  const done: string[] = [];
  const skipped: string[] = [];
  for (const o of ops) {
    switch (o.op) {
      case "caption_scale":
        p.captionScale = clamp(p.captionScale * o.factor, 0.6, 1.4);
        done.push(`Ondertitels ${o.factor < 1 ? "kleiner" : "groter"} (${Math.round(p.captionScale * 100)}%).`);
        break;
      case "caption_offset":
        p.captionOffsetY = clamp(p.captionOffsetY + o.px, -400, 200);
        done.push(`Ondertitels ${o.px < 0 ? "hoger" : "lager"} geplaatst.`);
        break;
      case "captions":
        p.captionsEnabled = o.enabled;
        done.push(o.enabled ? "Ondertitels aan." : "Ondertitels uit.");
        break;
      case "tighten": {
        const before = p.segments.length;
        p.segments = ctx.retighten(p, o.untilS, o.maxPauseS);
        ctx.reanchor(plan, p);
        done.push(`${o.untilS ? `Eerste ${o.untilS} seconden` : "Hele video"} strakker gemonteerd (pauzes > ${o.maxPauseS.toFixed(2)} s eruit, ${p.segments.length - before >= 0 ? "+" : ""}${p.segments.length - before} cuts).`);
        break;
      }
      case "remove_zoom": {
        if (o.atS == null) {
          p.segments.forEach((s) => { s.zoom = { from: 1, to: 1 }; });
          done.push("Alle zooms verwijderd.");
        } else {
          const id = ctx.segmentAt(p, o.atS);
          const seg = p.segments.find((s) => s.id === id);
          if (seg) { seg.zoom = { from: 1, to: 1 }; done.push(`Zoom rond ${o.atS} s verwijderd.`); }
          else skipped.push(`Geen shot gevonden op ${o.atS} s.`);
        }
        break;
      }
      case "zoom_all":
        if (!o.enabled) { p.segments.forEach((s) => { s.zoom = { from: 1, to: 1 }; }); done.push("Zooms uitgezet."); }
        else skipped.push("Zooms opnieuw aanzetten gaat via 'Opnieuw genereren'.");
        break;
      case "choose_take": {
        const idx = o.sentence === "last" ? p.takes.length - 1 : o.sentence === "first" ? 0 : Math.round(o.sentence) - 1;
        const choice = p.takes[idx];
        if (!choice) { skipped.push(`Zin ${String(o.sentence)} bestaat niet.`); break; }
        // "tweede take" = tweede opname in tijdsvolgorde.
        const byTime = [...choice.options].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.inS - b.inS);
        const pick = byTime[o.rank - 1];
        if (!pick) { skipped.push(`Zin ${idx + 1} heeft geen ${o.rank}e take (er ${byTime.length === 1 ? "is er 1" : `zijn er ${byTime.length}`}).`); break; }
        choice.chosenTakeId = pick.takeId;
        choice.needsUser = false;
        choice.userChosen = true;
        const old = p;
        p = { ...p, segments: ctx.rebuildSegments(p.takes) };
        ctx.reanchor(old, p);
        done.push(`Zin ${idx + 1}: take ${o.rank} gebruikt ("${pick.text.slice(0, 60)}${pick.text.length > 60 ? "…" : ""}").`);
        break;
      }
      case "grade": {
        const a = p.gradeAdjust;
        p.gradeAdjust = {
          warmth: clamp((a.warmth ?? 0) + (o.adjust.warmth ?? 0), -1, 1),
          exposure: clamp((a.exposure ?? 0) + (o.adjust.exposure ?? 0), -1, 1),
          saturation: clamp((a.saturation ?? 0) + (o.adjust.saturation ?? 0), -0.5, 0.5),
          contrast: clamp((a.contrast ?? 0) + (o.adjust.contrast ?? 0), -0.2, 0.2),
        };
        const parts = [o.adjust.warmth ? (o.adjust.warmth < 0 ? "koeler" : "warmer") : null, o.adjust.exposure ? (o.adjust.exposure > 0 ? "lichter" : "donkerder") : null, o.adjust.saturation ? (o.adjust.saturation < 0 ? "minder verzadigd" : "meer verzadigd") : null, o.adjust.contrast ? (o.adjust.contrast > 0 ? "meer contrast" : "minder contrast") : null].filter(Boolean);
        done.push(`Kleur: ${parts.join(", ")}.`);
        break;
      }
      case "music_volume":
        p.music.gainDb = clamp(p.music.gainDb + o.deltaDb, -20, 8);
        done.push(`Muziek ${o.deltaDb < 0 ? "zachter" : "harder"} (${p.music.gainDb > 0 ? "+" : ""}${p.music.gainDb.toFixed(0)} dB t.o.v. profiel).`);
        break;
      case "music":
        if (!o.enabled) { p.music.assetId = null; done.push("Muziek uitgezet."); }
        else skipped.push("Muziek aanzetten: kies een track in Stijlbeheer en genereer opnieuw.");
        break;
      case "remove_card": {
        if (o.atS == null) { const n = p.cards.length; p.cards = []; done.push(`${n} kaart(en) verwijderd.`); break; }
        const id = ctx.cardAt(p, o.atS);
        if (id) { p.cards = p.cards.filter((c) => c.id !== id); done.push(`Kaart rond ${o.atS} s verwijderd.`); }
        else skipped.push(`Geen kaart gevonden op ${o.atS} s.`);
        break;
      }
      case "remove_broll": {
        if (o.atS == null) { p.broll = []; done.push("Alle b-roll verwijderd."); break; }
        const id = ctx.brollAt(p, o.atS);
        if (id) { p.broll = p.broll.filter((b) => b.id !== id); done.push(`B-roll rond ${o.atS} s verwijderd.`); }
        else skipped.push(`Geen b-roll gevonden op ${o.atS} s.`);
        break;
      }
      case "sfx":
        p.sfx = o.enabled;
        done.push(o.enabled ? "Geluidseffecten aan." : "Geluidseffecten uit.");
        break;
    }
  }
  p.version = plan.version + 1;
  return { plan: p, done, skipped };
}
