import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { listClientsWithSessions, listInternalScriptReviews, SCRIPT_REVIEW_STATUS } from "@/server/script-review";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table } from "@/components/ui";
import { SendScriptForm } from "./send-form";

export const metadata: Metadata = { title: "Scriptcontrole" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "warn" | "info" | "good" | "neutral"> = { warn: "warn", info: "info", good: "good", neutral: "neutral" };

function fmtShoot(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

export default async function ScriptcontrolePage() {
  const viewer = await requirePermission("scripts:write");
  const [clients, reviews] = await Promise.all([listClientsWithSessions(viewer), listInternalScriptReviews(viewer)]);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Scriptcontrole"
        description="Stuur script-PDF's ter controle naar de klant. De klant bekijkt ze in het portaal, geeft feedback of keurt ze goed — zonder Adobe."
      />

      <div className="mb-6">
        <SendScriptForm clients={clients} />
      </div>

      <Card padded={false}>
        <CardHeader title="Verstuurde scripts" subtitle="De status werkt automatisch bij op basis van wat de klant doet." className="p-5 pb-2" />
        {reviews.length === 0 ? (
          <EmptyState title="Nog niets verstuurd" description="Verstuur hierboven de eerste script-PDF ter controle." />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Scripts</th>
                <th className="sc-th">Opname</th>
                <th className="sc-th text-center">Versie</th>
                <th className="sc-th text-center">Opmerkingen</th>
                <th className="sc-th">Status</th>
              </>
            }
          >
            {reviews.map((r) => {
              const meta = SCRIPT_REVIEW_STATUS[r.status];
              return (
                <tr key={r.id} style={meta.actie === "shortclips" ? { boxShadow: "inset 3px 0 0 var(--color-warn)" } : undefined}>
                  <td className="sc-td">
                    <Link href={`/clients/${r.clientSlug}`} className="font-medium hover:underline">{r.clientName}</Link>
                  </td>
                  <td className="sc-td">
                    <Link href={`/scriptcontrole/${r.id}`} className="font-medium text-[var(--color-brand-600)] hover:underline">{r.title}</Link>
                  </td>
                  <td className="sc-td tabular-nums text-[var(--color-ink-muted)]">{fmtShoot(r.shootOn)}</td>
                  <td className="sc-td text-center tabular-nums">{r.currentVersion}</td>
                  <td className="sc-td text-center tabular-nums">
                    {r.openComments > 0 ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-warn)]"><MessageSquare className="size-3.5" /> {r.openComments}</span>
                    ) : (
                      <span className="text-[var(--color-ink-faint)]">—</span>
                    )}
                  </td>
                  <td className="sc-td"><Badge tone={TONE[meta.tone]}>{meta.label}</Badge></td>
                </tr>
              );
            })}
          </Table>
        )}
        <p className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          Klantfeedback per pagina bekijken, erop reageren en een nieuwe versie uploaden komt in de volgende stap. Nu: versturen, status volgen en de goedkeuring vastleggen.
        </p>
      </Card>
    </div>
  );
}
