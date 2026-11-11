import { requireInternal } from "@/server/auth/context";
import { getScreenData } from "@/server/screen";
import { getScreenReel } from "@/server/screen-reel";
import { ReelPlayer } from "./reel-player";

export const dynamic = "force-dynamic";

/**
 * Kantoorscherm: automatisch draaiende presentatie van echte klantvideo's
 * (Frame.io) met hun echte resultaten (Metricool). Bedoeld voor de tv op
 * kantoor; ververst zichzelf zonder herladen.
 */
export default async function ScreenPage() {
  const viewer = await requireInternal();
  const [reel, d] = await Promise.all([getScreenReel(viewer), getScreenData(30, { trusted: true })]);
  return (
    <ReelPlayer
      initialReel={reel}
      initialTotals={{
        views: d.totals.views,
        reach: d.totals.reach,
        posts: d.totals.posts,
        followerGrowth: d.totals.followerGrowth,
        viewsGrowthPct: d.totals.viewsGrowthPct,
      }}
      initialClientCount={d.clientCount}
    />
  );
}
