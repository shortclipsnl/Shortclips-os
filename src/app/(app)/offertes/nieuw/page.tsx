import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/db/client";
import { clients, quoteTemplateVersions, salesLeads } from "@/db/schema";
import { requireQuotesAccess } from "@/server/auth/context";
import { listQuoteTemplates } from "@/server/quotes";
import { PageHeader } from "@/components/ui";
import { NieuwOfferteForm } from "./nieuw-form";
import type { QuoteContent } from "@/lib/quotes";

export const metadata: Metadata = { title: "Nieuwe offerte" };
export const dynamic = "force-dynamic";

export default async function NieuweOffertePage() {
  await requireQuotesAccess();
  const [templates, clientList, leadList] = await Promise.all([
    listQuoteTemplates(),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(and(isNull(clients.deletedAt))).orderBy(asc(clients.name)),
    db.select({ id: salesLeads.id, company: salesLeads.company }).from(salesLeads).where(and(isNull(salesLeads.deletedAt), eq(salesLeads.status, "offerte"))).orderBy(asc(salesLeads.company)),
  ]);

  // Pakketkeuzes (bijv. 6/8 video's) per sjabloon ophalen voor de wizard.
  const templatesWithPkgs = await Promise.all(
    templates.map(async (t) => {
      const [ver] = await db
        .select({ content: quoteTemplateVersions.content })
        .from(quoteTemplateVersions)
        .where(and(eq(quoteTemplateVersions.templateId, t.id), eq(quoteTemplateVersions.version, t.currentVersion)))
        .limit(1);
      const packages = ((ver?.content ?? {}) as QuoteContent).packageOptions ?? [];
      return { id: t.id, name: t.name, packages: packages.map((p) => ({ label: p.label })) };
    }),
  );

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        title="Nieuwe offerte"
        breadcrumb={<Link href="/offertes" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ChevronLeft className="size-3.5" /> Terug naar offertes</Link>}
        description="Kies een sjabloon en de klant (of lead). De gegevens worden automatisch ingevuld; daarna kun je alles nalopen en aanpassen."
      />
      <NieuwOfferteForm
        templates={templatesWithPkgs}
        clients={clientList}
        leads={leadList}
      />
    </div>
  );
}
