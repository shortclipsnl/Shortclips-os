import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import type { Viewer } from "@/server/auth/context";
import { editorHistoryRange, editorTone, itemStateForEditor, splitHistory } from "@/lib/editor-meetings";

describe("editor meetings: maandoverzicht editor", () => {
  it("loopt altijd minimaal tot en met maart 2027 door vanaf november 2026", () => {
    const r = editorHistoryRange("2026-11", null, null);
    expect(r).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  });
  it("schuift elke maand vanzelf mee en houdt eerdere meetings", () => {
    const r = editorHistoryRange("2027-02", "2026-12", "2027-03");
    expect(r[0]).toBe("2026-12");
    expect(r[r.length - 1]).toBe("2027-06");
  });
  it("zet de eerstvolgende maand bovenaan en eerdere maanden daaronder, recentste eerst", () => {
    const rows = ["2026-11", "2026-12", "2027-01", "2027-02"].map((period) => ({ period }));
    const { upcoming, earlier } = splitHistory(rows, "2027-01");
    expect(upcoming.map((r) => r.period)).toEqual(["2027-01", "2027-02"]);
    expect(earlier.map((r) => r.period)).toEqual(["2026-12", "2026-11"]);
  });
  it("geeft herkenbare kleuren per status", () => {
    expect(editorTone("te_plannen")).toBe("oranje");
    expect(editorTone("opnieuw_plannen")).toBe("oranje");
    expect(editorTone("gepland")).toBe("blauw");
    expect(editorTone("afgerond")).toBe("groen");
  });
  it("laat een conceptverslag niet doorlekken naar de editor", () => {
    expect(itemStateForEditor("open", null)).toBe("open");
    expect(itemStateForEditor("behandeld", "concept")).toBe("in_verslag");
    expect(itemStateForEditor("behandeld", "gepubliceerd")).toBe("behandeld");
  });
});

