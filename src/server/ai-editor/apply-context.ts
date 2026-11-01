/**
 * De context waarmee feedback-bewerkingen op een plan worden toegepast:
 * herbouwen uit takes, herankeren en tijdstip-opzoekingen. Puur (zonder
 * database), zodat tests met precies dezelfde logica werken als de worker.
 */
import type { ApplyContext } from "./feedback";
import { deriveTimeline, type EditPlan, type PlanSegment } from "./plan";
import { segmentsFromTakes } from "./planner";
import type { StyleConfig } from "./style-profile";
import { cutTake, norm, tokenize, type Take } from "./takes";

export type ContextSource = {
  pool: Record<number, Take[]>;
  sentences: string[];
  hasScript: boolean;
  sources: Array<{ id: string; filename: string; role: "speaker" | "broll"; durationS: number }>;
};

export function reanchor(oldPlan: EditPlan, newPlan: EditPlan): void {
  const find = (segId: string, wordIdx: number): { segmentId: string; wordIdx: number } | null => {
    const oldSeg = oldPlan.segments.find((s) => s.id === segId);
    if (!oldSeg) return null;
    const w = oldSeg.words[Math.min(wordIdx, oldSeg.words.length - 1)];
    for (const s of newPlan.segments) {
      const idx = s.words.findIndex((x) => s.sourceId === oldSeg.sourceId && Math.abs(x.s - (w?.s ?? -1)) < 0.02);
      if (idx >= 0) return { segmentId: s.id, wordIdx: idx };
    }
    // Andere take: zelfde zin, zelfde woord.
    for (const s of newPlan.segments.filter((x) => x.sentenceIdx === oldSeg.sentenceIdx)) {
      const idx = s.words.findIndex((x) => x.w.toLowerCase() === (w?.w ?? "").toLowerCase());
      if (idx >= 0) return { segmentId: s.id, wordIdx: idx };
    }
    const first = newPlan.segments.find((x) => x.sentenceIdx === oldSeg.sentenceIdx);
    return first ? { segmentId: first.id, wordIdx: 0 } : null;
  };
  newPlan.cards = newPlan.cards.flatMap((c) => {
    const start = find(c.start.segmentId, c.start.wordIdx);
    if (!start) return [];
    const items = c.items.map((it) => ({ ...it, anchor: find(it.anchor.segmentId, it.anchor.wordIdx) ?? start }));
    const end = c.end ? find(c.end.segmentId, c.end.wordIdx) : null;
    return [{ ...c, start, items, end: end ? { ...end, after: c.end?.after } : undefined }];
  });
  newPlan.broll = newPlan.broll.flatMap((b) => {
    const a = find(b.anchorSegmentId, 0);
    return a ? [{ ...b, anchorSegmentId: a.segmentId }] : [];
  });
}

export function buildApplyContext(stored: ContextSource, style: StyleConfig, musicAssets: Array<{ id: string; name: string }>): ApplyContext {
  const tl = (p: EditPlan) => deriveTimeline(p, style.captions, style.export.fps);
  return {
    style,
    brollSources: stored.sources.filter((s) => s.role === "broll").map((s) => ({ id: s.id, filename: s.filename, durationS: s.durationS })),
    musicAssets,
    scriptWords: new Set(stored.hasScript ? stored.sentences.flatMap((x) => tokenize(x).map(norm)).filter(Boolean) : []),
    rebuildSegments: (takes) => segmentsFromTakes(takes, stored.pool, stored.sentences, stored.hasScript, style),
    reanchor,
    segmentAt: (p, atS) => tl(p).segments.find((s) => atS >= s.atS && atS < s.atS + s.durS)?.id ?? null,
    cardAt: (p, atS) => {
      const cards = tl(p).cards;
      const hit = cards.find((c) => atS >= c.startS - 0.5 && atS <= c.endS + 0.5);
      return hit?.id ?? null;
    },
    brollAt: (p, atS) => tl(p).broll.find((b) => atS >= b.atS - 0.5 && atS <= b.atS + b.durS + 0.5)?.id ?? null,
    retighten: (p, untilS, maxPauseS) => {
      const timeline = tl(p);
      const tighter = new Set(timeline.segments.filter((s) => untilS == null || s.atS < untilS).map((s) => s.sentenceIdx));
      const loose = { ...style, editing: { ...style.editing } };
      const tight = { ...style, editing: { ...style.editing, maxPauseS, tailHandleS: Math.min(style.editing.tailHandleS, 0.06), headHandleS: Math.min(style.editing.headHandleS, 0.03) } };
      const segs: PlanSegment[] = [];
      for (const choice of p.takes) {
        if (choice.excluded) continue;
        const take = stored.pool[choice.sentenceIdx]?.find((t) => t.takeId === choice.chosenTakeId);
        if (!take) continue;
        const st = tighter.has(choice.sentenceIdx) ? tight : loose;
        segs.push(...cutTake(take.words, take.sourceId, choice.sentenceIdx, { maxPauseS: st.editing.maxPauseS, headHandleS: st.editing.headHandleS, tailHandleS: st.editing.tailHandleS, fillers: st.editing.fillers }));
      }
      // Unieke ids na het herknippen.
      segs.forEach((s, i) => { s.id = `seg${i + 1}t${p.version}`; });
      if (segs[0]) segs[0].inS = Math.max(segs[0].inS, segs[0].words[0].s - 0.02);
      const last = segs[segs.length - 1];
      if (last) last.outS += style.editing.endTailS;
      // Zooms per zin overnemen.
      const zoomBySentence = new Map(p.segments.map((s) => [s.sentenceIdx, s.zoom]));
      segs.forEach((s) => { s.zoom = zoomBySentence.get(s.sentenceIdx) ?? { from: 1, to: 1 }; });
      return segs;
    },
  };
}

