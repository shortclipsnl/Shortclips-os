import { describe, expect, it } from "vitest";
import { deriveClientRoadmap, deriveSession, type ClientInput, type SessionInput } from "@/lib/client-roadmap";

// Dinsdag 10 november 2026 als vaste "vandaag".
const TODAY = "2026-11-10";

function client(over: Partial<ClientInput> = {}): ClientInput {
  return {
    clientStatus: "active",
    weHandlePosting: true,
    today: TODAY,
    feedbackDaysScripts: 3,
    feedbackDaysVideos: 3,
    deliveryWorkdays: 14,
    holidays: new Set(),
    nextPlannedOn: null,
    plannedCount: 0,
    lastConfirmedOn: null,
    confirmedLast30: 0,
    ...over,
  };
}

function session(over: Partial<SessionInput> = {}): SessionInput {
  return {
    id: over.id ?? "s1",
    shootOn: "2026-11-20",
    startTime: "09:00:00",
    locationName: "Sneek",
    dayStatus: "planned",
    scriptingStatus: "concepting",
    scriptReview: null,
    edit: null,
    videoCount: 0,
    frameSessionKey: null,
    ...over,
  };
}

const edit = (status: string, changed: string, dueOn: string | null = null, dueOnSource = "auto") => ({
  status,
  statusChangedAt: `${changed}T09:00:00.000Z`,
  dueOn,
  dueOnSource,
});

