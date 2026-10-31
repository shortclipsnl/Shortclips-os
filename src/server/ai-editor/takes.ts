/**
 * Take-herkenning, take-keuze en het knippen van spraak.
 *
 * Werkt uitsluitend met wat er werkelijk gezegd is (woordtijden uit de
 * transcriptie). Er wordt nooit tekst verzonnen: met een script bepaalt het
 * script alleen welke zinnen bedoeld zijn, in welke volgorde, en hoe een woord
 * geschreven wordt in de ondertitel.
 *
 * Puur (geen I/O) zodat het los te testen is.
 */
import type { PlanSegment, TakeChoice, TakeOption, Word, Zoom } from "./plan";

export type SpeakerSource = { id: string; order: number; words: Word[] };

export type CutRules = {
  maxPauseS: number;
  headHandleS: number;
  tailHandleS: number;
  fillers: string[];
};

/* ------------------------------ Tekst ------------------------------ */

const NUM_WORDS: Record<string, string> = {
  een: "1", één: "1", twee: "2", drie: "3", vier: "4", vijf: "5", zes: "6", zeven: "7", acht: "8", negen: "9", tien: "10",
  twintig: "20", dertig: "30", veertig: "40", vijftig: "50", honderd: "100", duizend: "1000",
};

export function norm(token: string): string {
  const t = token
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+]/g, "");
  return NUM_WORDS[t] ?? t;
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

/** Splitst een script in zinnen (op . ? ! en regeleinden). */
export function splitScript(script: string): string[] {
  return script
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[-*•\d.)\s]+(?=[A-Za-zÀ-ÿ"'])/, "").trim())
    .filter((s) => s.length > 1 && /[A-Za-zÀ-ÿ0-9]/.test(s));
}

/** Longest common subsequence met de koppeling (indexparen). */
export function lcsAlign(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/* --------------------------- Uitspraken ---------------------------- */

export type Utterance = { sourceId: string; order: number; start: number; end: number; words: Word[] };

/** Splitst de woorden van een bron in uitspraken (op lange stiltes). */
export function utterances(src: SpeakerSource, gapS = 0.7): Utterance[] {
  const out: Utterance[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ sourceId: src.id, order: src.order, start: cur[0].s, end: cur[cur.length - 1].e, words: cur });
    cur = [];
  };
  for (const w of src.words) {
    const prev = cur[cur.length - 1];
    if (prev && w.s - prev.e > gapS) flush();
    cur.push(w);
  }
  flush();
  return out;
}

function isFiller(w: string, fillers: Set<string>): boolean {
  return fillers.has(norm(w));
}

/* ----------------------------- Takes ------------------------------- */

export type Take = TakeOption & { words: Word[] };

/**
 * Zoekt per scriptzin alle kandidaat-takes: aaneengesloten woordreeksen in de
 * spreker-bronnen die de zin het best dekken. Score = F1 (dekking × precisie)
 * met kleine straffen voor opvulwoorden en herhalingen en een kleine bonus voor
 * latere takes (de laatste poging is in de praktijk meestal de goede).
 */
