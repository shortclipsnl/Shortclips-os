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
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

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
  } = options;

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
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable = RETRYABLE_STATUS.has(response.status);
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
            : 2 ** attempt * 500,
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
        await sleep(2 ** attempt * 500);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new IntegrationError(provider, "Onbekende fout");
}
