/**
 * Beslislogica voor de scriptgoedkeuring per script (= per scriptpagina in de
 * review-PDF). Puur, zonder database, zodat het gedrag los te testen is.
 *
 * Uitgangspunten:
 * - Eén scriptpagina = één script. Voor- en achterpagina's van het vaste
 *   Shortclips-sjabloon (5 voor, 7 achter) zijn uitleg en worden niet
 *   goedgekeurd. Wijkt de PDF af (minder pagina's dan het sjabloon), dan telt
 *   elke pagina als script.
 * - Per script: Nog te beoordelen, Wijziging voorgesteld, Aangepast (opnieuw
 *   beoordelen) of Goedgekeurd.
 * - Een ronde is "behandeld" zodra elk script goedgekeurd is of een wijziging
 *   heeft. Alles goedgekeurd = de review is goedgekeurd.
 */

export const TEMPLATE_FRONT_PAGES = 5;
export const TEMPLATE_BACK_PAGES = 7;

export type PageRange = { from: number; to: number };

/** Welke pagina's scripts zijn, op basis van het aantal pagina's. */
export function scriptPageRange(pageCount: number): PageRange | null {
  if (!Number.isFinite(pageCount) || pageCount < 1) return null;
  const fixed = TEMPLATE_FRONT_PAGES + TEMPLATE_BACK_PAGES;
  if (pageCount > fixed) return { from: TEMPLATE_FRONT_PAGES + 1, to: pageCount - TEMPLATE_BACK_PAGES };
  return { from: 1, to: pageCount };
}

/** Scriptpagina's uit een bereik ([6,7,8]). */
export function scriptPages(range: PageRange | null): number[] {
  if (!range) return [];
  const out: number[] = [];
  for (let p = range.from; p <= range.to; p++) out.push(p);
  return out;
}

export type ScriptPageState = "todo" | "change" | "revised" | "approved";

export const SCRIPT_PAGE_LABEL: Record<ScriptPageState, string> = {
  todo: "Nog te beoordelen",
  change: "Wijziging voorgesteld",
  revised: "Aangepast, opnieuw beoordelen",
  approved: "Goedgekeurd",
};

export type ThreadRef = { versionNumber: number; pageNumber: number | null };

/**
 * Status per script in de huidige versie.
 * - approved: goedgekeurd in deze versie;
 * - change: klantopmerking op deze pagina in deze versie;
 * - revised: geen van beide, maar in een eerdere versie wel een opmerking op
 *   deze pagina (dus aangepast en opnieuw te beoordelen);
 * - todo: de rest.
 */
export function pageStates(input: {
  pages: number[];
  currentVersion: number;
  approvedPages: number[];
  clientThreads: ThreadRef[];
}): Map<number, ScriptPageState> {
  const approved = new Set(input.approvedPages);
  const changeNow = new Set<number>();
  const changeBefore = new Set<number>();
  for (const t of input.clientThreads) {
    if (t.pageNumber == null) continue;
    if (t.versionNumber === input.currentVersion) changeNow.add(t.pageNumber);
    else if (t.versionNumber < input.currentVersion) changeBefore.add(t.pageNumber);
  }
  const out = new Map<number, ScriptPageState>();
  for (const p of input.pages) {
    if (approved.has(p)) out.set(p, "approved");
    else if (changeNow.has(p)) out.set(p, "change");
    else if (changeBefore.has(p) && input.currentVersion > 1) out.set(p, "revised");
    else out.set(p, "todo");
  }
  return out;
}

export type ApprovalSummary = {
  total: number;
  approved: number;
  changes: number;
  open: number;
  /** Elk script is goedgekeurd of heeft een wijziging. */
  allHandled: boolean;
  allApproved: boolean;
};

export function summarize(states: Map<number, ScriptPageState>): ApprovalSummary {
  let approved = 0;
  let changes = 0;
  for (const s of states.values()) {
    if (s === "approved") approved++;
    else if (s === "change") changes++;
  }
  const total = states.size;
  const open = total - approved - changes;
  return { total, approved, changes, open, allHandled: total > 0 && open === 0, allApproved: total > 0 && approved === total };
}

/**
 * Welke goedkeuringen meegaan naar een nieuwe versie. Alleen als de PDF even
 * lang is gebleven (zelfde opbouw), en alleen voor scripts die goedgekeurd
 * waren én geen opmerking kregen in de vorige versie. Zo hoeft de klant alleen
 * de aangepaste scripts opnieuw te bekijken.
 */
export function carryOverPages(input: {
  prevPageCount: number | null;
  newPageCount: number | null;
  prevApprovedPages: number[];
  prevCommentPages: number[];
}): number[] {
  if (!input.prevPageCount || !input.newPageCount || input.prevPageCount !== input.newPageCount) return [];
  const commented = new Set(input.prevCommentPages);
  const range = scriptPageRange(input.newPageCount);
  const valid = new Set(scriptPages(range));
  return input.prevApprovedPages.filter((p) => valid.has(p) && !commented.has(p)).sort((a, b) => a - b);
}
