import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { metricool, metricoolDate } from "@/server/integrations/metricool";

/**
 * Omslagfoto's voor het Contentgeheugen (en alle andere plekken die
 * publications.thumbnail_data gebruiken).
 *
 * Metricool levert per post een omslag-URL, maar die verloopt na enkele dagen.
 * De dagelijkse sync bewaarde alleen recente posts en op 180 px, waardoor
 * oudere reels zonder omslag stonden en grote kaarten wazig waren. Deze
 * aanvulling haalt per klant de ontbrekende of te kleine omslagen opnieuw op
 * uit Metricool en bewaart ze als kleine JPEG (360 px breed).
 *
 * Alleen video's; foto- en aanbodposts doen niet mee in het Contentgeheugen.
 */

export const THUMB_WIDTH = 360;

const NETWORKS: Array<{ network: string; platform: string; subjects: string[] }> = [
  { network: "Instagram", platform: "instagram", subjects: ["reels", "posts"] },
  { network: "Tiktok", platform: "tiktok", subjects: ["posts"] },
  { network: "Facebook", platform: "facebook", subjects: ["reels", "posts"] },
  { network: "Youtube", platform: "youtube", subjects: ["posts"] },
];

const rowsOf = <T,>(res: unknown): T[] => (((res as { rows?: unknown[] }).rows ?? res) as T[]);

/** Downloadt een afbeelding en maakt er een kleine JPEG-data-URI van. */
export async function downloadThumbnailData(url: string, width = THUMB_WIDTH): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8_000_000) return null;
    try {
      const sharp = (await import("sharp")).default;
      const small = await sharp(buf).resize({ width, withoutEnlargement: true }).jpeg({ quality: 76, mozjpeg: true }).toBuffer();
      return `data:image/jpeg;base64,${small.toString("base64")}`;
    } catch {
      return buf.length <= 150_000 ? `data:${type};base64,${buf.toString("base64")}` : null;
    }
  } catch {
    return null;
  }
}

/** Breedte van een opgeslagen omslag (0 = onbekend/ongeldig). */
async function storedWidth(dataUri: string): Promise<number> {
  const i = dataUri.indexOf("base64,");
  if (i < 0) return 0;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(Buffer.from(dataUri.slice(i + 7), "base64")).metadata();
    return meta.width ?? 0;
  } catch {
    return 0;
  }
}

type Candidate = { id: string; client_id: string; platform: string; external_post_id: string; published_at: string | Date | null; thumb: string | null };

/**
 * Vult ontbrekende en te kleine omslagen aan. Idempotent en met tijdbudget:
 * wat niet lukt, volgt bij de volgende run.
 */
export async function backfillThumbnails(opts: { clientId?: string; budgetMs?: number } = {}): Promise<{ checked: number; updated: number; missing: number; clients: number }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 90_000;
  if (!metricool.isConfigured) return { checked: 0, updated: 0, missing: 0, clients: 0 };

  const res = await db.execute(sql`
    select p.id, p.client_id, p.platform::text platform, p.external_post_id, p.published_at, p.thumbnail_data thumb
    from publications p
    join clients c on c.id = p.client_id and c.deleted_at is null
    where p.deleted_at is null and p.status = 'published' and p.external_post_id is not null
      and p.published_at is not null
      ${opts.clientId ? sql`and p.client_id = ${opts.clientId}` : sql``}
      and (p.platform in ('tiktok','youtube') or coalesce(p.duration_seconds,0) > 0
           or exists (select 1 from social_metrics s where s.publication_id = p.id and coalesce(s.avg_watch_seconds,0) > 0))
  `);
  const all = rowsOf<Candidate>(res);

  // Te kleine (oude 180 px) omslagen tellen als ontbrekend voor grote kaarten.
  const need: Candidate[] = [];
  for (const r of all) {
    if (!r.thumb) need.push(r);
    else if ((await storedWidth(r.thumb)) < THUMB_WIDTH - 20) need.push(r);
  }
  if (!need.length) return { checked: all.length, updated: 0, missing: 0, clients: 0 };

  const linkRes = await db.execute(sql`
    select client_id, external_id, config from client_integrations
    where provider = 'metricool' and is_active
  `);
  const links = new Map<string, { blogId: number; userId: number }>();
  for (const l of rowsOf<{ client_id: string; external_id: string; config: { userId?: number } | null }>(linkRes)) {
    const blogId = Number(l.external_id);
    const userId = Number(l.config?.userId ?? 0);
    if (blogId && userId) links.set(l.client_id, { blogId, userId });
  }

  const byClient = new Map<string, Candidate[]>();
  for (const c of need) byClient.set(c.client_id, [...(byClient.get(c.client_id) ?? []), c]);

  let updated = 0;
  let clientsDone = 0;
  const done = new Set<string>();
  for (const [clientId, list] of byClient) {
    if (Date.now() - started > budget) break;
    const link = links.get(clientId);
    if (!link) continue;
    const times = list.map((c) => new Date(c.published_at!).getTime());
    const from = new Date(Math.min(...times) - 2 * 86_400_000);
    const to = new Date(Math.max(...times) + 2 * 86_400_000);
    const platforms = new Set(list.map((c) => c.platform));
    const imageById = new Map<string, string>();
    for (const n of NETWORKS) {
      if (!platforms.has(n.platform)) continue;
      for (const subject of n.subjects) {
        const posts = await metricool.posts(link.blogId, link.userId, n.network, subject, metricoolDate(from), metricoolDate(to, true)).catch(() => []);
        for (const p of posts) if (p.thumbnailUrl && !imageById.has(`${n.platform}:${p.externalId}`)) imageById.set(`${n.platform}:${p.externalId}`, p.thumbnailUrl);
      }
    }
    for (const c of list) {
      if (Date.now() - started > budget) break;
      const url = imageById.get(`${c.platform}:${c.external_post_id}`);
      if (!url) continue;
      const data = await downloadThumbnailData(url);
      if (!data) continue;
      await db.execute(sql`update publications set thumbnail_url = ${url}, thumbnail_data = ${data}, updated_at = now() where id = ${c.id}`);
      updated++;
      done.add(c.id);
    }
    clientsDone++;
  }
  const stillMissing = need.filter((c) => !c.thumb && !done.has(c.id)).length;
  return { checked: all.length, updated, missing: stillMissing, clients: clientsDone };
}
