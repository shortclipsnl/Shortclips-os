/**
 * Montageplanning: van geanalyseerde bronnen (+ optioneel script) naar een
 * volledig montageplan. Twee lagen:
 *
 * 1. Vaste logica (altijd, zonder AI-kosten): takes herkennen en kiezen,
 *    versprekingen/opvulwoorden/pauzes eruit, volgorde, zooms, b-roll op
 *    opsommingen, ondertitels, een CTA-kaart als er een oproep is.
 * 2. AI-laag (als ANTHROPIC_API_KEY is gezet): Claude kiest welke momenten een
 *    UI-kaart krijgen en waar b-roll het verhaal versterkt. Claude mag GEEN
 *    tekst verzinnen: kaartteksten worden gecontroleerd tegen wat er gezegd is.
 *
 * Puur, behalve de optionele AI-aanroep die als functie wordt meegegeven.
 */
import type { Card, CardItem, CardTemplate, EditPlan, PlanSegment, TakeChoice, Word } from "./plan";
import type { StyleConfig } from "./style-profile";
import {
  applyScriptSpelling,
  assignZooms,
  buildTakeChoice,
  cutTake,
  detectSentencesWithoutScript,
  findTakes,
  norm,
  resetSegmentIds,
  splitScript,
  tokenize,
  type CutRules,
  type SpeakerSource,
  type Take,
} from "./takes";

export type PlannerSource = {
  id: string;
  order: number;
  filename: string;
  role: "speaker" | "broll";
  durationS: number;
  words: Word[];
};

export type PlanInput = {
  sources: PlannerSource[];
  script: string | null;
  style: StyleConfig;
  musicAssetId: string | null;
  /** Eerder door de gebruiker gekozen takes (blijven behouden bij hergenereren). */
  userTakeChoices?: Record<number, string>;
};

export type DraftPlan = {
  plan: EditPlan;
  /** Alle kandidaat-takes, voor wisselen zonder opnieuw te analyseren. */
  takePool: Record<number, Take[]>;
  sentences: string[];
  warnings: string[];
};

function cutRules(style: StyleConfig): CutRules {
  return {
    maxPauseS: style.editing.maxPauseS,
    headHandleS: style.editing.headHandleS,
    tailHandleS: style.editing.tailHandleS,
    fillers: style.editing.fillers,
  };
}

/** Bouwt de segmenten opnieuw op uit de gekozen takes. */
export function segmentsFromTakes(takes: TakeChoice[], pool: Record<number, Take[]>, sentences: string[], hasScript: boolean, style: StyleConfig): PlanSegment[] {
  resetSegmentIds();
  const rules = cutRules(style);
  const segs: PlanSegment[] = [];
  for (const choice of takes) {
    const take = pool[choice.sentenceIdx]?.find((t) => t.takeId === choice.chosenTakeId);
    if (!take) continue;
    const words = hasScript ? applyScriptSpelling(take.words, sentences[choice.sentenceIdx]) : take.words;
    segs.push(...cutTake(words, take.sourceId, choice.sentenceIdx, rules));
  }
  // Hook: eerste woord vrijwel op frame 0.
  if (segs[0]) segs[0].inS = Math.max(0, Math.max(segs[0].inS, segs[0].words[0].s - 0.02));
  // Laatste segment iets langer uit laten lopen.
  const last = segs[segs.length - 1];
  if (last) last.outS = Math.round((last.outS + style.editing.endTailS) * 1000) / 1000;
  assignZooms(segs, style.zoom);
  return segs;
}