export function findTakes(sentence: string, sources: SpeakerSource[], rules: CutRules, sentenceIdx: number): Take[] {
  const target = tokenize(sentence).map(norm).filter(Boolean);
  if (!target.length) return [];
  const fillers = new Set(rules.fillers.map(norm));
  const takes: Take[] = [];
  const totalOrder = Math.max(1, ...sources.map((s) => s.order + 1));

  for (const src of sources) {
    const utts = utterances(src, 0.6);
    // Kandidaatvensters: 1 tot 3 opeenvolgende uitspraken.
    for (let i = 0; i < utts.length; i++) {
      for (let k = 1; k <= 3 && i + k <= utts.length; k++) {
        const words = utts.slice(i, i + k).flatMap((u) => u.words);
        const toks = words.map((w) => norm(w.w));
        const pairs = lcsAlign(target, toks);
        if (pairs.length < Math.max(1, Math.ceil(target.length * 0.5))) continue;
        // Inkorten tot het gedeelte dat bij de zin hoort. Missen de eerste of
        // laatste scriptwoorden een koppeling (Whisper hoorde "So" i.p.v. "Zo"),
        // dan het aangrenzende gesproken woord meenemen als het aantal klopt.
        let first = pairs[0][1];
        let last = pairs[pairs.length - 1][1];
        const headMissing = pairs[0][0];
        for (let h = 0; h < headMissing && first > 0; h++) {
          const prev = words[first - 1];
          if (words[first].s - prev.e > 0.8 || fillers.has(norm(prev.w))) break;
          first--;
        }
        const tailMissing = target.length - 1 - pairs[pairs.length - 1][0];
        for (let h = 0; h < tailMissing && last < words.length - 1; h++) {
          const nxt = words[last + 1];
          if (nxt.s - words[last].e > 0.8 || fillers.has(norm(nxt.w))) break;
          last++;
        }
        const span = words.slice(first, last + 1);
        const spanToks = span.map((w) => norm(w.w)).filter((t) => t && !fillers.has(t));
        const recall = pairs.length / target.length;
        const precision = pairs.length / Math.max(1, spanToks.length);
        const f1 = (2 * recall * precision) / Math.max(1e-6, recall + precision);
        const fillerCount = span.filter((w) => isFiller(w.w, fillers)).length;
        let reps = 0;
        for (let x = 1; x < span.length; x++) if (norm(span[x].w) === norm(span[x - 1].w)) reps++;
        const longGaps = span.slice(1).filter((w, x) => w.s - span[x].e > 0.6).length;
        // Herstart binnen de reeks (zelfde drie woorden twee keer) = valse start + nieuwe poging.
        const grams = new Set<string>();
        let restart = 0;
        for (let x = 0; x + 2 < spanToks.length; x++) {
          const g = spanToks.slice(x, x + 3).join(" ");
          if (grams.has(g)) restart = 1;
          grams.add(g);
        }
        const recency = (src.order + (span[0].s / 10000)) / totalOrder;
        const score = f1 - 0.04 * fillerCount - 0.06 * reps - 0.05 * longGaps - 0.3 * restart + 0.03 * recency;
        takes.push({
          takeId: `${sentenceIdx}:${src.id}:${span[0].s.toFixed(2)}`,
          sourceId: src.id,
          order: src.order,
          inS: span[0].s,
          outS: span[span.length - 1].e,
          score: Math.round(score * 1000) / 1000,
          text: span.map((w) => w.w).join(" "),
          words: span,
        });
      }
    }
  }
  // Ontdubbelen: overlappende kandidaten uit dezelfde bron → beste houden.
  takes.sort((a, b) => b.score - a.score);
  const kept: Take[] = [];
  for (const t of takes) {
    if (kept.some((k) => k.sourceId === t.sourceId && t.inS < k.outS && t.outS > k.inS)) continue;
    kept.push(t);
  }
  return kept.filter((t) => t.score >= 0.55).slice(0, 5);
}

/**
 * Neemt de woordweergave uit het script over (spelling), op basis van de
 * LCS-koppeling. Tussen twee gekoppelde woorden mogen 1-3 ongekoppelde woorden
 * staan die Whisper anders hoorde of anders opsplitste ("opnamesplan" voor
 * "opnames gepland", "grevens" voor "gegevens"): die worden vervangen door de
 * scriptwoorden, verdeeld over dezelfde tijdsspanne. De tijden blijven die van
 * de opname; alleen de schrijfwijze komt uit het script.
 */
export function applyScriptSpelling(words: Word[], sentence: string): Word[] {
  const scriptToks = tokenize(sentence);
  const pairs = lcsAlign(scriptToks.map(norm), words.map((w) => norm(w.w)));
  const out: Word[] = [];
  const bounds: Array<[number, number]> = [[-1, -1], ...pairs, [scriptToks.length, words.length]];
  for (let b = 1; b < bounds.length; b++) {
    const [s0, w0] = bounds[b - 1];
    const [s1, w1] = bounds[b];
    const gapS = s1 - s0 - 1;
    const gapW = w1 - w0 - 1;
    const between = words.slice(w0 + 1, w1);
    // Alleen tussen twee ankers (niet aan het begin/eind van de take).
    const inner = b > 1 && b < bounds.length - 1;
    if (gapW > 0 && gapS > 0 && gapS <= 3 && gapW <= 3 && (inner || gapS === gapW)) {
      const start = between[0].s;
      const end = between[between.length - 1].e;
      const toks = scriptToks.slice(s0 + 1, s1);
      const totalLen = toks.reduce((a, t) => a + Math.max(1, t.length), 0);
      let t = start;
      for (const tok of toks) {
        const d = ((end - start) * Math.max(1, tok.length)) / totalLen;
        out.push({ w: tok, s: Math.round(t * 1000) / 1000, e: Math.round((t + d) * 1000) / 1000, p: between[0].p });
        t += d;
      }
    } else {
      out.push(...between.map((w) => ({ ...w })));
    }
    if (b < bounds.length - 1) out.push({ ...words[w1], w: scriptToks[s1] });
  }
  return out;
}

