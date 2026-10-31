import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";

/**
 * Opslag voor de AI Editor: ruwe bronnen, previews, definitieve exports,
 * referenties en stijlbestanden (muziek, LUT's).
 *
 * Zelfde opzet als Video Intelligence:
 * - "disk": lokaal onder .data/ai-editor (ontwikkeling of een verwerk-server
 *   die tevens de hub draait);
 * - "supabase": Supabase Storage (productie). De browser uploadt rechtstreeks
 *   via een ondertekende URL, de worker downloadt en uploadt met de service-key.
 *
 * Sleutels zijn relatief: "<projectId>/sources/<bestand>", "<projectId>/preview-v3.mp4".
 */

export type Store = "disk" | "supabase";

export const AI_EDITOR_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "ai-editor");

let _client: SupabaseClient | null | undefined;
function supa(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  _client = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return _client;
}

const BUCKET = () => env.SUPABASE_AI_EDITOR_BUCKET;

export function activeStore(): Store {
  return supa() ? "supabase" : "disk";
}

/** Veilig bestandsdeel voor een opslagsleutel. */
export function safeName(name: string): string {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
  return base.slice(-120) || "bestand";
}

export function diskPath(key: string): string {
  const abs = path.resolve(AI_EDITOR_ROOT, key);
  if (!abs.startsWith(path.resolve(AI_EDITOR_ROOT) + path.sep)) throw new Error("Ongeldige opslagsleutel.");
  return abs;
}

/** Werkmap voor tussenbestanden (rendercache, proxies). Blijft bewaard tussen jobs. */
export function workDir(projectId: string): string {
  return path.join(process.env.AI_EDITOR_WORK_DIR || path.join(os.tmpdir(), "shortclips-ai-editor"), projectId);
}

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

async function ensureBucket(client: SupabaseClient): Promise<void> {
  const { data } = await client.storage.getBucket(BUCKET());
  if (data) return;
  await client.storage.createBucket(BUCKET(), { public: false });
}

export type UploadTarget = { store: Store; key: string; uploadUrl: string; headers: Record<string, string> };

/** Plek waar de browser een bestand naartoe uploadt. */
export async function createUploadTarget(key: string, mime: string): Promise<UploadTarget> {
  const client = supa();
  if (client) {
    await ensureBucket(client);
    const { data, error } = await client.storage.from(BUCKET()).createSignedUploadUrl(key, { upsert: true });
    if (error || !data) throw new Error(`Kon upload-URL niet maken: ${error?.message ?? "onbekend"}`);
    const signed = data.signedUrl.startsWith("http") ? data.signedUrl : `${env.SUPABASE_URL}${data.signedUrl}`;
    return { store: "supabase", key, uploadUrl: signed, headers: { "content-type": mime || "application/octet-stream", "x-upsert": "true" } };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Opslag (Supabase) is niet ingesteld. Voeg SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY toe.");
  }
  return { store: "disk", key, uploadUrl: `/api/ai-editor/blob?key=${encodeURIComponent(key)}`, headers: { "content-type": mime || "application/octet-stream" } };
}

/** Schrijft een stream naar de lokale opslag (disk-store, dev-upload). */
export async function writeDiskStream(key: string, body: ReadableStream<Uint8Array>): Promise<number> {
  const abs = diskPath(key);
  await mkdir(path.dirname(abs), { recursive: true });
  await pipeline(Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream), createWriteStream(abs));
  return (await stat(abs)).size;
}

/** Haalt een opgeslagen bestand naar een lokaal pad (voor ffmpeg). Hergebruikt een eerder gedownloade kopie. */
export async function fetchToLocal(store: Store, key: string, localPath: string): Promise<string> {
  if (store === "disk") {
    const abs = diskPath(key);
    await stat(abs);
    return abs;
  }
  try {
    const st = await stat(localPath);
    if (st.size > 0) return localPath;
  } catch { /* nog niet lokaal */ }
  const client = supa();
  if (!client) throw new Error("Supabase-opslag niet geconfigureerd.");
  const { data, error } = await client.storage.from(BUCKET()).createSignedUrl(key, 3600);
  if (error || !data) throw new Error(`Kon bestand niet ophalen: ${error?.message ?? "onbekend"}`);
  const url = data.signedUrl.startsWith("http") ? data.signedUrl : `${env.SUPABASE_URL}${data.signedUrl}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download mislukt (HTTP ${res.status}).`);
  await mkdir(path.dirname(localPath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(localPath));
  return localPath;
}

/** Zet een lokaal bestand (render) in de actieve opslag. */
export async function putLocalFile(localPath: string, key: string, mime = "video/mp4"): Promise<{ store: Store; key: string }> {
  const client = supa();
  if (!client) {
    const abs = diskPath(key);
    await mkdir(path.dirname(abs), { recursive: true });
    await copyFile(localPath, abs);
    return { store: "disk", key };
  }
  await ensureBucket(client);
  const { data, error } = await client.storage.from(BUCKET()).createSignedUploadUrl(key, { upsert: true });
  if (error || !data) throw new Error(`Kon upload niet voorbereiden: ${error?.message ?? "onbekend"}`);
  const signed = data.signedUrl.startsWith("http") ? data.signedUrl : `${env.SUPABASE_URL}${data.signedUrl}`;
  const size = (await stat(localPath)).size;
  const res = await fetch(signed, {
    method: "PUT",
    headers: { "content-type": mime, "x-upsert": "true", "content-length": String(size) },
    body: Readable.toWeb(createReadStream(localPath)) as unknown as BodyInit,
    // @ts-expect-error duplex is vereist voor streaming bodies in Node fetch
    duplex: "half",
  });
  if (!res.ok) throw new Error(`Upload naar opslag mislukt (HTTP ${res.status}).`);
  return { store: "supabase", key };
}

/** Tijdelijke URL om af te spelen/downloaden (alleen supabase; disk loopt via de media-route). */
export async function signedUrl(store: Store, key: string, expiresInSec = 3600, downloadName?: string): Promise<string | null> {
  if (store !== "supabase") return null;
  const client = supa();
  if (!client) return null;
  const { data, error } = await client.storage.from(BUCKET()).createSignedUrl(key, expiresInSec, downloadName ? { download: downloadName } : undefined);
  if (error || !data) return null;
  return data.signedUrl.startsWith("http") ? data.signedUrl : `${env.SUPABASE_URL}${data.signedUrl}`;
}

/** Bestandsgrootte (voor kosten): disk via stat; supabase via de lokale kopie die de worker kent. */
export async function localSize(p: string): Promise<number> {
  try { return (await stat(p)).size; } catch { return 0; }
}