export function draftPlan(input: PlanInput): DraftPlan {
  const { style } = input;
  const rules = cutRules(style);
  const speakers: SpeakerSource[] = input.sources.filter((s) => s.role === "speaker").map((s) => ({ id: s.id, order: s.order, words: s.words }));
  const warnings: string[] = [];
  const notes: string[] = [];
  const takePool: Record<number, Take[]> = {};
  const takes: TakeChoice[] = [];
  let sentences: string[] = [];
  const hasScript = Boolean(input.script && input.script.trim());

  if (!speakers.length) throw new Error("Geen bron met gesproken tekst gevonden. Upload minimaal één opname van de spreker.");

  if (hasScript) {
    sentences = splitScript(input.script!);
    sentences.forEach((sentence, i) => {
      const found = findTakes(sentence, speakers, rules, i);
      takePool[i] = found;
      const choice = buildTakeChoice(i, sentence, found);
      const userPick = input.userTakeChoices?.[i];
      if (userPick && found.some((t) => t.takeId === userPick)) {
        choice.chosenTakeId = userPick;
        choice.needsUser = false;
        choice.userChosen = true;
      }
      if (!found.length) warnings.push(`Zin ${i + 1} uit het script is niet teruggevonden in de opnames: "${sentence}"`);
      takes.push(choice);
    });
    notes.push(`Script gebruikt: ${sentences.length} zinnen; per zin de beste take gekozen uit ${Object.values(takePool).reduce((a, t) => a + t.length, 0)} kandidaten.`);
  } else {
    const detected = detectSentencesWithoutScript(speakers, rules);
    sentences = detected.map((d) => d.text);
    detected.forEach((d, i) => {
      takePool[i] = d.takes;
      const choice = buildTakeChoice(i, d.text, d.takes);
      const userPick = input.userTakeChoices?.[i];
      if (userPick && d.takes.some((t) => t.takeId === userPick)) {
        choice.chosenTakeId = userPick;
        choice.needsUser = false;
        choice.userChosen = true;
      }
      takes.push(choice);
    });
    const dropped = detected.reduce((a, d) => a + d.takes.length - 1, 0);
    notes.push(`Geen script: ${sentences.length} zinnen herkend in de opnames; ${dropped} valse start(s) of dubbele take(s) weggelaten (steeds de laatste, volledige poging gekozen).`);
  }

  preferContinuity(takes, takePool);
  const segments = segmentsFromTakes(takes, takePool, sentences, hasScript, style);
  const fillersRemoved = countRemovedFillers(takes, takePool, style);
  if (fillersRemoved) notes.push(`${fillersRemoved} opvulwoord(en)/herhaling(en) weggeknipt.`);
  notes.push(`Pauzes langer dan ${style.editing.maxPauseS.toFixed(2)} s verwijderd; ${segments.length} montagesegmenten.`);

  const plan: EditPlan = {
    version: 1,
    segments,
    broll: [],
    cards: [],
    takes,
    grades: {},
    gradeAdjust: {},
    captionScale: 1,
    captionOffsetY: 0,
    captionsEnabled: style.captions.enabled,
    music: { assetId: style.audio.music ? input.musicAssetId : null, gainDb: 0 },
    sfx: style.audio.sfx,
    notes,
  };

  // Vaste regels voor b-roll en de CTA-kaart.
  const brollSources = input.sources.filter((s) => s.role === "broll");
  if (style.broll.enabled && brollSources.length) placeBrollByRules(plan, brollSources, style);
  if (style.cards.enabled) addCtaCard(plan);
  return { plan, takePool, sentences, warnings };
}

/**
 * Continuïteit: zinnen die in één doorlopende take zijn opgenomen, liefst uit
 * diezelfde take halen (zelfde houding, licht en intonatie), zolang die take
 * nauwelijks slechter scoort. Door de gebruiker gekozen takes blijven staan.
 */
export function preferContinuity(takes: TakeChoice[], pool: Record<number, Take[]>): void {
  for (let i = 1; i < takes.length; i++) {
    const cur = takes[i];
    if (cur.userChosen) continue;
    const prevChoice = takes[i - 1];
    const prev = pool[prevChoice.sentenceIdx]?.find((t) => t.takeId === prevChoice.chosenTakeId);
    const options = pool[cur.sentenceIdx] ?? [];
    const best = options.find((t) => t.takeId === cur.chosenTakeId);
    if (!prev || !best) continue;
    const follow = options.find((t) => t.sourceId === prev.sourceId && t.inS >= prev.outS - 0.05 && t.inS - prev.outS < 1.5);
    if (follow && follow.takeId !== best.takeId && follow.score >= best.score - 0.06) {
      cur.chosenTakeId = follow.takeId;
      cur.needsUser = false;
    }
  }
}

function countRemovedFillers(takes: TakeChoice[], pool: Record<number, Take[]>, style: StyleConfig): number {
  const fillers = new Set(style.editing.fillers.map(norm));
  let n = 0;
  for (const c of takes) {
    const t = pool[c.sentenceIdx]?.find((x) => x.takeId === c.chosenTakeId);
    if (!t) continue;
    t.words.forEach((w, i) => {
      if (fillers.has(norm(w.w))) n++;
      else if (t.words[i + 1] && norm(t.words[i + 1].w) === norm(w.w)) n++;
    });
  }
  return n;
}

/* ------------------------------ B-roll ------------------------------ */

