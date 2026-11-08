import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { ProductionTimeline, WhatsNext } from "@/components/portal/client-roadmap";
import { getClientRoadmapFor } from "@/server/client-roadmap";
import type { InternalIssue } from "@/lib/client-roadmap";

/**
 * Intern: exact wat de klant op het portaaloverzicht ziet, plus de
 * controlepunten waar de automatische afleiding op ontbrekende of
 * tegenstrijdige gegevens stuitte. Alleen-lezen: wie iets wil corrigeren, doet
 * dat op de bestaande plek (opname, scriptreview, editing). Er is geen aparte
 * roadmap om bij te houden.
 */

const SEVERITY: Record<InternalIssue["severity"], { label: string; cls: string; icon: React.ReactNode }> = {
  escalate: { label: "Opvolgen", cls: "text-[var(--color-bad)]", icon: <AlertTriangle className="size-4" /> },
  warn: { label: "Controleren", cls: "text-[#b4470b]", icon: <AlertTriangle className="size-4" /> },
  info: { label: "Ter info", cls: "text-[var(--color-ink-muted)]", icon: <Info className="size-4" /> },
};

export async function RoadmapTab({ clientId }: { clientId: string }) {
  const roadmap = await getClientRoadmapFor(clientId);
  const order = { escalate: 0, warn: 1, info: 2 } as const;
  const issues = [...roadmap.issues].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Zo ziet de klant het nu</p>
        <div className="portal-studio flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-canvas)] p-4" style={{ minHeight: 0 }}>
          <WhatsNext roadmap={roadmap} />
          <ProductionTimeline roadmap={roadmap} />
        </div>
      </div>
      <Card padded={false}>
        <CardHeader
          title="Controlepunten"
          subtitle="Ontbrekende of tegenstrijdige gegevens. De klant ziet hier niets van; het portaal toont dan een veilige tekst zonder datum."
          className="p-5 pb-3"
        />
        {issues.length === 0 ? (
          <p className="flex items-center gap-2 px-5 pb-5 text-sm text-[var(--color-ink-muted)]">
            <CheckCircle2 className="size-4 text-[var(--color-good)]" /> Alles klopt: de roadmap kan volledig automatisch worden gevuld.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
            {issues.map((i, idx) => {
              const s = SEVERITY[i.severity];
              const shoot = i.sessionId ? roadmap.sessions.find((x) => x.id === i.sessionId)?.title ?? null : null;
              return (
                <li key={`${i.sessionId}-${idx}`} className="flex gap-3 px-5 py-3 text-sm">
                  <span className={`mt-0.5 shrink-0 ${s.cls}`}>{s.icon}</span>
                  <div className="min-w-0">
                    <div className={`text-[11px] font-semibold uppercase tracking-wider ${s.cls}`}>{s.label}{shoot ? ` · ${shoot}` : ""}</div>
                    <p className="mt-0.5 leading-snug">{i.message}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
