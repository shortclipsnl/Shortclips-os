import type { contentIdeas } from "@/db/schema";
import type { Opportunity } from "./opportunity";

/**
 * Wat de UI van een idee nodig heeft (serialiseerbaar, dus zonder Date-objecten).
 * Eén plek voor de omzetting, zodat de klantpagina en het weekoverzicht exact
 * hetzelfde idee tonen.
 */
export type Evidence = { type: string; tekst: string; zekerheid: string; url: string | null };

export type IdeaView = {
  id: string;
  clientId: string;
  titel: string;
  concept: string;
  hooks: string[];
  middenstuk: string[];
  middenstukRichting: string | null;
  ctaCommercieel: string | null;
  ctaInteractie: string | null;
  waaromWerkt: string | null;
  doel: string | null;
  inspiratieUrl: string | null;
  inspiratieLabel: string | null;
  categorie: string;
  uitvoerbaarheid: string;
  score: number;
  scoreReason: string | null;
  status: string;
  rejectionReason: string | null;
  invalshoek: string | null;
  herhaalReden: string | null;
  onderbouwing: Evidence[];
  opportunity: Opportunity | null;
  opportunityScore: number;
  forwardedAt: string | null;
  scriptLink: string | null;
  resultaat: { posts: number; views: number; relatief: number | null } | null;
  createdAt: string;
};

export function toIdeaView(i: typeof contentIdeas.$inferSelect): IdeaView {
  return {
    id: i.id,
    clientId: i.clientId,
    titel: i.titel,
    concept: i.concept,
    hooks: Array.isArray(i.hooks) ? (i.hooks as string[]) : [],
    middenstuk: Array.isArray(i.middenstuk) ? (i.middenstuk as string[]) : [],
    middenstukRichting: i.middenstukRichting,
    ctaCommercieel: i.ctaCommercieel,
    ctaInteractie: i.ctaInteractie,
    waaromWerkt: i.waaromWerkt,
    doel: i.doel,
    inspiratieUrl: i.inspiratieUrl,
    inspiratieLabel: i.inspiratieLabel,
    categorie: i.categorie,
    uitvoerbaarheid: i.uitvoerbaarheid,
    score: i.score,
    scoreReason: i.scoreReason,
    status: i.status,
    rejectionReason: i.rejectionReason,
    invalshoek: i.invalshoek,
    herhaalReden: i.herhaalReden,
    onderbouwing: Array.isArray(i.onderbouwing) ? (i.onderbouwing as Evidence[]) : [],
    opportunity: i.opportunity && Object.keys(i.opportunity as object).length ? (i.opportunity as Opportunity) : null,
    // Oudere ideeën (vóór de Opportunity Score) krijgen hun AI-score als benadering.
    opportunityScore: i.opportunityScore || i.score * 10,
    forwardedAt: i.forwardedAt ? i.forwardedAt.toISOString() : null,
    scriptLink: i.scriptLink,
    resultaat: (i.resultaat as IdeaView["resultaat"]) ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}
