import { describe, expect, it } from "vitest";
import { NAVIGATION, matchNavHref } from "@/components/layout/nav-config";

const all = NAVIGATION.flatMap((g) => g.items);
const team = NAVIGATION.find((g) => g.title === "Team")!;

describe("Editor Meetings onder Editing", () => {
  it("staat niet meer als los menu-item onder Team", () => {
    expect(team.items.some((i) => i.href === "/editor-meetings")).toBe(false);
  });

  it("houdt voor het team Editing actief in het menu op het meetingoverzicht en een meeting", () => {
    const teamItems = all.filter((i) => !i.editorsOnly);
    expect(matchNavHref(teamItems, "/editor-meetings")).toBe("/videos");
    expect(matchNavHref(teamItems, "/editor-meetings/abc")).toBe("/videos");
    expect(matchNavHref(teamItems, "/videos")).toBe("/videos");
  });

  it("laat het eigen menu-item van editors ongemoeid en actief", () => {
    const editorItem = all.find((i) => i.href === "/editor-meetings" && i.editorsOnly);
    expect(editorItem).toBeDefined();
    expect(matchNavHref(all, "/editor-meetings")).toBe("/editor-meetings");
  });
});
