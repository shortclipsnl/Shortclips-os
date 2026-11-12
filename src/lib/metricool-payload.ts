import type { Network, PublicationState } from "./publish-guard";

/**
 * Bouwt de Metricool-post voor precies één kanaal. Eén post per kanaal, zodat
 * caption en tijdstip per kanaal kunnen verschillen en een wijziging op het
 * ene kanaal nooit een ander kanaal raakt.
 */
export type MetricoolPostBody = {
  publicationDate: { dateTime: string; timezone: string };
  text: string;
  providers: Array<{ network: Network }>;
  media: string[];
  draft: boolean;
  autoPublish: boolean;
  shortener: false;
  descendants: [];
  firstCommentText: string;
  instagramData?: { type: "REEL"; showReelOnFeed: true };
  facebookData?: { type: "REEL" };
  tiktokData?: { privacyOption: "PUBLIC_TO_EVERYONE"; disableComment: false; disableDuet: false; disableStitch: false };
  youtubeData?: { type: "short"; title: string; privacy: "public"; madeForKids: false };
};

export const TIMEZONE = "Europe/Amsterdam";

/** ISO met offset → "YYYY-MM-DDTHH:mm:ss" in Amsterdamse tijd. */
export function amsterdamLocal(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}`;
}

export function buildMetricoolPost(
  pub: PublicationState,
  media: { mediaUrl: string },
  opts: { finalConfirmInApp: boolean; draft?: boolean },
): MetricoolPostBody {
  const body: MetricoolPostBody = {
    publicationDate: { dateTime: amsterdamLocal(pub.scheduledFor), timezone: TIMEZONE },
    text: pub.caption.trim(),
    providers: [{ network: pub.network }],
    media: [media.mediaUrl],
    draft: opts.draft ?? false,
    // false = Metricool stuurt een pushmelding en een medewerker drukt zelf op
    // publiceren in de Metricool-app. Extra handvat voor de pilot.
    autoPublish: !opts.finalConfirmInApp,
    shortener: false,
    descendants: [],
    firstCommentText: "",
  };
  if (pub.network === "instagram") body.instagramData = { type: "REEL", showReelOnFeed: true };
  if (pub.network === "facebook") body.facebookData = { type: "REEL" };
  if (pub.network === "tiktok") body.tiktokData = { privacyOption: "PUBLIC_TO_EVERYONE", disableComment: false, disableDuet: false, disableStitch: false };
  if (pub.network === "youtube") body.youtubeData = { type: "short", title: pub.title.trim().slice(0, 100), privacy: "public", madeForKids: false };
  return body;
}
