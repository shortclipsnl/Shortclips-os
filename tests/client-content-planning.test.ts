import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captionHeadline,
  captionIsFinal,
  clientPostStatus,
  clientPostTitle,
  isIsoDate,
  isIsoMonth,
  isoWeekNumber,
  mondayOf,
  monthDays,
  shiftMonth,
  sortPlatforms,
} from "@/lib/client-content-planning";

describe("klantstatus uit de interne publicatiestatus", () => {
  it("vertaalt de interne statussen naar drie klantstatussen", () => {
    expect(clientPostStatus("published")).toBe("published");
    expect(clientPostStatus("scheduled")).toBe("scheduled");
    expect(clientPostStatus("ready")).toBe("scheduled");
    expect(clientPostStatus("to_prepare")).toBe("tentative");
    expect(clientPostStatus("failed")).toBe("tentative");
    expect(clientPostStatus(null)).toBe("tentative");
  });
  it("toont de caption alleen als de video klaar of online is", () => {
    expect(captionIsFinal("to_prepare")).toBe(false);
    expect(captionIsFinal("ready")).toBe(true);
    expect(captionIsFinal("published")).toBe(true);
  });
});

describe("klanttitel", () => {
  const client = "Marco van Beek Premium Cars";
  it("haalt interne agendaruis weg", () => {
    expect(clientPostTitle("Marco van beek short online > 16:00 - onderhoud", client)).toBe("Onderhoud");
    expect(clientPostTitle("Marco van beek short online > 16:00 - BMW M5 Touring", client)).toBe("BMW M5 Touring");
    expect(clientPostTitle("Marco van beek short online > 16:00 - autos van personen", client)).toBe("Autos van personen");
  });
  it("geeft leeg terug bij nietszeggende titels", () => {
    expect(clientPostTitle("Marco van beek short online > 16:00 - NNB", client)).toBe("");
    expect(clientPostTitle("Marco van beek short online > 16:00", client)).toBe("");
    expect(clientPostTitle("Marco van Beek Premium Cars #4", client)).toBe("");
  });
  it("laat een gewone titel staan", () => {
    expect(clientPostTitle("Waarom de C 63 S een legende is", client)).toBe("Waarom de C 63 S een legende is");
  });
  it("pakt de eerste echte regel van een caption", () => {
    expect(captionHeadline("VIJF redenen waarom DE C 63 S zo'n legende is 🔥\n\n#amg #mercedes")).toBe("VIJF redenen waarom DE C 63 S zo'n legende is 🔥");
  });
});

describe("datums", () => {
  it("rekent weken en maanden", () => {
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16");
    expect(isoWeekNumber("2026-11-16")).toBe(47);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    const days = monthDays("2026-11");
    expect(days[0]).toBe("2026-10-26");
    expect(days.at(-1)).toBe("2026-12-06");
    expect(days.length % 7).toBe(0);
  });
  it("controleert invoer uit de URL", () => {
    expect(isIsoDate("2026-11-16")).toBe(true);
    expect(isIsoDate("16-11-2026")).toBe(false);
    expect(isIsoDate("<script>")).toBe(false);
    expect(isIsoMonth("2026-13")).toBe(false);
    expect(isIsoMonth("2026-11")).toBe(true);
  });
  it("sorteert kanalen vast", () => {
    expect(sortPlatforms(["youtube", "tiktok", "instagram", "tiktok"])).toEqual(["instagram", "tiktok", "youtube"]);
  });
});

