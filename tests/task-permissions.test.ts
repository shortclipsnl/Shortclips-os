import { describe, expect, it } from "vitest";
import { canModifyTask } from "@/lib/task-permissions";

const milou = { id: "milou", isOwner: false };
const jarno = { id: "jarno", isOwner: true };

describe("canModifyTask", () => {
  it("eigen taak mag je aanpassen", () => {
    expect(canModifyTask(milou, { assigneeId: "milou", createdById: "jarno" })).toBe(true);
  });
  it("taak van een collega is alleen-lezen", () => {
    expect(canModifyTask(milou, { assigneeId: "jiska", createdById: "jiska" })).toBe(false);
    expect(canModifyTask(milou, { assigneeId: "rutger", createdById: null })).toBe(false);
  });
  it("een taak die je zelf aan een collega gaf, mag je nog aanpassen", () => {
    expect(canModifyTask(milou, { assigneeId: "jiska", createdById: "milou" })).toBe(true);
  });
  it("niet toegewezen taken (verdelen onder team) mag iedereen oppakken", () => {
    expect(canModifyTask(milou, { assigneeId: null, createdById: "jarno" })).toBe(true);
  });
  it("de eigenaar mag alles aanpassen", () => {
    expect(canModifyTask(jarno, { assigneeId: "jiska", createdById: "jiska" })).toBe(true);
  });
});
