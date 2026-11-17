"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { auditLog } from "@/server/audit";
import { peekAccessLink, consumeAccessLink } from "@/server/auth/access-links";
import { loginCodeRequired } from "@/server/auth/login-code";
import { createSession, destroySession } from "@/server/auth/session";
import { isAccessToken, safePortalPath } from "@/lib/access-link";

/**
 * Tik op "Doorgaan" op /toegang/<token>: controleert de link opnieuw, telt het
 * gebruik (atomair) en maakt een gewone klantsessie aan. Daarna direct naar de
 * pagina uit de link.
 */
export async function redeemAccessLinkAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const naar = String(formData.get("naar") ?? "");
  if (!isAccessToken(token)) redirect("/login");

  const info = await peekAccessLink(token);
  if (!info.ok) redirect(`/toegang/${token}${naar ? `?naar=${encodeURIComponent(naar)}` : ""}`);

  const target = naar && safePortalPath(naar) !== "/portal" ? safePortalPath(naar) : info.targetPath;

  // Staat de inlogcode per e-mail aan bij deze klant en is dit apparaat nog
  // onbekend, dan vervangt de link die extra controle niet.
  if (await loginCodeRequired({ id: info.userId, primaryRole: "client", clientId: info.clientId })) {
    redirect(`/login?verder=${encodeURIComponent(target)}&reden=code`);
  }

  if (!(await consumeAccessLink(info.linkId))) {
    redirect(`/toegang/${token}?naar=${encodeURIComponent(target)}`);
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // Was er al iemand anders ingelogd op dit apparaat? Die sessie eerst sluiten.
  await destroySession().catch(() => undefined);
  await createSession(info.userId, { ip, userAgent: h.get("user-agent") });
  await db.update(users).set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, info.userId));
  await auditLog({
    action: "auth.login_link",
    entityType: "user",
    entityId: info.userId,
    clientId: info.clientId,
    changes: { target },
  }).catch(() => undefined);

  redirect(target);
}
