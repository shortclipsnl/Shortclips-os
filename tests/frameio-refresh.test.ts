import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";

/** Frame.io: het door Adobe vernieuwde refresh-token wordt bewaard en daarna gebruikt. */
beforeAll(async () => { await freshDatabase(); }, 180000);
afterAll(async () => { await closeDatabase(); vi.unstubAllGlobals(); });

describe("Frame.io refresh-token rotatie", () => {
  it("bewaart het nieuwe refresh-token en gebruikt het bij de volgende vernieuwing", async () => {
    const sent: string[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
      sent.push(new URLSearchParams(init.body).get("refresh_token") ?? "");
      n++;
      return new Response(JSON.stringify({ access_token: `a${n}`, expires_in: 1, refresh_token: `r${n + 1}` }), { status: 200 });
    }));
    const { FrameService, FRAMEIO_REFRESH_KEY } = await import("@/server/integrations/frameio");
    const { getStringSetting } = await import("@/server/app-settings");
    const svc = new FrameService(undefined, "acc", "cid", "secret", "r1") as unknown as { token(): Promise<string> };
    expect(await svc.token()).toBe("a1");
    expect(await getStringSetting(FRAMEIO_REFRESH_KEY, "")).toBe("r2");
    expect(await svc.token()).toBe("a2"); // expires_in 1 s: direct opnieuw vernieuwen
    expect(sent).toEqual(["r1", "r2"]);
    expect(await getStringSetting(FRAMEIO_REFRESH_KEY, "")).toBe("r3");
  });
});
