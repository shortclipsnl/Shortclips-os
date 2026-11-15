import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientResearchRuns, users } from "@/db/schema";
import { aiConfigured } from "@/server/ai/client";
import {
  missingInfo,
  resumePhase,
  type Addition,
  type BaselineRow,
  type Corrections,
  type Dossier,
  type InternalBasis,
  type ResearchPhase,
  type ResearchSource,
} from "@/lib/client-research";
import { STALE_MIN, type ResearchChanges } from "./run";

export type ResearchRunView = {
  id: string;
  kind: "nulmeting" | "hercontrole";
  status: string;
  dossier: Dossier;
  baseline: BaselineRow[];
  sources: ResearchSource[];
  basis: InternalBasis & { onderzoeksdatum?: string };
  changes: ResearchChanges;
  corrections: Corrections;
  additions: Addition[];
  finishedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  nextCheckOn: string | null;
  missing: string[];
};

export type ResearchHistoryItem = { id: string; kind: string; status: string; date: Date; approvedAt: Date | null };

export type ClientResearchView = {
  aiAvailable: boolean;
  /** Het onderzoek dat getoond wordt (gekozen of het nieuwste met een dossier). */
  shown: ResearchRunView | null;
  /** Is het getoonde onderzoek het nieuwste met een dossier? */
  shownIsLatest: boolean;
  /** Nulmeting van deze klant (eerste onderzoek met een dossier), ter vergelijking. */
  nulmetingId: string | null;
  nulmetingBaseline: BaselineRow[];
  running: { id: string; phase: ResearchPhase; stale: boolean; startedAt: Date | null; kind: string } | null;
  failed: { id: string; message: string | null; at: Date | null } | null;
  history: ResearchHistoryItem[];
};

const emptyBasis: InternalBasis = { website: null, kanalen: [], briefingVelden: 0, gekoppeldeCijfers: false, contactpersoon: false };

/** Alles wat het tabblad Klantonderzoek nodig heeft, in één keer. */
export async function getClientResearchView(clientId: string, selectedId?: string | null): Promise<ClientResearchView> {
  const rows = await db
    .select({ run: clientResearchRuns, approver: users.fullName })
    .from(clientResearchRuns)
    .leftJoin(users, eq(users.id, clientResearchRuns.approvedById))
    .where(and(eq(clientResearchRuns.clientId, clientId), isNull(clientResearchRuns.deletedAt)))
    .orderBy(asc(clientResearchRuns.createdAt));

  const withDossier = rows.filter((r) => r.run.dossier && (r.run.status === "controle" || r.run.status === "goedgekeurd"));
  const latest = withDossier[withDossier.length - 1] ?? null;
  const chosen = (selectedId && withDossier.find((r) => r.run.id === selectedId)) || latest;
  const first = withDossier[0] ?? null;
  const newest = rows[rows.length - 1]?.run ?? null;

  let shown: ResearchRunView | null = null;
  if (chosen) {
    const r = chosen.run;
    const basis = { ...emptyBasis, ...((r.dataBasis ?? {}) as Partial<InternalBasis>) };
    const dossier = r.dossier as Dossier;
    const baseline = (r.baseline ?? []) as BaselineRow[];
    const ch = (r.changes ?? {}) as Partial<ResearchChanges>;
    shown = {
      id: r.id,
      kind: r.kind === "hercontrole" ? "hercontrole" : "nulmeting",
      status: r.status,
      dossier,
      baseline,
      sources: (r.sources ?? []) as ResearchSource[],
      basis,
      changes: { cijfers: Array.isArray(ch.cijfers) ? ch.cijfers : [], inhoud: Array.isArray(ch.inhoud) ? ch.inhoud : [] },
      corrections: (r.corrections ?? {}) as Corrections,
      additions: (Array.isArray(r.additions) ? r.additions : []) as Addition[],
      finishedAt: r.finishedAt,
      approvedAt: r.approvedAt,
      approvedBy: chosen.approver ?? null,
      nextCheckOn: r.nextCheckOn,
      missing: missingInfo(basis, dossier, baseline),
    };
  }

  const stale = (r: typeof clientResearchRuns.$inferSelect) => {
    const last = r.heartbeatAt ?? r.startedAt ?? r.updatedAt;
    return !r.phase.startsWith("wacht_") && (Date.now() - last.getTime()) / 60000 >= STALE_MIN;
  };

  return {
    aiAvailable: aiConfigured(),
    shown,
    shownIsLatest: Boolean(chosen && latest && chosen.run.id === latest.run.id),
    nulmetingId: first?.run.id ?? null,
    nulmetingBaseline: ((first?.run.baseline ?? []) as BaselineRow[]) ?? [],
    running: newest && newest.status === "bezig" ? { id: newest.id, phase: resumePhase(newest.phase), stale: stale(newest), startedAt: newest.startedAt, kind: newest.kind } : null,
    failed: newest && newest.status === "mislukt" ? { id: newest.id, message: newest.errorMessage, at: newest.finishedAt } : null,
    history: withDossier
      .map((r) => ({ id: r.run.id, kind: r.run.kind, status: r.run.status, date: r.run.finishedAt ?? r.run.createdAt, approvedAt: r.run.approvedAt }))
      .reverse(),
  };
}

/** Compacte status voor andere pagina's (bijv. het Contentgeheugen). */
export async function researchStatusFor(clientId: string): Promise<{ status: "geen" | "bezig" | "controle" | "goedgekeurd" | "mislukt"; date: Date | null }> {
  const rows = await db
    .select({ status: clientResearchRuns.status, finishedAt: clientResearchRuns.finishedAt, approvedAt: clientResearchRuns.approvedAt, createdAt: clientResearchRuns.createdAt })
    .from(clientResearchRuns)
    .where(and(eq(clientResearchRuns.clientId, clientId), isNull(clientResearchRuns.deletedAt)))
    .orderBy(asc(clientResearchRuns.createdAt));
  const newest = rows[rows.length - 1];
  if (!newest) return { status: "geen", date: null };
  if (newest.status === "bezig") return { status: "bezig", date: newest.createdAt };
  // Een mislukte hercontrole doet niets af aan een eerder goedgekeurd dossier.
  const good = [...rows].reverse().find((r) => r.status === "goedgekeurd" || r.status === "controle");
  if (good) return { status: good.status as "controle" | "goedgekeurd", date: good.approvedAt ?? good.finishedAt };
  return { status: "mislukt", date: newest.finishedAt };
}
