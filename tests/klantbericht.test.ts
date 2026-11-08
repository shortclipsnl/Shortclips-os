import { describe, expect, it } from "vitest";
import { DEFAULT_KLANTBERICHT, normalizeKlantbericht } from "@/lib/klantbericht";

describe("standaard klantbericht", () => {
  it("bevat de afgesproken onderdelen, witregels en opsommingstekens", () => {
    const lines = DEFAULT_KLANTBERICHT.split("\n");
    expect(lines[0]).toBe("Goedemorgen!");
    expect(lines[1]).toBe("");
    expect(DEFAULT_KLANTBERICHT).toContain("[Voeg videolink toe]");
    expect(lines.filter((l) => l.startsWith("• "))).toHaveLength(3);
    expect(DEFAULT_KLANTBERICHT).not.toMatch(/https?:\/\//);
    expect(lines.at(-1)).toBe("Alvast bedankt! 😊");
  });

  it("normaliseert regeleinden en spaties zonder witregels te verliezen", () => {
    expect(normalizeKlantbericht("Hoi  \r\n\r\n• punt\r\n")).toBe("Hoi\n\n• punt");
    expect(normalizeKlantbericht(DEFAULT_KLANTBERICHT)).toBe(DEFAULT_KLANTBERICHT);
  });
});
