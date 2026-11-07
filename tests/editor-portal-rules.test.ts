import { describe, expect, it } from "vitest";
import { addWorkingDays, subWorkingDays } from "../src/lib/workdays";
import { nlHolidaySet } from "../src/lib/holidays";
import { EDITOR_BUFFER_DAYS, EDITOR_LEAD_DAYS, editorDeadline } from "../src/lib/edit-deadline";
import { editorMayOpenPath } from "../src/lib/editor-routes";
import { clientActivity, isActiveClientStatus } from "../src/lib/client-status";

const H = nlHolidaySet();

describe("editorDeadline", () => {
  const shoot = "2026-11-11"; // woensdag
  const clientDue = addWorkingDays(shoot, 14, H);

  it("eerste versie: opname + 7 werkdagen, nooit de klantdeadline", () => {
    for (const st of ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"]) {
      const d = editorDeadline(st, shoot, clientDue, H);
      expect(d).toBe(addWorkingDays(shoot, EDITOR_LEAD_DAYS, H));
      expect(d).not.toBe(clientDue);
    }
  });

  it("klantfeedback verwerken: klantdeadline min 2 werkdagen", () => {
    expect(editorDeadline("client_revision", shoot, clientDue, H)).toBe(subWorkingDays(clientDue, EDITOR_BUFFER_DAYS, H));
  });

  it("geen editor deadline als het werk bij Shortclips of de klant ligt of klaar is", () => {
    for (const st of ["internal_review", "client_review", "approved", "scheduled", "published"]) {
      expect(editorDeadline(st, shoot, clientDue, H)).toBeNull();
    }
  });

  it("een verplaatste opname schuift de editor deadline mee", () => {
    const moved = "2026-11-18";
    expect(editorDeadline("recorded", moved, clientDue, H)).toBe(addWorkingDays(moved, EDITOR_LEAD_DAYS, H));
  });
});

describe("editorMayOpenPath", () => {
  it("staat het eigen werk toe", () => {
    for (const p of ["/dashboard", "/videos", "/videos/abc", "/showcase", "/mijn-klanten", "/mijn-klanten/kkfh", "/scripts/123", "/notifications", "/account"]) {
      expect(editorMayOpenPath(p)).toBe(true);
    }
  });
  it("blokkeert beheerpagina's van Team Shortclips", () => {
    for (const p of ["/clients", "/clients/kkfh", "/klantenbeheer", "/productions/1", "/scripts", "/scripting", "/team", "/finance", "/editing", "/tasks", "/videosx"]) {
      expect(editorMayOpenPath(p)).toBe(false);
    }
  });
});

describe("klantstatus voor editors", () => {
  it("actief = actief of onboarding; gepauzeerd en gestopt = niet actief", () => {
    expect(isActiveClientStatus("active")).toBe(true);
    expect(isActiveClientStatus("onboarding")).toBe(true);
    expect(isActiveClientStatus("paused")).toBe(false);
    expect(isActiveClientStatus("churned")).toBe(false);
    expect(isActiveClientStatus(null)).toBe(false);
    expect(clientActivity("paused")).toBe("niet_actief");
  });
});
