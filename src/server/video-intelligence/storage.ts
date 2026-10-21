import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { VI_STORE_ROOT, ensureWorkDir, fromStoreRelative } from "./paths";

/**
 * Opslag voor de bronbestanden van Video Intelligence.
 *
 * - "disk": lokaal op schijf onder .data/ (ontwikkeling). Zoals voorheen.
 * - "supabase": Supabase Storage (productie op Vercel, dat geen vaste schijf
 *   heeft). Bestanden gaan rechtstreeks vanuit de browser naar Supabase via een
 *   korte, ondertekende upload-URL, zodat de 4,5 MB-limiet van Vercel-functies
 *   geen rol speelt.
 *
 * De keuze is automatisch: staan SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * ingesteld, dan Supabase; anders schijf.
 */

export type MediaStore = "disk" | "supabase";

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

const BUCKET = env.SUPABASE_VI_BUCKET;

/** Welke opslag gebruikt deze omgeving? */
export function activeStore(): MediaStore {
  return supa() ? "supabase" : "disk";
}

export { workDir, ensureWorkDir } from "./paths";

async function ensureBucket(client: SupabaseClient): Promise<void> {
  const { data } = await client.storage.getBucket(BUCKET);
  if (data) return;
  await client.storage.createBucket(BUCKET, { public: false });
}

export type UploadTarget = { store: MediaStore; key: string; uploadUrl: string; headers: Record<string, string> };

/**
 * Maakt een plek klaar waar de browser het bronbestand naartoe uploadt.
 * - supabase: een ondertekende upload-URL (direct naar Supabase).
 * - disk: een lokale route die het bestand naar .data schrijft.
 */
export async function createUploadTarget(id: string, ext: string, mime: string): Promise<UploadTarget> {
  const client = supa();
  const key = `${id}/source.${ext}`;
  if (client) {
    await ensureBucket(client);
    const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(key, { upsert: true });
    if (error || !data) throw new Error(`Kon upload-URL niet maken: ${error?.message ?? "onbekend"}`);
    const signed = data.signedUrl.startsWith("http") ? data.signedUrl : `${env.SUPABASE_URL}${data.signedUrl}`;
    return { store: "supabase", key, uploadUrl: signed, headers: { "content-type": mime || "application/octet-stream", "x-upsert": "true" } };
  }
  // In productie zonder Supabase is er geen schrijfbare schijf → duidelijke melding.
  if (env.NODE_ENV === "production") {
    throw new Error("Video-opslag (Supabase) is nog niet ingesteld. Voeg SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY toe in Vercel.");
  }
  // disk: upload via een lokale route (geen groottelimiet in ontwikkeling).
  return { store: "disk", key, uploadUrl: `/api/video-intelligence/blob?id=${encodeURIComponent(id)}&ext=${encodeURIComponent(ext)}`, headers: { "content-type": mime || "application/octet-stream" } };
}

/** Schrijft geüploade bytes naar de lokale schijf (alleen disk-store). Geeft de opslagsleutel terug. */
export async function writeDiskMedia(id: string, ext: string, bytes: Buffer): Promise<string> {
  const dir = path.join(VI_STORE_ROOT, id);
  await mkdir(dir, { recursive: true });
  const abs = path.join(dir, `source.${ext}`);
  await writeFile(abs, bytes);
  return `${id}/source.${ext}`;
}

/** Haalt het bronbestand op naar een lokaal pad dat ffmpeg kan lezen. */
export async function fetchMediaToTemp(store: MediaStore, key: string, id: string, ext: string): Promise<string> {
  if (store === "disk") {
    const abs = fromStoreRelative(key);
    await stat(abs); // bestaat het?
    return abs;
  }
  const client = supa();
  if (!client) throw new Error("Supabase-opslag niet geconfigureerd.");
  const { data, error } = await client.storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`Kon bronbestand niet ophalen: ${error?.message ?? "onbekend"}`);
  const dir = await ensureWorkDir(id);
  const abs = path.join(dir, `source.${ext}`);
  await writeFile(abs, Buffer.from(await data.arrayBuffer()));
  return abs;
}

/** Een tijdelijke, ondertekende URL waarmee de browser de video kan afspelen (alleen supabase). */
export async function signedMediaUrl(store: MediaStore, key: string, expiresInSec = 3600): Promise<string | null> {
  if (store !== "supabase") return null;
  const client = supa();
  if (!client) return null;
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(key, expiresInSec);
  if (error || !data) return null;
  return data.signedUrl.startsWith("http") ? data.signedUrl : `${env.SUPABASE_URL}${data.signedUrl}`;
}

/** Verwijdert het bronbestand (opruimen). Faalt stil. */
export async function deleteMedia(store: MediaStore, key: string): Promise<void> {
  if (store !== "supabase") return;
  const client = supa();
  if (!client) return;
  await client.storage.from(BUCKET).remove([key]).catch(() => {});
}
