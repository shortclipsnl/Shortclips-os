import { describe, expect, it } from "vitest";
import { splitNumbers } from "@/lib/cijfers";

const nums = (t: string) => splitNumbers(t).filter((p) => p.num).map((p) => p.text);

describe("cijfers in rapportzinnen", () => {
  it("herkent aantallen, percentages en bedragen in Nederlandse notatie", () => {
    expect(nums("Woningrondleiding haalde 19.522 weergaven en 159 shares, goed voor 68% van alle shares.")).toEqual(["19.522", "159", "68%"]);
    expect(nums("Bereik (+28%), interacties (+54,8%) en volgersgroei (+24,3%) lagen hoger.")).toEqual(["+28%", "+54,8%", "+24,3%"]);
    expect(nums("Bij Hof van Gaasterland (15,8%) en de watervilla (22%) haakten kijkers af.")).toEqual(["15,8%", "22%"]);
    expect(nums("Leeuwarden voor €550.000 haalde 2,8x de nummer twee bij 13 sec kijktijd.")).toEqual(["€550.000", "2,8x", "13 sec"]);
    expect(nums("Weergaven daalden met -1,2% en bleven onder 2.000 weergaven.")).toEqual(["-1,2%", "2.000"]);
  });
  it("laat de zin zelf ongewijzigd en neemt de punt aan het eind niet mee", () => {
    const zin = "We kregen 92 nieuwe volgers (+24,3% t.o.v. vorige maand).";
    expect(splitNumbers(zin).map((p) => p.text).join("")).toBe(zin);
    expect(nums("Het bereik groeide naar 2.000.")).toEqual(["2.000"]);
  });
  it("markeert geen cijfers die bij een woord horen", () => {
    expect(nums("De Q4-campagne en TikTok2 lopen door.")).toEqual([]);
    expect(nums("Een vergelijking per contentformat is deze maand nog niet mogelijk.")).toEqual([]);
  });
});
