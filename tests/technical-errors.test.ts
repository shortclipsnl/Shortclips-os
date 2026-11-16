import { describe, expect, it } from "vitest";
import { errorForViewer, isTechnicalError, TEAM_TECH_ERROR } from "@/lib/team-error";
import { describeIssue, normalizeIssueMessage, systemFor } from "@/lib/technical-issues";

describe("errorForViewer: technische fouten alleen voor de eigenaar", () => {
  const technisch = [
    "Google vraagt opnieuw toestemming (invalid_grant)",
    "HTTP 404 bij GET /calendar/v3/calendars/abc/events",
    "Token vernieuwen mislukt (HTTP 400)",
    'Failed query: insert into "editor_awards"',
    "Het AI-tegoed (Anthropic) is op. Vul het tegoed aan in console.anthropic.com",
    "PandaDoc is nog niet gekoppeld: PANDADOC_API_KEY ontbreekt.",
    "TypeError: Cannot read properties of undefined (reading 'id')",
  ];
  it("de eigenaar ziet de volledige fout", () => {
    for (const m of technisch) expect(errorForViewer(true, m)).toBe(m);
  });
  it("medewerkers krijgen een korte melding zonder details", () => {
    for (const m of technisch) {
      expect(isTechnicalError(m)).toBe(true);
      expect(errorForViewer(false, m)).toBe(TEAM_TECH_ERROR);
    }
  });
  it("begrijpelijke inhoudelijke meldingen blijven zichtbaar", () => {
    for (const m of [
      "Geen captions herkend in de PDF.",
      "Geen resultaten in deze maand om te analyseren.",
      "Niet gegenereerd: de klant staat op niet actief. Zet de klant weer op actief of start het rapport handmatig.",
    ]) {
      expect(errorForViewer(false, m)).toBe(m);
    }
  });
  it("geen fout = geen melding", () => {
    expect(errorForViewer(false, null)).toBeNull();
    expect(errorForViewer(true, "")).toBeNull();
  });
});

describe("technische meldingen voor het beheerdersoverzicht", () => {
  it("herkent de koppeling", () => {
    expect(systemFor("google_drive:drive.reconcile_client")).toBe("Google Drive");
    expect(systemFor("google_calendar:calendar.sync")).toBe("Google Agenda");
    expect(systemFor("system:pandadoc.sync")).toBe("PandaDoc");
    expect(systemFor("taak:captions")).toBe("Caption Maker");
    expect(systemFor("portaal:render")).toBe("Portaal");
    expect(systemFor(null)).toBe("Portaal");
  });
  it("geeft bij een verlopen Google-toestemming de echte oplossing", () => {
    const d = describeIssue("google_drive:drive.reconcile_client", "Google vraagt opnieuw toestemming (invalid_grant)");
    expect(d.needsOwner).toBe(true);
    expect(d.action).toContain("In production");
    expect(d.action).toContain("opnieuw");
  });
  it("tijdelijke storingen vragen geen actie", () => {
    expect(describeIssue("frameio:frameio.sync_library", "HTTP 503 bij GET /v4/me").needsOwner).toBe(false);
  });
  it("uitgefaseerde Monday-taken vragen geen actie", () => {
    expect(describeIssue("monday:monday.import_tasks", "Ontbrekende configuratie: MONDAY_API_TOKEN").needsOwner).toBe(false);
  });
  it("voegt dezelfde fout met andere id's samen", () => {
    expect(normalizeIssueMessage("Rij 3f2b1c4d-1111-2222-3333-444455556666 mislukt na 12345 ms")).toBe(
      normalizeIssueMessage("Rij aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee mislukt na 67890 ms"),
    );
  });
});
