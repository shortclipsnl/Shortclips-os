import { describe, expect, it } from "vitest";
import { nlHolidaySet } from "../src/lib/holidays";
import { feedbackTermLabel, feedbackTermState, planRound, reminderDue } from "../src/lib/feedback-term";

const H = nlHolidaySet([2026, 2027]);
// Tijdstippen in UTC; november = wintertijd (Amsterdam = UTC+1).
const at = (iso: string) => new Date(iso);

describe("feedbacktermijn per ronde (werkdagen)", () => {
  const sentMon = "2026-11-09T10:00:00Z"; // maandag
  it("telt werkdagen vanaf de dag van versturen", () => {
    expect(feedbackTermState(sentMon, 3, "2026-11-09", H)).toMatchObject({ day: 0, remaining: 3, stage: "gestart", dueOn: "2026-11-12" });
    expect(feedbackTermState(sentMon, 3, "2026-11-10", H)).toMatchObject({ day: 1, remaining: 2, stage: "loopt" });
    expect(feedbackTermState(sentMon, 3, "2026-11-11", H)).toMatchObject({ day: 2, remaining: 1, stage: "laatste_dag_morgen" });
    expect(feedbackTermState(sentMon, 3, "2026-11-12", H)).toMatchObject({ day: 3, remaining: 0, stage: "herinnering" });
    expect(feedbackTermState(sentMon, 3, "2026-11-13", H)).toMatchObject({ day: 4, lateBy: 1, stage: "te_laat" });
  });
  it("vrijdag verstuurd: weekend telt niet, dag 3 is woensdag", () => {
    const fri = "2026-11-06T15:00:00Z";
    expect(feedbackTermState(fri, 3, "2026-11-07", H).day).toBe(0); // zaterdag
    expect(feedbackTermState(fri, 3, "2026-11-09", H).day).toBe(1); // maandag
    expect(feedbackTermState(fri, 3, "2026-11-11", H).stage).toBe("herinnering"); // woensdag
  });
  it("feestdagen tellen niet mee (kerst)", () => {
    const wed = "2026-12-23T10:00:00Z";
    expect(feedbackTermState(wed, 3, "2026-12-24", H).day).toBe(1);
    expect(feedbackTermState(wed, 3, "2026-12-28", H).day).toBe(2); // 25/26 feestdag, 27 zondag
    expect(feedbackTermState(wed, 3, "2026-12-29", H).stage).toBe("herinnering");
  });
  it("Koningsdag 2027 (di 27 april) telt niet mee", () => {
    const mon = "2027-04-26T09:00:00Z";
    expect(feedbackTermState(mon, 3, "2027-04-28", H).day).toBe(1);
  });
  it("labels", () => {
    expect(feedbackTermLabel(feedbackTermState(sentMon, 3, "2026-11-10", H))).toMatchObject({ title: "Dag 1 van 3", tone: "groen" });
    expect(feedbackTermLabel(feedbackTermState(sentMon, 3, "2026-11-11", H))).toMatchObject({ title: "Dag 2 van 3", sub: "Nog 1 werkdag", tone: "oranje" });
    expect(feedbackTermLabel(feedbackTermState(sentMon, 3, "2026-11-12", H))).toMatchObject({ sub: "Herinnering sturen", tone: "rood" });
    expect(feedbackTermLabel(feedbackTermState(sentMon, 3, "2026-11-16", H))).toMatchObject({ title: "Klant te laat", sub: "2 werkdagen over de termijn" });
  });
});

describe("herinnering op werkdag 3 om 09:00", () => {
  const sentMon = "2026-11-09T10:00:00Z";
  const s = (today: string) => feedbackTermState(sentMon, 3, today, H);
  it("niet vóór 09:00 Amsterdamse tijd, wel erna", () => {
    expect(reminderDue({ state: s("2026-11-12"), now: at("2026-11-12T07:30:00Z"), today: "2026-11-12", alreadyReminded: false, holidays: H })).toBe(false); // 08:30
    expect(reminderDue({ state: s("2026-11-12"), now: at("2026-11-12T08:00:00Z"), today: "2026-11-12", alreadyReminded: false, holidays: H })).toBe(true); // 09:00
  });
  it("niet op dag 2, niet twee keer", () => {
    expect(reminderDue({ state: s("2026-11-11"), now: at("2026-11-11T10:00:00Z"), today: "2026-11-11", alreadyReminded: false, holidays: H })).toBe(false);
    expect(reminderDue({ state: s("2026-11-12"), now: at("2026-11-12T10:00:00Z"), today: "2026-11-12", alreadyReminded: true, holidays: H })).toBe(false);
  });
  it("zomertijd: 09:00 Amsterdam = 07:00 UTC", () => {
    const st = feedbackTermState("2027-06-07T09:00:00Z", 3, "2027-06-10", H);
    expect(reminderDue({ state: st, now: at("2027-06-10T07:00:00Z"), today: "2027-06-10", alreadyReminded: false, holidays: H })).toBe(true);
  });
  it("niet in het weekend (gemiste herinnering wacht tot maandag)", () => {
    expect(reminderDue({ state: s("2026-11-14"), now: at("2026-11-14T10:00:00Z"), today: "2026-11-14", alreadyReminded: false, holidays: H })).toBe(false);
  });
});

describe("rondes openen en sluiten", () => {
  const v = (status: string, rev = 0) => ({ status, deleted: false, statusChangedAt: "2026-11-09T10:00:00Z", clientRevisionRounds: rev });
  it("naar Feedback klant: nieuwe ronde", () => expect(planRound(v("client_review"), null)).toEqual({ close: false, open: true }));
  it("blijft bij de klant: niets doen", () => expect(planRound(v("client_review"), { id: "r", revisionMark: 0 })).toEqual({ close: false, open: false }));
  it("fase verlaten: ronde stopt", () => {
    expect(planRound(v("client_revision", 1), { id: "r", revisionMark: 0 })).toEqual({ close: true, open: false });
    expect(planRound(v("approved"), { id: "r", revisionMark: 0 })).toEqual({ close: true, open: false });
    expect(planRound(null, { id: "r", revisionMark: 0 })).toEqual({ close: true, open: false });
  });
  it("tussendoor feedback verwerkt en opnieuw naar klant: oude dicht, nieuwe open", () => {
    expect(planRound(v("client_review", 1), { id: "r", revisionMark: 0 })).toEqual({ close: true, open: true });
  });
  it("andere fases zonder ronde: niets", () => expect(planRound(v("editing"), null)).toEqual({ close: false, open: false }));
});
