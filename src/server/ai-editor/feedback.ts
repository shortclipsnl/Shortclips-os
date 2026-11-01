/**
 * Feedback → bewerkingen op het montageplan.
 *
 * Het team schrijft in een chat wat er anders moet, eventueel met meerdere
 * punten in één bericht en met een tijdstip uit de preview ("[0:12] zoom
 * eruit"). Elk punt wordt eerst met vaste patronen vertaald (gratis,
 * voorspelbaar); wat niet herkend wordt gaat naar Claude, dat dezelfde vaste
 * set bewerkingen teruggeeft of een verduidelijkende vraag stelt. Het plan
 * wordt aangepast, niet opnieuw opgebouwd; de render hergebruikt alle
 * segmenten die niet veranderd zijn.
 *
 * Harde regel: er wordt nooit tekst verzonnen. Kaartteksten moeten uit wat er
 * gezegd is (of uit het script) komen en een ondertitelcorrectie mag alleen de
 * spelling van een gesproken woord aanpassen.
 */
import { deriveTimeline, type Card, type CardTemplate, type EditPlan, type GradeAdjust, type PlanSegment, type TakeChoice } from "./plan";
import { isGrounded } from "./planner";
import type { StyleConfig } from "./style-profile";
import { norm, tokenize } from "./takes";

/** Zinverwijzing: zinnummer (vanaf 1, zoals in "Takes per zin"), of de eerste/laatste zin. */
export type SentenceRef = number | "first" | "last";

export type FeedbackOp =
  | { op: "caption_scale"; factor: number }
  | { op: "caption_offset"; px: number }
  | { op: "captions"; enabled: boolean }
  | { op: "tighten"; untilS: number | null; maxPauseS: number }
  | { op: "remove_zoom"; atS: number | null }
  | { op: "zoom_all"; enabled: boolean }
  | { op: "zoom_at"; atS: number; level: number }
  | { op: "choose_take"; sentence: SentenceRef; rank: number }
  | { op: "remove_sentence"; sentence?: SentenceRef; atS?: number }
  | { op: "restore_sentence"; sentence: SentenceRef }
  | { op: "move_sentence"; sentence?: SentenceRef; atS?: number; position: "start" | "end" | { before: number } | { after: number } }
  | { op: "trim"; atS: number; edge: "start" | "end"; deltaS: number }
  | { op: "fix_word"; from: string; to: string }
  | { op: "add_card"; atS: number; template: Exclude<CardTemplate, "cta_form">; title: string; items?: string[]; value?: string; label?: string }
  | { op: "grade"; adjust: GradeAdjust }
  | { op: "music_volume"; deltaDb: number }
  | { op: "music"; enabled: boolean }
  | { op: "music_track"; name: string }
  | { op: "remove_card"; atS: number | null }
  | { op: "remove_broll"; atS: number | null }
  | { op: "broll"; atS: number; source: string | null; durS?: number }
  | { op: "sfx"; enabled: boolean };

export const ALLOWED_OPS = new Set<FeedbackOp["op"]>([
  "caption_scale", "caption_offset", "captions", "tighten", "remove_zoom", "zoom_all", "zoom_at", "choose_take",
  "remove_sentence", "restore_sentence", "move_sentence", "trim", "fix_word", "add_card", "grade", "music_volume",
  "music", "music_track", "remove_card", "remove_broll", "broll", "sfx",
]);

const ORD: Record<string, number> = { eerste: 1, tweede: 2, derde: 3, vierde: 4, vijfde: 5, zesde: 6, zevende: 7, achtste: 8, negende: 9, tiende: 10, "1e": 1, "2e": 2, "3e": 3, "4e": 4, "5e": 5 };

function num(s: string): number {
  return Number(s.replace(",", "."));
}

/* ------------------------------------------------------------------ */
/* Punten en tijdstippen                                              */
/* ------------------------------------------------------------------ */

export type FeedbackPoint = { text: string; atS: number | null };

/** "[0:12]" of "[12.4s]" → seconden. */
const TAG_RE = /\[\s*(?:(\d+):(\d{1,2}(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*s?)\s*\]/;

export function formatTimestamp(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const whole = Math.floor(sec);
  const tenth = Math.floor((sec - whole) * 10);
  return `${m}:${String(whole).padStart(2, "0")}${tenth ? `.${tenth}` : ""}`;
}

function tagSeconds(m: RegExpMatchArray): number {
  return m[1] != null ? Number(m[1]) * 60 + num(m[2]) : num(m[3]);
}

/**
 * Splitst een chatbericht in losse punten: per regel, per opsommingsteken en
 * per zin. Een tijdstip-tag aan het begin van een regel hoort bij alle zinnen
 * op die regel.
 */
export function splitPoints(message: string): FeedbackPoint[] {
  const points: FeedbackPoint[] = [];
  for (const raw of message.split(/\r?\n/)) {
    let line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    if (!line) continue;
    let atS: number | null = null;
    const tag = line.match(TAG_RE);
    if (tag && tag.index != null && tag.index <= 2) {
      atS = tagSeconds(tag);
      line = (line.slice(0, tag.index) + line.slice(tag.index + tag[0].length)).trim();
    }
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z\[])/);
    for (let part of parts) {
      let at = atS;
      const inner = part.match(TAG_RE);
      if (inner && inner.index != null && inner.index <= 2) {
        at = tagSeconds(inner);
        part = (part.slice(0, inner.index) + part.slice(inner.index + inner[0].length)).trim();
      }
      part = part.replace(/^[,;:\s]+/, "").trim();
      if (part.length >= 2) points.push({ text: part, atS: at });
    }
  }
  return points;
}