describe("klantroadmap — de 14 uitzonderingen uit de opdracht", () => {
  it("1. nieuwe klant zonder geplande opnamedag: rustige tekst, geen actie, intern signaal", () => {
    const r = deriveClientRoadmap([], client());
    expect(r.next.headline).toBe("Er staat nog geen nieuwe opnamedag gepland");
    expect(r.next.action).toBeNull();
    expect(r.next.deadline).toBeNull();
    expect(r.sessions).toHaveLength(0);
    expect(r.issues.some((i) => i.message.includes("zonder lopende of geplande"))).toBe(true);
  });

  it("2. scripts wachten op goedkeuring: oranje hoofdactie met knop en termijn in werkdagen", () => {
    const r = deriveClientRoadmap(
      [session({ scriptReview: { id: "rv1", status: "klaar_controle", feedbackDeadline: null, sentAt: "2026-11-06T10:00:00.000Z" } })],
      client(),
    );
    expect(r.next.tone).toBe("orange");
    expect(r.next.headline).toBe("Je scripts staan klaar!");
    expect(r.next.action).toEqual({ label: "Bekijk scripts", href: "/portal/scripts/rv1" });
    // Vrijdag 6 nov + 3 werkdagen = woensdag 11 nov (weekend telt niet).
    expect(r.next.deadline).toBe("2026-11-11");
    expect(r.sessions[0]!.steps[0]!.state).toBe("action");
  });

  it("2b. scripttermijn verstreken wordt rood, met dezelfde knop", () => {
    const r = deriveClientRoadmap(
      [session({ scriptReview: { id: "rv1", status: "opnieuw_controle", feedbackDeadline: "2026-11-09T16:00:00.000Z", sentAt: null } })],
      client(),
    );
    expect(r.next.tone).toBe("red");
    expect(r.next.action?.href).toBe("/portal/scripts/rv1");
  });

  it("3. klant heeft feedback op scripts gegeven: blauw, Shortclips verwerkt het, geen actie", () => {
    const r = deriveClientRoadmap([session({ scriptReview: { id: "rv1", status: "feedback_gegeven", feedbackDeadline: null, sentAt: null } })], client());
    expect(r.next.tone).toBe("blue");
    expect(r.next.headline).toBe("We verwerken je feedback op de scripts");
    expect(r.next.action).toBeNull();
  });

  it("3b. klant heeft feedback op video's gegeven: blauw 'we verwerken je feedback'", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-10-20", scriptingStatus: "final", edit: edit("client_revision", "2026-11-05") })], client());
    expect(r.next.headline).toBe("We verwerken je feedback");
    expect(r.sessions[0]!.current).toBe("feedback");
    expect(r.sessions[0]!.state).toBe("active");
  });

  it("4. vertraagde montage: geen verlopen datum naar de klant, wel escalatie intern", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-10-01", scriptingStatus: "final", edit: edit("editing", "2026-10-02", "2026-10-21") })], client());
    expect(r.next.headline).toBe("We zijn je video's aan het monteren");
    expect(r.next.detail).toContain("iets langer");
    expect(r.next.expectedOn).toBeNull();
    expect(r.issues.some((i) => i.severity === "escalate" && i.message.includes("klantoplevering"))).toBe(true);
  });

  it("4b. montage op schema: verwachte oplevering = opname + 14 werkdagen", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-11-05", scriptingStatus: "final", edit: edit("editing", "2026-11-06", "2026-11-25") })], client());
    expect(r.next.tone).toBe("blue");
    // do 5 nov + 14 werkdagen = di 25 nov
    expect(r.next.expectedOn).toBe("2026-11-25");
  });

  it("5. meerdere actieve sessies: één hoofdactie, overige klantacties apart, elke sessie eigen status", () => {
    const r = deriveClientRoadmap(
      [
        session({ id: "oud", shootOn: "2026-10-27", scriptingStatus: "final", edit: edit("editing", "2026-10-28"), videoCount: 6 }),
        session({ id: "fb", shootOn: "2026-10-20", scriptingStatus: "final", edit: edit("client_review", "2026-11-09"), videoCount: 4, frameSessionKey: "F1" }),
        session({ id: "nieuw", shootOn: "2026-11-24", scriptReview: { id: "rv2", status: "klaar_controle", feedbackDeadline: null, sentAt: "2026-11-09T10:00:00.000Z" } }),
      ],
      client(),
    );
    expect(r.next.headline).toBe("Er staan 4 video's klaar voor jouw feedback");
    expect(r.next.action?.href).toBe("/portal/videos?sessie=F1");
    expect(r.alsoForYou.map((a) => a.headline)).toEqual(["Je scripts staan klaar!"]);
    const byId = Object.fromEntries(r.sessions.map((s) => [s.id, s.current]));
    expect(byId).toEqual({ oud: "montage", fb: "feedback", nieuw: "scripts" });
  });

  it("6. klant publiceert zelf: laatste stap heet 'Klaar om te plaatsen', geen planning", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-10-27", scriptingStatus: "final", edit: edit("approved", "2026-11-06") })], client({ weHandlePosting: false }));
    const s = r.sessions[0]!;
    expect(s.steps.at(-1)).toEqual({ key: "klaar", label: "Klaar om te plaatsen", state: "done" });
    expect(s.detail).toBe("Ze staan klaar om te plaatsen.");
    expect(r.publication?.mode).toBe("self");
    expect(r.next.headline).toBe("Alles verloopt volgens planning");
  });

  it("7. Shortclips publiceert: gepland en bevestigd online blijven gescheiden", () => {
    const r = deriveClientRoadmap(
      [session({ shootOn: "2026-10-27", scriptingStatus: "final", edit: edit("approved", "2026-11-06") })],
      client({ nextPlannedOn: "2026-11-12", plannedCount: 4, lastConfirmedOn: null }),
    );
    expect(r.publication).toMatchObject({ mode: "shortclips", nextPlannedOn: "2026-11-12", lastConfirmedOn: null });
    expect(r.sessions[0]!.detail).toContain("contentplanning");
  });

  it("7b. goedgekeurd zonder gedeelde planning → intern signaal", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-10-27", scriptingStatus: "final", edit: edit("approved", "2026-11-06") })], client());
    expect(r.issues.some((i) => i.message.includes("contentplanning"))).toBe(true);
  });

  it("8. ontbrekende deadlinegegevens: geen verzonnen datum", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-11-05", scriptingStatus: "final", edit: null })], client());
    expect(r.next.headline).toBe("We zijn je video's aan het monteren");
    expect(r.next.expectedOn).toBeNull();
    expect(r.issues.some((i) => i.message.includes("geen editingproject"))).toBe(true);
  });

  it("9. geen nieuwe sessie in de planning: afgeronde sessie + rustige status, intern signaal", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-10-27", scriptingStatus: "final", edit: edit("approved", "2026-11-06") })], client({ nextPlannedOn: "2026-11-12" }));
    expect(r.next.tone).toBe("green");
    expect(r.issues.some((i) => i.message.includes("geen volgende opnamedag"))).toBe(true);
  });

  it("10. contract niet meer actief: geen tijdlijn, geen acties", () => {
    const churned = deriveClientRoadmap([session({ scriptReview: { id: "x", status: "klaar_controle", feedbackDeadline: null, sentAt: null } })], client({ clientStatus: "churned" }));
    expect(churned.inactive).toBe(true);
    expect(churned.sessions).toHaveLength(0);
    expect(churned.next.action).toBeNull();
    const paused = deriveClientRoadmap([], client({ clientStatus: "paused" }));
    expect(paused.next.headline).toBe("Je samenwerking staat op pauze");
  });

  it("11. externe koppeling tijdelijk weg (Frame leeg) bij 'bij klant': geen getal, wel signaal", () => {
    const r = deriveClientRoadmap([session({ shootOn: "2026-10-27", scriptingStatus: "final", edit: edit("client_review", "2026-11-09"), videoCount: 0 })], client());
    expect(r.next.headline).toBe("Je video's staan klaar voor jouw feedback");
    expect(r.next.action?.href).toBe("/portal/videos");
    expect(r.issues.some((i) => i.message.includes("Frame.io"))).toBe(true);
  });

  it("12. teruggedraaide status: afleiding volgt de huidige data, geen geheugen", () => {
    const base = session({ shootOn: "2026-10-27", scriptingStatus: "final", videoCount: 3 });
    const voor = deriveSession({ ...base, edit: edit("client_review", "2026-11-09") }, client())!;
    const terug = deriveSession({ ...base, edit: edit("internal_review", "2026-11-10") }, client())!;
    expect(voor.current).toBe("feedback");
    expect(terug.current).toBe("montage");
    expect(terug.action).toBeNull();
  });

  it("13. opnamedag verplaatst: automatische deadline schuift mee, handmatige blijft staan", () => {
    const moved = deriveSession(session({ shootOn: "2026-11-03", scriptingStatus: "final", edit: edit("editing", "2026-11-04", "2026-11-18", "auto") }), client())!;
    expect(moved.expectedOn).toBe("2026-11-23"); // di 3 nov + 14 werkdagen, niet de oude dueOn
    const manual = deriveSession(session({ shootOn: "2026-11-03", scriptingStatus: "final", edit: edit("editing", "2026-11-04", "2026-11-27", "manual") }), client())!;
    expect(manual.expectedOn).toBe("2026-11-27");
    const cancelled = deriveSession(session({ dayStatus: "cancelled" }), client());
    expect(cancelled).toBeNull();
  });

  it("14. video na goedkeuring opnieuw aangepast: sessie komt terug uit 'klaar'", () => {
    const s = deriveSession(session({ shootOn: "2026-10-20", scriptingStatus: "final", edit: edit("client_revision", "2026-11-10") }), client())!;
    expect(s.steps.at(-1)!.state).toBe("future");
    expect(s.current).toBe("feedback");
    expect(s.archived).toBe(false);
  });
});

