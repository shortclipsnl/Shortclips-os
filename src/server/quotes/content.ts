import "server-only";
import { createHash } from "node:crypto";
import type { QuoteContent, QuoteLineInput } from "@/lib/quotes";

/**
 * Deterministische hash over de definitieve offerte-inhoud (tekst + regels +
 * bedrag). Wordt bij accepteren/ondertekenen vastgelegd en bewijst dat een
 * geaccepteerde offerte daarna niet ongemerkt is gewijzigd.
 */
export function quoteContentHash(input: {
  content: QuoteContent;
  lines: QuoteLineInput[];
  amount: number;
  title: string;
  recipientCompany?: string | null;
}): string {
  const canonical = JSON.stringify({
    title: input.title,
    recipientCompany: input.recipientCompany ?? null,
    amount: Math.round(input.amount * 100),
    content: input.content,
    lines: input.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
