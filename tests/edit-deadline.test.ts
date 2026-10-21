import { describe, expect, it } from "vitest";
import { addWorkingDays, subWorkingDays } from "../src/lib/workdays";
import { nlHolidaySet } from "../src/lib/holidays";
import { CLIENT_LEAD_DAYS, EDITOR_LEAD_DAYS, internalDeadline, isFirstVersionPending } from "../src/lib/edit-deadline";

const H = nlHolidaySet();

describe("internalDeadline", () => {
  it("is 7 werkdagen na de opname (uit shootOn)", () => {
    const shoot = "2026-10-14"; // woensdag
    expect(internalDeadline(shoot, null, H)).toBe(addWorkingDays(shoot, EDITOR_LEAD_DAYS, H));
  });

  it("leidt dezelfde datum af uit de klantdeadline (opname + 14 → intern = deadline − 7)", () => {
    const shoot = "2026-10-14";
    const clientDue = addWorkingDays(shoot, CLIENT_LEAD_DAYS, H); // opname + 14 wd
    // Met shootOn én met alleen de klantdeadline moet dezelfde interne datum komen.
    const fromShoot = internalDeadline(shoot, clientDue, H);
    const fromDue = internalDeadline(null, clientDue, H);
    expect(fromShoot).toBe(addWorkingDays(shoot, EDITOR_LEAD_DAYS, H));
    expect(fromDue).toBe(subWorkingDays(clientDue, CLIENT_LEAD_DAYS - EDITOR_LEAD_DAYS, H));
    expect(fromDue).toBe(fromShoot);
  });

  it("de interne deadline ligt vóór de klantdeadline", () => {
    const shoot = "2026-10-14";
    const clientDue = addWorkingDays(shoot, CLIENT_LEAD_DAYS, H);
    const intern = internalDeadline(shoot, clientDue, H)!;
    expect(intern < clientDue).toBe(true);
  });

  it("geeft null zonder opname én zonder klantdeadline", () => {
    expect(internalDeadline(null, null, H)).toBeNull();
  });
});

describe("isFirstVersionPending", () => {
  it("true voor de eerste-versie-fases", () => {
    for (const s of ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"]) {
      expect(isFirstVersionPending(s)).toBe(true);
    }
  });
  it("false zodra de eerste versie is opgeleverd", () => {
    for (const s of ["internal_review", "client_review", "client_revision", "approved", "scheduled", "published"]) {
      expect(isFirstVersionPending(s)).toBe(false);
    }
  });
});
