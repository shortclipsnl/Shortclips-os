import "server-only";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

/**
 * Cloudflare R2 (S3-compatibel) — de opslaglaag voor Shortclips Transfer.
 *
 * Grote bestanden gaan via presigned multipart-URL's rechtstreeks tussen de
 * browser en R2; onze server zit nooit in het datapad. Zonder R2-sleutels
 * degradeert alles netjes: `r2Configured()` is dan false en de UI meldt
 * "opslag nog niet ingesteld".
 */

let _client: S3Client | null | undefined;

function client(): S3Client | null {
  if (_client !== undefined) return _client;
  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  } else {
    _client = null;
  }
  return _client;
}

export function r2Configured(): boolean {
  return client() !== null;
}

const BUCKET = env.R2_BUCKET;

export type R2Health =
  | { ok: true; bucket: string }
  | { ok: false; configured: boolean; message: string };

/**
 * Serverzijdige verbindingstest: controleert of de sleutels kloppen en de bucket
 * bestaat en bereikbaar is. Draait via de server (geen CORS in het spel), dus
 * scheidt "sleutels/bucket fout" van "CORS fout bij browser-upload". Zo kun je
 * na het invullen van de R2-sleutels meteen zien of de opslag staat.
 */
export async function r2HealthCheck(): Promise<R2Health> {
  const c = client();
  if (!c) {
    return { ok: false, configured: false, message: "R2-sleutels nog niet ingevuld (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)." };
  }
  try {
    await c.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { ok: true, bucket: BUCKET };
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    if (status === 404 || err.name === "NotFound" || err.name === "NoSuchBucket") {
      return { ok: false, configured: true, message: `Bucket "${BUCKET}" niet gevonden. Maak hem aan in Cloudflare R2 of pas R2_BUCKET aan.` };
    }
    if (status === 403 || err.name === "Forbidden" || err.name === "AccessDenied") {
      return { ok: false, configured: true, message: "Sleutels afgekeurd (403). Controleer R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY en of het token leesrecht op de bucket heeft." };
    }
    return { ok: false, configured: true, message: e instanceof Error ? e.message : "Verbinding met R2 mislukt." };
  }
}

/** Start een multipart-upload en geef het upload-id terug. */
export async function createMultipartUpload(key: string, contentType?: string | null): Promise<string> {
  const c = client();
  if (!c) throw new Error("R2 is niet ingesteld.");
  const res = await c.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType || "application/octet-stream" }),
  );
  if (!res.UploadId) throw new Error("R2 gaf geen upload-id terug.");
  return res.UploadId;
}

/** Korte, ondertekende URL waar de browser één deel naartoe PUT. */
export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 60 * 60,
): Promise<string> {
  const c = client();
  if (!c) throw new Error("R2 is niet ingesteld.");
  return getSignedUrl(
    c,
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn },
  );
}

/** Reeds geüploade delen (voor hervatten na een onderbreking). */
export async function listParts(
  key: string,
  uploadId: string,
): Promise<{ PartNumber: number; ETag: string; Size: number }[]> {
  const c = client();
  if (!c) throw new Error("R2 is niet ingesteld.");
  const out: { PartNumber: number; ETag: string; Size: number }[] = [];
  let marker: number | undefined;
  // ListParts pagineert per 1000 delen.
  do {
    const res = await c.send(
      new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker ? String(marker) : undefined }),
    );
    for (const p of res.Parts ?? []) {
      if (p.PartNumber != null && p.ETag) out.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size ?? 0 });
    }
    marker = res.IsTruncated ? Number(res.NextPartNumberMarker) : undefined;
  } while (marker);
  return out;
}

/** Rond de multipart-upload af met de ETags van alle delen. */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  const c = client();
  if (!c) throw new Error("R2 is niet ingesteld.");
  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
  await c.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sorted },
    }),
  );
}

/** Breek een onvolledige upload af en ruim de delen op. */
export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    await c.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }));
  } catch {
    /* al opgeruimd of niet meer aanwezig */
  }
}

/**
 * Korte, ondertekende GET-URL waarmee de ontvanger het originele bestand
 * rechtstreeks uit R2 downloadt (met de juiste bestandsnaam). Onze server zit
 * zo niet in het datapad.
 */
export async function presignGet(key: string, fileName: string, expiresIn = 60 * 10): Promise<string> {
  const c = client();
  if (!c) throw new Error("R2 is niet ingesteld.");
  const safe = fileName.replace(/[\r\n"]/g, "_");
  return getSignedUrl(
    c,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safe}"`,
    }),
    { expiresIn },
  );
}

/** Objecten definitief uit R2 verwijderen (opslaglaag). */
export async function deleteObjects(keys: string[]): Promise<void> {
  const c = client();
  if (!c || keys.length === 0) return;
  // DeleteObjects doet max. 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await c.send(
      new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: batch.map((Key) => ({ Key })) } }),
    );
  }
}
