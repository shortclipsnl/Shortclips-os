import { describe, expect, it } from "vitest";
import { chunkCaptions, deriveTimeline, type EditPlan, type Word } from "@/server/ai-editor/plan";
import { applyScriptSpelling, cutTake, findTakes, splitScript, detectSentencesWithoutScript, resetSegmentIds } from "@/server/ai-editor/takes";
import { draftPlan, isGrounded, applyAiSuggestions, parseAiSuggestions } from "@/server/ai-editor/planner";
import { applyOps, parseFeedbackRules, processPoints, splitPoints, timeMention, type FeedbackOp } from "@/server/ai-editor/feedback";
import { buildApplyContext } from "@/server/ai-editor/apply-context";
import { AI_EDITOR_GUIDE } from "@/lib/ai-editor-guide";
import { defaultStyleConfig } from "@/server/ai-editor/style-profile";

const style = defaultStyleConfig();
const rules = { maxPauseS: style.editing.maxPauseS, headHandleS: style.editing.headHandleS, tailHandleS: style.editing.tailHandleS, fillers: style.editing.fillers };

/** Woorden op een tijdlijn: "tekst|pauze" — elke woordduur 0,3 s, pauze in seconden met "_0.8". */
function words(spec: string, start = 0): Word[] {
  let t = start;
  const out: Word[] = [];
  for (const tok of spec.split(" ")) {
    if (tok.startsWith("_")) { t += Number(tok.slice(1)); continue; }
    out.push({ w: tok, s: Math.round(t * 1000) / 1000, e: Math.round((t + 0.3) * 1000) / 1000 });
    t += 0.32;
  }
  return out;
}

describe("AI Editor: takes", () => {
  it("splitst een script in zinnen", () => {
    expect(splitScript("Zo, die staat. Wil jij live zijn? Dan nu!\nLaat je gegevens achter")).toEqual(["Zo, die staat.", "Wil jij live zijn?", "Dan nu!", "Laat je gegevens achter"]);
  });

  it("kiest de volledige take boven een valse start", () => {
    const src = { id: "A", order: 0, words: words("Wij plannen nu al _1.2 Wij plannen nu al de eerste opnamedagen in.") };
    const takes = findTakes("Wij plannen nu al de eerste opnamedagen in.", [src], rules, 0);
    expect(takes[0].text).toBe("Wij plannen nu al de eerste opnamedagen in.");
    expect(takes[0].inS).toBeGreaterThan(1.5);
  });

  it("vindt twee takes van dezelfde zin en markeert geen twijfel bij gelijke tekst", () => {
    const src = { id: "A", order: 0, words: words("Dan is dit het moment. _1.0 Dan is dit het moment.") };
    const takes = findTakes("Dan is dit het moment.", [src], rules, 0);
    expect(takes.length).toBe(2);
  });

  it("neemt de scriptspelling over, ook als Whisper woorden samenvoegt", () => {
    const w = words("Scripts klaar, opnamesplan en de video's");
    const fixed = applyScriptSpelling(w, "Scripts klaar, opnames gepland en de video's");
    expect(fixed.map((x) => x.w).join(" ")).toBe("Scripts klaar, opnames gepland en de video's");
    // Tijden blijven binnen de oorspronkelijke spanne.
    expect(fixed[2].s).toBeCloseTo(w[2].s, 3);
    expect(fixed[3].e).toBeCloseTo(w[2].e, 3);
  });

  it("knipt opvulwoorden, herhalingen en lange pauzes", () => {
    resetSegmentIds();
    const segs = cutTake(words("Dit is eh de de oplossing _0.9 voor jou."), "A", 0, rules);
    const text = segs.flatMap((s) => s.words.map((w) => w.w)).join(" ");
    expect(text).toBe("Dit is de oplossing voor jou.");
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < segs.length; i++) expect(segs[i].inS).toBeGreaterThanOrEqual(segs[i - 1].outS);
  });

  it("herkent zonder script een valse start en houdt de laatste poging", () => {
    const src = { id: "A", order: 0, words: words("Jullie plan staat _1.0 Jullie plan voor 2027 staat. _1.0 Mooi.") };
    const sentences = detectSentencesWithoutScript([src], rules);
    expect(sentences[0].takes[0].text).toBe("Jullie plan voor 2027 staat.");
  });
});

