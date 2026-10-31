/**
 * Het montageplan (edit decision list) van de Shortclips AI Editor.
 *
 * Het plan is de bron van waarheid: de render leest het plan, feedback past het
 * plan aan, en alleen onderdelen waarvan de plan-invoer veranderd is worden
 * opnieuw gerenderd. Ondertitels en kaarttijden worden niet opgeslagen maar
 * steeds uit de segmenten afgeleid (deriveTimeline), zodat ze na elke
 * montagewijziging automatisch weer kloppen.
 *
 * Bewust zonder "server-only": deze module is puur en wordt ook in tests en de
 * worker gebruikt.
 */

export type Word = {
  /** Getoonde tekst (uit het script als dat er is, anders uit de transcriptie). */
  w: string;
  /** Tijd in de bron (seconden). */
  s: number;
  e: number;
  /** Zekerheid van de transcriptie (0-1), indien bekend. */
  p?: number;
};

export type Zoom = { from: number; to: number };

export type PlanSegment = {
  id: string;
  sourceId: string;
  inS: number;
  outS: number;
  /** De woorden in dit segment (brontijd). */
  words: Word[];
  /** Zin-index (in het script of de gedetecteerde zinnen). */
  sentenceIdx: number;
  zoom: Zoom;
  /** Per-segment kleurcorrectie bovenop de bron-correctie (feedback). */
  gradeOffset?: GradeAdjust;
};

export type BrollClip = {
  id: string;
  sourceId: string;
  /** In-punt in de b-roll-bron (s). */
  inS: number;
  durS: number;
  /** Anker: start op dit segment + offset (s, in segmenttijd). */
  anchorSegmentId: string;
  anchorOffsetS: number;
};

export type CardTemplate = "checklist" | "status_list" | "process" | "stat" | "cta_form";

export type CardItem = {
  text: string;
  /** Optioneel label-pill rechts (status_list). */
  pill?: string;
  pillTone?: "primary" | "secondary";
  /** Anker: verschijnt/vinkt af op dit woord. */
  anchor: { segmentId: string; wordIdx: number };
};

export type Card = {
  id: string;
  template: CardTemplate;
  title: string;
  items: CardItem[];
  /** stat: groot getal + label. */
  value?: string;
  label?: string;
  sublabel?: string;
  /** cta_form: knoptekst. */
  button?: string;
  start: { segmentId: string; wordIdx: number };
  /** Eind-anker; zonder eind blijft de kaart tot het einde van de zin staan. */
  end?: { segmentId: string; wordIdx: number; after?: boolean };
  /** Herkomst voor de uitleg: "regel" (vaste logica) of "ai". */
  origin: "regel" | "ai";
};

export type TakeOption = {
  takeId: string;
  sourceId: string;
  /** Volgorde van de bron (uploadvolgorde), voor "tweede take" in tijdsvolgorde. */
  order?: number;
  inS: number;
  outS: number;
  score: number;
  text: string;
};

export type TakeChoice = {
  sentenceIdx: number;
  sentenceText: string;
  options: TakeOption[];
  chosenTakeId: string | null;
  /** True als de AI twijfelt en de gebruiker moet kiezen. */
  needsUser: boolean;
  /** Gekozen door een mens (overschrijft de automatische keuze). */
  userChosen?: boolean;
};

export type GradeAdjust = {
  /** -1..1, positief = warmer. */
  warmth?: number;
  /** In stops, positief = lichter. */
  exposure?: number;
  /** Factor-delta, bijv. -0.1 = 10% minder verzadigd. */
  saturation?: number;
  contrast?: number;
};

export type SourceGrade = {
  /** Witbalans-gains per kanaal. */
  r: number;
  g: number;
  b: number;
  /** Belichting (gamma) en helderheid. */
  gamma: number;
  brightness: number;
  contrast: number;
  saturation: number;
  /** Technische conversie: "none" | "lut:<assetId>" | "generic_log". */
  inputTransform: string;
};

export type EditPlan = {
  version: number;
  segments: PlanSegment[];
  broll: BrollClip[];
  cards: Card[];
  takes: TakeChoice[];
  /** Kleurcorrectie per bron (technisch + matching). */
  grades: Record<string, SourceGrade>;
  /** Globale creatieve bijstelling (feedback). */
  gradeAdjust: GradeAdjust;
  captionScale: number;
  captionOffsetY: number;
  captionsEnabled: boolean;
  music: { assetId: string | null; gainDb: number };
  sfx: boolean;
  /** Uitleg van de keuzes, in mensentaal. */
  notes: string[];
};

/* -------------------------- Afgeleide tijdlijn -------------------------- */

export type TimelineWord = Word & { os: number; oe: number; segmentId: string; idx: number };
export type TimelineCaption = { text: string; startS: number; endS: number };
export type TimelineCard = Card & { startS: number; endS: number; itemTimes: number[] };
export type TimelineBroll = BrollClip & { atS: number };
export type TimelineSegment = PlanSegment & { atS: number; durS: number };

export type Timeline = {
  durationS: number;
  segments: TimelineSegment[];
  words: TimelineWord[];
  captions: TimelineCaption[];
  cards: TimelineCard[];
  broll: TimelineBroll[];
  /** Ankerpunten voor geluidseffecten. */
  sfx: Array<{ atS: number; kind: "pop" | "whoosh" }>;
};

