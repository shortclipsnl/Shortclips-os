import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { storeRefreshToken } from "./frameio";

/**
 * 'Opnieuw verbinden' voor Frame.io (Adobe IMS, OAuth Web App) vanuit het
 * portaal zelf: de eigenaar logt in bij Adobe, de server wisselt de code om en
 * bewaart het refresh-token in app_settings. Geen terminal of Vercel nodig.
 */
export const FRAMEIO_STATE_COOKIE = "sc_frameio_oauth_state";
const SCOPES = "openid,email,profile,additional_info.roles,offline_access";

export function frameioRedirectUri(): string {
  return `${env.APP_URL.replace(/\/$/, "")}/api/integrations/frameio/callback`;
}

export function newFrameioState(): string {
  return randomBytes(24).toString("hex");
}

export function frameioStatesMatch(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function frameioConsentUrl(state: string): string | null {
  if (!env.FRAMEIO_CLIENT_ID) return null;
  const url = new URL(env.FRAMEIO_IMS_URL.replace("/token/v3", "/authorize/v2"));
  url.searchParams.set("client_id", env.FRAMEIO_CLIENT_ID);
  url.searchParams.set("redirect_uri", frameioRedirectUri());
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeFrameioConsent(code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!env.FRAMEIO_CLIENT_ID || !env.FRAMEIO_CLIENT_SECRET) return { ok: false, message: "FRAMEIO_CLIENT_ID of FRAMEIO_CLIENT_SECRET ontbreekt." };
  const res = await fetch(env.FRAMEIO_IMS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.FRAMEIO_CLIENT_ID,
      client_secret: env.FRAMEIO_CLIENT_SECRET,
      code,
      redirect_uri: frameioRedirectUri(),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, message: `Adobe gaf HTTP ${res.status}. ${t.slice(0, 160)}` };
  }
  const data = (await res.json()) as { refresh_token?: string };
  if (!data.refresh_token) return { ok: false, message: "Adobe gaf geen refresh-token terug (offline_access ontbreekt?)." };
  await storeRefreshToken(data.refresh_token);
  return { ok: true };
}