describe("AI Editor: plan en ondertitels", () => {
  it("bouwt een plan met CTA-kaart en een tijdlijn die op frames klopt", () => {
    const d = draftPlan({
      sources: [{ id: "A", order: 0, filename: "A.mp4", role: "speaker", durationS: 20, words: words("Zo, die staat. _1 Laat je gegevens achter, dan bellen we je.") }],
      script: "Zo, die staat. Laat je gegevens achter, dan bellen we je.",
      style,
      musicAssetId: null,
    });
    expect(d.plan.takes.every((t) => t.chosenTakeId)).toBe(true);
    expect(d.plan.cards.find((c) => c.template === "cta_form")?.title).toBe("Laat je gegevens achter");
    const tl = deriveTimeline(d.plan, style.captions, 25);
    for (const s of tl.segments) expect(Math.round(s.durS * 25 * 1000) % 1000).toBe(0);
    expect(tl.words[0].os).toBeLessThan(0.1);
    // Elk woord valt onder een ondertitel.
    for (const w of tl.words) expect(tl.captions.some((c) => w.os >= c.startS - 0.05 && w.os < c.endS)).toBe(true);
  });

  it("laat een ondertitel nooit over een zinseinde lopen", () => {
    const tw = words("al binnen vier weken online. Wil jij in januari live zijn?").map((w, idx) => ({ ...w, os: w.s, oe: w.e, segmentId: "s", idx }));
    const caps = chunkCaptions(tw, style.captions, 10);
    expect(caps.some((c) => /online\. Wil/.test(c.text))).toBe(false);
    expect(caps[0].text).toBe("al binnen vier weken online.");
  });
});

describe("AI Editor: geen verzonnen tekst", () => {
  it("accepteert alleen kaartteksten uit de gesproken woorden", () => {
    const spoken = new Set(["scripts", "klaar", "opnames", "gepland", "50", "merken"]);
    expect(isGrounded("Scripts klaar", spoken)).toBe(true);
    expect(isGrounded("50+ merken", spoken)).toBe(true);
    expect(isGrounded("Gratis proefmaand", spoken)).toBe(false);
  });

  it("wijst AI-kaarten met verzonnen tekst af", () => {
    const d = draftPlan({ sources: [{ id: "A", order: 0, filename: "A", role: "speaker", durationS: 20, words: words("Scripts klaar, opnames gepland. _1 Daarna komt de rest.") }], script: null, style, musicAssetId: null });
    const sug = parseAiSuggestions(JSON.stringify({ cards: [
      { template: "status_list", title: "Scripts klaar", startSegment: 0, startWord: 0, items: [{ text: "Scripts", pill: "Klaar", segment: 0, word: 0 }], reason: "x" },
      { template: "checklist", title: "Gratis proefmaand", startSegment: 1, startWord: 0, items: [{ text: "Nu 50% korting", segment: 1, word: 0 }], reason: "x" },
    ], broll: [], notes: [] }))!;
    const r = applyAiSuggestions(d.plan, sug, [], style);
    expect(r.applied).toBe(1);
    expect(r.rejected.length).toBe(1);
  });
});