/** Een tijdstip in de tekst zelf: "0:12", "seconde 12", "bij 12 s". Niet: "0,3 s later". */
export function timeMention(t: string): number | null {
  const mm = t.match(/\b(\d+):(\d{2}(?:[.,]\d+)?)\b/);
  if (mm) return Number(mm[1]) * 60 + num(mm[2]);
  const sec = t.match(/\bseconde\s*(\d+(?:[.,]\d+)?)/);
  if (sec) return num(sec[1]);
  const re = /(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconden?)\b(?!\s*(?:later|eerder|korter|langer|eruit|weg|sneller|strakker))/g;
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
    if (/eerste\s*$/.test(before)) continue; // "eerste 3 seconden" is een bereik, geen moment
    return num(m[1]);
  }
  return null;
}

function sentenceRef(t: string): SentenceRef | null {
  const n = t.match(/\bzin\s*(?:nummer\s*)?(\d+)/);
  if (n) return Number(n[1]);
  const o = t.match(/\b(eerste|tweede|derde|vierde|vijfde|zesde|zevende|achtste|negende|tiende|laatste)\s+zin/);
  if (o) return o[1] === "laatste" ? "last" : o[1] === "eerste" ? "first" : ORD[o[1]];
  return null;
}

/* ------------------------------------------------------------------ */
/* Vaste patronen                                                     */
/* ------------------------------------------------------------------ */

/**
 * Vaste patronen voor veelvoorkomende feedback. Geeft [] als er niets herkend
 * is. `atS` is het tijdstip van het punt (uit de preview), als dat er is.
 */
