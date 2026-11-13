import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  formatTimecode,
  framestampToMs,
  frameCommentText,
  isPortalFrameText,
  matchReplyParent,
  reviewSummary,
  secondsToFramestamp,
  videoReviewState,
  type ReviewInput,
} from "@/lib/video-review";

vi.mock("@/server/app-settings", () => ({ getStringSetting: vi.fn(), setStringSetting: vi.fn() }));
vi.mock("@/server/integrations/frameio", () => ({ frameio: { isConfigured: false } }));

const base: ReviewInput = { session: "feedback", deliverableStatus: "client_review", currentMediaFileId: "v2", approvedMediaFileIds: [], submitted: [] };

describe("videoReviewState", () => {
  it("wacht op beoordeling zolang de sessie bij de klant ligt", () => {
    expect(videoReviewState(base)).toEqual({ key: "wacht", canReview: true });
  });

  it("goedgekeurd geldt alleen voor de goedgekeurde versie", () => {
    expect(videoReviewState({ ...base, approvedMediaFileIds: ["v2"] }).key).toBe("goedgekeurd");
    // Goedkeuring van versie 1 telt niet voor de nieuwe versie 2.
    expect(videoReviewState({ ...base, approvedMediaFileIds: ["v1"] }).key).toBe("wacht");
  });

  it("feedback op de huidige versie → feedback ontvangen, daarna verwerken", () => {
    expect(videoReviewState({ ...base, deliverableStatus: "client_revision", session: "verwerken", submitted: [{ mediaFileId: "v2", completed: false }] }).key).toBe("feedback_ontvangen");
    expect(videoReviewState({ ...base, deliverableStatus: "editor_revision", session: "productie", submitted: [{ mediaFileId: "v2", completed: false }] }).key).toBe("feedback_verwerken");
    expect(videoReviewState({ ...base, deliverableStatus: "client_revision", session: "verwerken", submitted: [{ mediaFileId: "v2", completed: true }] }).key).toBe("feedback_verwerken");
  });

  it("feedback op een oudere versie + nieuwe versie bij de klant → opnieuw beoordelen", () => {
    const s = videoReviewState({ ...base, submitted: [{ mediaFileId: "v1", completed: true }] });
    expect(s).toEqual({ key: "opnieuw_beoordelen", canReview: true });
  });

  it("goedgekeurde of online sessie wordt niet opnieuw aangeboden", () => {
    expect(videoReviewState({ ...base, session: "goedgekeurd", deliverableStatus: "approved" })).toEqual({ key: "goedgekeurd", canReview: false });
    expect(videoReviewState({ ...base, session: "online", deliverableStatus: "published" }).canReview).toBe(false);
  });

  it("zonder gekoppeld editingproject: alleen bekijken, geen verzonnen status", () => {
    expect(videoReviewState({ ...base, session: null, deliverableStatus: null })).toEqual({ key: null, canReview: false });
    expect(videoReviewState({ ...base, session: "productie", deliverableStatus: "editing" })).toEqual({ key: null, canReview: false });
  });
});

describe("reviewSummary", () => {
  it("telt per status in vaste volgorde", () => {
    const s = reviewSummary(["goedgekeurd", "goedgekeurd", "goedgekeurd", "wacht", "wacht", "feedback_ontvangen", null]);
    expect(s.map((x) => x.label)).toEqual(["3 goedgekeurd", "2 wachten op beoordeling", "1 feedback ontvangen"]);
  });
});

describe("tijdcodes (Frame.io V4: framestempel = beeldnummer)", () => {
  it("rekent seconden om naar framestempels en terug", () => {
    // Echte Frame-opmerking: framestempel 295 bij 50 fps = 00:00:05:45.
    expect(framestampToMs(295, 50)).toBe(5900);
    expect(secondsToFramestamp(5.9, 50)).toBe(295);
    expect(secondsToFramestamp(18, 25)).toBe(450);
    expect(secondsToFramestamp(18, null)).toBe(450); // terugval 25 fps
    expect(secondsToFramestamp(18, 29.97)).toBe(539);
  });

  it("toont tijdcodes als m:ss", () => {
    expect(formatTimecode(18_000)).toBe("0:18");
    expect(formatTimecode(75_400)).toBe("1:15");
    expect(formatTimecode(null)).toBe("");
  });
});

describe("Frame.io-tekst", () => {
  it("is herkenbaar als klantfeedback en wordt niet terug-geïmporteerd", () => {
    const t = frameCommentText({ authorName: "Sanne", clientName: "KUBO", body: "Kunnen jullie hier een andere opname gebruiken?" });
    expect(t).toContain("Klantfeedback van Sanne (KUBO) via het Shortclips portaal:");
    expect(t.endsWith("Kunnen jullie hier een andere opname gebruiken?")).toBe(true);
    expect(isPortalFrameText(t)).toBe(true);
    expect(isPortalFrameText("Klopt, passen we aan")).toBe(false);
  });
});

describe("matchReplyParent", () => {
  const t0 = new Date("2026-11-13T10:00:00Z");
  const clientComments = [
    { id: "a", mediaFileId: "v2", timecodeMs: 18_000, createdAt: t0 },
    { id: "b", mediaFileId: "v2", timecodeMs: 40_000, createdAt: t0 },
  ];
  it("koppelt een teamreactie op dezelfde tijdcode", () => {
    expect(matchReplyParent({ mediaFileId: "v2", timecodeMs: 18_300, createdAt: new Date(t0.getTime() + 60_000) }, clientComments)?.id).toBe("a");
  });
  it("koppelt niet bij andere versie, ander moment of eerder geplaatst", () => {
    expect(matchReplyParent({ mediaFileId: "v1", timecodeMs: 18_000, createdAt: new Date(t0.getTime() + 60_000) }, clientComments)).toBeNull();
    expect(matchReplyParent({ mediaFileId: "v2", timecodeMs: 25_000, createdAt: new Date(t0.getTime() + 60_000) }, clientComments)).toBeNull();
    expect(matchReplyParent({ mediaFileId: "v2", timecodeMs: 18_000, createdAt: new Date(t0.getTime() - 60_000) }, clientComments)).toBeNull();
  });
});

describe("verifyFrameV4 (webhook-handtekening)", () => {
  it("accepteert alleen een geldige, recente v0-handtekening", async () => {
    const { verifyFrameV4 } = await import("@/server/integrations/frameio-webhook");
    const secret = "geheim";
    const body = JSON.stringify({ type: "comment.created", resource: { id: "c1", type: "comment" } });
    const ts = "1794570000";
    const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
    const now = 1794570000 * 1000 + 10_000;
    expect(verifyFrameV4(body, sig, ts, secret, now)).toBe(true);
    expect(verifyFrameV4(body + " ", sig, ts, secret, now)).toBe(false);
    expect(verifyFrameV4(body, sig, ts, "ander", now)).toBe(false);
    expect(verifyFrameV4(body, sig, ts, secret, now + 10 * 60_000)).toBe(false); // te oud
    expect(verifyFrameV4(body, null, ts, secret, now)).toBe(false);
    expect(verifyFrameV4(body, sig, ts, null, now)).toBeNull();
  });
});
