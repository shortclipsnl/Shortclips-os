"use client";

import { useState, useTransition } from "react";
import { Check, Info, Loader2, RotateCcw, Save } from "lucide-react";
import { saveClientAgreementOverrides } from "@/server/actions/client-agreements";
import type { PortalSettings } from "@/server/portal-settings";
import { Button, ErrorNote } from "@/components/ui";

type Key = keyof PortalSettings;

const FIELDS: Array<{ k: Key; label: string; type: "num" | "text" }> = [
  { k: "contractTerm", label: "Looptijd", type: "text" },
  { k: "billingNote", label: "Facturatie", type: "text" },
  { k: "shootDuration", label: "Duur opnamedag", type: "text" },
  { k: "feedbackDaysScripts", label: "Feedbacktermijn scripts (werkdagen)", type: "num" },
  { k: "feedbackDaysVideos", label: "Feedbacktermijn video's (werkdagen)", type: "num" },
  { k: "extraFeedbackFee", label: "Kosten extra feedbackronde", type: "text" },
  { k: "reviewDays", label: "Beoordelingstermijn (werkdagen)", type: "num" },
  { k: "reviewAutoApproveDays", label: "Akkoord bij geen reactie (werkdagen)", type: "num" },
  { k: "reshootFee", label: "Kosten opnieuw opnemen", type: "text" },
  { k: "extraContentNote", label: "Extra content op locatie", type: "text" },
  { k: "cancelNoticeDays", label: "Annulering kosteloos tot (werkdagen)", type: "num" },
  { k: "cancelFee", label: "Annuleringskosten binnen termijn", type: "text" },
  { k: "cancelLateNote", label: "Toelichting late annulering", type: "text" },
  { k: "travelCost", label: "Reiskosten", type: "text" },
  { k: "rawFootageFee", label: "Raw footage op verzoek", type: "text" },
  { k: "responseTime", label: "Responstijd", type: "text" },
];

/**
 * Interne editor voor klantspecifieke afspraken. Leeg = de algemene afspraak
 * geldt (placeholder). Informatieve weergave in het klantportaal; de offerte
 * blijft leidend.
 */
export function AgreementOverridesEditor({
  clientId,
  general,
  overrides,
}: {
  clientId: string;
  general: PortalSettings;
  overrides: Partial<PortalSettings>;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of FIELDS) init[f.k] = overrides[f.k] != null ? String(overrides[f.k]) : "";
    return init;
  });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const overrideCount = FIELDS.filter((f) => vals[f.k]?.trim()).length;

  function save() {
    setErr(null);
    setSaved(false);
    start(async () => {
      const payload: Record<string, string> = {};
      for (const f of FIELDS) if (vals[f.k]?.trim()) payload[f.k] = vals[f.k].trim();
      const res = await saveClientAgreementOverrides(clientId, payload);
      if (res.ok) setSaved(true);
      else setErr(res.message ?? "Opslaan mislukt.");
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info-soft)]/60 px-4 py-2.5 text-sm text-[var(--color-ink)]">
        <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-info)]" />
        <p>
          Laat een veld <strong>leeg</strong> om de algemene afspraak te gebruiken (die staat als voorbeeld in het veld). Alleen afwijkende waarden worden hier bewaard.
          Dit is de <strong>informatieve weergave</strong> in het klantportaal — de offerte/overeenkomst blijft leidend.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const isOverride = !!vals[f.k]?.trim();
          return (
            <label key={f.k} className="block">
              <span className="sc-label flex items-center justify-between">
                {f.label}
                {isOverride ? <span className="rounded-full bg-[var(--color-warn-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-warn)]">afwijkend</span> : null}
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type={f.type === "num" ? "number" : "text"}
                  min={f.type === "num" ? 0 : undefined}
                  max={f.type === "num" ? 60 : undefined}
                  className="sc-input text-sm"
                  value={vals[f.k]}
                  placeholder={`Algemeen: ${general[f.k]}`}
                  onChange={(e) => setVals((p) => ({ ...p, [f.k]: e.target.value }))}
                />
                {isOverride ? (
                  <button type="button" title="Terug naar algemeen" onClick={() => setVals((p) => ({ ...p, [f.k]: "" }))} className="shrink-0 rounded-md p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
                    <RotateCcw className="size-4" />
                  </button>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4 text-[var(--color-good)]" /> : <Save className="size-4" />}
          {saved ? "Opgeslagen" : "Opslaan"}
        </Button>
        <span className="text-xs text-[var(--color-ink-muted)]">
          {overrideCount === 0 ? "Deze klant volgt volledig de algemene afspraken." : `${overrideCount} afwijkend${overrideCount === 1 ? "" : "e"} veld${overrideCount === 1 ? "" : "en"} — zichtbaar in het klantportaal.`}
        </span>
      </div>
      {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}
