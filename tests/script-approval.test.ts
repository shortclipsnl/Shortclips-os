import { describe, expect, it } from "vitest";
import { carryOverPages, pageStates, scriptPageRange, scriptPages, summarize } from "@/lib/script-approval";

describe("scriptPageRange", () => {
  it("slaat de voor- en achterpagina's van het sjabloon over", () => {
    expect(scriptPageRange(15)).toEqual({ from: 6, to: 8 }); // 5 + 3 scripts + 7
    expect(scriptPageRange(13)).toEqual({ from: 6, to: 6 });
  });
  it("telt bij een afwijkende, korte PDF elke pagina als script", () => {
    expect(scriptPageRange(4)).toEqual({ from: 1, to: 4 });
    expect(scriptPageRange(12)).toEqual({ from: 1, to: 12 });
  });
  it("geeft null bij een ongeldig aantal", () => {
    expect(scriptPageRange(0)).toBeNull();
  });
});

describe("pageStates + summarize", () => {
  const pages = scriptPages({ from: 6, to: 9 });
  it("bepaalt de status per script", () => {
    const st = pageStates({
      pages,
      currentVersion: 2,
      approvedPages: [6],
      clientThreads: [
        { versionNumber: 2, pageNumber: 7 },
        { versionNumber: 1, pageNumber: 8 },
        { versionNumber: 2, pageNumber: null },
      ],
    });
    expect([...st.entries()]).toEqual([[6, "approved"], [7, "change"], [8, "revised"], [9, "todo"]]);
    expect(summarize(st)).toMatchObject({ total: 4, approved: 1, changes: 1, open: 2, allHandled: false, allApproved: false });
  });
  it("goedkeuring wint van een opmerking op hetzelfde script", () => {
    const st = pageStates({ pages: [1], currentVersion: 1, approvedPages: [1], clientThreads: [{ versionNumber: 1, pageNumber: 1 }] });
    expect(st.get(1)).toBe("approved");
  });
  it("is behandeld zodra elk script akkoord of een wijziging heeft", () => {
    const st = pageStates({ pages: [1, 2], currentVersion: 1, approvedPages: [1], clientThreads: [{ versionNumber: 1, pageNumber: 2 }] });
    expect(summarize(st)).toMatchObject({ allHandled: true, allApproved: false });
    const all = pageStates({ pages: [1, 2], currentVersion: 1, approvedPages: [1, 2], clientThreads: [] });
    expect(summarize(all)).toMatchObject({ allHandled: true, allApproved: true });
  });
  it("lege review is nooit afgerond", () => {
    expect(summarize(new Map())).toMatchObject({ allHandled: false, allApproved: false });
  });
});

describe("carryOverPages", () => {
  it("neemt ongewijzigde, goedgekeurde scripts mee", () => {
    expect(carryOverPages({ prevPageCount: 15, newPageCount: 15, prevApprovedPages: [6, 8], prevCommentPages: [7] })).toEqual([6, 8]);
  });
  it("neemt een script met opmerking niet mee", () => {
    expect(carryOverPages({ prevPageCount: 15, newPageCount: 15, prevApprovedPages: [6, 7], prevCommentPages: [7] })).toEqual([6]);
  });
  it("neemt niets mee als het aantal pagina's verandert", () => {
    expect(carryOverPages({ prevPageCount: 15, newPageCount: 16, prevApprovedPages: [6], prevCommentPages: [] })).toEqual([]);
    expect(carryOverPages({ prevPageCount: null, newPageCount: 15, prevApprovedPages: [6], prevCommentPages: [] })).toEqual([]);
  });
});
