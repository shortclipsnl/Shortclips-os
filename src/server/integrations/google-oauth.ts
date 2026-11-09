import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { GOOGLE_SCOPES, GOOGLE_TOKEN_URL, googleAuth } from "./google-auth";
import { readGoogleConnection, saveRefreshToken, setGoogleAuthState } from "./google-connection";

/**
 * Gecontroleerde herverbind-flow voor de centrale Google-koppeling.
 *
 * Alleen de eigenaar kan dit starten. Het nieuwe refresh-token gaat direct
 * versleuteld de database in; geen omgevingsvariabele aanpassen en geen nieuwe
 * deploy nodig. Wisselen naar een ánder Google-account wordt geweigerd tenzij
 * dat expliciet is gevraagd, zodat de koppeling niet per ongeluk aan het
 * privé-account van een medewerker komt te hangen.
 */

export const OAUTH_STATE_COOKIE = "sc_google_oauth_state";

export function googleRedirectUri(): string {
  return `${env.APP_URL.replace(/\/$/, "")}/api/integrations/google/callback`;
}

export function newOAuthState(allowSwitch: boolean): string {
  return `${randomBytes(24).toString("base64url")}${allowSwitch ? ".switch" : ""}`;
}

export function statesMatch(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function buildConsentUrl(state: string): Promise<string> {
  const conn = await readGoogleConnection().catch(() => null);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  // prompt=consent garandeert dat Google een (nieuw) refresh-token teruggeeft.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  const hint = conn?.tokenMeta.accountEmail;
  if (hint) url.searchParams.set("login_hint", hint);
  return url.toString();
}

export type ConnectOutcome = { ok: true; email: string } | { ok: false; message: string };

export async function completeConsent(code: string, allowSwitch: boolean): Promise<ConnectOutcome> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    return { ok: false, message: `Google weigerde de toestemming (${body.error ?? `HTTP ${res.status}`}).` };
  }
  if (!body.refresh_token) {
    return { ok: false, message: "Google gaf geen refresh-token terug. Probeer opnieuw; trek eventueel eerst de oude toestemming in." };
  }
  const granted = new Set((body.scope ?? "").split(" "));
  const missing = GOOGLE_SCOPES.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Niet alle rechten zijn aangevinkt (${missing.map((m) => m.split("/").pop()).join(", ")}). Verbind opnieuw en vink alles aan.`,
    };
  }

  const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { Authorization: `Bearer ${body.access_token}` },
    cache: "no-store",
  });
  const email = ((await about.json().catch(() => ({}))) as { user?: { emailAddress?: string } }).user?.emailAddress;
  if (!email) return { ok: false, message: "Kon het gekoppelde Google-account niet vaststellen." };

  const current = (await readGoogleConnection())?.tokenMeta.accountEmail;
  if (current && current.toLowerCase() !== email.toLowerCase() && !allowSwitch) {
    return {
      ok: false,
      message: `Je koos ${email}, maar de koppeling hoort bij ${current}. Log in met ${current}, of kies bewust voor 'Ander account koppelen'.`,
    };
  }

  await saveRefreshToken(body.refresh_token, "portal", { accountEmail: email, scopes: body.scope });
  await setGoogleAuthState("ok");
  googleAuth.reset();
  return { ok: true, email };
}
