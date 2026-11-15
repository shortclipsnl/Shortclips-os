import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge, clientResearchRuns, contentCompetitors } from "@/db/schema";
import { todayAmsterdam } from "@/lib/planning-deadline";
import {
  RESEARCH_KNOWLEDGE_SOURCE,
  knowledgeFromDossier,
  nextCheckDate,
  type Addition,
  type Corrections,
  type Dossier,
} from "@/lib/client-research";

export type ApproveResult = { ok: true; knowledge: number; competitors: number; nextCheckOn: string } | { ok: false; message: string };

/**
 * Menselijke goedkeuring van een onderzoek. Pas hier gaat er iets door naar de
 * rest van het portaal:
 *
 *  - Klantkennis (client_knowledge, bron "klantonderzoek"): de bron waar de
 *    Script Engine, captions, editorbriefings en Content Research al uit lezen.
 *    De regels van een vorig onderzoek worden vervangen, zodat er nooit twee
 *    versies naast elkaar staan. Wat het team zelf vastlegde blijft onaangeroerd.
 *  - Concurrenten (content_competitors): alleen namen die er nog niet staan.
 *    Een concurrent die het team eerder heeft uitgesloten, komt niet terug.
 *
 * Het dossier zelf blijft ongewijzigd bewaard.
 */
export async function approveResearch(runId: string, approver: { id: string }): Promise<ApproveResult> {
  const [run] = await db.select().from(clientResearchRuns).where(and(eq(clientResearchRuns.id, runId), isNull(clientResearchRuns.deletedAt))).limit(1);
  if (!run) return { ok: false, message: "Onderzoek niet gevonden." };
  if (run.status === "goedgekeurd") return { ok: false, message: "Dit onderzoek is al goedgekeurd." };
  if (run.status !== "controle" || !run.dossier) return { ok: false, message: "Dit onderzoek is nog niet klaar voor goedkeuring." };

  const dossier = run.dossier as Dossier;
  const drafts = knowledgeFromDossier(dossier, (run.corrections ?? {}) as Corrections, (run.additions ?? []) as Addition[]);
  const today = todayAmsterdam();
  const nextCheckOn = nextCheckDate(today);

  const competitors = await db.transaction(async (tx) => {
    await tx
      .update(clientKnowledge)
      .set({ deletedAt: new Date() })
      .where(and(eq(clientKnowledge.clientId, run.clientId), eq(clientKnowledge.source, RESEARCH_KNOWLEDGE_SOURCE), isNull(clientKnowledge.deletedAt)));
    if (drafts.length) {
      await tx.insert(clientKnowledge).values(
        drafts.map((d) => ({
          clientId: run.clientId,
          category: d.category,
          title: d.title.slice(0, 200),
          body: d.body,
          tags: ["klantonderzoek", run.id],
          source: RESEARCH_KNOWLEDGE_SOURCE,
          createdById: approver.id,
        })),
      );
    }

    // Ook verwijderde en uitgesloten concurrenten tellen als "bekend".
    const known = await tx.select({ naam: contentCompetitors.naam }).from(contentCompetitors).where(eq(contentCompetitors.clientId, run.clientId));
    const names = new Set(known.map((k) => k.naam.trim().toLowerCase()));
    const fresh = dossier.concurrenten.filter((c) => !names.has(c.naam.trim().toLowerCase()));
    if (fresh.length) {
      await tx.insert(contentCompetitors).values(
        fresh.map((c) => ({
          clientId: run.clientId,
          naam: c.naam.slice(0, 160),
          url: c.url,
          instagram: c.instagram,
          tiktok: c.tiktok,
          youtube: c.youtube,
          notitie: [c.aanpak, c.kansVoorKlant && `Kans: ${c.kansVoorKlant}`].filter(Boolean).join(" ").slice(0, 900) || null,
          bron: "ai",
          createdById: approver.id,
        })),
      );
    }

    await tx
      .update(clientResearchRuns)
      .set({ status: "goedgekeurd", approvedAt: new Date(), approvedById: approver.id, nextCheckOn, updatedAt: new Date() })
      .where(eq(clientResearchRuns.id, run.id));
    return fresh.length;
  });

  return { ok: true, knowledge: drafts.length, competitors, nextCheckOn };
}

/**
 * Na een correctie of aanvulling op een al goedgekeurd onderzoek: de
 * klantkennis opnieuw opbouwen, zodat scripts en captions met de verbeterde
 * tekst werken. Alleen voor het nieuwste goedgekeurde onderzoek van de klant;
 * een correctie op een ouder (historisch) dossier verandert de kennis niet.
 */
export async function resyncApprovedKnowledge(runId: string, userId: string): Promise<boolean> {
  const [run] = await db.select().from(clientResearchRuns).where(eq(clientResearchRuns.id, runId)).limit(1);
  if (!run || run.status !== "goedgekeurd" || !run.dossier) return false;
  const approved = await db
    .select({ id: clientResearchRuns.id, approvedAt: clientResearchRuns.approvedAt })
    .from(clientResearchRuns)
    .where(and(eq(clientResearchRuns.clientId, run.clientId), eq(clientResearchRuns.status, "goedgekeurd"), isNull(clientResearchRuns.deletedAt)));
  const newest = approved.sort((a, b) => (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0))[0];
  if (!newest || newest.id !== run.id) return false;

  const drafts = knowledgeFromDossier(run.dossier as Dossier, (run.corrections ?? {}) as Corrections, (run.additions ?? []) as Addition[]);
  await db.transaction(async (tx) => {
    await tx
      .update(clientKnowledge)
      .set({ deletedAt: new Date() })
      .where(and(eq(clientKnowledge.clientId, run.clientId), eq(clientKnowledge.source, RESEARCH_KNOWLEDGE_SOURCE), isNull(clientKnowledge.deletedAt)));
    if (drafts.length) {
      await tx.insert(clientKnowledge).values(
        drafts.map((d) => ({ clientId: run.clientId, category: d.category, title: d.title.slice(0, 200), body: d.body, tags: ["klantonderzoek", run.id], source: RESEARCH_KNOWLEDGE_SOURCE, createdById: userId })),
      );
    }
  });
  return true;
}
