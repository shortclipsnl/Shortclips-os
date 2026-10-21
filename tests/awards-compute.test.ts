import { describe, it, expect } from "vitest";
import { computeEarnedAwards, deliveredCount, highestEarned, nextAward, type Delivery } from "@/server/awards/compute";

/** Maakt n opleveringen met oplopende goedkeuringsdatums. */
function deliveries(n: number, startDay = 1): Delivery[] {
  return Array.from({ length: n }, (_, i) => ({ videoId: `v${i}`, approvedAt: new Date(2026, 0, startDay + i) }));
}

describe("awards telfunctie", () => {
  it("precies op de drempel (5) → Eerste cut, datum van de 5e oplevering", () => {
    const d = deliveries(5);
    const earned = computeEarnedAwards(d);
    expect(earned.map((e) => e.awardKey)).toEqual(["eerste_cut"]);
    expect(earned[0]!.achievedAt).toEqual(d[4]!.approvedAt);
    expect(earned[0]!.videoId).toBe("v4");
  });

  it("één onder de drempel (4) → geen award", () => {
    expect(computeEarnedAwards(deliveries(4))).toEqual([]);
  });

  it("meerdere drempels tegelijk (30) → Eerste cut + Op ritme", () => {
    const earned = computeEarnedAwards(deliveries(30));
    expect(earned.map((e) => e.awardKey)).toEqual(["eerste_cut", "op_ritme"]);
    expect(earned[1]!.videoId).toBe("v24"); // 25e oplevering
  });

  it("dubbele goedkeuring van dezelfde video telt één keer", () => {
    const d: Delivery[] = [
      { videoId: "a", approvedAt: new Date(2026, 0, 1) },
      { videoId: "a", approvedAt: new Date(2026, 0, 2) },
      { videoId: "b", approvedAt: new Date(2026, 0, 3) },
    ];
    expect(deliveredCount(d)).toBe(2);
  });

  it("revisies maken geen nieuwe oplevering (één rij per video)", () => {
    expect(deliveredCount(deliveries(5))).toBe(5);
  });

  it("chronologie bepaalt de award-datum, ook bij ongesorteerde invoer", () => {
    const d: Delivery[] = [
      { videoId: "c", approvedAt: new Date(2026, 0, 3) },
      { videoId: "a", approvedAt: new Date(2026, 0, 1) },
      { videoId: "e", approvedAt: new Date(2026, 0, 5) },
      { videoId: "b", approvedAt: new Date(2026, 0, 2) },
      { videoId: "d", approvedAt: new Date(2026, 0, 4) },
    ];
    const earned = computeEarnedAwards(d);
    expect(earned[0]!.achievedAt).toEqual(new Date(2026, 0, 5));
    expect(earned[0]!.videoId).toBe("e");
  });

  it("backfill: 100 opleveringen → vier awards met juiste datums", () => {
    const earned = computeEarnedAwards(deliveries(100));
    expect(earned.map((e) => e.awardKey)).toEqual(["eerste_cut", "op_ritme", "vaste_kracht", "century"]);
    expect(earned.find((e) => e.awardKey === "century")!.videoId).toBe("v99");
  });

  it("nextAward en highestEarned", () => {
    expect(nextAward(0)!.key).toBe("eerste_cut");
    expect(nextAward(5)!.key).toBe("op_ritme");
    expect(nextAward(1000)).toBeNull();
    expect(highestEarned(0)).toBeNull();
    expect(highestEarned(60)!.key).toBe("vaste_kracht");
    expect(highestEarned(1000)!.key).toBe("legend");
  });
});
