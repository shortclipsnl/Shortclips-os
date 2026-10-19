import { describe, expect, it } from "vitest";
import { docToPlainText, toEditorDoc, videoEmbedUrl, type PMDoc } from "@/lib/kennisbank-doc";

const doc: PMDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Verantwoordelijke:" }, { type: "text", text: " Content Creative" }] },
    { type: "horizontalRule" },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Doel" }] },
    { type: "unorderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Monday." }] }] }] },
    { type: "paragraph", content: [{ type: "text", marks: [{ type: "videoTimestamp", attrs: { timestamp: "09:00" } }], text: "09:00" }] },
  ],
};

describe("kennisbank-doc", () => {
  it("haalt alle tekst letterlijk uit een les", () => {
    const t = docToPlainText(doc);
    expect(t).toContain("Verantwoordelijke: Content Creative");
    expect(t).toContain("Doel");
    expect(t).toContain("Monday.");
    expect(t).toContain("09:00");
  });

  it("zet voor de editor alleen namen om, nooit tekst", () => {
    const ed = toEditorDoc(doc);
    expect(JSON.stringify(ed)).toContain('"bulletList"');
    expect(JSON.stringify(ed)).not.toContain('"unorderedList"');
    expect(docToPlainText(ed)).toBe(docToPlainText(doc));
  });

  it("maakt van een Loom-link een embed", () => {
    expect(videoEmbedUrl("https://www.loom.com/share/91d2b0486b4f4a4cacd44bbc98e8337a")).toBe("https://www.loom.com/embed/91d2b0486b4f4a4cacd44bbc98e8337a");
    expect(videoEmbedUrl("https://example.com/x")).toBeNull();
  });
});
