import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { quoteLines } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { peekQuoteByToken } from "@/server/quotes/token";
import { recordQuoteOpen } from "@/server/quotes";
import { getCompanyInfo } from "@/server/quotes/company";
import { signhostConfigured } from "@/server/quotes/signhost";
import { QuoteDocument, QUOTE_DOCUMENT_CSS, type QuoteDocData } from "@/components/quotes/quote-document";
import { PublicActions } from "./public-actions";
import type { QuoteContent } from "@/lib/quotes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offerte", robots: { index: false, follow: false } };

export default async function PublicQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ pdf?: string }>;
}) {
  const { token } = await params;
  const { pdf } = await searchParams;
  const isPdf = pdf === "1";

  const q = await peekQuoteByToken(token);
  if (!q) {
    return (
      <main className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-xl font-bold text-[#1a1d29]">Offerte niet gevonden</h1>
        <p className="mt-2 text-sm text-[#51607a]">Deze link is niet (meer) geldig. Neem contact op met Shortclips voor een nieuwe link.</p>
      </main>
    );
  }

  // Open-tracking: alléén tellen bij een echte, niet-ingelogde bezoeker en niet
  // tijdens het genereren van de PDF — zo tellen onze eigen previews niet mee.
  const viewer = await getViewer();
  if (!isPdf && !viewer) {
    const { headers } = await import("next/headers");
    const h = await headers();
    await recordQuoteOpen(q.id, {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    }).catch(() => {});
  }

  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, q.id)).orderBy(quoteLines.sortOrder);
  const company = await getCompanyInfo();

  const doc: QuoteDocData = {
    number: q.number,
    title: q.title,
    status: q.status,
    recipientCompany: q.recipientCompany,
    recipientContactName: q.recipientContactName,
    createdAt: q.createdAt,
    content: (q.content ?? { blocks: [] }) as QuoteContent,
    lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    amount: Number(q.amount),
    acceptedByName: q.acceptedByName,
    acceptedAt: q.acceptedAt,
  };

  const canAct = !isPdf && !["geaccepteerd", "ondertekend", "afgewezen"].includes(q.status);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: QUOTE_DOCUMENT_CSS }} />
      <main className={isPdf ? "" : "mx-auto max-w-[840px] px-4 py-8"}>
        <div className={isPdf ? "" : "overflow-hidden rounded-2xl bg-white shadow-[0_8px_40px_rgba(16,24,48,0.12)]"}>
          <QuoteDocument company={company} quote={doc} />
        </div>
        {canAct ? (
          <div className="mt-5">
            <PublicActions token={token} signingConfigured={signhostConfigured()} />
          </div>
        ) : null}
        {!isPdf && q.status === "geaccepteerd" ? (
          <p className="mt-4 text-center text-sm text-[#1d6b4c]">Deze offerte is geaccepteerd. Bedankt!</p>
        ) : null}
        {!isPdf && q.status === "ondertekend" ? (
          <p className="mt-4 text-center text-sm text-[#1d6b4c]">Deze offerte is ondertekend. Bedankt!</p>
        ) : null}
      </main>
    </>
  );
}
