"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Target, Save, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { saveClientStrategy } from "@/server/actions/monthly-reports";

export function StrategyEditor({
  clientId,
  primaryGoal,
  secondaryGoals,
  strategyNote,
  goalOptions,
  canWrite,
}: {
  clientId: string;
  primaryGoal: string | null;
  secondaryGoals: string[];
  strategyNote: string;
  goalOptions: Array<{ value: string; label: string }>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [primary, setPrimary] = useState(primaryGoal ?? "");
  const [secondary, setSecondary] = useState<string[]>(secondaryGoals);
  const [note, setNote] = useState(strategyNote);
  const [ok, setOk] = useState(false);

  function toggle(v: string) {
    setSecondary((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  }
  function save() {
    setOk(false);
    start(async () => {
      await saveClientStrategy({ clientId, primaryGoal: primary || null, secondaryGoals: secondary, strategyNote: note });
      setOk(true);
      router.refresh();
    });
  }

  const summary = primaryGoal ? goalOptions.find((g) => g.value === primaryGoal)?.label ?? primaryGoal : "nog niet ingesteld";

  return (
    <details className="sc-card mb-4 p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--color-ink)]">
        <Target className="size-4 text-[var(--color-brand-600)]" /> Doelstelling van deze klant — <span className="font-normal text-[var(--color-ink-muted)]">{summary}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-[var(--color-ink-muted)]">Dit stuurt waar de AI-analyse op let. Doelgroep en tone-of-voice komen uit de bestaande klantprofielen.</p>
        <label className="block">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Primaire doelstelling</span>
          <select className="sc-input w-full max-w-sm" value={primary} disabled={!canWrite} onChange={(e) => setPrimary(e.target.value)}>
            <option value="">Kies…</option>
            {goalOptions.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
        <div>
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Secundaire doelstellingen</span>
          <div className="flex flex-wrap gap-1.5">
            {goalOptions.filter((g) => g.value !== primary).map((g) => (
              <button key={g.value} type="button" disabled={!canWrite} onClick={() => toggle(g.value)}
                className={`rounded-full px-3 py-1 text-xs ${secondary.includes(g.value) ? "bg-[var(--color-brand-500)] text-white" : "border border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Strategie (één zin)</span>
          <input className="sc-input w-full" value={note} disabled={!canWrite} onChange={(e) => setNote(e.target.value)} placeholder="bijv. Werkgeversmerk versterken en sollicitanten aantrekken via herkenbare medewerkersvideo's." />
        </label>
        {canWrite ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={pending} className={buttonClass({ variant: "secondary", size: "sm" })}>{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Opslaan</button>
            {ok ? <span className="text-xs text-[var(--color-good)]">Opgeslagen.</span> : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
