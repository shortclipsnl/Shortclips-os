import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { listClientsAdmin } from "@/server/clients";
import { Avatar, Badge, Card, EmptyState, InfoNote, LinkButton, PageHeader, Table } from "@/components/ui";
import { CLIENT_STATUS } from "@/lib/statuses";
import { ClientRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Klantenbeheer" };
export const dynamic = "force-dynamic";

const STOPPED = new Set(["paused", "churned"]);
const FILTERS = [
  { key: "actief", label: "Actief" },
  { key: "gestopt", label: "Gestopt" },
  { key: "alle", label: "Alle" },
] as const;

function portalBadge(email: string | null) {
  if (!email) return <Badge tone="warn">Geen login</Badge>;
  if (email.toLowerCase().endsWith("@pilot.shortclips.nl")) return <Badge tone="info">Placeholder</Badge>;
  return <Badge tone="good">Eigen e-mail</Badge>;
}

export default async function KlantenbeheerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const viewer = await requireInternal();
  if (!viewer.permissions.has("clients:write")) redirect("/clients");

  const all = await listClientsAdmin(viewer);
  const filterKey = (await searchParams).status ?? "actief";
  const rows =
    filterKey === "gestopt"
      ? all.filter((r) => STOPPED.has(r.status))
      : filterKey === "alle"
        ? all
        : all.filter((r) => !STOPPED.has(r.status));

  const activeCount = all.filter((r) => !STOPPED.has(r.status)).length;
  const stoppedCount = all.filter((r) => STOPPED.has(r.status)).length;
  const placeholderCount = all.filter(
    (r) => !STOPPED.has(r.status) && r.portalEmail?.toLowerCase().endsWith("@pilot.shortclips.nl"),
  ).length;
  const noLoginCount = all.filter((r) => !STOPPED.has(r.status) && !r.portalEmail).length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Klantenbeheer"
        description={`${activeCount} actief · ${stoppedCount} gestopt`}
        actions={<LinkButton href="/clients/new">Nieuwe klant</LinkButton>}
      />

      {placeholderCount > 0 || noLoginCount > 0 ? (
        <div className="mb-4">
          <InfoNote tone="warn">
            {placeholderCount > 0 ? `${placeholderCount} actieve klanten hebben nog een placeholder-login (@pilot.shortclips.nl). ` : ""}
            {noLoginCount > 0 ? `${noLoginCount} actieve klanten hebben nog geen portaallogin. ` : ""}
            Vul het echte e-mailadres in bij de klant en draai daarna de portaalsetup.
          </InfoNote>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = f.key === "gestopt" ? stoppedCount : f.key === "alle" ? all.length : activeCount;
          const active = f.key === filterKey;
          return (
            <Link
              key={f.key}
              href={f.key === "actief" ? "/klantenbeheer" : `/klantenbeheer?status=${f.key}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                active
                  ? "bg-[var(--color-ink)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {f.label} ({count})
            </Link>
          );
        })}
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="Geen klanten in deze weergave" description="Maak een klant aan of pas het filter aan." />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Status</th>
                <th className="sc-th">Verantwoordelijke</th>
                <th className="sc-th text-right">Shorts/maand</th>
                <th className="sc-th">Portaallogin</th>
                <th className="sc-th text-right">Acties</th>
              </>
            }
          >
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="sc-td">
                  <Link href={`/clients/${c.slug}`} className="flex items-center gap-3">
                    <Avatar name={c.name} color={c.color} size={28} />
                    <span className="font-medium">{c.name}</span>
                  </Link>
                </td>
                <td className="sc-td">
                  <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>
                    {CLIENT_STATUS[c.status]?.label ?? c.status}
                  </Badge>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">{c.coordinatorName ?? "—"}</td>
                <td className="sc-td text-right tabular-nums">{c.monthlyVideoQuota}</td>
                <td className="sc-td">{portalBadge(c.portalEmail)}</td>
                <td className="sc-td">
                  <ClientRowActions slug={c.slug} status={c.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
