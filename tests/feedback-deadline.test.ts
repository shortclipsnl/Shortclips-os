import { describe, expect, it } from "vitest";
import { amsterdamTimeOn, deadlineLabel, feedbackDeadlineAt, feedbackDueDay, timeLeftLabel, waitingStatus } from "@/lib/feedback-deadline";
import { nlHolidaySet } from "@/lib/holidays";

describe("feedbackdeadline", () => {
  it("17:00 Nederlandse tijd in winter- en zomertijd", () => {
    expect(amsterdamTimeOn("2026-11-19").toISOString()).toBe("2026-11-19T16:00:00.000Z");
    expect(amsterdamTimeOn("2026-07-01").toISOString()).toBe("2026-07-01T15:00:00.000Z");
  });
  it("vrijdag verstuurd, 3 werkdagen: woensdag 17:00", () => {
    const d = feedbackDeadlineAt("2026-11-13T15:00:00Z", 3);
    expect(d.toISOString()).toBe("2026-11-18T16:00:00.000Z");
    expect(deadlineLabel(d)).toBe("woensdag 18 november om 17:00");
  });
  it("feestdagen tellen niet mee", () => {
    const h = nlHolidaySet([2026, 2027]);
    // dinsdag 22 dec + 3 werkdagen: wo 23, do 24, (vr 25 kerst), ma 28
    expect(feedbackDueDay("2026-12-22T09:00:00Z", 3, h)).toBe("2026-12-28");
  });
  it("afwijkende termijn per klant", () => {
    expect(feedbackDueDay("2026-11-16T09:00:00Z", 5)).toBe("2026-11-23");
  });
  it("status en resterende tijd", () => {
    expect(waitingStatus("2026-11-19", "2026-11-16")).toBe("wacht");
    expect(waitingStatus("2026-11-19", "2026-11-18")).toBe("nadert");
    expect(waitingStatus("2026-11-19", "2026-11-19")).toBe("nadert");
    expect(waitingStatus("2026-11-19", "2026-11-20")).toBe("verlopen");
    expect(timeLeftLabel("2026-11-19", "2026-11-17")).toBe("nog 2 werkdagen");
    expect(timeLeftLabel("2026-11-19", "2026-11-19")).toBe("vandaag vóór 17:00");
    expect(timeLeftLabel("2026-11-19", "2026-11-23")).toBe("2 werkdagen te laat");
  });
});
