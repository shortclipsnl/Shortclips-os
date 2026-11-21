"use server";

import { z } from "zod";
import { assertClientAccess, can, canManageClients, ForbiddenError, requireInternal } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { activePortalUsers, createAccessLink, recentAccessLinks } from "@/server/auth/access-links";
import { safePortalPath } from "@/lib/access-link";

export type PortalLinkUserOption = { id: string; name: string; email: string };

export type PersonalLinkResult =
  | { ok: true; url: string; userId: string; userName: string; expiresAt: string; users: PortalLinkUserOption[] }
  | { ok: false; message: string; users?: PortalLinkUserOption[] };

const uuid = z.string().uuid();

/** Projectcoördinatoren, de eigenaar en wie scripts mag versturen. Geen editors. */
async function requireLinkCreator() {
  const viewer = await requireInternal();
  if (viewer.isEditorOnly || !(canManageClients(viewer) || can(viewer, "scripts:write"))) {
    throw new ForbiddenError("Je mag geen inloglinks voor klanten maken.");
  }
  return viewer;
}

/**
 * Persoonlijke inloglink voor een klant maken, naar één portaalpagina. Zonder
 * userId kiest het systeem de klantgebruiker die het laatst heeft ingelogd.
 */
export async function createPersonalPortalLink(input: {
  clientId: string;
  targetPath: string;
  userId?: string | null;
}): Promise<PersonalLinkResult> {
  try {
    const viewer = await requireLinkCreator();
    if (!uuid.safeParse(input.clientId).success) return { ok: false, message: "Onbekende klant." };
    assertClientAccess(viewer, input.clientId);

    const list = await activePortalUsers(input.clientId);
    const users = list.map((u) => ({ id: u.id, name: u.fullName?.trim() || u.email, email: u.email }));
    if (users.length === 0) {
      return { ok: false, message: "Deze klant heeft nog geen actief portaalaccount.", users };
    }
    const chosen = input.userId ? users.find((u) => u.id === input.userId) : users[0];
    if (!chosen) return { ok: false, message: "Dit account hoort niet bij deze klant.", users };

    const targetPath = safePortalPath(input.targetPath);
    const res = await createAccessLink({ userId: chosen.id, targetPath, createdById: viewer.id });
    if (!res.ok) return { ok: false, message: res.message, users };

    await auditLog({
      viewer,
      action: "portal.access_link_created",
      entityType: "user",
      entityId: chosen.id,
      clientId: input.clientId,
      changes: { targetPath },
    }).catch(() => undefined);

    return { ok: true, url: res.url, userId: chosen.id, userName: res.userName, expiresAt: res.expiresAt.toISOString(), users };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    console.error("[inloglink] maken mislukt", error);
    return { ok: false, message: "De persoonlijke link kon niet worden gemaakt." };
  }
}

/** Laatste persoonlijke links van een klant (voor Klantportalen). */
export async function loadRecentPortalLinks(clientId: string) {
  try {
    const viewer = await requireLinkCreator();
    if (!uuid.safeParse(clientId).success) return [];
    assertClientAccess(viewer, clientId);
    const rows = await recentAccessLinks(clientId);
    return rows.map((r) => ({
      id: r.id,
      targetPath: r.targetPath,
      userName: r.userName?.trim() || r.email,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      useCount: r.useCount,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      revoked: Boolean(r.revokedAt),
    }));
  } catch {
    return [];
  }
}
