import "server-only";
import { sql, type SQL } from "drizzle-orm";

/**
 * SQL-voorwaarde "deze publicatie is een video" (reel, short, TikTok-video) en
 * geen fotopost, carrousel of tekstpost. Zelfde herkenning als de
 * Resultatenpagina (isVideoPost in src/lib/resultaten-overzicht.ts) en het
 * Contentgeheugen: de duur is bekend, of de link is een video- of reel-link.
 * Voorzichtig naar de andere kant: een publicatie die aan een eigen video
 * (deliverable) of aan de contentplanning hangt, of die nog geen link heeft,
 * blijft meetellen. Alleen wat aantoonbaar geen video is, valt af.
 *
 * Metricool levert ook Instagram-feedposts (link /p/) en Facebook-albums aan.
 * Die horen niet in de videostatistieken van maand- en kwartaalrapportages:
 * fotocontent telt daar niet mee als video.
 *
 * `alias` is de tabelalias van publications in de query (bijv. "p"), of leeg.
 */
export function isVideoSql(alias = ""): SQL {
  const a = alias ? `${alias}.` : "";
  return sql.raw(
    `(coalesce(${a}duration_seconds, 0) > 0` +
      ` or (${a}platform::text = 'tiktok' and ${a}external_url ~ '/video/')` +
      ` or ${a}platform::text = 'youtube'` +
      ` or ${a}external_url ~ '/reels?/|/videos?/'` +
      ` or ${a}deliverable_id is not null or ${a}calendar_item_id is not null` +
      ` or ${a}external_url is null)`,
  );
}
