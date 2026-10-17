import type { Metadata } from "next";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TeamAvatar } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getLeaveBalances } from "@/server/leave-balance";
import { RequestLeaveForm, ReviewButtons, CancelButton, LeaveBalances } from "./leave-ui";

export const metadata: Metadata = { title: "Vakantieplanning" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "neutral" | "good" | "bad" | "warn" }> = {
  requested: { label: "Aangevraagd", tone: "warn" },
  approved: { label: "Goedgekeurd", tone: "good" },
  rejected: { label: "Afgewezen", tone: "bad" },
};

function overlaps(a: { startOn: string; endOn: string }, b: { startOn: string; endOn: string }) {
  return a.startOn <= b.endOn && b.startOn <= a.endOn;
}

export default async function LeavePage() {
  const viewer = await requireInternal();
  const canApprove = viewer.primaryRole === "owner";
  const today = new Date().toISOString().slice(0, 10);

  const balances = await getLeaveBalances();
  const [mine, pending, approved] = await Promise.all([
    db.select().from(leaveRequests).where(eq(leaveRequests.userId, viewer.id)).orderBy(desc(leaveRequests.startOn)),
    canApprove
      ? db
          .select({ id: leaveRequests.id, userId: leaveRequests.userId, name: users.fullName, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn, kind: leaveRequests.kind, note: leaveRequests.note })
          .from(leaveRequests)
          .innerJoin(users, eq(users.id, leaveRequests.userId))
          .where(eq(leaveRequests.status, "requested"))
          .orderBy(asc(leaveRequests.startOn))
      : Promise.resolve([]),
    db
      .select({ id: leaveRequests.id, name: users.fullName, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn, kind: leaveRequests.kind })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(and(eq(leaveRequests.status, "approved"), gte(leaveRequests.endOn, today)))
      .orderBy(asc(leaveRequests.startOn)),
  ]);

  // Overlappingen: meerdere collega's tegelijk afwezig.
  const clashes: string[] = [];
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      if (approved[i]!.name !== approved[j]!.name && overlaps(approved[i]!, approved[j]!)) {
        const from = approved[i]!.startOn > approved[j]!.startOn ? approved[i]!.startOn : approved[j]!.startOn;
        const to = approved[i]!.endOn < approved[j]!.endOn ? approved[i]!.endOn : approved[j]!.endOn;
        clashes.push(`${approved[i]!.name} en ${approved[j]!.name} zijn allebei weg (${formatDate(from)}–${formatDate(to)})`);
      }
    }
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Vakantieplanning" description="Vraag verlof aan, bekijk goedgekeurde afwezigheid en voorkom dat te veel collega's tegelijk weg zijn." />

      <div className="mb-5">
        <RequestLeaveForm />
      </div>

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Vakantiesaldo vaste medewerkers <span className="font-normal text-[var(--color-ink-faint)]">· op uren (8 u per werkdag)</span></h2>
        <LeaveBalances balances={balances} canEdit={canApprove} />
      </div>

      {canApprove && pending.length > 0 ? (
        <Card className="mb-5" padded={false}>
          <CardHeader title={`Goed te keuren (${pending.length})`} className="p-5 pb-2" />
          <ul className="divide-y divide-[var(--color-line)]">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <TeamAvatar name={r.name} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{r.name} · {r.kind}</span>
                  <span className="block text-xs text-[var(--color-ink-muted)]">{formatDate(r.startOn)} t/m {formatDate(r.endOn)}{r.note ? ` · ${r.note}` : ""}</span>
                </span>
                <ReviewButtons id={r.id} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Mijn aanvragen */}
        <Card padded={false}>
          <CardHeader title="Mijn verlof" className="p-5 pb-2" />
          {mine.length === 0 ? (
            <EmptyState title="Nog geen aanvragen" description="Vraag hierboven je eerste verlof aan." />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {mine.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{formatDate(r.startOn)} t/m {formatDate(r.endOn)}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">{r.kind}{r.note ? ` · ${r.note}` : ""}</span>
                  </span>
                  <Badge tone={STATUS[r.status]?.tone ?? "neutral"}>{STATUS[r.status]?.label ?? r.status}</Badge>
                  {r.status !== "rejected" ? <CancelButton id={r.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Goedgekeurde afwezigheid */}
        <Card padded={false}>
          <CardHeader title="Goedgekeurde afwezigheid" subtitle="Aankomende en lopende vakanties van het team." className="p-5 pb-2" />
          {clashes.length > 0 ? (
            <div className="mx-5 mb-2 rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[#8a5300]">
              <strong className="font-semibold">Let op — meerdere collega&apos;s tegelijk weg:</strong>
              <ul className="mt-1 list-disc pl-4">{clashes.slice(0, 4).map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          ) : null}
          {approved.length === 0 ? (
            <EmptyState title="Niemand gepland afwezig" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {approved.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <TeamAvatar name={r.name} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{r.name}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">{r.kind}</span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{formatDate(r.startOn)} – {formatDate(r.endOn)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
