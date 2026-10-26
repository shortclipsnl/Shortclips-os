"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { updatePortalSettings } from "@/server/actions/portal-settings";
import { Button, ErrorNote } from "@/components/ui";
import type { PortalSettings } from "@/server/portal-settings";

export function PortalSettingsForm({ initial }: { initial: PortalSettings }) {
  const [s, setS] = useState<PortalSettings>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function set<K extends keyof PortalSettings>(k: K, v: PortalSettings[K]) {
    setS((cur) => ({ ...cur, [k]: v }));
    setSaved(false);
  }
  function save() {
    setErr(null);
    start(async () => {
      const res = await updatePortalSettings(s);
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
      else setErr(res.message ?? "Opslaan mislukt.");
    });
  }

  const Num = ({ label, k, hint }: { label: string; k: keyof PortalSettings; hint?: string }) => (
    <label className="block">
      <span className="sc-label">{label}</span>
      <input type="number" min={0} max={60} className="sc-input" value={Number(s[k])} onChange={(e) => set(k, Number(e.target.value) as never)} />
      {hint ? <span className="mt-1 block text-2xs text-[var(--color-ink-faint)]">{hint}</span> : null}
    </label>
  );
  const Txt = ({ label, k }: { label: string; k: keyof PortalSettings }) => (
    <label className="block">
      <span className="sc-label">{label}</span>
      <input className="sc-input" value={String(s[k])} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Num label="Feedbacktermijn scripts (werkdagen)" k="feedbackDaysScripts" hint="Herinnering gaat zodra dit nadert" />
        <Num label="Feedbacktermijn video's (werkdagen)" k="feedbackDaysVideos" />
        <Num label="Annulering: kosteloos tot (werkdagen)" k="cancelNoticeDays" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Num label="Beoordelingstermijn (werkdagen)" k="reviewDays" />
        <Num label="Akkoord-bij-geen-reactie (werkdagen)" k="reviewAutoApproveDays" />
        <Txt label="Raw footage op verzoek" k="rawFootageFee" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Txt label="Annuleringskosten binnen termijn" k="cancelFee" />
        <Txt label="Reiskosten" k="travelCost" />
        <Txt label="Kosten opnieuw opnemen" k="reshootFee" />
        <Txt label="Kosten extra feedbackronde" k="extraFeedbackFee" />
        <Txt label="Responstijd" k="responseTime" />
      </div>
      <label className="block">
        <span className="sc-label">Toelichting late annulering</span>
        <textarea rows={2} className="sc-input resize-y" value={s.cancelLateNote} onChange={(e) => set("cancelLateNote", e.target.value)} />
      </label>
      <label className="block">
        <span className="sc-label">Looptijd</span>
        <textarea rows={2} className="sc-input resize-y" value={s.contractTerm} onChange={(e) => set("contractTerm", e.target.value)} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="sc-label">Facturatie</span>
          <textarea rows={2} className="sc-input resize-y" value={s.billingNote} onChange={(e) => set("billingNote", e.target.value)} />
        </label>
        <label className="block">
          <span className="sc-label">Duur opnamedag</span>
          <textarea rows={2} className="sc-input resize-y" value={s.shootDuration} onChange={(e) => set("shootDuration", e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="sc-label">Extra content op locatie</span>
        <textarea rows={2} className="sc-input resize-y" value={s.extraContentNote} onChange={(e) => set("extraContentNote", e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4 text-[var(--color-good)]" /> : null}
          {saved ? "Opgeslagen" : "Opslaan"}
        </Button>
        <span className="text-xs text-[var(--color-ink-muted)]">Deze termijnen en bedragen zijn direct zichtbaar in het klantportaal (samenwerking + scripts).</span>
      </div>
      {err ? <ErrorNote>{err}</ErrorNote> : null}
    </div>
  );
}