describe("AI Editor: feedback", () => {
  it("vertaalt de voorbeeldfeedback uit de opdracht", () => {
    expect(parseFeedbackRules("De ondertiteling mag iets kleiner.")[0]).toMatchObject({ op: "caption_scale" });
    expect(parseFeedbackRules("De eerste drie seconden moeten sneller.")[0]).toMatchObject({ op: "tighten", untilS: 3 });
    expect(parseFeedbackRules("De color grading is iets te warm.")[0]).toMatchObject({ op: "grade" });
    expect(parseFeedbackRules("De zoom bij seconde 12 mag eruit.")[0]).toMatchObject({ op: "remove_zoom", atS: 12 });
    expect(parseFeedbackRules("Gebruik de tweede take voor de laatste zin.")[0]).toMatchObject({ op: "choose_take", sentence: "last", rank: 2 });
    expect(parseFeedbackRules("Muziek mag zachter")[0]).toMatchObject({ op: "music_volume" });
  });

  it("past bewerkingen toe zonder het plan opnieuw op te bouwen", () => {
    const d = draftPlan({ sources: [{ id: "A", order: 0, filename: "A", role: "speaker", durationS: 20, words: words("Dit is zin een. _1 Dit is zin twee.") }], script: null, style, musicAssetId: null });
    const before = d.plan;
    const { plan, done } = applyOps(before, [{ op: "caption_scale", factor: 0.9 }, { op: "grade", adjust: { warmth: -0.3 } }], {
      style, rebuildSegments: () => before.segments, reanchor: () => {}, segmentAt: () => null, cardAt: () => null, brollAt: () => null, retighten: (p) => p.segments,
      brollSources: [], musicAssets: [], scriptWords: new Set(),
    });
    expect(plan.captionScale).toBeCloseTo(0.9);
    expect(plan.gradeAdjust.warmth).toBeCloseTo(-0.3);
    expect(plan.segments).toEqual(before.segments);
    expect(plan.version).toBe(before.version + 1);
    expect(done.length).toBe(2);
    const p: EditPlan = plan;
    expect(p.takes.length).toBe(before.takes.length);
  });
});

