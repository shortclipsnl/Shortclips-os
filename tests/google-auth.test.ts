import { describe, expect, it, vi } from "vitest";
import { GoogleAuth, GoogleReauthRequiredError, type GoogleAuthDeps } from "@/server/integrations/google-auth";
import { apiFetch } from "@/server/integrations/http";
import { IntegrationError } from "@/server/integrations/types";

/**
 * Tokenbeheer en foutafhandeling, zonder echte Google-aanroepen.
 * Scenario's uit de opdracht: access-token verloopt, refresh-token wordt
 * vernieuwd (rotatie), Google tijdelijk onbereikbaar, API-limiet, ingetrokken
 * toestemming, gelijktijdige processen.
 */

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeAuth(responses: Array<Response | Error>, overrides: Partial<GoogleAuthDeps> = {}) {
  let clock = 1_000_000;
  const calls: string[] = [];
  const events = { rotated: [] as string[], reauth: 0, ok: 0, config: 0 };
  const deps: GoogleAuthDeps = {
    fetch: (async (_url: unknown, init?: RequestInit) => {
      calls.push(String((init?.body as URLSearchParams).get("refresh_token")));
      const next = responses.shift();
      if (!next) throw new Error("geen respons meer");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
    now: () => clock,
    sleep: async () => {},
    clientId: () => "cid",
    clientSecret: () => "secret",
    envRefreshToken: () => "rt-env",
    loadStoredRefreshToken: async () => null,
    onRotated: async (rt) => {
      events.rotated.push(rt);
    },
    onAuthOk: async () => {
      events.ok++;
    },
    onReauthRequired: async () => {
      events.reauth++;
    },
    onConfigError: async () => {
      events.config++;
    },
    ...overrides,
  };
  const auth = new GoogleAuth(deps);
  return { auth, calls, events, advance: (ms: number) => (clock += ms) };
}

describe("Google-tokenbeheer", () => {
  it("1. vernieuwt een verlopen access-token automatisch, ruim vóór het verloopt", async () => {
    const { auth, calls, advance } = makeAuth([
      json(200, { access_token: "a1", expires_in: 3600 }),
      json(200, { access_token: "a2", expires_in: 3600 }),
    ]);
    expect(await auth.getAccessToken()).toBe("a1");
    advance(30 * 60_000);
    expect(await auth.getAccessToken()).toBe("a1"); // nog geldig: geen extra aanroep
    expect(calls).toHaveLength(1);
    advance(26 * 60_000); // binnen de 5-minutenmarge van verlopen
    expect(await auth.getAccessToken()).toBe("a2");
    expect(calls).toHaveLength(2);
  });

  it("2. slaat een nieuw refresh-token van Google op (rotatie) en gebruikt dat daarna", async () => {
    const { auth, events, calls, advance } = makeAuth([
      json(200, { access_token: "a1", expires_in: 3600, refresh_token: "rt-nieuw" }),
      json(200, { access_token: "a2", expires_in: 3600 }),
    ]);
    await auth.getAccessToken();
    expect(events.rotated).toEqual(["rt-nieuw"]);
    advance(60 * 60_000);
    await auth.getAccessToken();
    expect(calls).toEqual(["rt-env", "rt-nieuw"]);
  });

  it("10. gelijktijdige aanvragen delen één vernieuwing (geen race)", async () => {
    const { auth, calls } = makeAuth([json(200, { access_token: "a1", expires_in: 3600 })]);
    const tokens = await Promise.all(Array.from({ length: 10 }, () => auth.getAccessToken()));
    expect(new Set(tokens)).toEqual(new Set(["a1"]));
    expect(calls).toHaveLength(1);
  });

  it("3. Google tijdelijk onbereikbaar bij token vernieuwen: opnieuw proberen en herstellen", async () => {
    const { auth, calls } = makeAuth([
      new TypeError("fetch failed"),
      json(503, { error: "backend" }),
      json(200, { access_token: "a1", expires_in: 3600 }),
    ]);
    expect(await auth.getAccessToken()).toBe("a1");
    expect(calls).toHaveLength(3);
  });

  it("ingetrokken toestemming (invalid_grant): duidelijke fout, één registratie, geen gehamer", async () => {
    const { auth, events, calls } = makeAuth([json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })]);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(GoogleReauthRequiredError);
    expect(events.reauth).toBe(1);
    // Binnen de afkoelperiode niet opnieuw bij Google aankloppen.
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(GoogleReauthRequiredError);
    expect(calls).toHaveLength(1);
  });

  it("valt terug op het env-token als het opgeslagen token ongeldig is", async () => {
    const { auth, calls, events } = makeAuth(
      [json(400, { error: "invalid_grant" }), json(200, { access_token: "a1", expires_in: 3600 })],
      { loadStoredRefreshToken: async () => "rt-db" },
    );
    expect(await auth.getAccessToken()).toBe("a1");
    expect(calls).toEqual(["rt-db", "rt-env"]);
    expect(events.reauth).toBe(0);
  });

  it("verkeerde client-gegevens worden als configuratiefout herkend, niet als tijdelijk", async () => {
    const { auth, events } = makeAuth([json(401, { error: "invalid_client" })]);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(IntegrationError);
    expect(events.config).toBe(1);
  });
});

describe("API-aanroepen: limieten en verlopen tokens", () => {
  it("4. API-limiet (429 en Drive's 403 rateLimitExceeded) wordt met backoff opnieuw geprobeerd", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const responses = [
      new Response("{}", { status: 429, headers: { "retry-after": "1" } }),
      new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }), { status: 403 }),
      json(200, { ok: true }),
    ];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);
    const p = apiFetch<{ ok: boolean }>("google_drive", "https://example.test/x", { retries: 4 });
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
    vi.useRealTimers();
  });

  it("6. 403 zonder limiet (geen toegang tot map) wordt níet eindeloos herhaald", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ error: { errors: [{ reason: "insufficientFilePermissions" }] } }), { status: 403 }));
    await expect(apiFetch("google_drive", "https://example.test/x", { retries: 4 })).rejects.toMatchObject({ status: 403 });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("1b. access-token blijkt halverwege ongeldig (401): één keer vernieuwen en doorgaan", async () => {
    const responses = [new Response("{}", { status: 401 }), json(200, { ok: true })];
    const seen: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      seen.push((init?.headers as Record<string, string>).Authorization);
      return responses.shift()!;
    });
    const result = await apiFetch<{ ok: boolean }>("google_drive", "https://example.test/x", {
      headers: { Authorization: "Bearer oud" },
      onUnauthorized: async () => ({ Authorization: "Bearer nieuw" }),
    });
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual(["Bearer oud", "Bearer nieuw"]);
    spy.mockRestore();
  });
});
