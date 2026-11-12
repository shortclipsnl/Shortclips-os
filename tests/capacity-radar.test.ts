import { describe, expect, it } from "vitest";
import {
  DEFAULT_RADAR_SETTINGS,
  batchCandidates,
  bestBatchMove,
  buildAlerts,
  computeRadar,
  countBottlenecks,
  roomText,
  videosPerShoot,
  type RadarInput,
  type RadarPerson,
  type RadarShoot,
} from "@/lib/capacity-radar";

const settings = DEFAULT_RADAR_SETTINGS;
// Do 12 nov 2026, week 46.
const today = "2026-11-12";

const rutger: RadarPerson = { id: "r", name: "Rutger", kind: "video", employment: "vast", group: "vast", hoursPerWeek: 32, daysPerWeek: 4, absences: [], assignable: true };
const fabian: RadarPerson = { id: "f", name: "Fabian", kind: "edit", employment: "freelance", group: "vast", videosPerWeek: 10, absences: [], assignable: true };
const quinn: RadarPerson = { id: "q", name: "Quinn", kind: "edit", employment: "freelance", group: "vast", videosPerWeek: 6, absences: [], assignable: true };
const senna: RadarPerson = { id: "s", name: "Senna", kind: "edit", employment: "freelance", group: "vast", videosPerWeek: null, absences: [], assignable: true };

const shoot = (id: string, date: string, extra: Partial<RadarShoot> = {}): RadarShoot => ({
  id, date, start: "09:00", durationH: 3, travelH: 1, clientName: `Klant ${id}`, clientSlug: null, videographerId: "r", editorId: "f", videos: 8, videosSource: "gepland", ...extra,
});
const input = (over: Partial<RadarInput>): RadarInput => ({ today, weeks: 8, people: [rutger, fabian, quinn, senna], shoots: [], projects: [], holidays: ["2026-12-25", "2026-12-26"], settings, ...over });

describe("capaciteitsradar", () => {
  it("telt een opname als uren inclusief reistijd en op- en afbouw", () => {
    const r = computeRadar(input({ shoots: [shoot("a", "2026-11-17")] }));
    expect(r.cells.r[1].load).toBe(5); // 3 + 1 + 1
    expect(r.cells.r[1].cap).toBe(32);
    expect(r.cells.r[1].status).toBe("green");
  });

  it("voorspelt editingwerk uit een komende opname bij de gekoppelde editor", () => {
    const r = computeRadar(input({ shoots: [shoot("a", "2026-11-17")] }));
    const total = r.cells.f.reduce((a, c) => a + c.load, 0);
    expect(total).toBeCloseTo(8 + 8 * settings.feedbackShare, 5);
    expect(r.cells.f[1].forecast).toBeGreaterThan(0);
  });

  it("telt een opname niet dubbel zodra er een echt editingproject loopt", () => {
    const s = shoot("a", "2026-11-10"); // al gefilmd
    const r = computeRadar(input({ shoots: [s], projects: [{ id: "p1", batchId: "a", clientName: "Klant a", editorId: "f", videos: 8, status: "beschikbaar", shootOn: "2026-11-10" }] }));
    const items = r.items.filter((i) => i.batchId === "a");
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("bevestigd");
  });

  it("laat iemand zonder vastgelegde capaciteit nooit groen zien", () => {
    const r = computeRadar(input({ shoots: [shoot("a", "2026-11-17", { editorId: "s" })] }));
    expect(r.cells.s[1].status).toBe("grey");
    expect(countBottlenecks(r, [rutger, fabian, quinn, senna], 6)).toBe(1);
  });

  it("zet een opname zonder videograaf apart", () => {
    const r = computeRadar(input({ shoots: [shoot("a", "2026-12-08", { videographerId: null })] }));
    expect(r.unassigned[4]).toHaveLength(1);
    const alerts = buildAlerts(r, [rutger, fabian, quinn, senna], settings, { weeks: 6, video: true, edit: true });
    expect(alerts[0].title).toContain("nog geen videograaf");
  });

  it("verplaatst editingwerk alleen als heel pakket naar één editor", () => {
    const shoots = [shoot("a", "2026-11-23", { editorId: "q" }), shoot("b", "2026-11-24", { editorId: "q" })];
    const r = computeRadar(input({ shoots }));
    const w = r.cells.q.findIndex((c) => c.status === "red");
    expect(w).toBeGreaterThanOrEqual(0);
    const mv = bestBatchMove(r, [rutger, fabian, quinn, senna], "q", w, settings);
    expect(mv?.to.id).toBe("f");
    // Senna zonder capaciteit kan nooit een pakket krijgen.
    expect(batchCandidates(r, [rutger, fabian, quinn, senna], "a", "q").some((c) => c.person.id === "s")).toBe(false);
  });

  it("houdt rekening met feestdagen en verlof", () => {
    const withLeave = { ...fabian, absences: [{ from: "2026-12-21", to: "2026-12-24" }] };
    const r = computeRadar(input({ people: [rutger, withLeave, quinn, senna] }));
    // Week 52: 25 dec is feestdag, 21 t/m 24 dec verlof → geen capaciteit.
    expect(r.cells.f[6].cap).toBe(0);
  });

  it("geeft gewone taal die past bij de kleur", () => {
    expect(roomText("edit", { load: 3, cap: 6, status: "green" }, settings)).toBe("Nog 3 video's");
    expect(roomText("edit", { load: 5.6, cap: 6, status: "orange" }, settings)).toBe("Vol");
    expect(roomText("edit", { load: 8.2, cap: 6, status: "red" }, settings)).toBe("3 te veel");
    expect(roomText("video", { load: 5, cap: 32, status: "green" }, settings)).toBe("Nog 4 opnames");
    expect(roomText("edit", { load: 2, cap: null, status: "grey" }, settings)).toBe("Onbekend");
  });

  it("rekent 6 tot 8 video's per opname als er niets is ingepland", () => {
    expect(videosPerShoot(null, 4)).toEqual({ videos: 6, source: "pakket" });
    expect(videosPerShoot(null, 12)).toEqual({ videos: 8, source: "pakket" });
    expect(videosPerShoot(null, null)).toEqual({ videos: 8, source: "standaard" });
    expect(videosPerShoot(5, 8)).toEqual({ videos: 5, source: "gepland" });
  });
});
