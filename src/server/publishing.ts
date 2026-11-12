import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientIntegrations, clients, contentCalendar, frameAssets, publications } from "@/db/schema";
import {
  decideSync,
  publicationFingerprint,
  publishBlocks,
  NETWORKS,
  type Network,
  type PublicationState,
  type SyncStatus,
} from "@/lib/publish-guard";
import { buildMetricoolPost } from "@/lib/metricool-payload";
import { cleanCaption } from "@/lib/clean-caption";
import { metricool } from "@/server/integrations/metricool";
import { findOwn, metricoolScheduler, type MetricoolScheduler } from "@/server/integrations/metricool-scheduler";
import { frameio } from "@/server/integrations/frameio";
import { getContentItemForVideo, resolveContentVideo } from "@/server/content-video";

/**
 * Publiceren vanuit de contentplanning: per bericht "Handmatig" (standaard, het
 * team post zelf, er gaat niets naar Metricool) of "Via Metricool".
 *
 * Veiligheid (zie ook src/lib/publish-guard.ts):
 *  - Alleen de knop "Inplannen via Metricool" + bevestiging stuurt iets weg.
 *    Op Metricool zetten alleen doet niets.
 *  - Zonder METRICOOL_PUBLISHING_ENABLED=true draait alles in proefmodus: alle
 *    controles lopen, maar er gaat niets echt naar Metricool.
 *  - Verandert er na het inplannen iets aan het bericht (tijd, caption, video,
 *    verwijderd), dan haalt de controle de post direct uit Metricool. Hij komt
 *    pas terug na opnieuw inplannen. Er wordt nooit iets stil bijgewerkt.
 *  - Shortclips raakt in Metricool alleen eigen posts aan (opgeslagen UUID).
 */

export type PublishMode = "handmatig" | "metricool";
export type ChannelView = {
  platform: Network;
  /** Gekoppeld bij het Metricool-merk van de klant. */
  connected: boolean;
  /** Status van dit kanaal: niet_verstuurd | proef | ingepland | in_de_wacht | gepubliceerd | mislukt | handmatig */
  status: SyncStatus | "handmatig";
  error: string | null;
};
export type PublishingView = {
  mode: PublishMode;
  /** Kan deze klant via Metricool (merk gekoppeld)? */
  metricoolAvailable: boolean;
  live: boolean;
  channels: ChannelView[];
  /** Wat er nog ontbreekt om in te plannen (leeg = kan). */
  blockers: string[];
  canPlan: boolean;
  canRevoke: boolean;
};

const WANT: Network[] = ["instagram", "tiktok", "youtube", "facebook"];

type Brand = { blogId: string; userId: string; networks: Network[] } | null;

/** Merken uit Metricool, 10 minuten bewaard voor het tonen; bij inplannen altijd vers. */
let brandCache: { at: number; brands: Awaited<ReturnType<typeof metricool.listBrands>> } | null = null;
async function cachedBrands(fresh: boolean) {
  if (!fresh && brandCache && Date.now() - brandCache.at < 10 * 60_000) return brandCache.brands;
  const brands = await metricool.listBrands();
  brandCache = { at: Date.now(), brands };
  return brands;
}

async function brandFor(clientId: string, live: boolean): Promise<Brand> {
  const [link] = await db
    .select({ blogId: clientIntegrations.externalId, config: clientIntegrations.config })
    .from(clientIntegrations)
    .where(and(eq(clientIntegrations.clientId, clientId), eq(clientIntegrations.provider, "metricool"), eq(clientIntegrations.isActive, true)))
    .limit(1);
  if (!link) return null;
  const cfg = (link.config ?? {}) as { userId?: number | string; networks?: string[] };
  let networks = (cfg.networks ?? []).filter((n): n is Network => (NETWORKS as readonly string[]).includes(n));
  // Bij inplannen altijd de actuele kanalen uit Metricool, nooit een oude kopie.
  // Ook als de kanalen nog nooit zijn opgeslagen (vóór de eerste nachtelijke koppeling).
  if ((live || cfg.networks === undefined) && metricool.isConfigured) {
    try {
      const b = (await cachedBrands(live)).find((x) => String(x.id) === String(link.blogId));
      if (!b) return null;
      networks = b.networks.filter((n): n is Network => (NETWORKS as readonly string[]).includes(n));
    } catch {
      /* val terug op de opgeslagen kanalen */
    }
  }
  return { blogId: String(link.blogId), userId: String(cfg.userId ?? ""), networks };
}

