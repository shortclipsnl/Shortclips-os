import "server-only";
import { env } from "@/lib/env";
import { IntegrationError, MissingCredentialsError, type Provider } from "./types";
import { backoffMs, isRateLimitBody } from "./http";
import {
  mergeGoogleTokenMeta,
  saveRefreshToken,
  setGoogleAuthState,
  storedRefreshToken,
} from "./google-connection";

/**
 * Centraal Google-tokenbeheer voor Drive, Agenda en Gmail.
 *
 * Voorheen had elke koppeling een eigen kopie van deze logica. Gevolg: drie
 * keer token vernieuwen, geen onderscheid tussen "tijdelijk mis" en "Google
 * wil opnieuw toestemming", en de foutreden van Google ging verloren.
 *
 * Nu:
 *  - één access-token per serverinstantie, ruim (5 min) vóór verlopen vernieuwd;
 *  - gelijktijdige aanvragen wachten op dezelfde vernieuwing (geen race);
 *  - tijdelijke fouten (netwerk, 5xx, 429) worden met backoff herhaald;
 *  - `invalid_grant` = toestemming echt weg → status "reauth_required", één
 *    duidelijke melding, géén eindeloze herhaalpogingen;
 *  - als Google een nieuw refresh-token meestuurt, wordt dat versleuteld
 *    opgeslagen (rotatie), zodat geen enkel proces een oud token blijft gebruiken.
 */

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Alle scopes die ShortClips OS nodig heeft. Eén toestemming dekt alles. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export class GoogleReauthRequiredError extends IntegrationError {
  constructor(provider: Provider, public reason: string) {
    super(provider, `Google vraagt opnieuw toestemming (${reason})`, 401, false);
    this.name = "GoogleReauthRequiredError";
  }
  get userMessage(): string {
    return "Google vraagt opnieuw toestemming voor de koppeling. Gebruik 'Opnieuw verbinden' op de pagina Koppelingen.";
  }
}

type FetchLike = typeof fetch;

export type GoogleAuthDeps = {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  envRefreshToken: () => string | undefined;
  loadStoredRefreshToken: () => Promise<string | null>;
  onRotated: (refreshToken: string) => Promise<void>;
  onAuthOk: (scope: string | undefined) => Promise<void>;
  onReauthRequired: (reason: string) => Promise<void>;
  onConfigError: (reason: string) => Promise<void>;
};

const defaultDeps: GoogleAuthDeps = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  clientId: () => env.GOOGLE_CLIENT_ID,
  clientSecret: () => env.GOOGLE_CLIENT_SECRET,
  envRefreshToken: () => env.GOOGLE_REFRESH_TOKEN,
  loadStoredRefreshToken: () => storedRefreshToken().catch(() => null),
  onRotated: (rt) => saveRefreshToken(rt, "rotation"),
  onAuthOk: async (scope) => {
    await setGoogleAuthState("ok");
    await mergeGoogleTokenMeta({ lastRefreshAt: new Date().toISOString(), ...(scope ? { scopes: scope } : {}) });
  },
  onReauthRequired: (reason) =>
    setGoogleAuthState(
      "reauth_required",
      `Google heeft de toestemming ingetrokken of laten verlopen (${reason}). Verbind opnieuw via Koppelingen.`,
    ),
  onConfigError: (reason) =>
    setGoogleAuthState("config_error", `De Google OAuth-configuratie klopt niet (${reason}). Controleer client-ID en secret.`),
};

/** Ververs zo lang vóór verlopen, zodat een token nooit halverwege een run verloopt. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Hoe lang een opgehaald refresh-token uit de database in het geheugen blijft. */
const STORED_TOKEN_TTL_MS = 5 * 60_000;
/** Na een `invalid_grant` niet elke aanroep opnieuw bij Google aankloppen. */
const REAUTH_COOLDOWN_MS = 10 * 60_000;

export class GoogleAuth {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;
  private stored: { token: string | null; loadedAt: number } | null = null;
  private reauthUntil = 0;
  private reauthReason = "";
  /** Laatst werkende refresh-token; gaat vóór, ook als opslaan ooit mislukte. */
  private lastGood: string | null = null;

  constructor(private deps: GoogleAuthDeps = defaultDeps) {}

  get isConfigured(): boolean {
    return Boolean(this.deps.clientId() && this.deps.clientSecret() && this.deps.envRefreshToken());
  }

