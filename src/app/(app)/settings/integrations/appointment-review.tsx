"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Loader2 } from "lucide-react";
import { linkAppointmentToClient } from "@/server/actions/appointments";
import { Badge, EmptyState, ErrorNote } from "@/components/ui";

export type ReviewRow = {
  id: string;
  title: string | null;
  when: string;
  calendarName: string | null;
  color: string;
  matchConfidence: string | null;
};

type ClientOption = { id: string; name: string };

/**
 * Review-lijst "geen klant herkend": per afspraak een klant kiezen en in één klik
 * koppelen. De gekoppelde opname verschijnt daarna direct als opnamedag op de
 * editing-boards; een volgende sync laat de handmatige keuze staan.
 */
export function AppointmentReview({ rows, clients }: { rows: ReviewRow[]; clients: ClientOption[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="Alles gekoppeld"
          description="Elke gesynchroniseerde afspraak is aan een klant gekoppeld. Twijfelgevallen verschijnen hier — nooit stilletjes bij de verkeerde klant."
        />
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr>
            <th className="sc-th">Afspraak</th>
            <th className="sc-th">Wanneer</th>
            <th className="sc-th">Agenda</th>
            <th className="sc-th">Reden</th>
            <th className="sc-th">Koppel aan klant</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <ReviewRowItem key={r.id} row={r} clients={clients} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewRowItem({ row, clients }: { row: ReviewRow; clients: ClientOption[] }) {
  const [clientId, setClientId] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  function link() {
    if (!clientId) { setErr("Kies eerst een klant."); return; }
    setErr(null);
    start(async () => {
      const res = await linkAppointmentToClient(row.id, clientId);
      if (res.ok) { setDone(res.data?.clientName ?? "klant"); router.refresh(); }
      else setErr(res.message ?? "Koppelen mislukt.");
    });
  }

  if (done) {
    return (
      <tr>
        <td className="sc-td font-medium">{row.title ?? "(zonder titel)"}</td>
        <td className="sc-td text-[var(--color-ink-muted)]">{row.when}</td>
        <td className="sc-td text-[var(--color-ink-muted)]">{row.calendarName ?? "–"}</td>
        <td className="sc-td" colSpan={2}>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-good)]">
            <Check className="size-4" /> Gekoppeld aan {done} — staat nu op het board.
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="sc-td font-medium">{row.title ?? "(zonder titel)"}</td>
      <td className="sc-td text-[var(--color-ink-muted)]">{row.when}</td>
      <td className="sc-td text-[var(--color-ink-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
          {row.calendarName ?? "–"}
        </span>
      </td>
      <td className="sc-td">
        <Badge tone={row.matchConfidence === "ambiguous" ? "warn" : "neutral"}>
          {row.matchConfidence === "ambiguous" ? "meerdere mogelijk" : "geen klant herkend"}
        </Badge>
      </td>
      <td className="sc-td">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setErr(null); }}
            disabled={pending}
            className="min-w-[160px] rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-brand-500)] disabled:opacity-60"
          >
            <option value="">Kies klant…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={link}
            disabled={pending || !clientId}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            Koppelen
          </button>
        </div>
        {err ? <div className="mt-1.5"><ErrorNote>{err}</ErrorNote></div> : null}
      </td>
    </tr>
  );
}
