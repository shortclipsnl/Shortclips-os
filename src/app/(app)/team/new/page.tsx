import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { Card, PageHeader } from "@/components/ui";
import { TeamMemberForm } from "../_form";

export const metadata: Metadata = { title: "Nieuw teamlid" };
export const dynamic = "force-dynamic";

const EMPTY = {
  fullName: "",
  email: "",
  primaryRole: "content_creator",
  jobTitle: "",
  phone: "",
  weeklyVideoCapacity: "0",
  color: "",
  isInternal: true,
};

export default async function NewTeamMemberPage() {
  const viewer = await requireInternal();
  if (!viewer.permissions.has("team:write")) redirect("/team");

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader title="Nieuw teamlid" description="Voeg een medewerker of freelancer toe aan het team." />
      <Card>
        <TeamMemberForm mode="create" initial={EMPTY} />
      </Card>
    </div>
  );
}
