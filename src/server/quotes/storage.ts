import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Opslag voor offerte-PDF's: gegenereerde offerte-PDF's, het ondertekende
 * document + ontvangstbewijs (Signhost) en originele PandaDoc-PDF's bij
 * migratie. Zelfde patroon als de script-opslag: een privé-bucket in Supabase,
 * bytes worden server-side geschreven en via een toegang-gecontroleerde route
 * geserveerd. Zonder Supabase (lokale ontwikkeling) is er geen opslag; de
 * offerte-PDF wordt dan on-demand gegenereerd en niet gearchiveerd.
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

const BUCKET = env.SUPABASE_OFFERTES_BUCKET;

export function quoteStorageConfigured(): boolean {
  return supa() !== null;
}

async function ensureBucket(client: SupabaseClient): Promise<void> {
  const { data } = await client.storage.getBucket(BUCKET);
  if (data) return;
  await client.storage.createBucket(BUCKET, { public: false });
}

/** Schrijft PDF-bytes naar de opslag onder `<quoteId>/<soort>-<uuid>.pdf` en
 *  geeft de opslagsleutel terug. Null als er geen opslag is ingesteld. */
export async function putQuotePdf(quoteId: string, kind: string, bytes: Uint8Array | Buffer): Promise<string | null> {
  const client = supa();
  if (!client) return null;
  await ensureBucket(client);
  const key = `${quoteId}/${kind}-${randomUUID()}.pdf`;
  const { error } = await client.storage.from(BUCKET).upload(key, Buffer.from(bytes), {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Kon offerte-PDF niet opslaan: ${error.message}`);
  return key;
}

/** Haalt PDF-bytes op (voor de toegang-gecontroleerde serve-route). */
export async function downloadQuotePdf(key: string): Promise<Buffer | null> {
  const client = supa();
  if (!client) return null;
  const { data, error } = await client.storage.from(BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Verwijdert een PDF uit de opslag (opruimen). Faalt stil. */
export async function deleteQuotePdf(key: string): Promise<void> {
  const client = supa();
  if (!client) return;
  await client.storage.from(BUCKET).remove([key]).catch(() => {});
}