describe("klantroadmap — prioriteit en archief", () => {
  it("opnamedag binnen 7 dagen wint van montage elders", () => {
    const r = deriveClientRoadmap(
      [
        session({ id: "m", shootOn: "2026-11-02", scriptingStatus: "final", edit: edit("editing", "2026-11-03") }),
        session({ id: "o", shootOn: "2026-11-13", scriptingStatus: "final" }),
      ],
      client(),
    );
    expect(r.next.headline).toBe("Je volgende opnamedag staat gepland op vrijdag 13 november");
    expect(r.next.action?.label).toBe("Bekijk opnamedag");
  });

  it("verstreken videofeedback (rood) gaat boven alles", () => {
    const r = deriveClientRoadmap(
      [
        session({ id: "a", shootOn: "2026-11-11" }),
        session({ id: "b", shootOn: "2026-10-01", scriptingStatus: "final", edit: edit("client_review", "2026-11-02"), videoCount: 5 }),
      ],
      client(),
    );
    expect(r.next.tone).toBe("red");
    expect(r.issues.some((i) => i.severity === "escalate")).toBe(true);
  });

  it("afgeronde sessie gaat na 14 dagen naar het archief; oude 'in productie' wordt verborgen", () => {
    const r = deriveClientRoadmap(
      [
        session({ id: "klaar", shootOn: "2026-09-20", scriptingStatus: "final", edit: edit("approved", "2026-10-01") }),
        session({ id: "stale", shootOn: "2026-09-01", scriptingStatus: "final", edit: edit("editing", "2026-09-02") }),
      ],
      client(),
    );
    expect(r.sessions).toHaveLength(0);
    expect(r.archivedCount).toBe(2);
  });

  it("scripts buiten het portaal verstuurd: oranje zonder dode knop", () => {
    const r = deriveClientRoadmap([session({ scriptingStatus: "scripts_bij_klant" })], client());
    expect(r.next.tone).toBe("orange");
    expect(r.next.action?.href).toBe("/portal/contact");
  });

  it("een klant ziet nooit twee hoofdacties tegelijk", () => {
    const r = deriveClientRoadmap(
      [
        session({ id: "1", shootOn: "2026-10-20", scriptingStatus: "final", edit: edit("client_review", "2026-11-09"), videoCount: 2 }),
        session({ id: "2", shootOn: "2026-10-22", scriptingStatus: "final", edit: edit("client_review", "2026-11-10"), videoCount: 3 }),
      ],
      client(),
    );
    expect(r.next.sessionId).toBe("1"); // vroegste termijn eerst
    expect(r.alsoForYou).toHaveLength(1);
  });
});