/**
 * B-roll op de momenten waar het verhaal opsomt of een proces beschrijft
 * (komma's / "en"), niet in de hook en niet op de oproep aan het einde.
 */
export function placeBrollByRules(plan: EditPlan, broll: PlannerSource[], style: StyleConfig): void {
  const b = style.broll;
  const segs = plan.segments;
  const lastSentence = Math.max(...segs.map((s) => s.sentenceIdx));
  let t = 0;
  const starts: number[] = segs.map((s) => { const at = t; t += s.outS - s.inS; return at; });
  const candidates = segs
    .map((s, i) => ({ s, i, at: starts[i], dur: s.outS - s.inS, listy: s.words.filter((w) => /,$/.test(w.w)).length + s.words.filter((w) => norm(w.w) === "en").length }))
    .filter((c) => c.at >= b.notBeforeS && c.s.sentenceIdx !== lastSentence && c.dur >= b.clipMinS + 0.2);
  candidates.sort((a, c) => c.listy - a.listy || c.dur - a.dur);
  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.length >= Math.max(1, Math.floor(t / 7))) break;
    if (picked.some((p) => Math.abs(p.at - c.at) < 3)) continue;
    picked.push(c);
  }
  picked.sort((a, c) => a.at - c.at);
  const offsets: Record<string, number> = {};
  picked.forEach((c, k) => {
    const src = broll[k % broll.length];
    const durS = Math.min(b.clipMaxS, Math.max(b.clipMinS, c.dur - 0.15));
    const usable = Math.max(0, src.durationS - durS - 0.6);
    const used = offsets[src.id] ?? 0.5;
    const inS = Math.min(usable, used);
    offsets[src.id] = inS + durS + 0.4 > usable ? 0.5 : inS + durS + 0.4;
    plan.broll.push({ id: `br${k + 1}`, sourceId: src.id, inS: Math.round(inS * 1000) / 1000, durS: Math.round(durS * 1000) / 1000, anchorSegmentId: c.s.id, anchorOffsetS: 0.1 });
  });
  if (picked.length) plan.notes.push(`${picked.length} b-rollmoment(en) geplaatst op opsommingen/procesbeschrijvingen (niet in de hook, niet op de CTA).`);
}

/* ------------------------------ CTA ------------------------------ */

const CTA_RE = /(gegevens|contact|bel(len)?|aanmeld|inschrijv|klik|link|formulier|plan(nen)? .* gesprek|afspraak)/i;