type ItemRow = {
  id: string;
  clientId: string;
  title: string;
  scheduledOn: string;
  scheduledAt: string | null;
  platforms: string[];
  caption: string | null;
  deleted: boolean;
  weHandlePosting: boolean;
};

async function loadItem(itemId: string): Promise<ItemRow | null> {
  const [r] = await db
    .select({
      id: contentCalendar.id,
      clientId: contentCalendar.clientId,
      title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn,
      scheduledAt: contentCalendar.scheduledAt,
      platforms: contentCalendar.platforms,
      caption: contentCalendar.caption,
      deletedAt: contentCalendar.deletedAt,
      weHandlePosting: clients.weHandlePosting,
    })
    .from(contentCalendar)
    .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
    .where(eq(contentCalendar.id, itemId))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    clientId: r.clientId,
    title: r.title,
    scheduledOn: String(r.scheduledOn).slice(0, 10),
    scheduledAt: r.scheduledAt ? String(r.scheduledAt).slice(0, 5) : null,
    platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
    caption: r.caption,
    deleted: Boolean(r.deletedAt),
    weHandlePosting: r.weHandlePosting,
  };
}

/** Datum + tijd in Amsterdam → ISO met de juiste offset (zomer/winter). */
export function amsterdamIso(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Amsterdam" }));
  const utcAsLocal = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMin = Math.round((local.getTime() - utcAsLocal.getTime()) / 60000);
  const t = new Date(guess.getTime() - offsetMin * 60000);
  return t.toISOString();
}

/** Kanalen waarop dit bericht hoort: de kanalen van het item, of alle vier als er niets is ingesteld. */
function wantedChannels(item: ItemRow): Network[] {
  const own = item.platforms.filter((p): p is Network => (WANT as string[]).includes(p));
  return own.length ? own : WANT;
}

async function rowsFor(itemId: string) {
  return db
    .select()
    .from(publications)
    .where(and(eq(publications.calendarItemId, itemId), isNull(publications.deletedAt)));
}

type Video = { videoId: string; mediaFileId: string } | null;

async function videoFor(itemId: string): Promise<Video> {
  const it = await getContentItemForVideo(itemId);
  if (!it) return null;
  const v = await resolveContentVideo(it);
  if (!v) return null;
  const [a] = await db.select({ mediaFileId: frameAssets.mediaFileId }).from(frameAssets).where(eq(frameAssets.id, v.id)).limit(1);
  return a ? { videoId: v.id, mediaFileId: a.mediaFileId } : null;
}

function stateFor(item: ItemRow, network: Network, video: Video, mode: PublishMode, selected: boolean): PublicationState {
  return {
    calendarItemId: item.id,
    mode,
    clientId: item.clientId,
    itemDeleted: item.deleted,
    network,
    networkSelected: selected,
    videoVersionId: video?.videoId ?? null,
    videoIsLatestApproved: Boolean(video),
    caption: cleanCaption(item.caption ?? ""),
    scheduledFor: item.scheduledAt ? amsterdamIso(item.scheduledOn, item.scheduledAt) : "invalid",
    title: item.title,
  };
}

/* ------------------------------------------------------------------ */
/* Lezen                                                               */
/* ------------------------------------------------------------------ */

