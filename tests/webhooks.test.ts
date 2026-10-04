import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { payloadHash, verifyHmac } from "@/server/webhooks";

describe("webhook-handtekeningen", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ event: "asset.approved", id: "abc" });

  it("accepteert een geldige handtekening", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmac(body, signature, secret)).toBe(true);
    expect(verifyHmac(body, `sha256=${signature}`, secret)).toBe(true);
  });

  it("weigert een gemanipuleerde payload", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmac(body + " ", signature, secret)).toBe(false);
  });

  it("weigert een verkeerd secret", () => {
    const signature = createHmac("sha256", "ander-secret").update(body).digest("hex");
    expect(verifyHmac(body, signature, secret)).toBe(false);
  });

  it("geeft 'onbekend' terug wanneer er geen secret is ingesteld", () => {
    // Bewust null en niet true: zonder secret kunnen we niets vaststellen.
    expect(verifyHmac(body, "van-alles", undefined)).toBe(null);
  });

  it("weigert een ontbrekende handtekening als er wél een secret is", () => {
    expect(verifyHmac(body, null, secret)).toBe(false);
  });
});

describe("payload-hash", () => {
  it("is stabiel voor dezelfde inhoud", () => {
    expect(payloadHash("a")).toBe(payloadHash("a"));
  });

  it("verschilt bij andere inhoud", () => {
    expect(payloadHash("a")).not.toBe(payloadHash("b"));
  });
});