export function parseFeedbackRules(text: string, atS: number | null = null): FeedbackOp[] {
  const original = text.replace(/\s+/g, " ").trim();
  const t = original.toLowerCase();
  const ops: FeedbackOp[] = [];
  const strong = /\b(veel|flink|een stuk|duidelijk)\b/.test(t);
  const mild = /\b(iets|ietsje|beetje|wat|licht)\b/.test(t);
  const amount = strong ? 2 : mild ? 0.6 : 1;
  const at = timeMention(t) ?? atS;
  const removeWord = /(eruit|weg|verwijder|schrap|haal .* uit)/;

  // Spelling in de ondertitels: "Shortclip" → "Shortclips", 'schrijf "x" als "y"'.
  const quoted = original.match(/["'“‘]([^"'”’]{1,40})["'”’]\s*(?:moet|moet zijn|wordt|→|->|=>|naar|in plaats van|i\.p\.v\.)\s*["'“‘]([^"'”’]{1,40})["'”’]/i);
  const arrow = original.match(/(?:^|\s)([\p{L}\d'-]{2,30})\s*(?:→|->|=>)\s*([\p{L}\d'-]{2,30})/u);
  const spell = original.match(/(?:schrijf|spel)\s+["'“]?([\p{L}\d'-]{2,30})["'”]?\s+(?:als|met)\s+["'“]?([\p{L}\d'-]{2,30})["'”]?/iu);
  const fix = quoted ?? arrow ?? spell;
  if (fix) {
    const insteadOf = quoted && /in plaats van|i\.p\.v\./i.test(quoted[0]);
    ops.push(insteadOf ? { op: "fix_word", from: fix[2], to: fix[1] } : { op: "fix_word", from: fix[1], to: fix[2] });
    return ops;
  }

  // Zinnen: weglaten, terugzetten, verplaatsen.
  const sRef = sentenceRef(t);
  if (/\bzin(nen)?\b|dit stuk|deze zin|dit deel/.test(t)) {
    if (/(terug|weer erin|toch erin|weer toevoegen)/.test(t) && sRef != null) {
      ops.push({ op: "restore_sentence", sentence: sRef });
      return ops;
    }
    const moveStart = /(naar voren|naar het begin|als eerste|vooraan|openen met|begin(nen)? met)/.test(t);
    const moveEnd = /(naar achteren|naar het einde|naar het eind|als laatste|achteraan)/.test(t);
    const rel = t.match(/zin\s*(\d+)\s*(?:moet\s*)?(?:komt\s*)?(voor|na|achter)\s*zin\s*(\d+)/);
    if (rel) {
      ops.push({ op: "move_sentence", sentence: Number(rel[1]), position: rel[2] === "voor" ? { before: Number(rel[3]) } : { after: Number(rel[3]) } });
      return ops;
    }
    if ((moveStart || moveEnd) && (sRef != null || at != null)) {
      ops.push({ op: "move_sentence", ...(sRef != null ? { sentence: sRef } : { atS: at! }), position: moveStart ? "start" : "end" });
      return ops;
    }
    if (removeWord.test(t) && !/(zoom|kaart|b-?roll|muziek|ondertitel)/.test(t) && (sRef != null || at != null)) {
      ops.push({ op: "remove_sentence", ...(sRef != null ? { sentence: sRef } : { atS: at! }) });
      return ops;
    }
  }

  // Knip verschuiven op een moment.
  if (at != null) {
    const amt = t.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconden?)\s*(?:later|eerder|korter|langer)/);
    const d = amt ? Math.min(1.5, num(amt[1])) : 0.25;
    if (/(later beginnen|later in|begint te vroeg|later starten|begin .*(eraf|weg|korter)|start .*later)/.test(t)) ops.push({ op: "trim", atS: at, edge: "start", deltaS: d });
    else if (/(eerder beginnen|eerder in|begint te laat|begin .*afgekapt|eerder starten|mist het begin)/.test(t)) ops.push({ op: "trim", atS: at, edge: "start", deltaS: -Math.min(0.5, d) });
    else if (/(eerder af|eerder stoppen|loopt te lang door|te lang door|eind .*korter|stopt te laat)/.test(t)) ops.push({ op: "trim", atS: at, edge: "end", deltaS: d });
    else if (/(later af|te vroeg af|wordt afgekapt|valt weg|afgekapt|stopt te vroeg|eind .*afgekapt)/.test(t)) ops.push({ op: "trim", atS: at, edge: "end", deltaS: -Math.min(0.5, d) });
    if (ops.length) return ops;
  }

  if (/(ondertitel|ondertiteling|subtitle|caption|tekst onder)/.test(t)) {
    if (/kleiner/.test(t)) ops.push({ op: "caption_scale", factor: 1 - 0.1 * amount });
    else if (/groter/.test(t)) ops.push({ op: "caption_scale", factor: 1 + 0.1 * amount });
    if (/hoger|omhoog/.test(t)) ops.push({ op: "caption_offset", px: -Math.round(60 * amount) });
    else if (/lager|omlaag/.test(t)) ops.push({ op: "caption_offset", px: Math.round(60 * amount) });
    if (/(weg|uit|geen)\b/.test(t) && !/kleiner|groter|hoger|lager/.test(t)) ops.push({ op: "captions", enabled: false });
    else if (/(aan|terug|erbij)\b/.test(t) && !/kleiner|groter|hoger|lager/.test(t)) ops.push({ op: "captions", enabled: true });
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

  if (/zoom/.test(t)) {
    if (/(eruit|weg|uit\b|verwijder|niet|geen)/.test(t)) {
      if (/(alle|overal|geen) zoom/.test(t)) ops.push({ op: "zoom_all", enabled: false });
      else ops.push({ op: "remove_zoom", atS: at });
    } else if (at != null && /(zoom (hier )?in|inzoomen|zoom erbij|zoom toevoegen|hier .*zoom|zoom hier)/.test(t)) {
      ops.push({ op: "zoom_at", atS: at, level: strong ? 1.2 : 1.12 });
    }
  }

  const take = t.match(/(eerste|tweede|derde|vierde|vijfde|1e|2e|3e|4e|5e|\d+)\s*(?:take|opname|versie|poging).*?(laatste|eerste|tweede|derde|vierde|vijfde|zesde|zevende|achtste|negende|tiende|(\d+)(?:e|ste|de)?) zin/)
    ?? t.match(/zin\s*(\d+)\D{0,30}?(eerste|tweede|derde|vierde|vijfde|1e|2e|3e|4e|5e)\s*(?:take|opname|versie|poging)/);
  if (take) {
    if (/^\d+$/.test(take[1]) && t.indexOf("zin") < t.indexOf(take[2])) {
      ops.push({ op: "choose_take", sentence: Number(take[1]), rank: ORD[take[2]] ?? num(take[2]) });
    } else {
      const rank = ORD[take[1]] ?? num(take[1]);
      const s: SentenceRef = take[2] === "laatste" ? "last" : take[2] === "eerste" ? "first" : ORD[take[2]] ?? num(take[3] ?? "1");
      ops.push({ op: "choose_take", sentence: s, rank });
    }
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

  if (/muziek|track|nummer\b/.test(t)) {
    const name = original.match(/["'“‘]([^"'”’]{2,60})["'”’]/);
    if (name && /(gebruik|kies|zet|andere|wissel|neem)/.test(t)) ops.push({ op: "music_track", name: name[1] });
    else if (/(andere|ander nummer|andere track|wissel)/.test(t)) ops.push({ op: "music_track", name: "" });
    else if (/(zachter|te hard|lager|minder hard)/.test(t)) ops.push({ op: "music_volume", deltaDb: -3 * amount });
    else if (/(harder|luider|te zacht)/.test(t)) ops.push({ op: "music_volume", deltaDb: 3 * amount });
    else if (/(weg|eruit|uit|geen)/.test(t)) ops.push({ op: "music", enabled: false });
    else if (/(erbij|toevoegen|aan)/.test(t)) ops.push({ op: "music", enabled: true });
  }

  if (/(kaart|grafiek|overlay|pop-?up|card)/.test(t) && removeWord.test(t)) {
    ops.push({ op: "remove_card", atS: at });
  }
  if (/b-?roll/.test(t)) {
    const file = original.match(/["'“‘]([^"'”’]{2,80})["'”’]/) ?? original.match(/([\w-]+\.(?:mp4|mov|mxf|mts|m4v))/i);
    if (removeWord.test(t)) ops.push({ op: "remove_broll", atS: at });
    else if (at != null && /(andere|wissel|vervang|ander shot|toevoegen|erbij|hier|plaats|zet)/.test(t)) ops.push({ op: "broll", atS: at, source: file ? file[1] : null });
  }
  if (/(geluidseffect|sfx|plop|pop\b)/.test(t)) {
    if (/(eruit|weg|uit|geen)/.test(t)) ops.push({ op: "sfx", enabled: false });
    else if (/(aan|terug|erbij)/.test(t)) ops.push({ op: "sfx", enabled: true });
  }
  return ops;
}

/* ------------------------------------------------------------------ */
/* AI-laag                                                            */
/* ------------------------------------------------------------------ */

export type PromptContext = {
  plan: EditPlan;
  style: StyleConfig;
  brollSources: Array<{ id: string; filename: string; durationS: number }>;
  musicAssets: Array<{ id: string; name: string }>;
  /** Eerdere chatberichten met de antwoorden, oud → nieuw. */
  history: Array<{ text: string; response: string | null }>;
};

export function feedbackPrompt(points: FeedbackPoint[], c: PromptContext): { system: string; user: string } {
  const tl = deriveTimeline(c.plan, c.style.captions, c.style.export.fps);
  const sentences = c.plan.takes.map((t) => {
    const segs = tl.segments.filter((s) => s.sentenceIdx === t.sentenceIdx);
    const text = segs.flatMap((s) => s.words.map((w) => w.w)).join(" ") || t.sentenceText;
    const span = segs.length ? `${segs[0].atS.toFixed(1)}-${(segs[segs.length - 1].atS + segs[segs.length - 1].durS).toFixed(1)}s` : t.excluded ? "weggelaten" : "niet in montage";
    return `Zin ${t.sentenceIdx + 1} (${span}, ${t.options.length} take(s)): "${text}"`;
  });
  const brollName = (id: string) => c.brollSources.find((b) => b.id === id)?.filename ?? "b-roll";
  return {
    system: `Je verwerkt feedback van het Shortclips-team op een gemonteerde advertentie. Je krijgt genummerde punten; vertaal elk punt naar bewerkingen uit de vaste lijst hieronder. Antwoord uitsluitend met JSON:
{"points":[{"i":0,"ops":[...],"reply":"korte bevestiging in het Nederlands","question":null}]}

Toegestane ops (tijden in seconden op de tijdlijn van de video):
{"op":"caption_scale","factor":0.9}  (0.6-1.4)
{"op":"caption_offset","px":-60}  (negatief = hoger)
{"op":"captions","enabled":false}
{"op":"tighten","untilS":3,"maxPauseS":0.12}  (untilS null = hele video)
{"op":"remove_zoom","atS":12}  (atS null = alle zooms)
{"op":"zoom_all","enabled":false}
{"op":"zoom_at","atS":12,"level":1.12}  (1.05-1.3)
{"op":"choose_take","sentence":3,"rank":2}  (sentence = zinnummer of "first"/"last"; rank = take in opnamevolgorde)
{"op":"remove_sentence","sentence":3}  of  {"op":"remove_sentence","atS":12}
{"op":"restore_sentence","sentence":3}
{"op":"move_sentence","sentence":4,"position":"start"}  (position "start", "end", {"before":2} of {"after":2})
{"op":"trim","atS":12,"edge":"start","deltaS":0.3}  (positief = korter: later beginnen of eerder afkappen; negatief = langer, max -0.5)
{"op":"fix_word","from":"shortclip","to":"Shortclips"}  (alleen spelling van een woord dat gezegd wordt)
{"op":"add_card","atS":8,"template":"checklist","title":"...","items":["..."]}  (templates: checklist, status_list, process, stat met "value" en "label")
{"op":"grade","adjust":{"warmth":-0.5,"exposure":0.2,"saturation":-0.1,"contrast":0.05}}
{"op":"music_volume","deltaDb":-3}
{"op":"music","enabled":false}
{"op":"music_track","name":"exacte naam uit de muzieklijst"}
{"op":"remove_card","atS":8}  (atS null = alle kaarten)
{"op":"remove_broll","atS":15}  (atS null = alle b-roll)
{"op":"broll","atS":15,"source":"bestandsnaam of null"}  (b-roll toevoegen of wisselen op dat moment)
{"op":"sfx","enabled":false}

Regels:
- Verzin nooit tekst. Kaartteksten moeten letterlijk uit de gesproken zinnen komen. Een nieuwe zin, andere woorden of nieuwe opnames kun je niet maken: zeg dat in "reply" en geef "ops":[].
- Is een punt onduidelijk (welk moment, welke zin, welke kaart), geef dan "ops":[] en stel in "question" één korte, concrete vraag.
- Gebruik een tijdstip uit het punt ("[0:12]") als het moment waar het over gaat.
- Eerdere berichten staan erbij als context; een antwoord op jouw eerdere vraag hoort bij dat punt.
- Schrijf "reply" kort en zakelijk, zonder emoji.`,
    user: `Punten:
${points.map((p, i) => `${i}. ${p.atS != null ? `[${formatTimestamp(p.atS)}] ` : ""}${p.text}`).join("\n")}

Video: ${tl.durationS.toFixed(1)} s.
${sentences.join("\n")}
Kaarten: ${tl.cards.map((k) => `${k.startS.toFixed(1)}-${k.endS.toFixed(1)}s ${k.template} "${k.title}"`).join("; ") || "geen"}.
B-roll in de montage: ${tl.broll.map((b) => `${b.atS.toFixed(1)}s ${brollName(b.sourceId)}`).join("; ") || "geen"}.
B-roll-bestanden: ${c.brollSources.map((b) => b.filename).join(", ") || "geen"}.
Muzieklijst: ${c.musicAssets.map((m) => `"${m.name}"`).join(", ") || "leeg"}. Huidige muziek: ${c.musicAssets.find((m) => m.id === c.plan.music.assetId)?.name ?? "geen"}.
${c.history.length ? `Eerdere berichten:\n${c.history.map((h) => `Team: ${h.text}\nEditor: ${h.response ?? ""}`).join("\n")}` : ""}`,
  };
}

export type AiPoint = { i: number; ops: FeedbackOp[]; reply: string; question: string | null };

export function parseAiPoints(text: string): AiPoint[] | null {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const j = JSON.parse(text.slice(s, e + 1)) as { points?: Array<Partial<AiPoint>>; ops?: FeedbackOp[]; reply?: string };
    const list = j.points ?? (j.ops ? [{ i: 0, ops: j.ops, reply: j.reply }] : []);
    return list.map((p, k) => ({
      i: typeof p.i === "number" ? p.i : k,
      ops: (Array.isArray(p.ops) ? p.ops : []).filter((o) => o && typeof o === "object" && ALLOWED_OPS.has(o.op)),
      reply: String(p.reply ?? ""),
      question: p.question ? String(p.question) : null,
    }));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Toepassen                                                          */
/* ------------------------------------------------------------------ */

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
  brollSources: Array<{ id: string; filename: string; durationS: number }>;
  musicAssets: Array<{ id: string; name: string }>;
  /** Woorden uit het script (genormaliseerd), voor spelling en kaartteksten. */
  scriptWords: Set<string>;
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Knipt een segment aan het begin of eind korter (positief) of langer (negatief). */
function trimSegment(s: PlanSegment, edge: "start" | "end", deltaS: number): void {
  const minDur = 0.3;
  if (edge === "start") s.inS = r3(clamp(s.inS + deltaS, 0, s.outS - minDur));
  else s.outS = r3(Math.max(s.inS + minDur, s.outS - deltaS));
  // Woorden die nu buiten het segment vallen, verdwijnen ook uit de ondertitels.
  s.words = s.words.filter((w) => (w.s + w.e) / 2 >= s.inS && (w.s + w.e) / 2 <= s.outS);
}

function fixWord(w: string, fixes: Record<string, string>): string {
  const key = norm(w);
  const to = fixes[key];
  if (!to) return w;
  const trail = w.match(/[.,!?;:]+$/)?.[0] ?? "";
  const lead = w.match(/^[("“']+/)?.[0] ?? "";
  return `${lead}${to}${trail}`;
}

/**
 * Past blijvende handmatige wijzigingen (knippen, spelling) opnieuw toe op
 * vers opgebouwde segmenten. Alleen aanroepen direct na een herbouw.
 */
export function reapplyEdits(p: EditPlan): void {
  for (const t of p.trims ?? []) {
    for (const s of p.segments) {
      if (s.sourceId !== t.sourceId || !s.words.length) continue;
      if (t.edge === "start" && Math.abs(s.words[0].s - t.at) < 0.03) trimSegment(s, "start", t.deltaS);
      else if (t.edge === "end" && Math.abs(s.words[s.words.length - 1].e - t.at) < 0.03) trimSegment(s, "end", t.deltaS);
    }
  }
  applyWordFixes(p);
}

function applyWordFixes(p: EditPlan): void {
  const fixes = p.wordFixes ?? {};
  if (!Object.keys(fixes).length) return;
  for (const s of p.segments) s.words = s.words.map((w) => ({ ...w, w: fixWord(w.w, fixes) }));
}

/** Zoekt de plek van een zin in p.takes. */
function resolveSentence(p: EditPlan, ctx: ApplyContext, ref: SentenceRef | undefined, atS: number | undefined, includeExcluded = false): number {
  const live = p.takes.map((t, i) => ({ t, i })).filter((x) => includeExcluded || !x.t.excluded);
  if (ref === "first") return live[0]?.i ?? -1;
  if (ref === "last") return live[live.length - 1]?.i ?? -1;
  if (typeof ref === "number") return p.takes.findIndex((t) => t.sentenceIdx === Math.round(ref) - 1);
  if (atS != null) {
    const id = ctx.segmentAt(p, atS);
    const seg = p.segments.find((s) => s.id === id);
    return seg ? p.takes.findIndex((t) => t.sentenceIdx === seg.sentenceIdx) : -1;
  }
  return -1;
}

function rebuild(p: EditPlan, ctx: ApplyContext, old: EditPlan): EditPlan {
  const next = { ...p, segments: ctx.rebuildSegments(p.takes) };
  reapplyEdits(next);
  ctx.reanchor(old, next);
  return next;
}

function short(text: string, n = 60) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/** Past bewerkingen toe; geeft een nieuw plan + leesbare beschrijving. */
export function applyOps(plan: EditPlan, ops: FeedbackOp[], ctx: ApplyContext): { plan: EditPlan; done: string[]; skipped: string[] } {
  let p: EditPlan = JSON.parse(JSON.stringify(plan));
  const done: string[] = [];
  const skipped: string[] = [];
  const tl = () => deriveTimeline(p, ctx.style.captions, ctx.style.export.fps);
  for (const o of ops) {
    switch (o.op) {
      case "caption_scale":
        p.captionScale = clamp(p.captionScale * clamp(Number(o.factor) || 1, 0.5, 1.5), 0.6, 1.4);
        done.push(`Ondertitels ${o.factor < 1 ? "kleiner" : "groter"} (${Math.round(p.captionScale * 100)}%).`);
        break;
      case "caption_offset":
        p.captionOffsetY = clamp(p.captionOffsetY + (Number(o.px) || 0), -400, 200);
        done.push(`Ondertitels ${o.px < 0 ? "hoger" : "lager"} geplaatst.`);
        break;
      case "captions":
        p.captionsEnabled = o.enabled;
        done.push(o.enabled ? "Ondertitels aan." : "Ondertitels uit.");
        break;
      case "tighten": {
        const old = p;
        const before = p.segments.length;
        p = { ...p, segments: ctx.retighten(p, o.untilS, clamp(Number(o.maxPauseS) || 0.18, 0.05, 0.6)) };
        reapplyEdits(p);
        ctx.reanchor(old, p);
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
          if (seg) { seg.zoom = { from: 1, to: 1 }; done.push(`Zoom rond ${formatTimestamp(o.atS)} verwijderd.`); }
          else skipped.push(`Geen shot gevonden op ${formatTimestamp(o.atS)}.`);
        }
        break;
      }
      case "zoom_all":
        if (!o.enabled) { p.segments.forEach((s) => { s.zoom = { from: 1, to: 1 }; }); done.push("Zooms uitgezet."); }
        else skipped.push("Alle zooms opnieuw aanzetten gaat via 'Opnieuw genereren'. Een zoom op één moment kan wel: noem het tijdstip.");
        break;
      case "zoom_at": {
        const id = ctx.segmentAt(p, o.atS);
        const seg = p.segments.find((s) => s.id === id);
        if (!seg) { skipped.push(`Geen shot gevonden op ${formatTimestamp(o.atS)}.`); break; }
        const level = clamp(Number(o.level) || 1.12, 1.05, 1.3);
        seg.zoom = { from: level, to: level };
        done.push(`Zoom (${Math.round((level - 1) * 100)}%) op het shot rond ${formatTimestamp(o.atS)}.`);
        break;
      }
      case "choose_take": {
        const idx = resolveSentence(p, ctx, o.sentence, undefined);
        const choice = p.takes[idx];
        if (!choice) { skipped.push(`Zin ${String(o.sentence)} bestaat niet.`); break; }
        // "tweede take" = tweede opname in tijdsvolgorde.
        const byTime = [...choice.options].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.inS - b.inS);
        const pick = byTime[o.rank - 1];
        if (!pick) { skipped.push(`Zin ${choice.sentenceIdx + 1} heeft geen ${o.rank}e take (er ${byTime.length === 1 ? "is er 1" : `zijn er ${byTime.length}`}).`); break; }
        choice.chosenTakeId = pick.takeId;
        choice.needsUser = false;
        choice.userChosen = true;
        p = rebuild(p, ctx, p);
        done.push(`Zin ${choice.sentenceIdx + 1}: take ${o.rank} gebruikt ("${short(pick.text)}").`);
        break;
      }
      case "remove_sentence": {
        const idx = resolveSentence(p, ctx, o.sentence, o.atS);
        const choice = p.takes[idx];
        if (!choice) { skipped.push(o.atS != null ? `Geen zin gevonden op ${formatTimestamp(o.atS)}.` : `Zin ${String(o.sentence)} bestaat niet.`); break; }
        if (choice.excluded) { skipped.push(`Zin ${choice.sentenceIdx + 1} staat al niet in de montage.`); break; }
        if (p.takes.filter((t) => !t.excluded).length <= 1) { skipped.push("De laatste zin kan er niet uit; dan blijft er geen video over."); break; }
        const old: EditPlan = JSON.parse(JSON.stringify(p));
        choice.excluded = true;
        choice.needsUser = false;
        p = rebuild(p, ctx, old);
        done.push(`Zin ${choice.sentenceIdx + 1} weggelaten ("${short(choice.sentenceText)}"). Terugzetten kan met "zin ${choice.sentenceIdx + 1} terug".`);
        break;
      }
      case "restore_sentence": {
        const idx = resolveSentence(p, ctx, o.sentence, undefined, true);
        const choice = p.takes[idx];
        if (!choice) { skipped.push(`Zin ${String(o.sentence)} bestaat niet.`); break; }
        if (!choice.excluded) { skipped.push(`Zin ${choice.sentenceIdx + 1} staat al in de montage.`); break; }
        const old: EditPlan = JSON.parse(JSON.stringify(p));
        choice.excluded = false;
        p = rebuild(p, ctx, old);
        done.push(`Zin ${choice.sentenceIdx + 1} staat weer in de montage.`);
        break;
      }
      case "move_sentence": {
        const idx = resolveSentence(p, ctx, o.sentence, o.atS);
        const choice = p.takes[idx];
        if (!choice) { skipped.push("Ik kon niet bepalen welke zin verplaatst moet worden. Noem het zinnummer of zet het tijdstip erbij."); break; }
        const old: EditPlan = JSON.parse(JSON.stringify(p));
        const rest = p.takes.filter((_, i) => i !== idx);
        let at: number;
        let where: string;
        if (o.position === "start") { at = 0; where = "naar het begin"; }
        else if (o.position === "end") { at = rest.length; where = "naar het einde"; }
        else {
          const target = "before" in o.position ? o.position.before : o.position.after;
          const ti = rest.findIndex((t) => t.sentenceIdx === Math.round(target) - 1);
          if (ti < 0) { skipped.push(`Zin ${target} bestaat niet.`); break; }
          at = "before" in o.position ? ti : ti + 1;
          where = `${"before" in o.position ? "vóór" : "na"} zin ${target}`;
        }
        rest.splice(at, 0, choice);
        p.takes = rest;
        p = rebuild(p, ctx, old);
        done.push(`Zin ${choice.sentenceIdx + 1} verplaatst ${where}.`);
        break;
      }
      case "trim": {
        const id = ctx.segmentAt(p, o.atS);
        const seg = p.segments.find((s) => s.id === id);
        if (!seg || !seg.words.length) { skipped.push(`Geen shot gevonden op ${formatTimestamp(o.atS)}.`); break; }
        const deltaS = clamp(Number(o.deltaS) || 0, -0.5, 1.5);
        if (!deltaS) { skipped.push("Hoeveel moet de knip verschuiven?"); break; }
        const key = o.edge === "start" ? seg.words[0].s : seg.words[seg.words.length - 1].e;
        const beforeWords = seg.words.length;
        trimSegment(seg, o.edge, deltaS);
        p.trims = [...(p.trims ?? []), { sourceId: seg.sourceId, at: key, edge: o.edge, deltaS }];
        const lost = beforeWords - seg.words.length;
        done.push(`Knip rond ${formatTimestamp(o.atS)}: ${o.edge === "start" ? "shot begint" : "shot stopt"} ${Math.abs(deltaS).toFixed(2)} s ${o.edge === "start" ? (deltaS > 0 ? "later" : "eerder") : (deltaS > 0 ? "eerder" : "later")}${lost > 0 ? ` (${lost} woord(en) vallen weg)` : ""}.`);
        break;
      }
      case "fix_word": {
        const from = norm(o.from);
        const toText = String(o.to ?? "").trim();
        if (!from || !toText || /\s/.test(o.from.trim()) || /\s/.test(toText)) { skipped.push("Spelling aanpassen kan per los woord (bijv. \"shortclip\" → \"Shortclips\")."); break; }
        const hits = p.segments.reduce((n, s) => n + s.words.filter((w) => norm(w.w) === from).length, 0);
        if (!hits) { skipped.push(`"${o.from}" komt niet voor in de ondertitels.`); break; }
        const to = norm(toText);
        const similar = to === from || levenshtein(from, to) <= Math.max(1, Math.floor(Math.max(from.length, to.length) / 3)) || ctx.scriptWords.has(to);
        if (!similar) { skipped.push(`"${o.from}" → "${toText}" is een ander woord, geen spellingcorrectie. De ondertitels tonen alleen wat er gezegd wordt.`); break; }
        p.wordFixes = { ...(p.wordFixes ?? {}), [from]: toText };
        applyWordFixes(p);
        done.push(`Ondertitels: "${o.from}" wordt "${toText}" (${hits}×).`);
        break;
      }
      case "add_card": {
        const templates: Card["template"][] = ["checklist", "status_list", "process", "stat"];
        if (!templates.includes(o.template)) { skipped.push(`Onbekend kaarttype "${String(o.template)}".`); break; }
        const timeline = tl();
        const spoken = new Set(p.segments.flatMap((s) => s.words.map((w) => norm(w.w))));
        for (const w of ctx.scriptWords) spoken.add(w);
        const items = (o.items ?? []).map((x) => String(x)).filter(Boolean).slice(0, 6);
        const texts = [o.title, ...items, o.value ?? "", o.label ?? ""].map((x) => String(x ?? "")).filter(Boolean);
        const bad = texts.find((x) => !isGrounded(x, spoken, ["stap", "week", "maand"]));
        if (!o.title || bad) { skipped.push(`Kaart niet gemaakt: "${bad ?? "(geen titel)"}" komt niet uit wat er gezegd is. Kaartteksten moeten uit de video of het script komen.`); break; }
        const startWord = timeline.words.find((w) => w.oe > o.atS) ?? timeline.words[timeline.words.length - 1];
        if (!startWord) { skipped.push("Geen woord gevonden op dat moment."); break; }
        const after = timeline.words.filter((w) => w.os >= startWord.os);
        const anchors = items.map((it) => {
          const firstTok = norm(tokenize(it)[0] ?? "");
          const hit = after.find((w) => norm(w.w) === firstTok) ?? startWord;
          return { segmentId: hit.segmentId, wordIdx: hit.idx };
        });
        const card: Card = {
          id: `fb${p.version}_${p.cards.length + 1}`,
          template: o.template,
          title: o.title,
          items: items.map((text, i) => ({ text, anchor: anchors[i] })),
          value: o.value,
          label: o.label,
          start: { segmentId: startWord.segmentId, wordIdx: startWord.idx },
          origin: "ai",
        };
        p.cards.push(card);
        done.push(`Kaart "${short(o.title, 40)}" toegevoegd rond ${formatTimestamp(startWord.os)}.`);
        break;
      }
      case "grade": {
        const a = p.gradeAdjust;
        const adj = o.adjust ?? {};
        p.gradeAdjust = {
          warmth: clamp((a.warmth ?? 0) + (adj.warmth ?? 0), -1, 1),
          exposure: clamp((a.exposure ?? 0) + (adj.exposure ?? 0), -1, 1),
          saturation: clamp((a.saturation ?? 0) + (adj.saturation ?? 0), -0.5, 0.5),
          contrast: clamp((a.contrast ?? 0) + (adj.contrast ?? 0), -0.2, 0.2),
        };
        const parts = [adj.warmth ? (adj.warmth < 0 ? "koeler" : "warmer") : null, adj.exposure ? (adj.exposure > 0 ? "lichter" : "donkerder") : null, adj.saturation ? (adj.saturation < 0 ? "minder verzadigd" : "meer verzadigd") : null, adj.contrast ? (adj.contrast > 0 ? "meer contrast" : "minder contrast") : null].filter(Boolean);
        if (parts.length) done.push(`Kleur: ${parts.join(", ")}.`);
        else skipped.push("Welke kleuraanpassing bedoel je (warmer, koeler, lichter, donkerder)?");
        break;
      }
      case "music_volume":
        p.music.gainDb = clamp(p.music.gainDb + (Number(o.deltaDb) || 0), -20, 8);
        done.push(`Muziek ${o.deltaDb < 0 ? "zachter" : "harder"} (${p.music.gainDb > 0 ? "+" : ""}${p.music.gainDb.toFixed(0)} dB t.o.v. profiel).`);
        break;
      case "music":
        if (!o.enabled) { p.music.assetId = null; done.push("Muziek uitgezet."); }
        else if (p.music.assetId) skipped.push("Er staat al muziek onder.");
        else if (ctx.musicAssets[0]) { p.music.assetId = ctx.musicAssets[0].id; done.push(`Muziek aangezet ("${ctx.musicAssets[0].name}").`); }
        else skipped.push("De muziekbibliotheek is leeg. Voeg een track toe in Stijlbeheer.");
        break;
      case "music_track": {
        if (!ctx.musicAssets.length) { skipped.push("De muziekbibliotheek is leeg. Voeg een track toe in Stijlbeheer."); break; }
        const want = norm(o.name ?? "");
        let pick = want ? ctx.musicAssets.find((m) => norm(m.name) === want) ?? ctx.musicAssets.find((m) => norm(m.name).includes(want) || want.includes(norm(m.name))) : undefined;
        if (!want) {
          const cur = ctx.musicAssets.findIndex((m) => m.id === p.music.assetId);
          pick = ctx.musicAssets.length > 1 || cur < 0 ? ctx.musicAssets[(cur + 1) % ctx.musicAssets.length] : undefined;
        }
        if (!pick) { skipped.push(want ? `Geen track "${o.name}" in de muziekbibliotheek. Beschikbaar: ${ctx.musicAssets.map((m) => m.name).join(", ")}.` : "Er is maar één track in de bibliotheek."); break; }
        p.music.assetId = pick.id;
        done.push(`Muziek gewisseld naar "${pick.name}".`);
        break;
      }
      case "remove_card": {
        if (o.atS == null) { const n = p.cards.length; p.cards = []; done.push(`${n} kaart(en) verwijderd.`); break; }
        const id = ctx.cardAt(p, o.atS);
        if (id) { p.cards = p.cards.filter((c) => c.id !== id); done.push(`Kaart rond ${formatTimestamp(o.atS)} verwijderd.`); }
        else skipped.push(`Geen kaart gevonden op ${formatTimestamp(o.atS)}.`);
        break;
      }
      case "remove_broll": {
        if (o.atS == null) { p.broll = []; done.push("Alle b-roll verwijderd."); break; }
        const id = ctx.brollAt(p, o.atS);
        if (id) { p.broll = p.broll.filter((b) => b.id !== id); done.push(`B-roll rond ${formatTimestamp(o.atS)} verwijderd.`); }
        else skipped.push(`Geen b-roll gevonden op ${formatTimestamp(o.atS)}.`);
        break;
      }
      case "broll": {
        const list = ctx.brollSources;
        if (!list.length) { skipped.push("Er zijn geen b-roll-bestanden. Zet bij de bestanden een opname op de rol b-roll."); break; }
        const existingId = ctx.brollAt(p, o.atS);
        const existing = p.broll.find((b) => b.id === existingId);
        const want = o.source ? norm(o.source.replace(/\.[a-z0-9]+$/i, "")) : "";
        let src = want ? list.find((b) => norm(b.filename.replace(/\.[a-z0-9]+$/i, "")) === want) ?? list.find((b) => norm(b.filename).includes(want)) : undefined;
        if (want && !src) { skipped.push(`Geen b-roll-bestand "${o.source}". Beschikbaar: ${list.map((b) => b.filename).join(", ")}.`); break; }
        if (!src) {
          const cur = existing ? list.findIndex((b) => b.id === existing.sourceId) : -1;
          src = list[(cur + 1) % list.length];
        }
        const durS = clamp(Number(o.durS) || ctx.style.broll.clipMaxS, ctx.style.broll.clipMinS, Math.max(ctx.style.broll.clipMinS, src.durationS - 0.2));
        const inS = r3(Math.max(0, Math.min(0.5, src.durationS - durS - 0.1)));
        if (existing) {
          existing.sourceId = src.id;
          existing.inS = inS;
          done.push(`B-roll rond ${formatTimestamp(o.atS)} gewisseld naar ${src.filename}.`);
        } else {
          const segId = ctx.segmentAt(p, o.atS);
          const seg = tl().segments.find((s) => s.id === segId);
          if (!seg) { skipped.push(`Geen shot gevonden op ${formatTimestamp(o.atS)}.`); break; }
          p.broll.push({ id: `brfb${p.version}_${p.broll.length + 1}`, sourceId: src.id, inS, durS: r3(durS), anchorSegmentId: seg.id, anchorOffsetS: r3(Math.max(0, o.atS - seg.atS)) });
          done.push(`B-roll (${src.filename}, ${durS.toFixed(1)} s) toegevoegd op ${formatTimestamp(o.atS)}.`);
        }
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

/* ------------------------------------------------------------------ */
/* Een heel chatbericht verwerken                                     */
/* ------------------------------------------------------------------ */

export type PointResult = {
  text: string;
  atS: number | null;
  status: "done" | "partial" | "skipped" | "question" | "not_understood";
  ops: FeedbackOp[];
  reply: string;
};

const NOT_UNDERSTOOD = "Dit kon ik niet vertalen naar een montagewijziging. Probeer het concreter, met een tijdstip of zinnummer (bijv. \"[0:12] zoom eruit\" of \"zin 3 mag eruit\").";

/**
 * Verwerkt de punten van een bericht na elkaar op het plan. `aiPoints` zijn de
 * vertalingen van de punten die de vaste patronen niet herkenden.
 */
export function processPoints(plan: EditPlan, points: FeedbackPoint[], rulesOps: FeedbackOp[][], aiPoints: AiPoint[] | null, ctx: ApplyContext): { plan: EditPlan; results: PointResult[]; changed: boolean } {
  let p = plan;
  let changed = false;
  const results: PointResult[] = points.map((pt, i) => {
    let ops = rulesOps[i] ?? [];
    let aiReply = "";
    if (!ops.length) {
      const ai = aiPoints?.find((a) => a.i === i);
      if (ai?.question && !ai.ops.length) return { text: pt.text, atS: pt.atS, status: "question", ops: [], reply: ai.question };
      if (ai) { ops = ai.ops; aiReply = ai.reply; }
      if (!ops.length) return { text: pt.text, atS: pt.atS, status: "not_understood", ops: [], reply: aiReply || NOT_UNDERSTOOD };
    }
    const r = applyOps(p, ops, ctx);
    if (r.done.length) { p = r.plan; changed = true; }
    const status: PointResult["status"] = r.done.length && r.skipped.length ? "partial" : r.done.length ? "done" : "skipped";
    const reply = [...r.done, ...r.skipped].join(" ") || aiReply;
    return { text: pt.text, atS: pt.atS, status, ops, reply };
  });
  p = { ...p, version: plan.version + 1 };
  return { plan: p, results, changed };
}
