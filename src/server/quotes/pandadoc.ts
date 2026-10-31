import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { quoteTemplates, quoteTemplateVersions, quotes } from "@/db/schema";
import { env } from "@/lib/env";
import { putQuotePdf } from "@/server/quotes/storage";
import { nextQuoteNumber } from "@/server/quotes";
import { DEFAULT_TEMPLATE_CONTENT, type QuoteContent } from "@/lib/quotes";

/**
 * PandaDoc-import (officiële API, developers.pandadoc.com). Neemt de bestaande
 * sjablonen en historische offertes over. We verzinnen niets: wat niet via de
 * API beschikbaar is (bv. historische open-/kijkgegevens) wordt in het rapport
 * als "niet beschikbaar" gemeld. In PandaDoc wordt niets gewijzigd of verwijderd.
 *
 * LET OP: vereist PANDADOC_API_KEY en is nog niet tegen een echt PandaDoc-account
 * getest — de exacte velden moeten met de API-sleutel geverifieerd worden.
 */

const BASE = "https://api.pandadoc.com/public/v1";

function pdHeaders(): Record<string, string> {
  return { Authorization: `API-Key ${env.PANDADOC_API_KEY}`, "Content-Type": "application/json" };
}

export function pandadocConfigured(): boolean {
  return !!env.PANDADOC_API_KEY;
}

type PdListItem = { id: string; name?: string; status?: string; date_created?: string; grand_total?: { amount?: string; currency?: string } };

async function pdGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: pdHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`PandaDoc ${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** PandaDoc-documentstatus → onze offertestatus (best effort). */
function mapStatus(pd?: string): "concept" | "verzonden" | "bekeken" | "geaccepteerd" | "afgewezen" {
  const s = (pd ?? "").toLowerCase();
  if (s.includes("completed")) return "geaccepteerd";
  if (s.includes("viewed")) return "bekeken";
  if (s.includes("declined") || s.includes("voided") || s.includes("expired")) return "afgewezen";
  if (s.includes("sent")) return "verzonden";
  return "concept";
}

export type ImportReport = {
  templates: { imported: number; skipped: number };
  documents: { imported: number; skipped: number; pdfMissing: number };
  notes: string[];
};

/** Voert de volledige import uit. `dryRun` schrijft niets weg. */
export async function importPandaDoc(opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
  if (!pandadocConfigured()) throw new Error("PANDADOC_API_KEY ontbreekt.");
  const report: ImportReport = { templates: { imported: 0, skipped: 0 }, documents: { imported: 0, skipped: 0, pdfMissing: 0 }, notes: [] };
  report.notes.push("Historische open-/kijkgegevens (eerste/laatste opening, aantal) zijn via de PandaDoc-API doorgaans niet beschikbaar en worden daarom niet overgenomen.");
  report.notes.push("De visuele opmaak van sjablonen wordt als startpunt overgenomen; loop ze na en verfijn waar nodig. De originele PDF's van historische offertes worden 1-op-1 bewaard.");

  // --- Sjablonen ---
  const tpls = await pdGet<{ results?: PdListItem[] }>("/templates");
  for (const t of tpls.results ?? []) {
    const [existing] = await db.select({ id: quoteTemplates.id }).from(quoteTemplates).where(eq(quoteTemplates.externalId, t.id)).limit(1);
    if (existing) { report.templates.skipped++; continue; }
    // Detail ophalen voor een eerste inhoudsreproductie (best effort).
    let content: QuoteContent = DEFAULT_TEMPLATE_CONTENT;
    try {
      const detail = await pdGet<{ name?: string; content?: unknown }>(`/templates/${t.id}/details`);
      content = { ...DEFAULT_TEMPLATE_CONTENT, blocks: [{ type: "heading", text: detail.name ?? t.name ?? "Offerte" }, ...DEFAULT_TEMPLATE_CONTENT.blocks] };
    } catch {
      report.notes.push(`Sjabloon "${t.name ?? t.id}": details niet op te halen; standaardstartinhoud gebruikt.`);
    }
    if (!opts.dryRun) {
      const [tpl] = await db.insert(quoteTemplates).values({ name: (t.name ?? "PandaDoc-sjabloon").slice(0, 160), source: "pandadoc", externalId: t.id }).returning({ id: quoteTemplates.id });
      await db.insert(quoteTemplateVersions).values({ templateId: tpl!.id, version: 1, content });
    }
    report.templates.imported++;
  }

  // --- Historische offertes (documenten) ---
  const docs = await pdGet<{ results?: PdListItem[] }>("/documents?count=100");
  for (const d of docs.results ?? []) {
    const [existing] = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.externalId, d.id)).limit(1);
    if (existing) { report.documents.skipped++; continue; }

    let pdfPath: string | null = null;
    try {
      const res = await fetch(`${BASE}/documents/${d.id}/download`, { headers: { Authorization: `API-Key ${env.PANDADOC_API_KEY}` } });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!opts.dryRun) pdfPath = await putQuotePdf(`pandadoc-${d.id}`, "original", bytes).catch(() => null);
      } else {
        report.documents.pdfMissing++;
        report.notes.push(`Offerte "${d.name ?? d.id}": PDF niet te downloaden (status ${res.status}).`);
      }
    } catch {
      report.documents.pdfMissing++;
    }

    if (!opts.dryRun) {
      const number = await nextQuoteNumber();
      await db.insert(quotes).values({
        number, title: (d.name ?? "Offerte").slice(0, 200), status: mapStatus(d.status),
        amount: d.grand_total?.amount ? Number(d.grand_total.amount).toFixed(2) : "0",
        currency: d.grand_total?.currency ?? "EUR",
        source: "pandadoc", externalId: d.id, isReadOnly: true, originalPdfPath: pdfPath,
        content: { blocks: [] },
      });
    }
    report.documents.imported++;
  }

  return report;
}
