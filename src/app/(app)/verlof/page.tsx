import type { Metadata } from "next";
import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { CalendarClock, ArrowRightLeft, Clapperboard, Film, Send, Users } from "lucide-react";
import { db } from "@/db/client";
import { leaveRequests, users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TeamAvatar } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getLeaveBalances } from "@/server/leave-balance";
import { getLeaveHandover, type LeaveHandover, type HandoverItem } from "@/server/leave-handover";
import { RequestLeaveForm, ReviewButtons, CancelButton, LeaveBalances, SickReportForm } from "./leave-ui";

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
  // Saldo is privé: iedereen ziet alleen het eigen saldo; de eigenaar ziet alles.
  const visibleBalances = canApprove ? balances : balances.filter((b) => b.userId === viewer.id);

  const [mine, pending, approved, upcoming] = await Promise.all([
    db.select().from(leaveRequests).where(eq(leaveRequests.userId, viewer.id)).orderBy(desc(leaveRequests.startOn)),
    canApprove
      ? db
          .select({ id: leaveRequests.id, userId: leaveRequests.userId, name: users.fullName, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn, kind: leaveRequests.kind, note: leaveRequests.note })
          .from(leaveRequests)
          .innerJoin(users, eq(users.id, leaveRequests.userId))
          .where(and(eq(leaveRequests.status, "requested"), ne(leaveRequests.kind, "ziek")))
          .orderBy(asc(leaveRequests.startOn))
      : Promise.resolve([]),
    // Team-brede afwezigheid: alléén verlof, nooit ziekmeldingen.
    db
      .select({ id: leaveRequests.id, name: users.fullName, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn, kind: leaveRequests.kind })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(and(eq(leaveRequests.status, "approved"), ne(leaveRequests.kind, "ziek"), gte(leaveRequests.endOn, today)))
      .orderBy(asc(leaveRequests.startOn)),
    // Voor de overdrachtslijst: lopende/aankomende goedgekeurde afwezigheid
    // (verlof én ziek). Eigenaar ziet iedereen, anderen alleen zichzelf.
    db
      .select({ id: leaveRequests.id, userId: leaveRequests.userId, name: users.fullName, startOn: leaveRequests.startOn, endOn: leaveRequests.endOn, kind: leaveRequests.kind })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .where(
        and(
          eq(leaveRequests.status, "approved"),
          gte(leaveRequests.endOn, today),
          canApprove ? undefined : eq(leaveRequests.userId, viewer.id),
        ),
      )
      .orderBy(asc(leaveRequests.startOn)),
  ]);

  // Overdrachtslijst per afwezigheid: wat moet er tijdens de afwezigheid worden
  // overgenomen? Automatisch afgeleid uit opnames, opleveringen, posts en klanten.
  const handovers = await Promise.all(
    upcoming.map(async (r) => ({ req: r, items: await getLeaveHandover(r.userId, r.startOn, r.endOn) })),
  );
  const handoversWithWork = handovers.filter((h) => h.items.total > 0);

  // Ziekmeldingen zijn privé: alleen de eigenaar ziet ze hier (de persoon zelf
  // ziet de eigen melding in "Mijn verlof").
  const sickList = canApprove ? upcoming.filter((r) => r.kind === "ziek") : [];

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

      {/* Duidelijke oproep om vakantie tijdig door te geven. */}
      <div className="mb-5 flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info-soft)]/60 px-4 py-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-[var(--color-info)]" strokeWidth={1.75} />
        <p className="text-sm text-[var(--color-ink)]">
          <strong className="font-semibold">Geef je vakantie op tijd door.</strong> Vraag verlof het liefst{" "}
          <strong>minimaal 4 weken van tevoren</strong> aan, zodat we opnames, opleveringen en de klantplanning er goed
          omheen kunnen regelen. Hoe eerder bekend, hoe makkelijker we het rond krijgen.
        </p>
      </div>

      <div className="mb-5">
        <RequestLeaveForm />
      </div>

      <div className="mb-6">
        <SickReportForm />
      </div>

      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">
          {canApprove ? "Vakantiesaldo vaste medewerkers" : "Jouw vakantiesaldo"}{" "}
          <span className="font-normal text-[var(--color-ink-faint)]">· op uren (8 u per werkdag)</span>
        </h2>
        {visibleBalances.length > 0 ? (
          <LeaveBalances balances={visibleBalances} canEdit={canApprove} />
        ) : (
          <Card><p className="text-sm text-[var(--color-ink-muted)]">Voor jou wordt geen vakantiesaldo bijgehouden.</p></Card>
        )}
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

      {/* Overdracht bij afwezigheid: automatisch samengesteld bij goedkeuring. */}
      {handoversWithWork.length > 0 ? (
        <Card className="mb-5" padded={false}>
          <CardHeader
            title={canApprove ? "Overdracht bij afwezigheid" : "Jouw overdracht"}
            subtitle="Wat er tijdens de afwezigheid moet worden overgenomen — opnames, opleveringen, posts en klanten."
            className="p-5 pb-2"
          />
          <ul className="divide-y divide-[var(--color-line)]">
            {handoversWithWork.map(({ req, items }) => (
              <li key={req.id} className="px-5 py-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {canApprove ? <TeamAvatar name={req.name} size={24} /> : null}
                  <span className="text-sm font-semibold">{canApprove ? req.name : "Jij"}</span>
                  {req.kind === "ziek" ? <Badge tone="bad">ziek</Badge> : <Badge tone="warn">{req.kind}</Badge>}
                  <span className="text-xs text-[var(--color-ink-muted)]">{formatDate(req.startOn)} – {formatDate(req.endOn)}</span>
                  <span className="ml-auto text-2xs font-medium text-[var(--color-ink-faint)]">{items.total} over te dragen</span>
                </div>
                <HandoverGroups items={items} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Ziekmeldingen — uitsluitend voor de eigenaar. */}
      {canApprove && sickList.length > 0 ? (
        <Card className="mb-5" padded={false}>
          <CardHeader title={`Ziekmeldingen (${sickList.length})`} subtitle="Alleen zichtbaar voor jou." className="p-5 pb-2" />
          <ul className="divide-y divide-[var(--color-line)]">
            {sickList.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <TeamAvatar name={r.name} size={26} />
                <span className="min-w-0 flex-1 text-sm font-medium">{r.name}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{formatDate(r.startOn)} – {formatDate(r.endOn)}</span>
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
                    <span className="block text-xs text-[var(--color-ink-muted)]">{r.kind === "ziek" ? "ziekmelding" : r.kind}{r.note ? ` · ${r.note}` : ""}</span>
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

function HandoverGroups({ items }: { items: LeaveHandover }) {
  const groups: { icon: React.ReactNode; label: string; list: HandoverItem[] }[] = [
    { icon: <Clapperboard className="size-3.5" />, label: "Opnames", list: items.shoots },
    { icon: <Film className="size-3.5" />, label: "Opleveringen", list: items.deliveries },
    { icon: <Send className="size-3.5" />, label: "Posts", list: items.posts },
    { icon: <Users className="size-3.5" />, label: "Klanten (coördinatie)", list: items.clients },
  ].filter((g) => g.list.length > 0);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {groups.map((g) => (
        <div key={g.label} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)]/50 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            <ArrowRightLeft className="size-3" /> {g.label} · {g.list.length}
          </div>
          <ul className="space-y-0.5 text-xs">
            {g.list.slice(0, 6).map((it) => (
              <li key={it.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  {it.clientName ? <span className="font-medium">{it.clientName}</span> : null}
                  {it.clientName && it.label !== it.clientName ? " · " : ""}
                  {it.label !== it.clientName ? it.label : ""}
                </span>
                {it.date ? <span className="shrink-0 text-[var(--color-ink-faint)]">{formatDate(it.date)}</span> : null}
              </li>
            ))}
            {g.list.length > 6 ? <li className="text-[var(--color-ink-faint)]">+{g.list.length - 6} meer</li> : null}
          </ul>
        </div>
      ))}
    </div>
  );
}
