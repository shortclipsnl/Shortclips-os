import { describe, expect, it } from "vitest";
import CapEngine from "@/lib/capacity-engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const E: any = CapEngine;

const base = () => {
  E.configure({ today: "2026-11-16", holidays: [] });
  const people = [
    { id: "noah", name: "Noah", role: "editor", employment: "freelance", shortsPerWeek: 4.25, pattern: [1, 2, 3, 4, 5], leave: [] },
    { id: "fab", name: "Fabian", role: "editor", employment: "freelance", shortsPerWeek: 12.25, pattern: [1, 2, 3, 4, 5], leave: [] },
    { id: "senna", name: "Senna", role: "editor", employment: "freelance", shortsPerWeek: null, pattern: [1, 2, 3, 4, 5], leave: [] },
  ];
  const clients = [
    { id: "a", name: "Klant A", quota: 8, editor: "noah" },
    { id: "b", name: "Klant B", quota: 8, editor: "noah" },
  ];
  const shoot = (id: string, client: string, date: string, editor: string | null, shorts = 8) =>
    ({ id, date, client, clientName: client === "a" ? "Klant A" : "Klant B", start: "09:00", dur: 3, travel: 1, vg: null, shorts, editor, estimated: false, shortsSource: "ingevuld", videoStatus: [], clientDue: E.addWorkdays(date, 14) });
  const data = { people, clients, projects: [], shoots: [shoot("s1", "a", "2026-11-30", "noah"), shoot("s2", "b", "2026-12-01", "noah"), shoot("s3", "a", "2026-12-02", "senna")] };
  const st = { settings: E.defaultSettings(), moves: {}, vgMoves: {}, snoozed: [] };
  return { data, st };
};

describe("capaciteitsradar", () => {
  it("telt geen verwacht werk uit pakketten mee", () => {
    const { data, st } = base();
    const R = E.compute(data, st, 10);
    expect(R.edItems.every((i: { source: string }) => i.source !== "verwacht")).toBe(true);
    expect(R.edItems).toHaveLength(3);
  });

  it("toont geen percentage zonder ingestelde capaciteit, wel het werk", () => {
    const { data, st } = base();
    const R = E.compute(data, st, 6);
    const senna = R.edRows.find((r: { person: { id: string } }) => r.person.id === "senna");
    const busy = senna.cells.find((c: { load: number }) => c.load > 0);
    expect(busy.pct).toBeNull();
    expect(busy.key).toBe("grijs");
  });

  it("wijst bij overbelasting de veroorzakers, ruimte en een verschuiving aan", () => {
    const { data, st } = base();
    const R = E.compute(data, st, 6);
    const row = R.edRows.find((r: { person: { id: string } }) => r.person.id === "noah");
    const i = row.cells.findIndex((c: { key: string }) => c.key === "rood");
    expect(i).toBeGreaterThanOrEqual(0);
    const D = E.editorCellDetail(data, st, R, "noah", i, []);
    expect(D.excess).toBeGreaterThan(0);
    expect(D.rows.some((r: { cause: boolean }) => r.cause)).toBe(true);
    expect(D.others.find((o: { person: { id: string } }) => o.person.id === "fab").free).toBeGreaterThan(0);
    expect(D.moves[0].to.id).toBe("fab");
    // Niets wordt automatisch verplaatst.
    expect(st.moves).toEqual({});
  });

  it("verandert direct mee als de editor in de planning wijzigt", () => {
    const { data, st } = base();
    data.shoots[1]!.editor = "fab";
    const R = E.compute(data, st, 6);
    const b = R.edItems.find((x: { id: string }) => x.id === "s2");
    expect(b.editor).toBe("fab");
  });
});