  /** Vergeet het access-token (bijv. na een 401), zodat de volgende aanroep vernieuwt. */
  invalidate() {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  /** Na opnieuw verbinden: direct het nieuwe refresh-token gebruiken. */
  reset() {
    this.invalidate();
    this.stored = null;
    this.lastGood = null;
    this.reauthUntil = 0;
  }

  async getAccessToken(provider: Provider = "google_drive"): Promise<string> {
    if (!this.deps.clientId() || !this.deps.clientSecret()) {
      throw new MissingCredentialsError(provider, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]);
    }
    if (this.accessToken && this.deps.now() < this.expiresAt - REFRESH_MARGIN_MS) return this.accessToken;
    if (this.deps.now() < this.reauthUntil) throw new GoogleReauthRequiredError(provider, this.reauthReason);
    if (!this.inflight) {
      this.inflight = this.refresh(provider).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async candidateTokens(): Promise<string[]> {
    const now = this.deps.now();
    if (!this.stored || now - this.stored.loadedAt > STORED_TOKEN_TTL_MS) {
      this.stored = { token: await this.deps.loadStoredRefreshToken(), loadedAt: now };
    }
    const list = [this.lastGood, this.stored.token, this.deps.envRefreshToken()].filter((t): t is string => Boolean(t));
    return [...new Set(list)];
  }

  private async refresh(provider: Provider): Promise<string> {
    const candidates = await this.candidateTokens();
    if (candidates.length === 0) {
      throw new MissingCredentialsError(provider, ["GOOGLE_REFRESH_TOKEN"]);
    }

    let lastGrantError = "";
    for (const refreshToken of candidates) {
      const result = await this.exchange(provider, refreshToken);
      if (result.kind === "ok") {
        this.accessToken = result.accessToken;
        this.expiresAt = this.deps.now() + result.expiresIn * 1000;
        this.reauthUntil = 0;
        this.lastGood = result.newRefreshToken ?? refreshToken;
        if (result.newRefreshToken && result.newRefreshToken !== refreshToken) {
          await this.deps.onRotated(result.newRefreshToken).catch(() => {});
          this.stored = { token: result.newRefreshToken, loadedAt: this.deps.now() };
        }
        await this.deps.onAuthOk(result.scope).catch(() => {});
        return result.accessToken;
      }
      if (result.kind === "invalid_grant") {
        if (this.lastGood === refreshToken) this.lastGood = null;
        // Probeer het volgende token (bijv. database-token verlopen, env-token nieuw).
        lastGrantError = result.reason;
        continue;
      }
      if (result.kind === "config") {
        await this.deps.onConfigError(result.reason).catch(() => {});
        throw new IntegrationError(provider, `Google OAuth-configuratie ongeldig (${result.reason})`, 401, false);
      }
    }

    this.reauthUntil = this.deps.now() + REAUTH_COOLDOWN_MS;
    this.reauthReason = lastGrantError || "invalid_grant";
    await this.deps.onReauthRequired(this.reauthReason).catch(() => {});
    throw new GoogleReauthRequiredError(provider, this.reauthReason);
  }

  /** Eén token-uitwisseling, met herhaling bij tijdelijke fouten. */
  private async exchange(
    provider: Provider,
    refreshToken: string,
  ): Promise<
    | { kind: "ok"; accessToken: string; expiresIn: number; scope?: string; newRefreshToken?: string }
    | { kind: "invalid_grant"; reason: string }
    | { kind: "config"; reason: string }
  > {
    const attempts = 4;
    let lastError: IntegrationError | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await this.deps.sleep(Math.min(8000, 2 ** attempt * 500) + Math.floor(Math.random() * 250));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await this.deps.fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: this.deps.clientId()!,
            client_secret: this.deps.clientSecret()!,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          expires_in?: number;
          scope?: string;
          refresh_token?: string;
          error?: string;
          error_description?: string;
        };
        if (res.ok && body.access_token) {
          return {
            kind: "ok",
            accessToken: body.access_token,
            expiresIn: body.expires_in ?? 3600,
            scope: body.scope,
            newRefreshToken: body.refresh_token,
          };
        }
        // Alleen de foutcode van Google bewaren, nooit tokens of secrets.
        const reason = body.error ?? `HTTP ${res.status}`;
        if (body.error === "invalid_grant") return { kind: "invalid_grant", reason };
        if (body.error === "invalid_client" || body.error === "unauthorized_client") {
          return { kind: "config", reason };
        }
        lastError = new IntegrationError(provider, `Token vernieuwen mislukt (${reason})`, res.status, res.status >= 500 || res.status === 429);
        if (!lastError.retryable) throw lastError;
      } catch (error) {
        if (error instanceof IntegrationError && !error.retryable) throw error;
        lastError =
          error instanceof IntegrationError
            ? error
            : new IntegrationError(provider, "Google tijdelijk niet bereikbaar bij token vernieuwen", undefined, true);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new IntegrationError(provider, "Token vernieuwen mislukt", undefined, true);
  }
}

/** De ene gedeelde instantie voor het hele platform. */
export const googleAuth = new GoogleAuth();

/**
 * Fetch met Google-authenticatie voor ruwe aanroepen (downloaden, uploaden,
 * exporteren). Vernieuwt het token één keer bij een 401 en herhaalt tijdelijke
 * fouten en limieten met backoff.
 */
export async function googleFetch(
  provider: Provider,
  url: string,
  init: RequestInit = {},
  options: { retries?: number; auth?: GoogleAuth } = {},
): Promise<Response> {
  const auth = options.auth ?? googleAuth;
  const retries = options.retries ?? 4;
  let refreshedAfter401 = false;
  for (let attempt = 0; ; attempt++) {
    const token = await auth.getAccessToken(provider);
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401 && !refreshedAfter401) {
      refreshedAfter401 = true;
      auth.invalidate();
      continue;
    }
    if (attempt < retries && (await isRetryableResponse(res))) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) =>
        setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt)),
      );
      continue;
    }
    return res;
  }
}

/** 429/5xx, of een 403 die eigenlijk een Drive-limiet is. */
export async function isRetryableResponse(res: Response): Promise<boolean> {
  if ([408, 425, 429, 500, 502, 503, 504].includes(res.status)) return true;
  if (res.status === 403) {
    const text = await res.clone().text().catch(() => "");
    return isRateLimitBody(text);
  }
  return false;
}
