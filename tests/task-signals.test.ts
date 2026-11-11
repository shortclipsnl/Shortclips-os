import { describe, expect, it } from "vitest";
import { taskSignal } from "@/lib/task-signals";
import { isFeedbackReminderKey } from "@/lib/ops-control/plan";

describe("taskSignal", () => {
  it("feedbackherinnering uit de operationele controle wordt compact", () => {
    const s = taskSignal({
      title: "Donker Groep | Klant herinneren aan feedback",
      description: "Klant: Donker Groep\nVerantwoordelijke: Milou\nProbleem: Donker Groep #1 · 1 dag over deadline, wacht op klant\nActie: x",
      dedupeKey: "opscontrol:klantfeedback:te-laat-bij-klant:abc", entityType: "ops_control_item", clientName: "Donker Groep",
    });
    expect(s?.kind).toBe("feedback");
    expect(s?.title).toBe("Feedback herinneren | Donker Groep");
    expect(s?.meta).toBe("Donker Groep #1 · 1 dag over deadline");
  });
  it("feedbackronde-taak wordt ook een feedbackherinnering", () => {
    const s = taskSignal({ title: "Feedbackherinnering sturen: KKFH", description: "De feedbacktermijn van 3 werkdagen is verstreken. Er is nog geen feedback.", dedupeKey: "feedbackronde:1", entityType: "deliverable", clientName: null });
    expect(s?.title).toBe("Feedback herinneren | KKFH");
    expect(s?.meta).toBe("De feedbacktermijn van 3 werkdagen is verstreken");
  });
  it("maandcontrole wordt Maandrapportage | Maand", () => {
    const s = taskSignal({ title: "Maandrapportages controleren en afronden (oktober 2026)", description: "1 van 4 gecontroleerd, 3 nog te controleren.\nOpen: A", dedupeKey: "report_batch:2026-10:u1", entityType: "report_batch", clientName: null });
    expect(s?.kind).toBe("maandrapport");
    expect(s?.title).toBe("Maandrapportage | Oktober");
  });
  it("video versturen is geen feedbackherinnering", () => {
    expect(isFeedbackReminderKey("opscontrol:klantcommunicatie:video-klaar-maar-niet-verstuurd:x")).toBe(false);
    expect(taskSignal({ title: "Gewone taak", description: null, dedupeKey: null, entityType: null, clientName: null })).toBeNull();
  });
});
