import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Opslag voor script-review-PDF's.
 *
 * Grote PDF's (een scriptdocument met beeld kan ruim boven de 4,5 MB uitkomen)
 * kunnen niet als base64 via een server-action worden verstuurd: Vercel begrenst
 * het request-body tot ~4,5 MB. Daarom gaat de PDF rechtstreeks vanuit de browser
 * naar Supabase Storage via een korte, ondertekende upload-URL. De server bewaart
 * alleen de opslagsleutel. Oudere versies (base64 in de database) blijven werken.
 *
 * Zonder Supabase (lokale ontwikkeling) is er geen storage; dan valt de upload-UI
 * terug op base64 via de server-action — lokaal speelt de groottelimiet niet.
 */

let _client: SupabaseClient | null | undefined;
function supa(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    _client = null;
  }
  return _client;
}

const BUCKET = env.SUPABASE_SCRIPTS_BUCKET;

export function scriptStorageConfigured(): boolean {
  return supa() !== null;
}

async function ensureBucket(client: SupabaseClient): Promise<void> {
  const { data } = await client.storage.getBucket(BUCKET);
  if (data) return;
  await client.storage.createBucket(BUCKET, { public: false });
}

export type ScriptUploadTarget = { key: string; uploadUrl: string; headers: Record<string, string> };

/**
 * Maakt een ondertekende upload-URL waar de browser de PDF rechtstreeks naartoe
 * zet. Geeft de opslagsleutel terug die daarna bij de reviewversie wordt bewaard.
 */
export async function createScriptUploadTarget(clientId: string): Promise<ScriptUploadTarget | null> {
  const client = supa();
  if (!client) return null;
  await ensureBucket(client);
  const key = `${clientId}/${randomUUID()}.pdf`;
  const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(key, { upsert: true });
  if (error || !data) throw new Error(`Kon upload-URL niet maken: ${error?.message ?? "onbekend"}`);
  const signed = data.signedUrl.startsWith("http") ? data.signedUrl : `${env.SUPABASE_URL}${data.signedUrl}`;
  return { key, uploadUrl: signed, headers: { "content-type": "application/pdf", "x-upsert": "true" } };
}

/** Haalt de PDF-bytes op uit Supabase Storage (voor de serve-route). */
export async function downloadScriptPdf(key: string): Promise<Buffer | null> {
  const client = supa();
  if (!client) return null;
  const { data, error } = await client.storage.from(BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Verwijdert een PDF uit de opslag (opruimen). Faalt stil. */
export async function deleteScriptPdf(key: string): Promise<void> {
  const client = supa();
  if (!client) return;
  await client.storage.from(BUCKET).remove([key]).catch(() => {});
}
