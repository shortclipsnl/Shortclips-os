import type { Metadata } from "next";
import { isOwner, requireInternal } from "@/server/auth/context";
import { getAttentionBoard } from "@/server/attention";
import { AttentionBoard } from "./attention-board";

export const metadata: Metadata = { title: "Aandachtspunten" };
export const dynamic = "force-dynamic";

/**
 * Aandachtspunten: wat er moet gebeuren, per persoon verdeeld. Elk teamlid opent
 * standaard op de eigen punten en kan wisselen naar het hele team. Elke regel is
 * één actie met een korte reden; afvinken is één klik.
 */
export default async function AttentionPage() {
  const viewer = await requireInternal();
  const { items, team } = await getAttentionBoard(viewer);
  return (
    <div className="mx-auto max-w-[940px]">
      <AttentionBoard
        items={items}
        team={team}
        viewerId={viewer.id}
        defaultScope={isOwner(viewer) || !team.some((t) => t.id === viewer.id) ? "all" : "mine"}
      />
    </div>
  );
}
