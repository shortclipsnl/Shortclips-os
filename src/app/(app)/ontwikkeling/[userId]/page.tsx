import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader, Stat, TeamAvatar } from "@/components/ui";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import {
  canReviewDevelopment,
  canSeeTeamDevelopment,
  canViewUserDevelopment,
  getUserMetrics,
  getUserPoints,
  getUserTrend,
} from "@/server/development";
import { GenerateButton, PointCard, type UiPoint } from "./development-ui";

export const metadata: Metadata = { title: "Ontwikkeling" };
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  owner: "Eigenaar", admin: "Beheer", project_coordinator: "Coördinator",
  content_creator: "Content", videographer: "Videograaf", editor: "Editor", finance: "Finance",
};
const TYPE_ORDER = ["fout", "vaardigheid", "feedback"] as const;
const TYPE_LABEL: Record<string, string> = {
  fout: "Terugkerende fouten",
  vaardigheid: "Ontwikkelpunten",
  feedback: "Persoonlijke feedback",
};

function pct(v: number | null) {
  return v == null ? "—" : `${v}%`;
}

export default async function DevelopmentDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const viewer = await requireInternal();
  if (!canViewUserDevelopment(viewer, userId)) notFound();

  const [person] = await db
    .select({ id: users.id, fullName: users.fullName, role: users.primaryRole, avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!person) notFound();

  const [points, metrics, trend] = await Promise.all([
    getUserPoints(userId),
    getUserMetrics(userId, 90),
    getUserTrend(userId, 10),
  ]);

  const isManager = canReviewDevelopment(viewer);
  const isSelf = viewer.id === userId;
  const canSeeTeam = canSeeTeamDevelopment(viewer);
  const aiReady = aiConfigured();

  const active = points.filter((p) => p.status === "open" || p.status === "in_progress");
  const afgehandeld = points.filter((p) => p.status === "resolved" || p.status === "dismissed");
  const byType = (t: string) => active.filter((p) => p.type === t);

  // Verloop: eerste vs laatste momentopname (vooruitgang?).
  const firstSnap = trend[0]?.metrics as Record<string, number> | undefined;
  const lastSnap = trend[trend.length - 1]?.metrics as Record<string, number> | undefined;
  const foutenDelta =
    firstSnap && lastSnap && typeof firstSnap.openFouten === "number" && typeof lastSnap.openFouten === "number"
      ? lastSnap.openFouten - firstSnap.openFouten
      : null;

  return (
    <div className="mx-auto max-w-[1000px]">
      {canSeeTeam ? (
        <Link href="/ontwikkeling" className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          <ArrowLeft className="size-4" /> Alle medewerkers
        </Link>
      ) : null}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <TeamAvatar name={person.fullName} avatarUrl={person.avatarUrl} size={44} />
          <div>
            <h1 className="text-xl font-bold text-[var(--color-ink)]">{isSelf ? "Mijn ontwikkeling" : person.fullName}</h1>
            <p className="text-sm text-[var(--color-ink-muted)]">
              {ROLE_LABEL[person.role] ?? person.role} · ontwikkelpunten op basis van je eigen cijfers en feedback
            </p>
          </div>
        </div>
        {isSelf || isManager ? <GenerateButton userId={userId} hasPoints={points.length > 0} available={aiReady} /> : null}
      </div>

      {/* Kerncijfers (objectief, geen oordeel) */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Opgeleverd (90d)" value={String(metrics.opgeleverd)} />
        <Stat
          label="Interne correctie"
          value={pct(metrics.internalCorrectionRate)}
          tone={metrics.internalCorrectionRate != null && metrics.internalCorrectionRate > 20 ? "warn" : "good"}
        />
        <Stat
          label="Op tijd"
          value={pct(metrics.onTimeRate)}
          tone={metrics.onTimeRate != null && metrics.onTimeRate < 80 ? "warn" : "good"}
        />
        <Stat
          label="Open fouten"
          value={String(active.filter((p) => p.type === "fout").length)}
          tone={active.some((p) => p.type === "fout") ? "warn" : "good"}
        />
      </div>

      {/* Ontwikkelpunten per type */}
      {active.length === 0 ? (
        <Card>
          <EmptyState
            title="Nog geen ontwikkelpunten"
            description={
              aiReady
                ? "Klik op 'AI-analyse genereren' om op basis van de echte cijfers en feedback concrete ontwikkelpunten te laten opstellen. Er worden geen conclusies getrokken zonder voldoende gegevens."
                : "Zet ANTHROPIC_API_KEY in de omgeving; daarna kan de AI-analyse ontwikkelpunten opstellen uit de echte cijfers."
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {TYPE_ORDER.map((t) => {
            const items = byType(t);
            if (items.length === 0) return null;
            return (
              <section key={t}>
                <h2 className="mb-2 text-sm font-bold tracking-tight text-[var(--color-ink)]">{TYPE_LABEL[t]}</h2>
                <div className="space-y-2.5">
                  {items.map((p) => (
                    <PointCard key={p.id} point={p as UiPoint} isManager={isManager} isSelf={isSelf} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Verloop */}
      <Card padded={false} className="mt-6">
        <CardHeader
          title="Voortgang"
          subtitle="Dagelijkse momentopname van de kerncijfers. Zo zie je of eerdere fouten minder vaak voorkomen."
          className="p-5 pb-2"
        />
        {trend.length < 2 ? (
          <p className="px-5 pb-5 pt-1 text-sm text-[var(--color-ink-muted)]">
            Het verloop verschijnt zodra er meerdere dagelijkse momentopnames zijn (de registratie draait elke nacht automatisch).
          </p>
        ) : (
          <div className="px-5 pb-5 pt-1">
            {foutenDelta != null ? (
              <p className="mb-3 text-sm">
                {foutenDelta < 0 ? (
                  <span className="font-semibold text-[var(--color-good)]">Vooruitgang: {Math.abs(foutenDelta)} open fout(en) minder</span>
                ) : foutenDelta > 0 ? (
                  <span className="font-semibold text-[var(--color-warn)]">{foutenDelta} open fout(en) meer</span>
                ) : (
                  <span className="text-[var(--color-ink-muted)]">Aantal open fouten gelijk gebleven</span>
                )}
                <span className="text-[var(--color-ink-muted)]"> sinds de eerste momentopname.</span>
              </p>
            ) : null}
            <div className="flex items-end gap-1.5">
              {trend.map((s, i) => {
                const m = s.metrics as Record<string, number>;
                const v = typeof m.internalCorrectionRate === "number" ? m.internalCorrectionRate : 0;
                const h = Math.max(4, Math.min(100, v));
                return (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${s.snapshotOn}: interne correctie ${v}%`}>
                    <span className="flex h-20 w-full items-end">
                      <span className="w-full rounded-t bg-[var(--color-brand-500)]" style={{ height: `${h}%` }} />
                    </span>
                    <span className="text-[9px] text-[var(--color-ink-faint)]">{String(s.snapshotOn).slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Interne-correctiepercentage per momentopname (lager = beter).</p>
          </div>
        )}
      </Card>

      {/* Afgehandelde punten */}
      {afgehandeld.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-bold tracking-tight text-[var(--color-ink-muted)]">Afgehandeld ({afgehandeld.length})</h2>
          <div className="space-y-2.5">
            {afgehandeld.map((p) => (
              <PointCard key={p.id} point={p as UiPoint} isManager={isManager} isSelf={isSelf} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