describe("AI Editor: feedback op zinsnummer", () => {
  it("begrijpt rangtelwoorden voor zinnen", () => {
    expect(parseFeedbackRules("Gebruik de tweede take voor de vijfde zin.")[0]).toMatchObject({ op: "choose_take", sentence: 5, rank: 2 });
    expect(parseFeedbackRules("pak de 2e opname voor de 3e zin")[0]).toMatchObject({ op: "choose_take", sentence: 3, rank: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* Chat-feedback: punten, tijdstippen en de uitgebreide bewerkingen    */
/* ------------------------------------------------------------------ */

const SCRIPT = "Wij maken video's voor bedrijven. Elke week drie nieuwe shortclips. Laat je gegevens achter.";

function scriptedProject() {
  resetSegmentIds();
  const w = words("Wij maken video's voor bedrijven. _1 Elke week drie nieuwe shortclip. _1 Laat je gegevens achter.");
  const src = { id: "A", order: 0, filename: "A.mp4", role: "speaker" as const, durationS: 20, words: w };
  const broll = { id: "B", order: 1, filename: "kantoor.mp4", role: "broll" as const, durationS: 12, words: [] };
  const d = draftPlan({ sources: [src, broll], script: SCRIPT, style, musicAssetId: null });
  const stored = { pool: d.takePool, sentences: d.sentences, hasScript: true, sources: [{ id: "A", filename: "A.mp4", role: "speaker" as const, durationS: 20 }, { id: "B", filename: "kantoor.mp4", role: "broll" as const, durationS: 12 }] };
  const ctx = buildApplyContext(stored, style, [{ id: "m1", name: "Upbeat Corporate" }, { id: "m2", name: "Calm Piano" }]);
  return { plan: d.plan, ctx };
}

const spokenText = (p: EditPlan) => p.segments.flatMap((s) => s.words.map((x) => x.w)).join(" ");

describe("AI Editor: chatberichten", () => {
  it("splitst een bericht in punten met tijdstippen", () => {
    const pts = splitPoints("[0:12] zoom eruit\n- muziek iets zachter\n[1:02.5] Kaart weg. Zin 2 mag eruit.");
    expect(pts).toEqual([
      { text: "zoom eruit", atS: 12 },
      { text: "muziek iets zachter", atS: null },
      { text: "Kaart weg.", atS: 62.5 },
      { text: "Zin 2 mag eruit.", atS: 62.5 },
    ]);
  });

  it("herkent tijdstippen in de tekst, maar niet een duur", () => {
    expect(timeMention("de zoom op 0:12")).toBe(12);
    expect(timeMention("bij seconde 7,5")).toBe(7.5);
    expect(timeMention("0,3 s later beginnen")).toBeNull();
    expect(timeMention("de eerste 3 seconden sneller")).toBeNull();
  });

  it("vertaalt de voorbeelden uit de handleiding met vaste patronen", () => {
    const examples = AI_EDITOR_GUIDE.flatMap((g) => g.examples ?? []);
    const expected: Record<string, FeedbackOp["op"]> = {
      "[0:12] zoom eruit": "remove_zoom",
      "De eerste 3 seconden moeten strakker": "tighten",
      "Zin 4 mag eruit": "remove_sentence",
      "Zin 5 naar het begin": "move_sentence",
      "Gebruik de tweede take voor de laatste zin": "choose_take",
      "[0:08] begint te vroeg, 0,3 s later beginnen": "trim",
      "\"shortclip\" moet \"Shortclips\"": "fix_word",
      "[0:15] andere b-roll": "broll",
      "Muziek iets zachter": "music_volume",
      "Gebruik de track \"Upbeat Corporate\"": "music_track",
      "Ondertiteling iets kleiner en hoger": "caption_scale",
      "Beeld is te warm": "grade",
    };
    for (const ex of examples) {
      const [pt] = splitPoints(ex);
      const ops = parseFeedbackRules(pt.text, pt.atS);
      if (expected[ex]) expect(ops[0]?.op, ex).toBe(expected[ex]);
    }
    const [trim] = splitPoints("[0:08] begint te vroeg, 0,3 s later beginnen");
    expect(parseFeedbackRules(trim.text, trim.atS)[0]).toEqual({ op: "trim", atS: 8, edge: "start", deltaS: 0.3 });
    expect(parseFeedbackRules("Zin 2 terug")[0]).toEqual({ op: "restore_sentence", sentence: 2 });
    expect(parseFeedbackRules("zin 3 voor zin 1")[0]).toEqual({ op: "move_sentence", sentence: 3, position: { before: 1 } });
  });

  it("laat een zin weg, zet hem terug en verplaatst zinnen", () => {
    const { plan, ctx } = scriptedProject();
    expect(plan.takes.length).toBe(3);
    const r1 = applyOps(plan, [{ op: "remove_sentence", sentence: 2 }], ctx);
    expect(r1.done.length).toBe(1);
    expect(spokenText(r1.plan)).not.toMatch(/Elke week/);
    expect(r1.plan.segments.some((s) => s.sentenceIdx === 1)).toBe(false);
    const r2 = applyOps(r1.plan, [{ op: "restore_sentence", sentence: 2 }], ctx);
    expect(spokenText(r2.plan)).toMatch(/Elke week/);
    const r3 = applyOps(plan, [{ op: "move_sentence", sentence: 3, position: "start" }], ctx);
    expect(r3.plan.segments[0].sentenceIdx).toBe(2);
    expect(spokenText(r3.plan).startsWith("Laat je gegevens")).toBe(true);
    // CTA-kaart gaat mee met de verplaatste zin.
    const cta = r3.plan.cards.find((c) => c.template === "cta_form");
    if (cta) expect(r3.plan.segments.find((s) => s.id === cta.start.segmentId)?.sentenceIdx).toBe(2);
  });

  it("corrigeert spelling, maar vervangt geen woorden", () => {
    const { plan, ctx } = scriptedProject();
    // Het script spelt "shortclips"; de ondertitels volgen het script al.
    const ok = applyOps(plan, [{ op: "fix_word", from: "bedrijven", to: "Bedrijven" }], ctx);
    expect(ok.done.length).toBe(1);
    expect(spokenText(ok.plan)).toMatch(/Bedrijven\./);
    const bad = applyOps(plan, [{ op: "fix_word", from: "bedrijven", to: "ondernemers" }], ctx);
    expect(bad.done.length).toBe(0);
    expect(bad.skipped[0]).toMatch(/ander woord/);
    // De correctie blijft gelden na een herbouw (zin weg en terug).
    const again = applyOps(ok.plan, [{ op: "remove_sentence", sentence: 2 }, { op: "restore_sentence", sentence: 2 }], ctx);
    expect(spokenText(again.plan)).toMatch(/Bedrijven\./);
  });

  it("maakt alleen kaarten met gesproken tekst", () => {
    const { plan, ctx } = scriptedProject();
    const good = applyOps(plan, [{ op: "add_card", atS: 2.5, template: "stat", title: "Elke week", value: "3", label: "nieuwe shortclips" }], ctx);
    expect(good.done.length).toBe(1);
    expect(good.plan.cards.length).toBe(plan.cards.length + 1);
    const bad = applyOps(plan, [{ op: "add_card", atS: 2.5, template: "checklist", title: "Gratis proefmaand", items: ["50% korting"] }], ctx);
    expect(bad.done.length).toBe(0);
    expect(bad.skipped[0]).toMatch(/komt niet uit wat er gezegd is/);
  });

  it("verschuift een knip en houdt die vast na een herbouw", () => {
    const { plan, ctx } = scriptedProject();
    const seg = plan.segments[1];
    const tl = deriveTimeline(plan, style.captions, style.export.fps);
    const at = tl.segments[1].atS + 0.05;
    const r = applyOps(plan, [{ op: "trim", atS: at, edge: "start", deltaS: 0.2 }], ctx);
    const trimmed = r.plan.segments.find((s) => s.sourceId === seg.sourceId && s.sentenceIdx === seg.sentenceIdx)!;
    expect(trimmed.inS).toBeCloseTo(seg.inS + 0.2, 3);
    const rebuilt = applyOps(r.plan, [{ op: "remove_sentence", sentence: 3 }, { op: "restore_sentence", sentence: 3 }], ctx);
    const again = rebuilt.plan.segments.find((s) => s.sentenceIdx === seg.sentenceIdx)!;
    expect(again.inS).toBeCloseTo(seg.inS + 0.2, 3);
  });

  it("wisselt b-roll en muziek bij naam", () => {
    const { plan, ctx } = scriptedProject();
    const r = applyOps(plan, [{ op: "broll", atS: 3, source: "kantoor" }, { op: "music_track", name: "calm piano" }], ctx);
    expect(r.done.length).toBe(2);
    expect(r.plan.broll.some((b) => b.sourceId === "B")).toBe(true);
    expect(r.plan.music.assetId).toBe("m2");
    const none = applyOps(plan, [{ op: "music_track", name: "Metal" }], ctx);
    expect(none.skipped[0]).toMatch(/Upbeat Corporate/);
  });

  it("verwerkt een bericht per punt, met een vraag terug als iets onduidelijk is", () => {
    const { plan, ctx } = scriptedProject();
    const points = splitPoints("Muziek iets zachter\nmaak het spannender");
    const rulesOps = points.map((p) => parseFeedbackRules(p.text, p.atS));
    expect(rulesOps[1]).toEqual([]);
    const r = processPoints(plan, points, rulesOps, [{ i: 1, ops: [], reply: "", question: "Bedoel je sneller monteren of andere muziek?" }], ctx);
    expect(r.changed).toBe(true);
    expect(r.results.map((x) => x.status)).toEqual(["done", "question"]);
    expect(r.plan.version).toBe(plan.version + 1);
    const none = processPoints(plan, [points[1]], [[]], null, ctx);
    expect(none.changed).toBe(false);
    expect(none.results[0].status).toBe("not_understood");
  });
});