export type CaptionRules = { wordsMin: number; wordsMax: number; maxChars: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Rekent het plan om naar een tijdlijn op de uitvoer (output-seconden). */
export function deriveTimeline(plan: EditPlan, rules: CaptionRules, fps = 25): Timeline {
  const frame = 1 / fps;
  const segments: TimelineSegment[] = [];
  let t = 0;
  for (const seg of plan.segments) {
    // Op hele frames afronden, zodat audio en beeld exact gelijk lopen.
    const durS = Math.max(frame, Math.round((seg.outS - seg.inS) / frame) * frame);
    segments.push({ ...seg, atS: round(t), durS: round(durS) });
    t += durS;
  }
  const durationS = round(t);

  const words: TimelineWord[] = [];
  for (const seg of segments) {
    seg.words.forEach((w, idx) => {
      const os = Math.max(seg.atS, seg.atS + (w.s - seg.inS));
      const oe = Math.min(seg.atS + seg.durS, seg.atS + (w.e - seg.inS));
      words.push({ ...w, os: round(os), oe: round(Math.max(os + 0.04, oe)), segmentId: seg.id, idx });
    });
  }

  const captions = plan.captionsEnabled ? chunkCaptions(words, rules, durationS) : [];

  const anchorTime = (a: { segmentId: string; wordIdx: number; after?: boolean }): number | null => {
    const seg = segments.find((s) => s.id === a.segmentId);
    if (!seg) return null;
    const w = seg.words[Math.min(Math.max(0, a.wordIdx), seg.words.length - 1)];
    if (!w) return seg.atS;
    const v = seg.atS + ((a.after ? w.e : w.s) - seg.inS);
    return round(Math.min(Math.max(v, seg.atS), seg.atS + seg.durS));
  };

  const cards: TimelineCard[] = [];
  for (const c of plan.cards) {
    const startS = anchorTime(c.start);
    if (startS == null) continue; // anker is weggeknipt → kaart vervalt
    let endS: number | null = c.end ? anchorTime(c.end) : null;
    if (endS == null) {
      // Tot het einde van de zin (laatste segment met dezelfde sentenceIdx).
      const seg = segments.find((s) => s.id === c.start.segmentId)!;
      const last = [...segments].reverse().find((s) => s.sentenceIdx === seg.sentenceIdx) ?? seg;
      endS = last.atS + last.durS;
    }
    if (c.template === "cta_form") endS = durationS; // CTA blijft tot het einde
    const itemTimes = c.items.map((it) => anchorTime({ ...it.anchor }) ?? startS);
    if (endS - startS < 0.4) continue;
    cards.push({ ...c, startS, endS: round(endS), itemTimes });
  }

  const broll: TimelineBroll[] = [];
  for (const b of plan.broll) {
    const seg = segments.find((s) => s.id === b.anchorSegmentId);
    if (!seg) continue;
    const atS = round(seg.atS + b.anchorOffsetS);
    if (atS >= durationS - 0.2) continue;
    broll.push({ ...b, atS, durS: round(Math.min(b.durS, durationS - atS)) });
  }

  const sfx: Timeline["sfx"] = [];
  if (plan.sfx) {
    for (const c of cards) {
      sfx.push({ atS: c.startS, kind: "pop" });
      c.itemTimes.slice(1).forEach((it) => { if (it > c.startS + 0.2) sfx.push({ atS: it, kind: "pop" }); });
    }
    for (const b of broll) sfx.push({ atS: Math.max(0, b.atS - 0.08), kind: "whoosh" });
  }

  return { durationS, segments, words, captions, cards, broll, sfx };
}

const PUNCT_END = /[.,!?;:]$/;
const SENTENCE_END = /[.!?]$/;

/**
 * Knipt woorden in ondertitelblokken van 2-4 woorden, met een breuk na
 * leestekens en een maximum aantal tekens. Een blok staat tot het volgende
 * blok begint (er zitten na de montage geen lange pauzes meer in).
 */
export function chunkCaptions(words: TimelineWord[], rules: CaptionRules, durationS: number): TimelineCaption[] {
  const chunks: TimelineWord[][] = [];
  let cur: TimelineWord[] = [];
  const flush = () => { if (cur.length) { chunks.push(cur); cur = []; } };
  for (const w of words) {
    const text = [...cur, w].map((x) => x.w).join(" ");
    if (cur.length >= rules.wordsMax || (cur.length >= 1 && text.length > rules.maxChars)) flush();
    cur.push(w);
    // Zinseinde: altijd breken (een ondertitel loopt nooit over twee zinnen).
    if (SENTENCE_END.test(w.w)) flush();
    else if (PUNCT_END.test(w.w) && cur.length >= rules.wordsMin) flush();
  }
  flush();
  // Eén los woord achteraan samenvoegen met het vorige blok als dat past.
  for (let i = chunks.length - 1; i > 0; i--) {
    if (chunks[i].length === 1 && !SENTENCE_END.test(chunks[i - 1][chunks[i - 1].length - 1].w)) {
      const merged = [...chunks[i - 1], ...chunks[i]];
      if (merged.map((x) => x.w).join(" ").length <= rules.maxChars + 4) {
        chunks.splice(i - 1, 2, merged);
      }
    }
  }
  return chunks.map((c, i) => {
    const startS = c[0].os;
    const next = chunks[i + 1];
    const endS = next ? next[0].os : Math.min(durationS, c[c.length - 1].oe + 0.35);
    return { text: c.map((x) => x.w).join(" "), startS: round(startS), endS: round(Math.max(endS, startS + 0.2)) };
  });
}

/** Stabiele hash van een object (voor de rendercache). */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
  let h1 = 0xdeadbeef ^ json.length;
  let h2 = 0x41c6ce57 ^ json.length;
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