describe("editor meetings: Wat wil ik bespreken?", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let svc: typeof import("@/server/editor-meetings");
  const id: Record<string, string> = {};
  const viewer = (key: string, email: string, fullName: string, role: string): Viewer =>
    ({ id: id[key]!, email, fullName, primaryRole: role, clientId: null, avatarUrl: null, status: "active", permissions: new Set<string>(), clientScope: role === "editor" ? [] : null, isPortalUser: false, isEditorOnly: role === "editor" }) as Viewer;
  const milou = () => viewer("milou", "milou@shortclips.nl", "Milou Sjoerdsma", "operational_manager");
  const jiska = () => viewer("jiska", "jiska@shortclips.nl", "Jiska", "project_coordinator");
  const quinn = () => viewer("quinn", "quinn@x.nl", "Quinn Borghart", "editor");
  const noah = () => viewer("noah", "noah@x.nl", "Noah", "editor");
  const notes = (who: string) => db.select().from(s.notifications).where(eq(s.notifications.userId, id[who]!));

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00+01:00"));
    db = await freshDatabase();
    s = await import("@/db/schema");
    svc = await import("@/server/editor-meetings");
    const add = async (key: string, email: string, fullName: string, role: string) => {
      const [u] = await db.insert(s.users).values({ email, fullName, status: "active", primaryRole: role as "editor" }).returning({ id: s.users.id });
      id[key] = u!.id;
    };
    await add("jarno", "jarno@shortclips.nl", "Jarno Klijnsma", "owner");
    await add("milou", "milou@shortclips.nl", "Milou Sjoerdsma", "operational_manager");
    await add("jiska", "jiska@shortclips.nl", "Jiska", "project_coordinator");
    await add("quinn", "quinn@x.nl", "Quinn Borghart", "editor");
    await add("noah", "noah@x.nl", "Noah", "editor");
    // Vaste verdeling: Quinn bij Jiska (niet de standaard Milou).
    await db.insert(s.editorMeetingOwners).values({ editorId: id.quinn!, ownerId: id.jiska! });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await closeDatabase();
  });

  it("toont de juiste content creative en het maandoverzicht tot en met maart 2027", async () => {
    const page = await svc.getEditorPage(quinn());
    expect(page.owner?.fullName).toBe("Jiska");
    expect(page.ownerFixed).toBe(true);
    expect(page.history.map((h) => h.period)).toEqual(["2027-03", "2027-02", "2027-01", "2026-12", "2026-11"]);
    expect(page.history.every((h) => h.ownerName === "Jiska")).toBe(true);
    expect(page.target.period).toBe("2026-11");
  });

  it("editor zet punten klaar; de content creative krijgt één melding", async () => {
    await svc.addItem(quinn(), "Ik wil meer variatie in mijn hooks leren");
    vi.setSystemTime(new Date("2026-11-16T10:05:00+01:00"));
    await svc.addItem(quinn(), "  Briefings   missen soms de lengte  ");
    const page = await svc.getEditorPage(quinn());
    expect(page.items.open.map((i) => i.body)).toEqual(["Ik wil meer variatie in mijn hooks leren", "Briefings missen soms de lengte"]);
    const n = (await notes("jiska")).filter((x) => x.type === "editor_meeting.items");
    expect(n).toHaveLength(1);
    expect((await notes("milou")).filter((x) => x.type === "editor_meeting.items")).toHaveLength(0);
    // Een andere editor of een teamlid kan de punten van Quinn niet aanpassen.
    const item = page.items.open[0]!;
    await expect(svc.updateItem(noah(), item.id, "x")).rejects.toThrow();
    await expect(svc.deleteItem(milou(), item.id)).rejects.toThrow();
    await expect(svc.addItem(milou(), "x")).rejects.toThrow();
    // Noah ziet niets van Quinn.
    expect((await svc.getEditorPage(noah())).items.open).toHaveLength(0);
  });

  it("de content creative ziet de punten vooraf en zet ze in het verslag om, zonder dubbele invoer", async () => {
    const { id: meetingId } = await svc.planMeeting(jiska(), { editorId: id.quinn!, date: "2026-11-18", time: "10:00" });
    const before = (await svc.getMeetingDetail(jiska(), meetingId))!;
    expect(before.items.map((i) => i.body)).toHaveLength(2);
    await expect(svc.getMeetingDetail(milou(), meetingId)).rejects.toThrow(); // niet haar editor

    vi.setSystemTime(new Date("2026-11-18T11:00:00+01:00"));
    const [hooks, briefing] = before.items;
    const input = {
      insights: "",
      focusNext: "",
      internalNotes: "",
      points: [{ kind: "verbeterpunt" as const, theme: "hook", body: hooks!.body }],
      actions: [],
      items: [
        { id: hooks!.id, outcome: "verbeterpunt" as const },
        { id: briefing!.id, outcome: null },
      ],
    };
    await svc.saveReport(jiska(), meetingId, input, false);
    // Concept: voor de editor nog niet behandeld, wel vergrendeld.
    let page = await svc.getEditorPage(quinn());
    expect(page.items.open.find((i) => i.id === hooks!.id)?.editorState).toBe("in_verslag");
    await expect(svc.updateItem(quinn(), hooks!.id, "aangepast")).rejects.toThrow(/besproken/);

    const draft = (await svc.getMeetingDetail(jiska(), meetingId))!;
    await svc.saveReport(jiska(), meetingId, { ...input, points: draft.points.map((p) => ({ id: p.id, kind: p.kind, theme: p.theme, body: p.body })) }, true);
    page = await svc.getEditorPage(quinn());
    expect(page.items.handled.map((i) => [i.body, i.outcome])).toEqual([[hooks!.body, "verbeterpunt"]]);
    // Het niet behandelde punt blijft open staan voor de volgende meeting.
    expect(page.items.open.map((i) => i.body)).toEqual(["Briefings missen soms de lengte"]);
    expect(page.target.period).toBe("2026-12");
    // Het verbeterpunt staat één keer in het verslag en bij de verbeterpunten.
    expect(page.openPoints.map((p) => p.body)).toEqual([hooks!.body]);
    const d = (await svc.getMeetingDetail(quinn(), meetingId))!;
    expect(d.items.map((i) => i.outcome)).toEqual(["verbeterpunt"]);
    expect(page.history.find((h) => h.period === "2026-11")).toMatchObject({ status: "afgerond", hasReport: true });
  });

  it("een wijziging van verantwoordelijke werkt direct door voor komende maanden", async () => {
    await svc.setEditorOwner(viewer("jarno", "jarno@shortclips.nl", "Jarno Klijnsma", "owner"), id.quinn!, id.milou!);
    const page = await svc.getEditorPage(quinn());
    expect(page.owner?.fullName).toBe("Milou Sjoerdsma");
    expect(page.history.find((h) => h.period === "2027-01")?.ownerName).toBe("Milou Sjoerdsma");
    // De afgeronde meeting van november blijft bij Jiska.
    expect(page.history.find((h) => h.period === "2026-11")?.ownerName).toBe("Jiska");
  });
});