/** CTA-kaart als de laatste zin een oproep bevat. Titel = de gesproken oproep. */
export function addCtaCard(plan: EditPlan): void {
  const lastIdx = Math.max(...plan.segments.map((s) => s.sentenceIdx));
  const segs = plan.segments.filter((s) => s.sentenceIdx === lastIdx);
  const words = segs.flatMap((s) => s.words.map((w, wi) => ({ w, seg: s, wi })));
  const text = words.map((x) => x.w.w).join(" ");
  if (!CTA_RE.test(text) || !words.length) return;
  // Titel: de korte frase rond "gegevens"/"contact", zoals gesproken.
  const idx = words.findIndex((x) => /gegevens|contact|aanmeld|inschrijv|afspraak/i.test(x.w.w));
  let title = "";
  if (idx >= 0) {
    const from = Math.max(0, idx - 2);
    title = words.slice(from, Math.min(words.length, idx + 2)).map((x) => x.w.w).join(" ").replace(/[,.]$/, "");
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  const lower = text.toLowerCase();
  const button = /binnen (één|een|1) dag/.test(lower) ? "Bel mij binnen 1 dag" : /vandaag/.test(lower) ? "Neem vandaag contact op" : "Neem contact op";
  const first = words[0];
  const lastW = words[words.length - 1];
  plan.cards.push({
    id: "cta",
    template: "cta_form",
    title: title || "Laat je gegevens achter",
    items: [{ text: button, anchor: { segmentId: lastW.seg.id, wordIdx: lastW.wi } }],
    button,
    start: { segmentId: first.seg.id, wordIdx: first.wi },
    origin: "regel",
  });
  plan.notes.push(`CTA-formulier toegevoegd op de laatste zin ("${title || "Laat je gegevens achter"}"), met vinkje op het laatste woord.`);
}

/* ------------------------------ AI-laag ------------------------------ */

export type AiCardSuggestion = {
  template: CardTemplate;
  title: string;
  /** Index van het segment waar de kaart start en het woord daarin. */
  startSegment: number;
  startWord: number;
  items: Array<{ text: string; pill?: string; pillTone?: "primary" | "secondary"; segment: number; word: number }>;
  value?: string;
  label?: string;
  sublabel?: string;
  reason: string;
};

export type AiBrollSuggestion = { segment: number; brollSource: number; reason: string };

export type AiSuggestions = { cards: AiCardSuggestion[]; broll: AiBrollSuggestion[]; notes: string[] };

/** Toegestane pill-labels: neutrale statuswoorden, geen inhoudelijke claims. */
export const PILL_ALLOWLIST = ["klaar", "gepland", "gestart", "live", "nieuw", "ja", "nee", "check", "opnamedag", "online", "bezig", "gedaan", "nu"];

/** Controleert of een tekst uit gesproken woorden bestaat (geen verzonnen claims). */
export function isGrounded(text: string, spoken: Set<string>, allowExtra: string[] = []): boolean {
  const toks = tokenize(text).map(norm).filter(Boolean);
  if (!toks.length) return false;
  const extra = new Set(allowExtra.map(norm));
  const ok = toks.filter((t) => spoken.has(t) || extra.has(t) || /^\d+[+%]?$/.test(t) && spoken.has(t.replace(/[+%]/g, "")));
  return ok.length / toks.length >= 0.8;
}

/** Past de AI-suggesties toe, alleen als ze geaard zijn in de gesproken tekst. */
export function applyAiSuggestions(plan: EditPlan, s: AiSuggestions, brollSources: PlannerSource[], style: StyleConfig): { applied: number; rejected: string[] } {
  const spoken = new Set(plan.segments.flatMap((seg) => seg.words.map((w) => norm(w.w))));
  const rejected: string[] = [];
  let applied = 0;
  const segAt = (i: number) => plan.segments[Math.min(Math.max(0, i), plan.segments.length - 1)];
  const lastIdx = Math.max(...plan.segments.map((x) => x.sentenceIdx));
  const uiWords = ["week", "maand", "plan", "stap", "eerste", "tweede", "derde"];

  for (const c of s.cards.slice(0, 5)) {
    if (!style.cards.enabled) break;
    const texts = [c.title, ...c.items.map((i) => i.text), c.value ?? "", c.label ?? ""].filter(Boolean);
    const bad = texts.find((t) => !isGrounded(t, spoken, uiWords));
    const badPill = c.items.find((i) => i.pill && !PILL_ALLOWLIST.includes(norm(i.pill)));
    if (bad || badPill) { rejected.push(`Kaart "${c.title}" niet gebruikt: tekst "${bad ?? badPill?.pill}" komt niet uit wat er gezegd is.`); continue; }
    const startSeg = segAt(c.startSegment);
    if (startSeg.sentenceIdx === lastIdx && c.template !== "cta_form") { rejected.push(`Kaart "${c.title}" overlapt de CTA.`); continue; }
    if (plan.cards.some((k) => k.start.segmentId === startSeg.id)) continue;
    const items: CardItem[] = c.items.slice(0, 6).map((i) => ({
      text: i.text,
      pill: i.pill,
      pillTone: i.pillTone,
      anchor: { segmentId: segAt(i.segment).id, wordIdx: Math.max(0, Math.min(i.word, segAt(i.segment).words.length - 1)) },
    }));
    const card: Card = {
      id: `ai${plan.cards.length + 1}`,
      template: c.template,
      title: c.title,
      items,
      value: c.value,
      label: c.label,
      sublabel: c.sublabel,
      start: { segmentId: startSeg.id, wordIdx: Math.max(0, Math.min(c.startWord, startSeg.words.length - 1)) },
      origin: "ai",
    };
    plan.cards.push(card);
    plan.notes.push(`Kaart (${c.template}) "${c.title}": ${c.reason}`);
    applied++;
  }

  if (s.broll.length && brollSources.length && style.broll.enabled) {
    plan.broll = [];
    const b = style.broll;
    let t = 0;
    const starts = plan.segments.map((seg) => { const at = t; t += seg.outS - seg.inS; return at; });
    const offsets: Record<string, number> = {};
    s.broll.slice(0, 8).forEach((sug, k) => {
      const seg = segAt(sug.segment);
      const i = plan.segments.indexOf(seg);
      if (starts[i] < b.notBeforeS || seg.sentenceIdx === lastIdx) { rejected.push(`B-roll bij segment ${sug.segment} overgeslagen (hook of CTA).`); return; }
      const src = brollSources[Math.min(Math.max(0, sug.brollSource), brollSources.length - 1)];
      const durS = Math.min(b.clipMaxS, Math.max(b.clipMinS, seg.outS - seg.inS - 0.15));
      const usable = Math.max(0, src.durationS - durS - 0.6);
      const inS = Math.min(usable, offsets[src.id] ?? 0.5);
      offsets[src.id] = inS + durS + 0.4 > usable ? 0.5 : inS + durS + 0.4;
      plan.broll.push({ id: `br${k + 1}`, sourceId: src.id, inS: Math.round(inS * 1000) / 1000, durS: Math.round(durS * 1000) / 1000, anchorSegmentId: seg.id, anchorOffsetS: 0.1 });
      plan.notes.push(`B-roll (${src.filename}) bij "${seg.words.slice(0, 4).map((w) => w.w).join(" ")}…": ${sug.reason}`);
    });
  }
  for (const n of s.notes.slice(0, 4)) plan.notes.push(n);
  return { applied, rejected };
}

/** De prompt voor de AI-laag (compact; segmenten genummerd). */
export function aiPlanningPrompt(plan: EditPlan, brollSources: PlannerSource[]): { system: string; user: string } {
  const system = `Je bent de senior editor van Shortclips, een Nederlands short video bureau. Je verbetert de montage van een eigen Shortclips-advertentie (9:16, Meta/Instagram/TikTok) in de vaste Shortclips Ads Style: strak ritme, ondertitels in een blauw blok, en witte UI-kaarten die het verhaal visualiseren (checklist, status_list, process, stat, cta_form).

Regels:
- Verzin NOOIT tekst of claims. Kaartteksten (title, items, value, label) bestaan uit woorden die letterlijk gesproken worden. Pills mogen alleen neutrale statuswoorden zijn: Klaar, Gepland, Gestart, Live, Nieuw, Opnamedag, Online.
- Maximaal 4 kaarten, alleen waar ze echt iets toevoegen (opsomming, proces, getal, planning). Geen kaart in de eerste 2 segmenten als die alleen de hook herhaalt. De CTA-kaart bestaat al; maak die niet opnieuw.
- B-roll alleen als er b-roll-bronnen zijn, op opsommingen of procesbeschrijvingen, niet in de hook en niet op de laatste zin.
- Premium en rustig: liever minder effecten dan te veel.
Antwoord uitsluitend met JSON volgens het schema.`;
  const segLines = plan.segments.map((s, i) => `${i}: [zin ${s.sentenceIdx}] ${s.words.map((w, wi) => `${w.w}(${wi})`).join(" ")}`).join("\n");
  const broll = brollSources.length ? brollSources.map((b, i) => `${i}: ${b.filename} (${b.durationS.toFixed(1)} s)`).join("\n") : "geen";
  const user = `Segmenten (index: [zin] woord(woordindex) ...):
${segLines}

B-roll-bronnen:
${broll}

Bestaande kaarten: ${plan.cards.map((c) => c.template + ' "' + c.title + '"').join(", ") || "geen"}

Geef JSON:
{"cards":[{"template":"checklist|status_list|process|stat","title":"...","startSegment":0,"startWord":0,"items":[{"text":"...","pill":"optioneel","pillTone":"primary|secondary","segment":0,"word":0}],"value":"alleen bij stat","label":"alleen bij stat","sublabel":"optioneel","reason":"waarom, kort"}],
 "broll":[{"segment":0,"brollSource":0,"reason":"kort"}],
 "notes":["max 3 korte observaties over de montage"]}
Items verschijnen op het woord dat je aangeeft (segment + woordindex).`;
  return { system, user };
}

/** Parseert de AI-uitvoer robuust (JSON uit een tekstantwoord). */
export function parseAiSuggestions(text: string): AiSuggestions | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as Partial<AiSuggestions>;
    const templates: CardTemplate[] = ["checklist", "status_list", "process", "stat"];
    return {
      cards: (j.cards ?? []).filter((c) => c && templates.includes(c.template) && typeof c.title === "string" && Array.isArray(c.items ?? [])).map((c) => ({ ...c, items: c.items ?? [] })),
      broll: (j.broll ?? []).filter((b) => b && Number.isInteger(b.segment)),
      notes: (j.notes ?? []).filter((n) => typeof n === "string").slice(0, 3),
    };
  } catch {
    return null;
  }
}
