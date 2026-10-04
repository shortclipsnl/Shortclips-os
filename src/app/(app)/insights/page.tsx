import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { aiEnabled, listInsights } from "@/server/ai";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, periodLabel, plural } from "@/lib/format";
import { RefreshInsights } from "./refresh-button";

export const metadata: Metadata = { title: "AI-inzichten" };
export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  hook_performance: "Hooks",
  topic_performance: "Onderwerpen",
  revision_pattern: "Revisies",
  feedback_pattern: "Feedback",
  risk_signal: "Risico",
  editor_performance: "Editors",
  bottleneck: "Doorlooptijd",
  monthly_summary: "Maandsamenvatting",
  quarterly_review: "Kwartaalanalyse",
  content_recommendation: "Aanbeveling",
};

export default async function InsightsPage() {
  const viewer = await requirePermission("ai:read");
  const insights = await listInsights(viewer);
  const canRun = viewer.permissions.has("ai:run");

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="AI-inzichten"
        description="Conclusies uit je eigen data. Elk inzicht laat zien waarop het gebaseerd is."
        actions={canRun ? <RefreshInsights /> : undefined}
      />

      <Card className="mb-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-[var(--color-brand-500)]" strokeWidth={1.75} />
          <div className="text-sm text-[var(--color-ink-muted)]">
            <p>
              Deze analyses rekenen rechtstreeks op de database: gepubliceerde
              video&apos;s, statistieken, doorlooptijden en revisierondes. Er wordt
              niets geschat en niets verzonnen — is er te weinig data, dan
              verschijnt er geen inzicht.
            </p>
            <p className="mt-1.5">
              Taalmodel-samenvattingen zijn{" "}
              <strong className="font-medium text-[var(--color-ink)]">
                {aiEnabled() ? "ingeschakeld" : "uitgeschakeld"}
              </strong>
              {aiEnabled() ? "." : " — vul ANTHROPIC_API_KEY in om die toe te voegen. De berekende inzichten hierboven werken hoe dan ook."}
            </p>
          </div>
        </div>
      </Card>

      {insights.length === 0 ? (
        <Card>
          <EmptyState
            title="Nog geen inzichten"
            description="Draai de analyses zodra er genoeg gepubliceerde video's en cijfers zijn."
            icon={<Sparkles className="size-6" />}
            action={canRun ? <RefreshInsights /> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {insights.map((i) => (
            <Card key={i.id}>
              <CardHeader
                title={i.title}
                subtitle={
                  i.clientName ? (
                    <Link href={`/clients/${i.clientSlug}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <Avatar name={i.clientName} color={i.clientColor} size={16} />
                      {i.clientName}
                    </Link>
                  ) : (
                    "Alle klanten"
                  )
                }
                action={<Badge tone="info">{KIND_LABELS[i.kind] ?? i.kind}</Badge>}
              />
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{i.body}</p>

              <div className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-3">
                <p className="text-2xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
                  Gebaseerd op
                </p>
                <ul className="mt-1.5 space-y-1 text-xs">
                  {(i.evidence as Array<{ label: string; value: unknown; source?: string }>).map(
                    (e, idx) => (
                      <li key={idx} className="flex items-baseline justify-between gap-3">
                        <span className="text-[var(--color-ink-muted)]">{e.label}</span>
                        <span className="shrink-0 font-medium tabular-nums">{String(e.value)}</span>
                      </li>
                    ),
                  )}
                </ul>
                <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-2xs text-[var(--color-ink-faint)]">
                  {plural(i.sampleSize, "datapunt", "datapunten")} ·{" "}
                  {i.method === "deterministic" ? "berekend uit de database" : "samengevat door een taalmodel"}
                  {i.period ? ` · ${periodLabel(i.period)}` : ""} · {formatDate(i.generatedAt)}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
