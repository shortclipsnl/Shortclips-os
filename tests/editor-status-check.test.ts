import { describe, expect, it } from "vitest";
import { nlHolidaySet } from "../src/lib/holidays";
import { addWorkingDays } from "../src/lib/workdays";
import { editorDeadline } from "../src/lib/edit-deadline";
import {
  editorCycle,
  isWorkingHours,
  noReplyOverdue,
  planCheck,
  progressView,
} from "../src/lib/editor-status-check";

const H = nlHolidaySet();
const base = {
  hasHalfwayThisCycle: false,
  hasPreDeadlineThisCycle: false,
  hasOpenCheck: false,
  lastResponse: null,
  lastResponseThisCycle: null,
  unansweredThisCycle: false,
};
const shoot = "2026-11-02"; // maandag
const cycle = editorCycle({ status: "editing", shootOn: shoot, dueOn: null, statusSince: shoot }, H)!;

describe("editorCycle", () => {
  it("gebruikt de editor deadline, niet de klantdeadline", () => {
    expect(cycle.deadline).toBe(editorDeadline("editing", shoot, null, H));
    expect(cycle.phase).toBe("first");
    expect(cycle.cycleKey).toBe(`first:${cycle.deadline}`);
  });

  it("legt het 50%-moment halverwege de bewerkingstijd (8 werkdagen → dag 4)", () => {
    const deadline = addWorkingDays(shoot, 8, H);
    const c = editorCycle({ status: "client_revision", shootOn: shoot, dueOn: addWorkingDays(deadline, 2, H), statusSince: shoot }, H)!;
    expect(c.totalWorkdays).toBe(8);
    expect(c.halfwayOn).toBe(addWorkingDays(shoot, 4, H));
  });

  it("geeft geen cyclus als het werk niet bij de editor ligt", () => {
    expect(editorCycle({ status: "internal_review", shootOn: shoot, dueOn: null, statusSince: shoot }, H)).toBeNull();
    expect(editorCycle({ status: "recorded", shootOn: shoot, dueOn: null, statusSince: shoot }, H)).toBeNull();
  });

  it("berekent het moment opnieuw als de deadline verschuift (nieuwe cyclus)", () => {
    const later = editorCycle({ status: "editing", shootOn: "2026-11-04", dueOn: null, statusSince: shoot }, H)!;
    expect(later.cycleKey).not.toBe(cycle.cycleKey);
    expect(later.halfwayOn > cycle.halfwayOn).toBe(true);
  });
});

describe("planCheck", () => {
  it("stuurt niets vóór het 50%-moment en wel daarna", () => {
    const before = addWorkingDays(shoot, 1, H);
    expect(planCheck(cycle, before, base, H)).toBeNull();
    expect(planCheck(cycle, cycle.halfwayOn, base, H)).toEqual({ kind: "halfway" });
  });

  it("geen dubbele check binnen dezelfde cyclus of met een open check", () => {
    expect(planCheck(cycle, cycle.halfwayOn, { ...base, hasHalfwayThisCycle: true }, H)).toBeNull();
    expect(planCheck(cycle, cycle.halfwayOn, { ...base, hasOpenCheck: true }, H)).toBeNull();
  });

  it("geen check als de editor recent al een status gaf", () => {
    expect(planCheck(cycle, cycle.halfwayOn, { ...base, lastResponse: { status: "bezig", on: cycle.halfwayOn } }, H)).toBeNull();
  });

  it("niets na de deadline", () => {
    expect(planCheck(cycle, addWorkingDays(cycle.deadline, 1, H), base, H)).toBeNull();
  });

  it("extra check vlak voor de deadline alleen bij risico", () => {
    const dayBefore = addWorkingDays(cycle.halfwayOn, Math.max(0, cycle.totalWorkdays - Math.ceil(cycle.totalWorkdays / 2) - 1), H);
    const done = { ...base, hasHalfwayThisCycle: true };
    expect(planCheck(cycle, dayBefore, { ...done, lastResponseThisCycle: "bezig", lastResponse: { status: "bezig", on: cycle.halfwayOn } }, H)).toBeNull();
    expect(planCheck(cycle, dayBefore, { ...done, lastResponseThisCycle: "nog_niet", lastResponse: { status: "nog_niet", on: cycle.halfwayOn } }, H)).toEqual({ kind: "pre_deadline" });
    expect(planCheck(cycle, dayBefore, { ...done, hasOpenCheck: true, unansweredThisCycle: true }, H)).toEqual({ kind: "pre_deadline" });
    expect(planCheck(cycle, dayBefore, { ...done, hasPreDeadlineThisCycle: true, lastResponseThisCycle: "nog_niet" }, H)).toBeNull();
  });
});

describe("progressView en werktijden", () => {
  it("geen reactie pas na één werkdag", () => {
    const sent = new Date("2026-11-09T09:30:00+01:00"); // maandag 09:30
    expect(noReplyOverdue(sent, new Date("2026-11-09T16:00:00+01:00"), H)).toBe(false);
    expect(noReplyOverdue(sent, new Date("2026-11-10T09:00:00+01:00"), H)).toBe(false);
    expect(noReplyOverdue(sent, new Date("2026-11-10T09:31:00+01:00"), H)).toBe(true);
    // Vrijdag verstuurd → pas maandag aandachtspunt.
    const fri = new Date("2026-11-13T10:00:00+01:00");
    expect(noReplyOverdue(fri, new Date("2026-11-15T12:00:00+01:00"), H)).toBe(false);
    expect(noReplyOverdue(fri, new Date("2026-11-16T10:00:00+01:00"), H)).toBe(true);
  });

  it("nog niet begonnen vlak voor de deadline = risico", () => {
    const now = new Date("2026-11-10T10:00:00+01:00");
    const latest = { status: "nog_niet" as const, sentAt: now, respondedAt: now };
    expect(progressView(latest, now, "2026-11-12", H).key).toBe("risico");
    expect(progressView(latest, now, "2026-11-24", H).key).toBe("nog_niet");
    expect(progressView({ ...latest, status: "bezig" }, now, "2026-11-12", H).tone).toBe("good");
  });

  it("verstuurt alleen tijdens werktijd", () => {
    expect(isWorkingHours(new Date("2026-11-09T08:59:00+01:00"), H)).toBe(false);
    expect(isWorkingHours(new Date("2026-11-09T09:10:00+01:00"), H)).toBe(true);
    expect(isWorkingHours(new Date("2026-11-09T17:00:00+01:00"), H)).toBe(false);
    expect(isWorkingHours(new Date("2026-11-14T11:00:00+01:00"), H)).toBe(false); // zaterdag
    expect(isWorkingHours(new Date("2026-12-25T11:00:00+01:00"), H)).toBe(false); // Kerst
  });
});