export async function getPublishingView(itemId: string, now = new Date()): Promise<PublishingView | null> {
  const item = await loadItem(itemId);
  if (!item) return null;
  const [brand, rows, video] = await Promise.all([brandFor(item.clientId, false), rowsFor(itemId), videoFor(itemId)]);
  const mode: PublishMode = rows.some((r) => r.publishMode === "metricool") ? "metricool" : "handmatig";
  const live = metricoolScheduler.isLive;
  const channels: ChannelView[] = wantedChannels(item).map((p) => {
    const r = rows.find((x) => x.platform === p);
    const connected = Boolean(brand?.networks.includes(p));
    const status: ChannelView["status"] = !r || r.publishMode !== "metricool" ? "handmatig" : (r.syncStatus as SyncStatus);
    return { platform: p, connected, status, error: r?.lastError ?? null };
  });
  const blockers: string[] = [];
  if (mode === "metricool") {
    if (!video) blockers.push("Er is nog geen video gekoppeld.");
    if (!cleanCaption(item.caption ?? "").trim()) blockers.push("De caption is leeg.");
    if (!item.scheduledAt) blockers.push("Er is nog geen tijdstip.");
    else if (new Date(amsterdamIso(item.scheduledOn, item.scheduledAt)).getTime() < now.getTime() + 15 * 60_000) blockers.push("Het tijdstip ligt in het verleden of binnen 15 minuten.");
    if (!channels.some((c) => c.connected)) blockers.push("Geen van de kanalen is gekoppeld in Metricool.");
  }
  const pending = channels.filter((c) => c.connected && ["niet_verstuurd", "in_de_wacht", "mislukt", "geannuleerd"].includes(c.status));
  return {
    mode,
    metricoolAvailable: Boolean(brand && brand.networks.length && item.weHandlePosting),
    live,
    channels,
    blockers,
    canPlan: mode === "metricool" && blockers.length === 0 && pending.length > 0,
    canRevoke: channels.some((c) => c.status === "ingepland" || c.status === "proef"),
  };
}

