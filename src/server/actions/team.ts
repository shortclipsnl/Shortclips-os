"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { roles, teamMembers, userRoles, users } from "@/db/schema";
import { ForbiddenError, requirePermission } from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export type ActionResult = { ok: boolean; message?: string; id?: string };

const ROLE_KEYS = [
  "owner",
  "admin",
  "project_coordinator",
  "content_creator",
  "videographer",
  "editor",
  "finance",
] as const;
type RoleKey = (typeof ROLE_KEYS)[number];

export type TeamMemberInput = {
  fullName: string;
  email: string;
  primaryRole: RoleKey;
  jobTitle?: string | null;
  phone?: string | null;
  weeklyVideoCapacity?: number;
  color?: string | null;
  isInternal?: boolean;
};

function clean(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

async function roleIdForKey(key: string): Promise<string | null> {
  const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
  return r?.id ?? null;
}

/** Zorgt dat de gebruiker precies de rol-koppeling heeft die bij primaryRole hoort. */
async function syncUserRole(userId: string, roleKey: string): Promise<void> {
  const roleId = await roleIdForKey(roleKey);
  if (!roleId) return;
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
}

export async function createTeamMember(input: TeamMemberInput): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("team:write");
    const fullName = clean(input.fullName);
    const email = clean(input.email)?.toLowerCase();
    if (!fullName) return { ok: false, message: "Geef een naam op." };
    if (!email) return { ok: false, message: "Geef een e-mailadres op." };
    if (!ROLE_KEYS.includes(input.primaryRole)) return { ok: false, message: "Onbekende rol." };

    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (exists) return { ok: false, message: "Er bestaat al een gebruiker met dit e-mailadres." };

    const [created] = await db
      .insert(users)
      .values({
        email,
        fullName,
        primaryRole: input.primaryRole,
        status: "active",
        phone: clean(input.phone),
      })
      .returning({ id: users.id });
    const userId = created!.id;

    await db.insert(teamMembers).values({
      userId,
      jobTitle: clean(input.jobTitle),
      weeklyVideoCapacity: input.weeklyVideoCapacity ?? 0,
      color: clean(input.color),
      isInternal: input.isInternal ?? true,
      startedAt: new Date(),
    });

    await syncUserRole(userId, input.primaryRole);

    await auditLog({
      viewer,
      action: "team.member_created",
      entityType: "user",
      entityId: userId,
      changes: { fullName, email, role: input.primaryRole },
    });

    revalidatePath("/team");
    return { ok: true, id: userId };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateTeamMember(userId: string, input: TeamMemberInput): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("team:write");
    const [user] = await db
      .select({ id: users.id, primaryRole: users.primaryRole, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { ok: false, message: "Teamlid niet gevonden." };

    const fullName = clean(input.fullName);
    const email = clean(input.email)?.toLowerCase();
    if (!fullName) return { ok: false, message: "Geef een naam op." };
    if (!email) return { ok: false, message: "Geef een e-mailadres op." };
    if (!ROLE_KEYS.includes(input.primaryRole)) return { ok: false, message: "Onbekende rol." };

    if (email !== user.email) {
      const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (clash && clash.id !== userId) return { ok: false, message: "E-mailadres is al in gebruik." };
    }

    await db
      .update(users)
      .set({ fullName, email, primaryRole: input.primaryRole, phone: clean(input.phone), updatedAt: new Date() })
      .where(eq(users.id, userId));

    // teamMembers-rij kan ontbreken bij oudere accounts → upsert.
    const [tm] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.userId, userId)).limit(1);
    if (tm) {
      await db
        .update(teamMembers)
        .set({
          jobTitle: clean(input.jobTitle),
          weeklyVideoCapacity: input.weeklyVideoCapacity ?? 0,
          color: clean(input.color),
          isInternal: input.isInternal ?? true,
          updatedAt: new Date(),
        })
        .where(eq(teamMembers.userId, userId));
    } else {
      await db.insert(teamMembers).values({
        userId,
        jobTitle: clean(input.jobTitle),
        weeklyVideoCapacity: input.weeklyVideoCapacity ?? 0,
        color: clean(input.color),
        isInternal: input.isInternal ?? true,
      });
    }

    if (input.primaryRole !== user.primaryRole) await syncUserRole(userId, input.primaryRole);

    await auditLog({
      viewer,
      action: "team.member_updated",
      entityType: "user",
      entityId: userId,
      changes: { fullName, role: input.primaryRole },
    });

    revalidatePath("/team");
    revalidatePath(`/team/${userId}/edit`);
    return { ok: true, id: userId };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Teamlid (de)activeren. Gedeactiveerd = kan niet meer inloggen, blijft wel in
 *  de historie en overzichten. */
export async function setTeamMemberActive(userId: string, active: boolean): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("team:write");
    const [user] = await db.select({ id: users.id, primaryRole: users.primaryRole }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return { ok: false, message: "Teamlid niet gevonden." };
    if (user.primaryRole === "owner" && !active) return { ok: false, message: "De eigenaar kan niet gedeactiveerd worden." };
    if (user.id === viewer.id && !active) return { ok: false, message: "Je kunt jezelf niet deactiveren." };

    await db.update(users).set({ status: active ? "active" : "suspended", updatedAt: new Date() }).where(eq(users.id, userId));

    await auditLog({
      viewer,
      action: active ? "team.member_activated" : "team.member_deactivated",
      entityType: "user",
      entityId: userId,
    });

    revalidatePath("/team");
    revalidatePath(`/team/${userId}/edit`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