/**
 * Zonder script: valse starts en dubbele takes herkennen. Een uitspraak die
 * door een latere, gelijkende uitspraak wordt overgedaan, vervalt; de latere
 * blijft (de laatste poging is meestal de goede). Geeft per overgebleven zin
 * de take-keuze terug met alternatieven.
 */
export function detectSentencesWithoutScript(sources: SpeakerSource[], rules: CutRules): Array<{ text: string; takes: Take[] }> {
  const fillers = new Set(rules.fillers.map(norm));
  const all = sources
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((s) => utterances(s, 0.7))
    .filter((u) => u.words.filter((w) => !isFiller(w.w, fillers)).length >= 2);

  const toks = (u: Utterance) => u.words.map((w) => norm(w.w)).filter((t) => t && !fillers.has(t));
  const sim = (a: Utterance, b: Utterance) => {
    const ta = toks(a);
    const tb = toks(b);
    const p = lcsAlign(ta, tb).length;
    return (2 * p) / Math.max(1, ta.length + tb.length);
  };
  const startsAlike = (a: Utterance, b: Utterance) => {
    const ta = toks(a).slice(0, 3);
    const tb = toks(b).slice(0, 3);
    return ta.length >= 2 && ta.filter((t, i) => tb[i] === t).length >= 2;
  };

  const groups: Utterance[][] = [];
  const used = new Set<number>();
  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    const group = [all[i]];
    used.add(i);
    for (let j = i + 1; j < Math.min(all.length, i + 6); j++) {
      if (used.has(j)) continue;
      const last = group[group.length - 1];
      if (sim(last, all[j]) >= 0.6 || (startsAlike(last, all[j]) && toks(last).length <= toks(all[j]).length + 1)) {
        group.push(all[j]);
        used.add(j);
      }
    }
    groups.push(group);
  }

  return groups.map((g, idx) => {
    const takes: Take[] = g.map((u, k) => {
      const fillerCount = u.words.filter((w) => isFiller(w.w, fillers)).length;
      // Latere pogingen krijgen voorrang; volledigheid telt mee.
      const completeness = toks(u).length / Math.max(1, ...g.map((x) => toks(x).length));
      const score = 0.6 + 0.25 * completeness + 0.1 * (k / Math.max(1, g.length - 1)) - 0.04 * fillerCount;
      return {
        takeId: `${idx}:${u.sourceId}:${u.start.toFixed(2)}`,
        sourceId: u.sourceId,
        order: u.order,
        inS: u.start,
        outS: u.end,
        score: Math.round(score * 1000) / 1000,
        text: u.words.map((w) => w.w).join(" "),
        words: u.words,
      };
    });
    takes.sort((a, b) => b.score - a.score);
    return { text: takes[0].text, takes };
  });
}

/* ------------------------- Take-keuze ------------------------------ */

/** Twijfel als de beste twee takes inhoudelijk verschillen en dicht bij elkaar scoren. */
export function buildTakeChoice(sentenceIdx: number, sentenceText: string, takes: Take[]): TakeChoice {
  const options: TakeOption[] = takes.map((t) => ({ takeId: t.takeId, sourceId: t.sourceId, order: t.order, inS: t.inS, outS: t.outS, score: t.score, text: t.text }));
  const [a, b] = takes;
  let needsUser = false;
  if (a && b) {
    const ta = a.words.map((w) => norm(w.w)).join(" ");
    const tb = b.words.map((w) => norm(w.w)).join(" ");
    needsUser = ta !== tb && a.score - b.score < 0.03;
  }
  return { sentenceIdx, sentenceText, options, chosenTakeId: a?.takeId ?? null, needsUser };
}

/* ---------------------------- Knippen ------------------------------ */

let segCounter = 0;
export function resetSegmentIds() { segCounter = 0; }