describe("klantagenda uit de interne planning (database)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let s: typeof import("@/db/schema");
  let A = "", B = "";
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  };

  beforeAll(async () => {
    const h = await import("./helpers/db");
    db = await h.freshDatabase();
    s = await import("@/db/schema");
    const ins = async (slug: string, name: string) =>
      (await db.insert(s.clients).values({ slug, name, status: "active", weHandlePosting: true }).returning({ id: s.clients.id }))[0]!.id as string;
    A = await ins("marco-test", "Marco van Beek Premium Cars");
    B = await ins("andere-klant", "Andere Klant");
    const [pub] = await db.insert(s.contentCalendar).values([
      { clientId: A, title: "Marco van beek short online > 16:00 - onderhoud", scheduledOn: day(-1), scheduledAt: "15:00", status: "published", platforms: [], caption: "Onderhoud bij ons 🔧\n#amg", notes: "INTERNE NOTITIE" },
      { clientId: A, title: "Marco van beek short online > 16:00 - NNB", scheduledOn: day(1), scheduledAt: "15:00", status: "to_prepare", platforms: [], caption: "Conceptcaption", clientApproved: false },
      { clientId: A, title: "Nieuwe AMG binnen", scheduledOn: day(2), scheduledAt: "16:30", status: "scheduled", platforms: ["youtube", "instagram"], caption: "Definitief" },
      { clientId: B, title: "Video van een andere klant", scheduledOn: day(1), status: "scheduled", platforms: ["tiktok"] },
    ]).returning({ id: s.contentCalendar.id });
    await db.insert(s.publications).values([
      { clientId: A, calendarItemId: pub.id, platform: "tiktok", status: "published", publishedAt: new Date(), externalUrl: "https://www.tiktok.com/@marco/video/1" },
      { clientId: A, calendarItemId: pub.id, platform: "instagram", status: "published", publishedAt: new Date(), externalUrl: "https://www.instagram.com/reel/abc" },
    ]);
  });
  afterAll(async () => {
    const h = await import("./helpers/db");
    await h.closeDatabase();
  });

  it("toont alleen de eigen video's, met klantstatus, zonder interne gegevens", async () => {
    const { getClientAgenda } = await import("@/server/portal-content");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await getClientAgenda({ clientId: A } as any, day(-3), day(5));
    expect(a.posts.map((p) => p.status)).toEqual(["published", "tentative", "scheduled"]);
    expect(a.posts.map((p) => p.title)).toEqual(["Onderhoud", "Nieuwe video", "Nieuwe AMG binnen"]);
    expect(JSON.stringify(a)).not.toContain("INTERNE NOTITIE");
    expect(JSON.stringify(a)).not.toContain("andere klant");
    // Caption alleen als definitief.
    expect(a.posts[1]!.caption).toBeNull();
    expect(a.posts[2]!.caption).toBe("Definitief");
    // Kanalen: eigen keuze van het team, anders echte publicaties.
    expect(a.posts[2]!.platforms).toEqual(["instagram", "youtube"]);
    expect(a.posts[0]!.platforms).toEqual(["instagram", "tiktok"]);
    expect(a.posts[0]!.links.map((l) => l.platform)).toEqual(["instagram", "tiktok"]);
    expect(a.posts[0]!.scheduledAt).toBe("15:00");
  });

  it("een wijziging in de interne planning is direct zichtbaar", async () => {
    const { eq } = await import("drizzle-orm");
    const { getClientAgenda } = await import("@/server/portal-content");
    await db.update(s.contentCalendar).set({ scheduledAt: "17:45", status: "scheduled", platforms: ["facebook"] }).where(eq(s.contentCalendar.title, "Nieuwe AMG binnen"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await getClientAgenda({ clientId: A } as any, day(-3), day(5));
    const p = a.posts.find((x) => x.title === "Nieuwe AMG binnen")!;
    expect(p.scheduledAt).toBe("17:45");
    expect(p.platforms).toEqual(["facebook"]);
  });

  it("zonder klant of zonder planning: lege agenda", async () => {
    const { getClientAgenda, countClientAgendaByWeek } = await import("@/server/portal-content");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await getClientAgenda({ clientId: null } as any, day(0), day(6))).posts).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((await getClientAgenda({ clientId: B } as any, day(30), day(36))).posts).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const weeks = await countClientAgendaByWeek({ clientId: A } as any, mondayOf(day(0)), mondayOf(day(0)));
    expect(weeks.length).toBe(1);
  });
});

describe("klanttitel randgevallen", () => {
  it("laat afkortingen en een klantnaam midden in de titel staan", () => {
    expect(clientPostTitle("Marco van beek short online > 16:00 - AMG", "Marco van Beek Premium Cars")).toBe("AMG");
    expect(clientPostTitle("Onderhoud bij Marco van Beek", "Marco van Beek Premium Cars")).toBe("Onderhoud bij Marco van Beek");
    expect(clientPostTitle("NIEUWE AUTO BINNEN VANDAAG", "Marco van Beek Premium Cars")).toBe("Nieuwe auto binnen vandaag");
  });
});
