"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Loader2 } from "lucide-react";
import { Badge, ClientLogo, buttonClass, type Tone } from "@/components/ui";
import { startMonthlyReport } from "@/server/actions/monthly-reports";
import type { ReportRow } from "@/server/reports/service";

export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  gegevens_verzamelen: { label: "Gegevens verzamelen", tone: "info" },
  analyse_bezig: { label: "Analyse bezig", tone: "info" },
  klaar_voor_controle: { label: "Klaar voor controle", tone: "warn" },
  aanpassing_nodig: { label: "Aanpassing nodig", tone: "warn" },
  goedgekeurd: { label: "Goedgekeurd", tone: "good" },
  gepubliceerd: { label: "Gepubliceerd", tone: "lime" },
  mislukt: { label: "Mislukt", tone: "bad" },
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "alle", label: "Alle" },
  { key: "mijn", label: "Mijn klanten" },
  { key: "te_controleren", label: "Nog te controleren" },
  { key: "gepubliceerd", label: "Gepubliceerd" },
];

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "—";
}

export function ReportList({
  reports,
  activeClients,
  viewerId,
  canWrite,
  aiReady,
}: {
  reports: ReportRow[];
  activeClients: Array<{ id: string; name: string }>;
  viewerId: string;
  canWrite: boolean;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("alle");
  const [pm, setPm] = useState("");
  const [genClient, setGenClient] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const pms = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of reports) if (r.pmId && r.pmName) m.set(r.pmId, r.pmName);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [reports]);

  const shown = reports.filter((r) => {
    if (pm && r.pmId !== pm) return false;
    if (filter === "mijn" && r.pmId !== viewerId) return false;
    if (filter === "te_controleren" && !(r.status === "klaar_voor_controle" || r.status === "aanpassing_nodig")) return false;
    if (filter === "gepubliceerd" && r.status !== "gepubliceerd") return false;
    return true;
  });

  function generate() {
    if (!genClient) return;
    setErr(null);
    start(async () => {
      const res = await startMonthlyReport(genClient);
      if (res.ok && "reportId" in res && res.reportId) router.push(`/analytics/maandrapportages/${res.reportId}`);
      else {
        setErr(res.message ?? "Er ging iets mis.");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="sc-card flex flex-wrap items-end gap-2 p-4">
          <label className="flex-1 min-w-[220px]">
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Maandrapport genereren (vorige maand)</span>
            <select className="sc-input w-full" value={genClient} onChange={(e) => setGenClient(e.target.value)}>
              <option value="">Kies een klant…</option>
              {activeClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={generate} disabled={!genClient || pending || !aiReady} className={buttonClass({ variant: "primary", size: "md" })}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Genereren
          </button>
          {!aiReady ? <span className="text-xs text-[var(--color-ink-faint)]">AI-sleutel ontbreekt</span> : null}
          {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === f.key ? "bg-[var(--color-brand-500)] text-white" : "border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
            {f.label}
          </button>
        ))}
        {pms.length > 1 ? (
          <select className="sc-input ml-auto text-sm" value={pm} onChange={(e) => setPm(e.target.value)}>
            <option value="">{`Alle PM's`}</option>
            {pms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div className="sc-card p-6 text-sm text-[var(--color-ink-muted)]">Geen maandrapporten gevonden.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                <th className="sc-th">Klant</th><th className="sc-th">Maand</th><th className="sc-th">PM</th><th className="sc-th">Status</th><th className="sc-th">{`Video's`}</th><th className="sc-th">Analyse</th><th className="sc-th">Gepubliceerd</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = STATUS_META[r.status] ?? STATUS_META.gegevens_verzamelen;
                return (
                  <tr key={r.id} className="border-b border-[var(--color-line)]">
                    <td className="sc-td">
                      <Link href={`/analytics/maandrapportages/${r.id}`} className="inline-flex items-center gap-2 font-medium text-[var(--color-ink)] hover:underline">
                        <ClientLogo name={r.clientName} logoUrl={r.logoUrl} color={r.color} size={22} /> {r.clientName}
                      </Link>
                      {r.ontbrekend > 0 ? <span className="ml-2 text-2xs text-[var(--color-warn)]">· {r.ontbrekend} ontbreekt</span> : null}
                    </td>
                    <td className="sc-td capitalize">{r.periodLabel}</td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{r.pmName ?? "—"}</td>
                    <td className="sc-td"><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="sc-td tabular-nums">{r.aantalVideos}</td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{fmt(r.generatedAt)}</td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{fmt(r.publishedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
