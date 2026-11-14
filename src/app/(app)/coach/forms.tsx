"use client";

import { useActionState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { avondIndienen, ochtendNu, weekNu, zetActieStatus, type CoachActionState } from "@/server/actions/coach";

const START: CoachActionState = { ok: true };

function Melding({ state }: { state: CoachActionState }) {
  if (!state.message) return null;
  return <p className={`text-sm ${state.ok ? "text-[#1d6b4c]" : "text-[#a3271c]"}`}>{state.message}</p>;
}

export function GenereerKnop({ soort, label }: { soort: "ochtend" | "week"; label: string }) {
  const [state, action, pending] = useActionState(soort === "ochtend" ? ochtendNu : weekNu, START);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Coach denkt na (ongeveer een minuut)..." : label}
      </button>
      <Melding state={state} />
    </form>
  );
}

export function AvondFormulier({ initial }: { initial?: { gedaan?: string; uitkomsten?: string; salesgesprekken?: number | null; offertesOpgevolgd?: number | null; verspild?: string } }) {
  const [state, action, pending] = useActionState(avondIndienen, START);
  const veld = "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]";
  const label = "mb-1 block text-xs font-medium text-[var(--color-ink-muted)]";
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className={label} htmlFor="gedaan">Wat heb je vandaag echt gedaan?</label>
        <textarea id="gedaan" name="gedaan" rows={3} required defaultValue={initial?.gedaan} className={veld} placeholder="Bijvoorbeeld: offerte Zocon opgevolgd, Partnerjaar-voorstel naar 2 klanten, 2 uur aan het portaal" />
      </div>
      <div>
        <label className={label} htmlFor="uitkomsten">Wat leverde het op?</label>
        <textarea id="uitkomsten" name="uitkomsten" rows={2} defaultValue={initial?.uitkomsten} className={veld} placeholder="Uitkomsten van gesprekken, akkoorden, afwijzingen" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="salesgesprekken">Salesgesprekken</label>
          <input id="salesgesprekken" name="salesgesprekken" type="number" min={0} max={200} defaultValue={initial?.salesgesprekken ?? ""} className={veld} />
        </div>
        <div>
          <label className={label} htmlFor="offertesOpgevolgd">Offertes opgevolgd</label>
          <input id="offertesOpgevolgd" name="offertesOpgevolgd" type="number" min={0} max={200} defaultValue={initial?.offertesOpgevolgd ?? ""} className={veld} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="verspild">Waar ging tijd naartoe die je achteraf anders had besteed? (optioneel)</label>
        <textarea id="verspild" name="verspild" rows={2} defaultValue={initial?.verspild} className={veld} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass({ variant: "primary", size: "md" })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Coach beoordeelt je dag..." : "Beoordeel mijn dag"}
        </button>
        <Melding state={state} />
      </div>
    </form>
  );
}

const OPTIES = [
  { v: "gehaald", l: "Gehaald" },
  { v: "deels", l: "Deels" },
  { v: "niet", l: "Niet" },
] as const;

export function ActieStatusKnoppen({ datum, index, status }: { datum: string; index: number; status?: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      {OPTIES.map((o) => {
        const actief = status === o.v;
        return (
          <button
            key={o.v}
            type="button"
            disabled={pending}
            onClick={() => start(() => zetActieStatus(datum, index, actief ? "open" : o.v))}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${actief ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}