/** Compacte status per bericht voor de weekweergave (zonder Metricool-aanroepen). */
export async function getPublishingSummaries(itemIds: string[]): Promise<Map<string, Array<{ platform: string; status: string }>>> {
  const map = new Map<string, Array<{ platform: string; status: string }>>();
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return map;
  const rows = await db
    .select({ itemId: publications.calendarItemId, platform: publications.platform, status: publications.syncStatus })
    .from(publications)
    .where(and(inArray(publications.calendarItemId, ids), eq(publications.publishMode, "metricool"), isNull(publications.deletedAt)));
  for (const r of rows) {
    if (!r.itemId) continue;
    const list = map.get(r.itemId) ?? [];
    list.push({ platform: r.platform, status: r.status });
    map.set(r.itemId, list);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Schrijven                                                           */
/* ------------------------------------------------------------------ */

export type ActionResult = { ok: boolean; message: string };

/** Handmatig of via Metricool. Terug naar handmatig haalt eigen posts eerst uit Metricool. */
export async function setPublishMode(itemId: string, mode: PublishMode, scheduler: MetricoolScheduler = metricoolScheduler): Promise<ActionResult> {
  const item = await loadItem(itemId);
  if (!item || item.deleted) return { ok: false, message: "Dit bericht staat niet in de planning." };
  if (mode === "handmatig") {
    const res = await removeOwnPosts(itemId, "geannuleerd", "Op handmatig posten gezet.", scheduler);
    await db
      .update(publications)
      .set({ publishMode: "handmatig", updatedAt: new Date() })
      .where(and(eq(publications.calendarItemId, itemId), isNull(publications.deletedAt)));
    return res.ok ? { ok: true, message: "Staat op handmatig posten. Er gaat niets naar Metricool." } : res;
  }
  if (!item.weHandlePosting) return { ok: false, message: "Deze klant plaatst zelf; publiceren via Shortclips staat uit." };
  const brand = await brandFor(item.clientId, false);
  if (!brand) return { ok: false, message: "Deze klant heeft geen Metricool-merk gekoppeld." };
  for (const p of wantedChannels(item)) {
    const want: PublishMode = brand.networks.includes(p) ? "metricool" : "handmatig";
    await db
      .insert(publications)
      .values({ clientId: item.clientId, calendarItemId: itemId, platform: p, status: "ready", publishMode: want, syncStatus: "niet_verstuurd" })
      .onConflictDoUpdate({
        target: [publications.calendarItemId, publications.platform],
        targetWhere: sql`${publications.deletedAt} IS NULL AND ${publications.calendarItemId} IS NOT NULL`,
        set: { publishMode: want, updatedAt: new Date() },
      });
  }
  return { ok: true, message: "Staat op via Metricool. Er gaat nog niets uit: eerst inplannen en bevestigen." };
}

/** Claim: zet een rij op "wordt_verstuurd", alleen als niemand anders bezig is. */
async function claim(id: string): Promise<boolean> {
  const r = await db
    .update(publications)
    .set({ syncStatus: "wordt_verstuurd", updatedAt: new Date() })
    .where(and(eq(publications.id, id), sql`${publications.syncStatus} <> 'wordt_verstuurd'`))
    .returning({ id: publications.id });
  return r.length === 1;
}

/**
 * Inplannen via Metricool. Dit is de vrijgave: alleen aangeroepen na de knop
 * "Inplannen via Metricool" én de bevestiging "Ja, inplannen".
 */
export async function planViaMetricool(
  itemId: string,
  releasedById: string,
  opts: { scheduler?: MetricoolScheduler; now?: Date; mediaUrl?: (mediaFileId: string) => Promise<string | null> } = {},
): Promise<ActionResult> {
  const scheduler = opts.scheduler ?? metricoolScheduler;
  const now = opts.now ?? new Date();
  const item = await loadItem(itemId);
  if (!item || item.deleted) return { ok: false, message: "Dit bericht staat niet in de planning." };
  const brand = await brandFor(item.clientId, true);
  if (!brand) return { ok: false, message: "Deze klant heeft geen Metricool-merk gekoppeld." };
  const video = await videoFor(itemId);
  const rows = (await rowsFor(itemId)).filter((r) => r.publishMode === "metricool");
  if (!rows.length) return { ok: false, message: "Dit bericht staat op handmatig posten." };

  const done: string[] = [];
  const problems: string[] = [];
  for (const row of rows) {
    const network = row.platform as Network;
    const pub = stateFor(item, network, video, "metricool", wantedChannels(item).includes(network));
    const fingerprint = publicationFingerprint(pub, brand.blogId);
    const release = { releasedAt: now.toISOString(), releasedById, fingerprint };
    const blocks = publishBlocks({
      pub,
      client: { weHandlePosting: item.weHandlePosting, metricoolPublishing: true, metricoolBlogId: brand.blogId, connectedNetworks: brand.networks, clientApprovalRequired: false },
      release,
      clientApproved: true,
      globalEnabled: true, // de echte schakelaar zit in de scheduler (proefmodus)
      now,
    });
    const remote = { syncStatus: row.syncStatus as SyncStatus, metricoolUuid: row.metricoolPostUuid, sentFingerprint: row.sentFingerprint };
    const action = decideSync({ blocks, remote, release, currentFingerprint: fingerprint, cancelled: false, mode: "metricool" });
    if (action.kind === "none" && blocks.length) {
      problems.push(`${label(network)}: ${blocks[0]!.message}`);
      continue;
    }
    if (action.kind === "none") {
      done.push(label(network));
      continue;
    }
    if (action.kind !== "create" && action.kind !== "update") continue;
    if (!(await claim(row.id))) {
      problems.push(`${label(network)}: er loopt al een verzending.`);
      continue;
    }
    try {
      const url = scheduler.isLive ? await (opts.mediaUrl ?? ((m: string) => frameio.getFileDownload(m)))(video!.mediaFileId) : "proefmodus";
      if (!url) throw new Error("De video kon niet uit Frame.io worden opgehaald.");
      const body = buildMetricoolPost(pub, { mediaUrl: url }, { finalConfirmInApp: true });
      const base = { releasedAt: now, releasedById, releasedFingerprint: fingerprint, videoVersionId: null as string | null, lastSyncedAt: new Date(), lastError: null as string | null, scheduledFor: new Date(pub.scheduledFor), caption: pub.caption };
      const day = body.publicationDate.dateTime.slice(0, 10);
      const findExisting = async () => findOwn(await scheduler.list(brand.blogId, brand.userId, `${day}T00:00:00`, `${day}T23:59:59`).catch(() => []), body);
      let res;
      // Een eerdere poging kan de post al hebben gemaakt (fout erna): eerst zoeken.
      const earlier = scheduler.isLive && action.kind === "create" && (row.attempts > 0 || row.syncStatus === "mislukt") ? await findExisting() : null;
      if (earlier) res = { dryRun: false as const, post: earlier };
      else {
        try {
          res = action.kind === "update" && row.metricoolPostId && row.metricoolPostUuid
            ? await scheduler.update(brand.blogId, brand.userId, row.metricoolPostId, row.metricoolPostUuid, body)
            : await scheduler.create(brand.blogId, brand.userId, body);
        } catch (e) {
          // Onzeker of de post toch is aangemaakt: eerst zoeken, nooit blind opnieuw maken.
          const own = scheduler.isLive ? await findExisting() : null;
          if (!own) throw e;
          res = { dryRun: false as const, post: own };
        }
      }
      // Eerst het Metricool-ID vastleggen, los van de rest: zo weten we altijd welke post van ons is.
      if (!res.dryRun && res.post?.uuid) {
        await db.update(publications).set({ metricoolPostId: res.post.id, metricoolPostUuid: res.post.uuid, updatedAt: new Date() }).where(eq(publications.id, row.id));
      }
      if (res.dryRun) {
        await db.update(publications).set({ ...base, syncStatus: "proef", sentFingerprint: fingerprint, attempts: 0 }).where(eq(publications.id, row.id));
      } else {
        if (!res.post?.uuid) throw new Error("Metricool gaf geen bevestiging terug.");
        await db
          .update(publications)
          .set({ ...base, syncStatus: "ingepland", metricoolPostId: res.post.id, metricoolPostUuid: res.post.uuid, sentFingerprint: fingerprint, attempts: 0 })
          .where(eq(publications.id, row.id));
      }
      done.push(label(network));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(publications)
        .set({ syncStatus: "mislukt", lastError: msg.slice(0, 500), attempts: sql`${publications.attempts} + 1`, updatedAt: new Date() })
        .where(eq(publications.id, row.id));
      problems.push(`${label(network)}: ${msg}`);
    }
  }
  const prefix = scheduler.isLive ? "Ingepland in Metricool" : "Proefmodus: gecontroleerd, niets verstuurd";
  if (problems.length && !done.length) return { ok: false, message: problems.join(" ") };
  return { ok: true, message: `${prefix}${done.length ? `: ${done.join(", ")}` : ""}.${problems.length ? ` Niet gelukt: ${problems.join(" ")}` : ""}` };
}

/** Eigen posts van dit bericht uit Metricool halen. */
async function removeOwnPosts(itemId: string, newStatus: SyncStatus, reason: string, scheduler: MetricoolScheduler): Promise<ActionResult> {
  const item = await loadItem(itemId);
  const brand = item ? await brandFor(item.clientId, false) : null;
  const rows = await rowsFor(itemId);
  const failed: string[] = [];
  for (const r of rows) {
    if (!["ingepland", "proef", "mislukt", "wordt_verstuurd"].includes(r.syncStatus) && !r.metricoolPostUuid) continue;
    try {
      if (r.metricoolPostUuid && r.metricoolPostId && brand) await scheduler.remove(brand.blogId, brand.userId, r.metricoolPostId, r.metricoolPostUuid);
      await db
        .update(publications)
        .set({ syncStatus: newStatus, metricoolPostId: null, metricoolPostUuid: null, sentFingerprint: null, releasedAt: null, releasedFingerprint: null, lastError: reason, updatedAt: new Date() })
        .where(eq(publications.id, r.id));
    } catch (e) {
      failed.push(`${label(r.platform as Network)}: ${e instanceof Error ? e.message : String(e)}`);
      await db.update(publications).set({ lastError: `Verwijderen uit Metricool mislukt: ${String(e).slice(0, 300)}`, updatedAt: new Date() }).where(eq(publications.id, r.id));
    }
  }
  return failed.length ? { ok: false, message: `Uit Metricool halen lukte niet: ${failed.join(" ")}` } : { ok: true, message: reason };
}

export async function revokePlanning(itemId: string, scheduler: MetricoolScheduler = metricoolScheduler): Promise<ActionResult> {
  return removeOwnPosts(itemId, "niet_verstuurd", "Inplanning ingetrokken: post uit Metricool gehaald.", scheduler);
}

/**
 * Controle (elke 15 minuten en na elke agenda-sync): staat er iets ingepland
 * terwijl het bericht sindsdien is veranderd of verwijderd? Dan direct uit
 * Metricool halen ("in de wacht"). Bevestigt ook publicaties via de statistieken.
 */
export async function reconcilePublishing(opts: { scheduler?: MetricoolScheduler; now?: Date } = {}): Promise<{ held: number; confirmed: number }> {
  const scheduler = opts.scheduler ?? metricoolScheduler;
  const now = opts.now ?? new Date();
  const rows = await db
    .select()
    .from(publications)
    .where(and(eq(publications.publishMode, "metricool"), inArray(publications.syncStatus, ["ingepland", "proef", "mislukt"]), isNull(publications.deletedAt)));
  let held = 0;
  let confirmed = 0;
  const videoCache = new Map<string, Video>();
  for (const r of rows) {
    if (!r.calendarItemId) continue;
    // "Niet gelukt" alleen meenemen als er toch een eigen post in Metricool staat.
    if (r.syncStatus === "mislukt" && !r.metricoolPostUuid) continue;
    const item = await loadItem(r.calendarItemId);
    const brand = item ? await brandFor(item.clientId, false) : null;
    if (!videoCache.has(r.calendarItemId)) videoCache.set(r.calendarItemId, item ? await videoFor(r.calendarItemId) : null);
    const network = r.platform as Network;
    const changed = (() => {
      if (!item || item.deleted || !brand || !item.scheduledAt) return true;
      const pub = stateFor(item, network, videoCache.get(r.calendarItemId) ?? null, "metricool", wantedChannels(item).includes(network));
      return publicationFingerprint(pub, brand.blogId) !== r.sentFingerprint;
    })();
    const due = r.scheduledFor ? r.scheduledFor.getTime() < now.getTime() : false;
    if (changed && !due) {
      const res = await removeOwnPosts(r.calendarItemId, "in_de_wacht", "Bericht gewijzigd na inplannen: post uit Metricool gehaald. Plan opnieuw in.", scheduler);
      if (res.ok) held++;
      continue;
    }
    if (due && r.syncStatus === "ingepland") {
      // Bevestigen via de statistieken: een door Metricool opgehaalde post van
      // dezelfde klant en hetzelfde kanaal, gepubliceerd rond het geplande tijdstip.
      const t = r.scheduledFor!.getTime();
      const [hit] = await db
        .select({ id: publications.id })
        .from(publications)
        .where(and(
          eq(publications.clientId, r.clientId),
          eq(publications.platform, r.platform),
          isNull(publications.calendarItemId),
          sql`${publications.externalPostId} IS NOT NULL`,
          // Zelfde caption (begin), zodat twee video's van dezelfde klant rond hetzelfde tijdstip niet verwisseld worden.
          sql`left(regexp_replace(lower(coalesce(${publications.caption}, '')), '\s+', ' ', 'g'), 40) = left(regexp_replace(lower(${r.caption ?? ""}), '\s+', ' ', 'g'), 40)`,
          sql`${publications.publishedAt} BETWEEN ${new Date(t - 2 * 3600_000).toISOString()}::timestamptz AND ${new Date(t + 3 * 3600_000).toISOString()}::timestamptz`,
        ))
        .limit(1);
      if (hit) {
        // De opgehaalde post (met de statistieken) wordt de publicatie van dit bericht:
        // onze planningsrij gaat op in die rij, zodat de cijfers aan deze video hangen.
        await db.transaction(async (tx) => {
          await tx.update(publications).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(publications.id, r.id));
          await tx
            .update(publications)
            .set({
              calendarItemId: r.calendarItemId,
              deliverableId: r.deliverableId,
              publishMode: "metricool",
              syncStatus: "gepubliceerd",
              publishedConfirmedAt: new Date(),
              metricoolPostId: r.metricoolPostId,
              metricoolPostUuid: r.metricoolPostUuid,
              releasedAt: r.releasedAt,
              releasedById: r.releasedById,
              releasedFingerprint: r.releasedFingerprint,
              sentFingerprint: r.sentFingerprint,
              scheduledFor: r.scheduledFor,
              updatedAt: new Date(),
            })
            .where(eq(publications.id, hit.id));
        });
        confirmed++;
      }
    }
  }
  // Alles gepubliceerd → planningsbericht op Gepubliceerd.
  await db.execute(sql`
    UPDATE content_calendar c SET status = 'published', updated_at = now()
    WHERE c.status <> 'published' AND EXISTS (SELECT 1 FROM publications p WHERE p.calendar_item_id = c.id AND p.publish_mode = 'metricool' AND p.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.calendar_item_id = c.id AND p.publish_mode = 'metricool' AND p.deleted_at IS NULL AND p.sync_status <> 'gepubliceerd')`);
  return { held, confirmed };
}

const LABELS: Record<Network, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook" };
function label(n: Network): string {
  return LABELS[n] ?? n;
}
