import type { PortalResults } from "@/server/portal";
import { PLATFORM } from "@/lib/statuses";

export type Highlight = {
  /** positief = groen met vinkje, aandacht = oranje, neutraal = blauw. */
  tone: "positief" | "aandacht" | "neutraal";
  /** Het belangrijkste cijfer, vetgedrukt. */
  figure: string;
  /** Korte uitleg in gewone taal. */
  text: string;
};

const nf = new Intl.NumberFormat("nl-NL");
const name = (p: string) => (p === "youtube" ? "YouTube Shorts" : PLATFORM[p]?.label ?? p);

/** Minimale verandering voordat we iets groei of daling noemen. */
const TOTAL_MIN = 5;
const PLATFORM_MIN = 15;

/**
 * "Wat valt op?": uitsluitend punten die de echte cijfers van deze klant
 * onderbouwen (totalen, vergelijking met de vorige periode, platforms en
 * video's). Geen algemene of verzonnen conclusies: zonder vergelijkbare data
 * geen groei- of dalingspunt. Successen eerst, daarna aandachtspunten.
 */
export function buildHighlights(r: PortalResults): Highlight[] {
  if (!r.hasData) return [];
  const pos: Highlight[] = [];
  const att: Highlight[] = [];
  const neu: Highlight[] = [];
  const d = r.deltas;

  // Weergaven en bereik t.o.v. de vorige periode
  if (d.views !== null && d.views >= TOTAL_MIN) pos.push({ tone: "positief", figure: `+${d.views}% weergaven`, text: `${nf.format(r.metrics.views)} weergaven, tegen ${nf.format(r.prev.views)} in de vorige periode.` });
  else if (d.views !== null && d.views <= -TOTAL_MIN) att.push({ tone: "aandacht", figure: `${d.views}% weergaven`, text: `${nf.format(r.metrics.views)} weergaven, tegen ${nf.format(r.prev.views)} in de vorige periode.` });

  if (d.reach !== null && d.reach >= TOTAL_MIN) pos.push({ tone: "positief", figure: `+${d.reach}% bereik`, text: `Jullie video's bereikten ${nf.format(r.metrics.reach)} mensen.` });
  else if (d.reach !== null && d.reach <= -TOTAL_MIN) att.push({ tone: "aandacht", figure: `${d.reach}% bereik`, text: `Jullie video's bereikten ${nf.format(r.metrics.reach)} mensen, minder dan de vorige periode.` });
  else if (d.views === null && r.metrics.reach > 0) neu.push({ tone: "neutraal", figure: `${nf.format(r.metrics.reach)} mensen bereikt`, text: "Unieke accounts die jullie content in deze periode zagen." });

  // Volgers
  if (r.metrics.followerGrowth > 0) {
    const g = d.followerGrowth;
    pos.push({ tone: "positief", figure: `+${nf.format(r.metrics.followerGrowth)} nieuwe volgers`, text: g !== null && g >= TOTAL_MIN ? `Dat is ${g}% meer groei dan de vorige periode.` : "Nieuwe volgers over alle gekoppelde kanalen samen." });
  } else if (r.metrics.followerGrowth < 0) {
    att.push({ tone: "aandacht", figure: `${nf.format(r.metrics.followerGrowth)} volgers`, text: "Er gingen per saldo volgers af in deze periode." });
  }

  // Beste video
  const top = r.videos[0];
  if (top && top.views > 0) {
    const share = r.metrics.views > 0 && r.videos.length > 1 ? Math.round((top.views / r.metrics.views) * 100) : null;
    pos.push({
      tone: "positief",
      figure: `Topvideo: ${nf.format(top.views)} weergaven`,
      text: `De best presterende video van deze periode${top.platforms.length > 1 ? ` (op ${top.platforms.length} platforms samen)` : ""}${share && share >= 15 && share <= 100 ? `, goed voor ${share}% van alle weergaven` : ""}.`,
    });
  }

  // Platforms: sterkste kanaal en duidelijke groei of daling per kanaal
  const live = r.platforms.filter((p) => p.state === "data" && (p.views ?? 0) > 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  if (live.length >= 2) {
    const best = live[0]!;
    const total = live.reduce((s, p) => s + (p.views ?? 0), 0);
    neu.push({ tone: "neutraal", figure: `${name(best.platform)} is het sterkste kanaal`, text: `${nf.format(best.views ?? 0)} weergaven${total > 0 ? `, ${Math.round(((best.views ?? 0) / total) * 100)}% van het totaal` : ""}.` });
  }
  for (const p of r.platforms) {
    const g = p.growth.views;
    if (p.state !== "data" || g === null) continue;
    if (g >= PLATFORM_MIN) pos.push({ tone: "positief", figure: `${name(p.platform)} +${g}%`, text: `Meer weergaven op ${name(p.platform)} dan de vorige periode.` });
    else if (g <= -PLATFORM_MIN) att.push({ tone: "aandacht", figure: `${name(p.platform)} ${g}%`, text: `Minder weergaven op ${name(p.platform)} dan de vorige periode.` });
  }

  // Minder geplaatst dan de vorige periode
  if (r.prev.publishedVideos > 0 && r.metrics.publishedVideos < r.prev.publishedVideos && d.publishedVideos !== null && d.publishedVideos <= -20) {
    att.push({ tone: "aandacht", figure: `${r.metrics.publishedVideos} posts geplaatst`, text: `Tegen ${r.prev.publishedVideos} in de vorige periode; minder posts geeft meestal minder weergaven.` });
  }

  // Gekoppeld kanaal zonder activiteit
  const quiet = r.platforms.filter((p) => p.state === "stil").map((p) => name(p.platform));
  if (quiet.length) att.push({ tone: "aandacht", figure: `Geen activiteit op ${quiet.join(" en ")}`, text: "Dit kanaal is gekoppeld, maar er stond in deze periode niets nieuws live." });

  return [...pos.slice(0, 4), ...neu.slice(0, 2), ...att.slice(0, 3)];
}