/**
 * Maakt van een gekozen take montagesegmenten: opvulwoorden en directe
 * herhalingen ("de de") eruit, pauzes langer dan maxPause eruit, met korte
 * marges rond de woorden zodat er niets wordt afgekapt.
 */
/** Maximale geloofwaardige duur van een woord; langer = er zit stilte of ander geluid in. */
export function plausibleEnd(w: Word): number {
  const max = Math.max(0.55, 0.11 * w.w.length + 0.25);
  return Math.min(w.e, w.s + max);
}

export function cutTake(rawWords: Word[], sourceId: string, sentenceIdx: number, rules: CutRules): PlanSegment[] {
  const fillers = new Set(rules.fillers.map(norm));
  // Woorden met een onwaarschijnlijk lange duur inkorten, zodat de pauze erin wordt weggeknipt.
  const words = rawWords.map((w) => ({ ...w, e: Math.round(plausibleEnd(w) * 1000) / 1000 }));
  const kept: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (isFiller(w.w, fillers)) continue;
    const next = words[i + 1];
    // Stotter/herhaling: hetzelfde woord direct opnieuw → eerste vervalt.
    if (next && norm(next.w) === norm(w.w) && norm(w.w).length > 0 && next.s - w.e < 0.8) continue;
    kept.push(w);
  }
  if (!kept.length) return [];

  // Groepen aaneengesloten woorden; een nieuwe groep bij een te lange pauze of
  // als er tussenin een woord is weggeknipt.
  const groups: Word[][] = [];
  let cur: Word[] = [kept[0]];
  for (let i = 1; i < kept.length; i++) {
    const prev = kept[i - 1];
    const w = kept[i];
    const removedBetween = words.indexOf(w) - words.indexOf(prev) > 1;
    if (w.s - prev.e > rules.maxPauseS || removedBetween) {
      groups.push(cur);
      cur = [w];
    } else {
      cur.push(w);
    }
  }
  groups.push(cur);

  return groups.map((g, gi) => {
    const prevWord = gi > 0 ? groups[gi - 1][groups[gi - 1].length - 1] : null;
    const nextWord = gi < groups.length - 1 ? groups[gi + 1][0] : null;
    // Marges, maar nooit over een weggeknipt woord heen.
    const allIdxFirst = words.indexOf(g[0]);
    const before = allIdxFirst > 0 ? words[allIdxFirst - 1] : null;
    const allIdxLast = words.indexOf(g[g.length - 1]);
    const after = allIdxLast < words.length - 1 ? words[allIdxLast + 1] : null;
    let inS = g[0].s - rules.headHandleS;
    if (before) inS = Math.max(inS, before.e + 0.01);
    if (prevWord) inS = Math.max(inS, prevWord.e);
    let outS = g[g.length - 1].e + rules.tailHandleS;
    if (after) outS = Math.min(outS, after.s - 0.01);
    if (nextWord) outS = Math.min(outS, nextWord.s);
    inS = Math.max(0, inS);
    return {
      id: `seg${++segCounter}`,
      sourceId,
      inS: Math.round(inS * 1000) / 1000,
      outS: Math.round(Math.max(outS, inS + 0.1) * 1000) / 1000,
      words: g,
      sentenceIdx,
      zoom: { from: 1, to: 1 },
    };
  });
}

/* ------------------------------ Zooms ------------------------------ */

/**
 * Wisselt bij jumpcuts binnen dezelfde opname tussen normaal en een punch-in,
 * zodat de knip niet "springt". Langere shots krijgen een subtiele push-in.
 */
export function assignZooms(segments: PlanSegment[], z: { enabled: boolean; pushInTo: number; punchIn: number; minShotForPushS: number }): void {
  let punched = false;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const prev = segments[i - 1];
    if (!z.enabled) { s.zoom = { from: 1, to: 1 }; continue; }
    const jump = prev && prev.sourceId === s.sourceId && s.inS - prev.outS < 3 && s.inS >= prev.outS - 0.01;
    punched = jump ? !punched : false;
    const base = punched ? z.punchIn : 1;
    const dur = s.outS - s.inS;
    const zoom: Zoom = dur >= z.minShotForPushS ? { from: base, to: Math.round(base * z.pushInTo * 1000) / 1000 } : { from: base, to: base };
    s.zoom = zoom;
  }
}
