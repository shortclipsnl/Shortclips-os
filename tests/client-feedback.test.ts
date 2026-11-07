import { describe, expect, it } from "vitest";
import { nlHolidaySet } from "../src/lib/holidays";
import { clientFeedbackDue, isClientFeedbackOverdue, workdaysAtClient } from "../src/lib/client-feedback";

const H = nlHolidaySet();

describe("feedbacktermijn klant in werkdagen", () => {
  it("vrijdag verstuurd, 3 werkdagen: termijn loopt t/m woensdag (weekend telt niet)", () => {
    const sent = "2026-11-06T14:00:00Z"; // vrijdag
    expect(clientFeedbackDue(sent, 3, H)).toBe("2026-11-11");
    expect(isClientFeedbackOverdue(sent, 3, "2026-11-09", H)).toBe(false); // maandag (na 72 uur zou dit al te laat zijn)
    expect(isClientFeedbackOverdue(sent, 3, "2026-11-11", H)).toBe(false); // woensdag: nog binnen termijn
    expect(isClientFeedbackOverdue(sent, 3, "2026-11-12", H)).toBe(true); // donderdag: verstreken
  });
  it("maandag verstuurd: t/m donderdag", () => {
    expect(clientFeedbackDue("2026-11-09T09:00:00Z", 3, H)).toBe("2026-11-12");
  });
  it("feestdagen tellen niet mee (kerst)", () => {
    // woensdag 23 dec → 24 do, (25/26 feest) → 28 ma, 29 di
    expect(clientFeedbackDue("2026-12-23T10:00:00Z", 3, H)).toBe("2026-12-29");
  });
  it("late avond in Amsterdam telt als die dag, niet als UTC-dag", () => {
    // 23:30 Amsterdam op vrijdag = 22:30 UTC vrijdag
    expect(clientFeedbackDue("2026-11-06T22:30:00Z", 3, H)).toBe("2026-11-11");
  });
  it("werkdagen bij de klant", () => {
    expect(workdaysAtClient("2026-11-06T14:00:00Z", "2026-11-10", H)).toBe(2);
  });
});
