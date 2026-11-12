import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { passkeys, pushSubscriptions, trustedDevices } from "@/db/schema";

/**
 * Trekt alles in wat een klantaccount buiten een sessie om op een toestel heeft:
 * push-abonnementen, vertrouwde apparaten (inlogcode) en passkeys (Face ID / Touch ID). Gebruikt bij
 * deactiveren, een gepauzeerde of beëindigde samenwerking en een wachtwoordreset.
 */
export async function revokeClientAppAccess(userId: string): Promise<void> {
  const now = new Date();
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)));
  await db
    .update(trustedDevices)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)));
  await db
    .update(passkeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(passkeys.userId, userId), isNull(passkeys.revokedAt)));
}
