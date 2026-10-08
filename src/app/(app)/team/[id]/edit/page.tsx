import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMembers, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { Card, PageHeader } from "@/components/ui";
import { TeamMemberForm } from "../../_form";

export const metadata: Metadata = { title: "Teamlid bewerken" };
export const dynamic = "force-dynamic";

export default async function EditTeamMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireInternal();
  if (!viewer.permissions.has("team:write")) redirect("/team");

  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      primaryRole: users.primaryRole,
      status: users.status,
      phone: users.phone,
      jobTitle: teamMembers.jobTitle,
      weeklyVideoCapacity: teamMembers.weeklyVideoCapacity,
      color: teamMembers.color,
      isInternal: teamMembers.isInternal,
    })
    .from(users)
    .leftJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(eq(users.id, id))
    .limit(1);
  if (!row) notFound();

  const initial = {
    fullName: row.fullName,
    email: row.email,
    primaryRole: row.primaryRole,
    jobTitle: row.jobTitle ?? "",
    phone: row.phone ?? "",
    weeklyVideoCapacity: String(row.weeklyVideoCapacity ?? 0),
    color: row.color ?? "",
    isInternal: row.isInternal ?? true,
  };

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader title={`${row.fullName} bewerken`} description="Pas gegevens, rol of toegang aan." />
      <Card>
        <TeamMemberForm
          mode="edit"
          userId={row.id}
          initial={initial}
          isActive={row.status === "active"}
          canDeactivate
        />
      </Card>
    </div>
  );
}
