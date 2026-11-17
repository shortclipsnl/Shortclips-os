import { describe, expect, it } from "vitest";
import { autoMatch, calendarKey, latestVersions, versionOf, videoKey, type MatchableVideo } from "@/lib/content-video-match";

const v = (id: string, name: string, session: string, subfolder: string | null = null, created = "2026-09-02"): MatchableVideo => ({
  id, name, clientId: "c", sessionKey: session, sessionName: session, sessionCreatedAt: new Date("2026-09-01"),
  sessionProductionDayId: null, subfolder, frameCreatedAt: new Date(created), versionCount: 1,
});

describe("contentplanning ↔ Frame-video", () => {
  it("haalt het onderwerp uit een agendatitel", () => {
    expect(calendarKey("Koops Short online > 16:00 >  Wat kies jij?", "Koops Chalets")).toBe("wat kies jij");
    expect(calendarKey("Benz Collector - ", "Benz Collector Museum")).toBe("");
  });

  it("maakt een sleutel van een Frame-bestandsnaam", () => {
    expect(videoKey("3. WAT KIES JIJ - Shortclips_1.mp4")).toBe("wat kies jij");
    expect(videoKey("V2 2. Is een audi een dure volkswagen Luxewagen - ShortClips.mp4", "Luxewagen")).toBe("is een audi een dure volkswagen");
    expect(videoKey("4. 24.000 EURO OP JEZELF WONEN - Shortclips.mp4")).toBe("24000 euro op jezelf wonen");
    // Nummering met underscore en versie vooraan (Marco van Beek, sessie 15).
    expect(videoKey("1._V2 ONDERHOUD.mp4")).toBe("onderhoud");
    expect(videoKey("4._V5 AUTO'S VAN PERSONEEL.mp4")).toBe("auto s van personeel");
    expect(videoKey("4V2 - Target blue eye - Shortclips.mp4")).toBe("target blue eye");
    expect(videoKey("24.000 views in een week.mp4")).toBe("24000 views in een week");
  });

  it("koppelt een onderwerp aan een video met underscore-nummering", () => {
    const vids = [v("o", "1._V2 ONDERHOUD.mp4", "s15"), v("p", "2._V2 C63S AMG.mp4", "s15")];
    const m = autoMatch({ title: "Marco van beek short online > 16:00 - onderhoud", scheduledOn: "2026-11-06" }, latestVersions(vids, "Marco van Beek Premium Cars"), "Marco van Beek Premium Cars");
    expect(m?.id).toBe("o");
  });

  it("herkent versies in naam en submap", () => {
    expect(versionOf("V3 3. BMW knipperlichten", null)).toBe(3);
    expect(versionOf("3. WAT KIES JIJ", "v4")).toBe(4);
    expect(versionOf("3. WAT KIES JIJ", "ORGANISCHE SHORTS")).toBe(1);
  });

  it("koppelt automatisch aan de nieuwste versie", () => {
    const vids = [v("1", "3. WAT KIES JIJ - Shortclips.mp4", "s5", "v4"), v("2", "3. WAT KIES JIJ - Shortclips_1.mp4", "s5", "V1"), v("3", "3. WAT KIES JIJ - Shortclips.mp4", "s5", "v3"), v("4", "1. NIEUWE REGELING - Shortclips.mp4", "s5", "v4")];
    const m = autoMatch({ title: "Koops Short online > 16:00 >  Wat kies jij?", scheduledOn: "2026-11-20" }, latestVersions(vids, "Koops Chalets"), "Koops Chalets");
    expect(m?.id).toBe("1");
  });

  it("koppelt niet bij twijfel of een te vaag onderwerp", () => {
    const vids = [v("a", "1. AMG GT - Shortclips.mp4", "s1"), v("b", "2. AMG C63 - Shortclips.mp4", "s1")];
    expect(autoMatch({ title: "Marco van beek short online > 16:00 - AMG", scheduledOn: "2026-11-13" }, latestVersions(vids), "Marco van Beek")).toBeNull();
    expect(autoMatch({ title: "Hoekstra Transport - Video 3", scheduledOn: "2026-11-13" }, latestVersions(vids), "Hoekstra Transport")).toBeNull();
  });

  it("negeert video's die pas na de publicatiedatum in Frame kwamen", () => {
    const vids = [v("x", "1. OMVORMER - Shortclips.mp4", "s1", null, "2026-12-01")];
    expect(autoMatch({ title: "Campernet short online - 16.15 - Omvormer", scheduledOn: "2026-11-10" }, latestVersions(vids), "campernet")).toBeNull();
  });
});
