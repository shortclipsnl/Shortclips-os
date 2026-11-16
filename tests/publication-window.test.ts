import { describe, expect, it } from "vitest";
import { amsterdamClock, isInPublicationWindow, publicationPhaseKey } from "@/lib/publication-window";

// Wintertijd: Amsterdam = UTC+1. Zomertijd: UTC+2.
describe("publicatiemoment 14:00-17:00 (Europe/Amsterdam)", () => {
  it("is dicht net voor 14:00 en open vanaf 14:00 op een werkdag", () => {
    expect(isInPublicationWindow(new Date("2026-11-16T12:59:00Z"))).toBe(false); // ma 13:59
    expect(isInPublicationWindow(new Date("2026-11-16T13:00:00Z"))).toBe(true); // ma 14:00
  });
  it("is open tot 17:00 en daarna dicht", () => {
    expect(isInPublicationWindow(new Date("2026-11-16T15:59:00Z"))).toBe(true); // ma 16:59
    expect(isInPublicationWindow(new Date("2026-11-16T16:00:00Z"))).toBe(false); // ma 17:00
  });
  it("is in het weekend altijd dicht", () => {
    expect(isInPublicationWindow(new Date("2026-11-21T14:00:00Z"))).toBe(false); // za 15:00
    expect(isInPublicationWindow(new Date("2026-11-22T14:00:00Z"))).toBe(false); // zo 15:00
  });
  it("houdt rekening met zomertijd", () => {
    expect(isInPublicationWindow(new Date("2026-07-06T12:00:00Z"))).toBe(true); // ma 14:00 CEST
    expect(isInPublicationWindow(new Date("2026-07-06T11:59:00Z"))).toBe(false); // ma 13:59 CEST
  });
  it("geeft per dag en fase een eigen sleutel", () => {
    expect(publicationPhaseKey(new Date("2026-11-16T13:30:00Z"))).toBe("2026-11-16:open");
    expect(publicationPhaseKey(new Date("2026-11-16T16:30:00Z"))).toBe("2026-11-16:dicht");
    expect(amsterdamClock(new Date("2026-11-16T23:30:00Z")).date).toBe("2026-11-17");
  });
});
