import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { quotes } from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Onvoorspelbare, beveiligde deel-link voor een offerte: 32 willekeurige bytes
 * (base64url). Het token wordt owner-only opgeslagen zodat de eigenaar de link
 * altijd opnieuw kan kopiëren; door de willekeur is hij niet te raden en zijn
 * offertes van elkaar afgeschermd.
 */

export function newQuoteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Bouwt de publieke offerte-URL. */
export function publicQuoteLink(token: string): string {
  const base = env.APP_URL.replace(/\/$/, "");
  return `${base}/offerte/${token}`;
}

/** Zoekt een offerte op het token (publieke pagina, geen sessie nodig). */
export async function peekQuoteByToken(token: string) {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.publicToken, token), isNull(quotes.deletedAt)))
    .limit(1);
  return row ?? null;
}
