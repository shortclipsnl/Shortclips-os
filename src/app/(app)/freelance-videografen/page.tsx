import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { canUseFreelanceVideographers } from "@/server/freelance-videographers-access";
import { listVideographerHistory, listVideographerProfiles } from "@/server/freelance-videographers";
import { FreelanceVideographers } from "./freelance-videographers-ui";

export const metadata: Metadata = { title: "Freelance videografen" };
export const dynamic = "force-dynamic";

/**
 * Freelance videografen: wie we kunnen inschakelen voor opnames bij klanten.
 * Alleen voor de eigenaar en het vaste kantoorteam; voor iedereen anders (ook
 * freelancers zelf) bestaat deze pagina niet.
 */
export default async function FreelanceVideographersPage({ searchParams }: { searchParams: Promise<{ videograaf?: string }> }) {
  const viewer = await requireInternal();
  if (!canUseFreelanceVideographers(viewer)) notFound();
  const params = await searchParams;
  const profiles = await listVideographerProfiles();
  const history = await listVideographerHistory(profiles.map((p) => p.id));

  return (
    <div className="mx-auto max-w-[1500px]">
      <FreelanceVideographers profiles={profiles} history={history} initialOpenId={params.videograaf ?? null} />
    </div>
  );
}
