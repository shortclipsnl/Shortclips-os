import "server-only";
import { IntegrationError, type Provider } from "./types";

/**
 * Eén plek voor alle uitgaande API-aanroepen: time-out, nette fouten en
 * opnieuw proberen bij tijdelijke problemen. Elke adapter gebruikt dit, zodat
 * gedrag bij storingen overal hetzelfde is.
 */
export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  /** Query-parameters; undefined-waarden worden weggelaten. */
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Wordt aangeroepen bij een 401. Geeft nieuwe headers terug (bijv. met een
   * vers token) om het verzoek één keer opnieuw te doen, of null om te stoppen.
   */
  onUnauthorized?: () => Promise<Record<string, string> | null>;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Google Drive meldt limieten vaak als 403 met een reden in de body. */
export function isRateLimitBody(text: string): boolean {
  return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError/i.test(text);
}

/** Exponentiële backoff met spreiding, maximaal 32 seconden. */
export function backoffMs(attempt: number): number {
  return Math.min(32_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 500);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiFetch<T>(
  provider: Provider,
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 20000,
    retries = 2,
    query,
    onUnauthorized,
  } = options;
  let currentHeaders = headers;
  let reauthTried = false;

  const target = new URL(url);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) target.searchParams.set(key, String(value));
    }
  }

  let lastError: IntegrationError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(target, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...currentHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.status === 401 && onUnauthorized && !reauthTried) {
        reauthTried = true;
        const fresh = await onUnauthorized();
        if (fresh) {
          currentHeaders = { ...currentHeaders, ...fresh };
          attempt--; // telt niet als herhaalpoging
          continue;
        }
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable =
          RETRYABLE_STATUS.has(response.status) ||
          (response.status === 403 && isRateLimitBody(text));
        lastError = new IntegrationError(
          provider,
          `HTTP ${response.status} bij ${method} ${target.pathname}`,
          response.status,
          retryable,
          text.slice(0, 2000),
        );
        if (!retryable || attempt === retries) throw lastError;

        // Respecteer Retry-After wanneer die er is.
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoffMs(attempt),
        );
        continue;
      }

      if (response.status === 204) return undefined as T;
      const contentType = response.headers.get("content-type") ?? "";
      return (contentType.includes("json")
        ? await response.json()
        : await response.text()) as T;
    } catch (error) {
      if (error instanceof IntegrationError) {
        if (!error.retryable || attempt === retries) throw error;
        lastError = error;
      } else {
        const aborted = error instanceof Error && error.name === "AbortError";
        lastError = new IntegrationError(
          provider,
          aborted ? "Time-out bij het externe systeem" : String(error),
          undefined,
          true,
        );
        if (attempt === retries) throw lastError;
        await sleep(backoffMs(attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new IntegrationError(provider, "Onbekende fout");
}
