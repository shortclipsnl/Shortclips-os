import "server-only";
import { desc, like } from "drizzle-orm";
import { db } from "@/db/client";
import { quotes } from "@/db/schema";

/** Volgend offertenummer: "JAAR-NNN", oplopend per jaar. Los van de auth-laag
 *  zodat ook het import-CLI (zonder sessie) dit kan gebruiken. */
export async function nextQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [row] = await db
    .select({ number: quotes.number })
    .from(quotes)
    .where(like(quotes.number, `${year}-%`))
    .orderBy(desc(quotes.number))
    .limit(1);
  const last = row?.number ? Number(row.number.split("-")[1]) : 0;
  return `${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(3, "0")}`;
}
