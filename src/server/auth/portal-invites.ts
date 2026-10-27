import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { portalInvites } from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Eenmalige tokens voor het klantportaal: een uitnodiging (de klant stelt zelf
 * een wachtwoord in) of een wachtwoordherstel. Net als bij sessies bewaren we
 * alléén de SHA-256 van het token; het token zelf zit uitsluitend in de link die
 * per mail (of handmatig) wordt gedeeld. Een token verloopt en is één keer te
 * gebruiken.
 */

export type InvitePurpose = "invite" | "reset";

/** Uitnodiging blijft 7 dagen geldig, een herstel-link 2 uur. */
const TTL_MS: Record<InvitePurpose, number> = {
  invite: 7 * 24 * 60 * 60 * 1000,
  reset: 2 * 60 * 60 * 1000,
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Maakt een nieuw token voor deze gebruiker en dit doel. Oudere, nog ongebruikte
 * tokens voor hetzelfde doel worden ongeldig gemaakt (als gebruikt gemarkeerd),
 * zodat er altijd maar één geldige link tegelijk bestaat. Geeft het token in
 * platte tekst terug — dat is het enige moment waarop het bestaat.
 */
export async function createPortalToken(
  userId: string,
  purpose: InvitePurpose,
  createdByUserId?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  // Eerdere openstaande tokens voor dit doel intrekken.
  await db
    .update(portalInvites)
    .set({ usedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(portalInvites.userId, userId),
        eq(portalInvites.purpose, purpose),
        isNull(portalInvites.usedAt),
      ),
    );

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS[purpose]);
  await db.insert(portalInvites).values({
    userId,
    tokenHash: hashToken(token),
    purpose,
    expiresAt,
    createdByUserId: createdByUserId ?? null,
  });
  return { token, expiresAt };
}

/**
 * Controleert een token zonder het te verbruiken. Geeft de gebruiker + het doel
 * terug als het geldig, ongebruikt en niet verlopen is; anders null. Voor het
 * tonen van het juiste formulier op de activerings-/herstelpagina.
 */
export async function peekPortalToken(
  token: string,
): Promise<{ userId: string; purpose: InvitePurpose } | null> {
  if (!token) return null;
  const [row] = await db
    .select({ userId: portalInvites.userId, purpose: portalInvites.purpose })
    .from(portalInvites)
    .where(
      and(
        eq(portalInvites.tokenHash, hashToken(token)),
        isNull(portalInvites.usedAt),
        gt(portalInvites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { userId: row.userId, purpose: row.purpose as InvitePurpose };
}

/**
 * Verbruikt een token: markeert het als gebruikt en geeft de gebruiker terug.
 * Atomisch via de WHERE op `used_at is null`, zodat een token nooit twee keer
 * gebruikt kan worden (ook niet bij gelijktijdige requests).
 */
export async function consumePortalToken(
  token: string,
): Promise<{ userId: string; purpose: InvitePurpose } | null> {
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .update(portalInvites)
    .set({ usedAt: now, updatedAt: now })
    .where(
      and(
        eq(portalInvites.tokenHash, hashToken(token)),
        isNull(portalInvites.usedAt),
        gt(portalInvites.expiresAt, now),
      ),
    )
    .returning({ userId: portalInvites.userId, purpose: portalInvites.purpose });
  if (!row) return null;
  return { userId: row.userId, purpose: row.purpose as InvitePurpose };
}

/** De volledige link die de klant opent (activeren of wachtwoord herstellen). */
export function portalTokenLink(token: string, purpose: InvitePurpose): string {
  const base = env.APP_URL.replace(/\/$/, "");
  const path = purpose === "invite" ? "account-instellen" : "wachtwoord-herstellen";
  return `${base}/${path}/${token}`;
}
