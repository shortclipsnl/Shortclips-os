import { describe, expect, it } from "vitest";
import { syncedShootStatus } from "@/lib/shoot-status";
import { blockFromCalendarTitle, computeAvailability, largestFreeGap, type BusyItem } from "@/lib/shoot-availability";

const VG = [
  { id: "r", name: "Rutger" },
  { id: "j", name: "Jarno" },
];
const run = (busy: BusyItem[], opts: { from?: string; to?: string; today?: string; now?: number; holidays?: string[] } = {}) =>
  computeAvailability({
    from: opts.from ?? "2026-11-16",
    to: opts.to ?? "2026-11-20",
    today: opts.today ?? "2026-11-16",
    nowMinutes: opts.now ?? 8 * 60,
    videographers: VG,
    busy,
    holidays: new Set(opts.holidays ?? []),
  });

describe("syncedShootStatus: agenda-sync mag afgeronde opnames niet terugzetten", () => {
  it("nieuw wordt gepland", () => expect(syncedShootStatus(null, "2026-11-20", "2026-11-16")).toBe("planned"));
  it("afgerond in het verleden blijft afgerond", () => expect(syncedShootStatus("completed", "2026-11-05", "2026-11-16")).toBe("completed"));
  it("afgerond maar verplaatst naar de toekomst wordt weer gepland", () =>
    expect(syncedShootStatus("completed", "2026-11-25", "2026-11-16")).toBe("planned"));
  it("handmatig geannuleerd in het verleden blijft geannuleerd", () =>
    expect(syncedShootStatus("cancelled", "2026-11-12", "2026-11-16")).toBe("cancelled"));
  it("geannuleerd maar weer actief in de agenda (toekomst) wordt gepland", () =>
    expect(syncedShootStatus("cancelled", "2026-11-20", "2026-11-16")).toBe("planned"));
  it("gepland blijft gepland, ook als de datum voorbij is", () =>
    expect(syncedShootStatus("planned", "2026-11-03", "2026-11-16")).toBe("planned"));
});

describe("largestFreeGap", () => {
  it("lege dag = hele werkdag", () => expect(largestFreeGap([], 510, 1020)).toEqual([510, 1020]));
  it("ochtendopname laat de middag vrij", () => expect(largestFreeGap([[480, 810]], 510, 1020)).toEqual([810, 1020]));
});

describe("computeAvailability", () => {
  it("toont alleen werkdagen vanaf vandaag", () => {
    const days = run([], { from: "2026-11-14", to: "2026-11-23" });
    expect(days.map((d) => d.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23"]);
  });

  it("iemand zonder vaste capaciteit is op aanvraag en maakt een dag niet beschikbaar", () => {
    const days = computeAvailability({
      from: "2026-11-17", to: "2026-11-17", today: "2026-11-16", nowMinutes: 480,
      videographers: [{ id: "r", name: "Rutger" }, { id: "j", name: "Jarno", countsForCapacity: false }],
      busy: [{ videographerId: "r", date: "2026-11-17", start: "09:00", end: "16:00", label: "Hegro", kind: "opname" }],
      holidays: new Set(),
    });
    expect(days[0]!.perVg[1]).toMatchObject({ state: "op_aanvraag" });
    expect(days[0]!.available).toBe(false);
  });

  it("opname van 09:00-15:00 maakt Rutger bezet (blauw), Jarno blijft beschikbaar", () => {
    const [, tue] = run([{ videographerId: "r", date: "2026-11-17", start: "09:00", end: "15:00", label: "Hegro", kind: "opname" }]);
    expect(tue!.perVg[0]).toMatchObject({ state: "bezet", busyBy: "opname", detail: "Hegro" });
    expect(tue!.perVg[1]!.state).toBe("beschikbaar");
    expect(tue!.available).toBe(true);
  });

  it("korte ochtendopname + reistijd laat te weinig ruimte (geen halve dag vrij)", () => {
    const [mon] = run([{ videographerId: "r", date: "2026-11-16", start: "09:00", end: "12:30", label: "Koops", kind: "opname" }]);
    expect(mon!.perVg[0]!.state).toBe("bezet");
  });

  it("vroege opname laat een volle middag vrij en zegt vanaf hoe laat", () => {
    const days = run([{ videographerId: "r", date: "2026-11-18", start: "08:30", end: "11:00", label: "X", kind: "opname" }]);
    const wed = days.find((d) => d.date === "2026-11-18")!;
    expect(wed.perVg[0]).toMatchObject({ state: "beschikbaar", detail: "vanaf 12:00" });
  });

  it("verlof en feestdagen maken een videograaf afwezig (grijs)", () => {
    const days = run([{ videographerId: "j", date: "2026-11-19", start: null, end: null, label: "Verlof", kind: "blokkade" }], { holidays: ["2026-11-20"] });
    expect(days.find((d) => d.date === "2026-11-19")!.perVg[1]).toMatchObject({ state: "afwezig", detail: "Verlof" });
    const fri = days.find((d) => d.date === "2026-11-20")!;
    expect(fri.available).toBe(false);
    expect(fri.perVg.every((v) => v.detail === "Feestdag")).toBe(true);
  });

  it("teamsluiting blokkeert iedereen", () => {
    const days = run([{ videographerId: null, date: "2026-11-19", start: null, end: null, label: "Gesloten", kind: "blokkade" }]);
    expect(days.find((d) => d.date === "2026-11-19")!.available).toBe(false);
  });

  it("vandaag telt alleen de rest van de dag", () => {
    const [mon] = run([], { now: 14 * 60 });
    expect(mon!.available).toBe(false);
    const [mon2] = run([], { now: 10 * 60 });
    expect(mon2!.perVg[0]).toMatchObject({ state: "beschikbaar", detail: "vanaf 10:00" });
  });
});

describe("blockFromCalendarTitle", () => {
  it("herkent afwezigheid van een videograaf", () => expect(blockFromCalendarTitle("Rutger vrij", VG)).toEqual({ videographerId: "r", label: "Afwezig" }));
  it("negeert afwezigheid van niet-videografen", () => expect(blockFromCalendarTitle("Milou vrij", VG)).toBeNull());
  it("negeert INVULLEN-blokken en gewone afspraken", () => {
    expect(blockFromCalendarTitle("INVULLEN!", VG)).toBeNull();
    expect(blockFromCalendarTitle("JARNO MEE", VG)).toBeNull();
  });
  it("herkent sluiting van het hele team", () => expect(blockFromCalendarTitle("Kantoor gesloten", VG)).toEqual({ videographerId: null, label: "Gesloten" }));
});
