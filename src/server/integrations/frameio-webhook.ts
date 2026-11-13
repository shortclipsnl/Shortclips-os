import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { getStringSetting, setStringSetting } from "@/server/app-settings";
import { frameio } from "./frameio";

/** app_settings-sleutel met het secret van de V4-webhook (gezet bij registratie). */
export const FRAMEIO_WEBHOOK_SECRET_KEY = "frameio.webhook_secret";
export const FRAMEIO_WEBHOOK_ID_KEY = "frameio.webhook_id";

/** Gebeurtenissen die de videobeoordeling nodig heeft. */
export const FRAMEIO_REVIEW_EVENTS = ["comment.created", "comment.updated", "comment.deleted", "comment.completed", "comment.uncompleted", "file.versioned"];

/**
 * Frame.io V4-handtekening: HMAC-SHA256 over `v0:{timestamp}:{body}`, header
 * `X-Frameio-Signature: v0=<hex>` plus `X-Frameio-Request-Timestamp`. Ouder
 * dan 5 minuten = weigeren (replay). https://developer.adobe.com/frameio/guides/Webhooks
 */
export function verifyFrameV4(raw: string, signature: string | null, timestamp: string | null, secret: string | undefined | null, now = Date.now()): boolean | null {
  if (!secret) return null;
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Registreert (eenmalig) de webhook in de Frame.io-workspace en bewaart het
 * secret in app_settings. Bestaat er al een webhook naar dezelfde URL, dan
 * wordt er niets dubbel aangemaakt.
 */
export async function ensureFrameWebhook(): Promise<{ ok: boolean; message: string }> {
  if (!frameio.isConfigured) return { ok: false, message: "Frame.io is niet ingesteld." };
  const url = `${env.APP_URL.replace(/\/$/, "")}/api/webhooks/frameio`;
  if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url)) return { ok: false, message: `APP_URL (${url}) is geen publiek https-adres.` };
  const workspaces = await frameio.listWorkspaces();
  for (const ws of workspaces) {
    const hooks = await frameio.listWorkspaceWebhooks(ws.id);
    const hit = hooks.find((h) => h.url === url);
    if (hit) {
      const secret = await getStringSetting(FRAMEIO_WEBHOOK_SECRET_KEY, "");
      if (secret) return { ok: true, message: `Webhook bestaat al (${hit.id}).` };
      return { ok: false, message: `Er staat al een webhook naar ${url} (${hit.id}), maar het secret is hier niet bekend. Verwijder die in Frame.io en registreer opnieuw.` };
    }
  }
  const ws = workspaces[0];
  if (!ws) return { ok: false, message: "Geen Frame.io-workspace gevonden." };
  const created = await frameio.createWorkspaceWebhook(ws.id, { name: "Shortclips portaal (videobeoordeling)", url, events: FRAMEIO_REVIEW_EVENTS });
  if (!created.secret) return { ok: false, message: "Frame.io gaf geen secret terug." };
  await setStringSetting(FRAMEIO_WEBHOOK_SECRET_KEY, created.secret, { category: "integrations", description: "Secret van de Frame.io-webhook (videobeoordeling)." });
  await setStringSetting(FRAMEIO_WEBHOOK_ID_KEY, created.id, { category: "integrations", description: "Id van de Frame.io-webhook." });
  return { ok: true, message: `Webhook aangemaakt (${created.id}) in workspace ${ws.name}.` };
}
